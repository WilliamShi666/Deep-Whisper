import type { RecalledMemory } from './service';

/**
 * 会话级召回快照：把「翻一次档案」的结果缓存下来，供同一段连续对话复用。
 *
 * 为什么需要它：上下文召回一次要发 3 个 SEARCH（主 query + 2 个补充角度），
 * 而**每一条用户消息都发**。但模型本来就已经拿到最近 20 轮原文 —— 长期记忆的
 * 边际价值集中在跨会话、跨时段，连续对话里同一批记忆被反复召回几乎没有增量收益。
 * 实测观测：add ≈ 70 时 retrieval 已 > 1000（约 14:1），正是这个「每轮固定 4 次」造成的。
 *
 * 本模块只放**纯逻辑**（可离线测试）；读写数据库的部分在 recall-snapshot-store 里。
 */

export const DEFAULT_RECALL_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_RECALL_MAX_TURNS = 10;

/**
 * 快照容量上限。
 *
 * 快照是「最近一次召回的工作集」（缺省上限 30 条），写入路径会在它上面就地增删改，
 * 所以必须封顶，否则一段很长的会话会让它无限增长、最后把提示词撑爆。
 */
export const SNAPSHOT_MAX_MEMORIES = 40;

/**
 * 回忆触发词：用户明确指向过去时必须重新召回，不能拿旧快照糊弄。
 * 宁可多付一次检索，也不能在用户问「你还记得吗」时答不出来。
 */
const RECALL_TRIGGER_PATTERN = /(记得|还记得|记不记得|上次|上回|之前|以前|曾经|我说过|跟你说过|那天|当时|早先)/;

export interface RecallSnapshot {
  memories: RecalledMemory[];
  /** 上一次真正去 Mem0 召回的时刻（ISO）。 */
  refreshedAt: string;
  /** 自上次刷新以来已经复用了多少轮。 */
  turnsSinceRefresh: number;
}

/**
 * 本轮召回结果的来源。定义放在这个纯模块里（而不是编排层），
 * 是为了让 `isRecallTrusted` 这种纯判定不必反向 import 编排层、避免导入环。
 *
 *   - `live`           —— 本轮真的问了 Mem0
 *   - `snapshot`       —— 复用了过去某次真实查询的结果，本轮零检索
 *   - `stale-fallback`  —— 本轮刷新失败，沿用了上一次**真实**的结果
 *   - `unavailable`    —— 召不回来，也不知道有哪些既有记忆（唯一不可信的一种）
 */
export type RecallSource = 'live' | 'snapshot' | 'stale-fallback' | 'unavailable';

export type RecallRefreshReason =
  | 'no-snapshot'
  | 'disabled'
  | 'trigger'
  | 'turn-limit'
  | 'expired'
  | 'reuse';

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

/** `MEMORY_RECALL_TTL_MS`：0 = 关闭缓存（回滚开关）；非法值回落默认，绝不猜。 */
export function resolveRecallTtlMs(env: Record<string, string | undefined> = process.env): number {
  return readPositiveInteger(env.MEMORY_RECALL_TTL_MS, DEFAULT_RECALL_TTL_MS);
}

/** `MEMORY_RECALL_MAX_TURNS`：0 视为非法（会导致每轮都刷新），回落默认。 */
export function resolveRecallMaxTurns(env: Record<string, string | undefined> = process.env): number {
  const parsed = readPositiveInteger(env.MEMORY_RECALL_MAX_TURNS, DEFAULT_RECALL_MAX_TURNS);
  return parsed === 0 ? DEFAULT_RECALL_MAX_TURNS : parsed;
}

export function hasRecallTrigger(text: string): boolean {
  return RECALL_TRIGGER_PATTERN.test(text);
}

/**
 * 这一轮要不要真的去 Mem0 召回。
 *
 * 判断顺序（命中即返回）：
 *   1. 没有快照 → 必须召回（会话/关系第一次）
 *   2. ttl = 0 → 缓存被显式关闭
 *   3. 命中回忆触发词 → 用户在问过去的事
 *   4. 连续复用超过 maxTurns 轮 → 兜底刷新
 *   5. 快照超过 ttl → 过期
 *   6. 否则复用
 */
export function shouldRefreshRecall(input: {
  snapshot: RecallSnapshot | null;
  messageText: string;
  now: Date;
  ttlMs: number;
  maxTurns: number;
}): { refresh: boolean; reason: RecallRefreshReason } {
  if (!input.snapshot) return { refresh: true, reason: 'no-snapshot' };
  if (input.ttlMs <= 0) return { refresh: true, reason: 'disabled' };
  if (hasRecallTrigger(input.messageText)) return { refresh: true, reason: 'trigger' };
  if (input.snapshot.turnsSinceRefresh >= input.maxTurns) return { refresh: true, reason: 'turn-limit' };
  const refreshedAt = Date.parse(input.snapshot.refreshedAt);
  if (!Number.isFinite(refreshedAt) || input.now.getTime() - refreshedAt >= input.ttlMs) {
    return { refresh: true, reason: 'expired' };
  }
  return { refresh: false, reason: 'reuse' };
}

/** 复用一轮：只把计数器 +1，其他原样保留。 */
export function markSnapshotReused(snapshot: RecallSnapshot): RecallSnapshot {
  return { ...snapshot, turnsSinceRefresh: snapshot.turnsSinceRefresh + 1 };
}

/**
 * 写入路径就地维护快照。
 *
 * 为什么不能「写完就把快照作废」：作废意味着下一轮必须重新召回（3 次检索），
 * 而整理器大约每 3~4 轮就会写一条记忆 —— 那等于把省下来的检索又还回去。
 * 直接在快照上增删改，刚写下的记忆下一轮就能被用到，且零额外检索。
 */
export function applyWriteToSnapshot(
  memories: readonly RecalledMemory[],
  write: { kind: 'add' | 'update' | 'delete'; memory: RecalledMemory },
): RecalledMemory[] {
  if (write.kind === 'delete') return memories.filter((memory) => memory.id !== write.memory.id);

  const withoutTarget = memories.filter((memory) => memory.id !== write.memory.id);
  // 新增与更新都放到最前面：它们是「刚刚发生的事」，比旧快照里的任何一条都更该被看到。
  return [write.memory, ...withoutTarget].slice(0, SNAPSHOT_MAX_MEMORIES);
}

/**
 * 这份召回结果能不能当作「本轮已经可靠地召回过」交给写路径当去重依据。
 *
 * 为什么需要一个显式判定（code review r1 的 F1）：调用方通常只拿到 `memories` 数组，
 * 而 `[]` 有两种截然不同的含义——
 *   - 「召回成功，Mem0 里确实没有既有记忆」→ 可以复用（整理器看到空集是正确的情报）；
 *   - 「召回失败，我们**不知道**有哪些既有记忆」→ 绝不可复用，否则整理器会把
 *     Mem0 里已有的事实再 ADD 一遍（实测可复现：同一句话被写成两条记忆）。
 * 写前的这次安全召回原本就是为后者存在的，别把它优化掉。
 *
 * `source === 'unavailable'` 是唯一「不可信」的来源：其余三种都建立在真实召回结果之上
 * （`live` 刚查过、`snapshot` 是过去某次真实查询的结果、`stale-fallback` 是在召回失败时
 * 特意沿用的**旧的真实结果**——把它当去重依据仍然安全，因为那些记忆确实存在于 Mem0）。
 */
export function isRecallTrusted(source: RecallSource): boolean {
  return source !== 'unavailable';
}
