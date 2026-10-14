import { recallQueries, type RecalledMemory } from './service';
import {
  applyWriteToSnapshot,
  markSnapshotReused,
  resolveRecallMaxTurns,
  resolveRecallTtlMs,
  shouldRefreshRecall,
  isRecallTrusted,
  type RecallRefreshReason,
  type RecallSnapshot,
  type RecallSource,
} from './recall-snapshot';

/**
 * 伴侣级召回快照的**编排层**：决定这一轮是复用快照还是真去召回，并把结果落库。
 *
 * 与 recall-snapshot.ts 的分工：那边是纯规则，这边是「读快照 → 判断 → 召回 → 写回」的流程。
 * 存储被抽象成一个小接口，因此这一层可以完全离线测试（不需要数据库、不需要 Mem0）。
 *
 * 命名口径：快照按 `(visitor, companion)` 一行，是**伴侣级**（同一伴侣的多个会话共用
 * 同一份工作集）。原先文档写「会话级」，与实现不符，已统一。
 */

export type { RecallSource };

export interface RecallSnapshotStore {
  read(): Promise<RecallSnapshot | null>;
  write(snapshot: RecallSnapshot): Promise<void>;
}

export interface RecallOutcome {
  memories: RecalledMemory[];
  source: RecallSource;
  /** 本轮真实发出的 SEARCH 次数 —— 不是估算，是设计上确定的数。 */
  searches: number;
  reason: RecallRefreshReason;
  /**
   * 这份 `memories` 能不能当作「本轮已经可靠地召回过」交给写路径当去重依据。
   *
   * 调用方通常只拿到 `memories` 数组，而 `[]` 有两种含义：「召回成功但没有既有记忆」
   * 与「召回失败，我们不知道有哪些既有记忆」。只有前者能复用；后者若被当成空集交给
   * 整理器，Mem0 里已有的事实会被再 ADD 一遍（见 `isRecallTrusted`）。
   */
  memoriesTrusted: boolean;
}

/**
 * 决定并执行本轮的召回。
 *
 * 三种降级路径都刻意保留：
 *   - 没有存储（本地未建表 / 记忆关闭）→ 照旧实时召回
 *   - 快照新鲜 → 复用，**一次检索都不发**
 *   - 快照过期但召回失败 → 沿用旧快照（`stale-fallback`）
 *
 * 最后一条是「不会被打断」的关键：Mem0 配额打满或网络抖动时，
 * 恋人应该继续记得上一次还记得的事，而不是当场失忆。
 */
/**
 * 读快照，永不抛错。
 *
 * 读不到（表不存在、连接抖动、权限）一律当成「没有快照」处理 ——
 * 那只会让这一轮多花一次检索，而不是让整轮对话失去记忆。
 */
async function readSnapshotSafely(store: RecallSnapshotStore): Promise<RecallSnapshot | null> {
  try {
    return await store.read();
  } catch (error) {
    console.error('[memory:recall-snapshot] read failed, falling back to a live recall', error);
    return null;
  }
}

/** 写快照，永不抛错：写不进去只损失下一次的加速，绝不影响本轮结果。 */
async function writeSnapshotSafely(store: RecallSnapshotStore, snapshot: RecallSnapshot): Promise<void> {
  try {
    await store.write(snapshot);
  } catch (error) {
    console.error('[memory:recall-snapshot] write failed, continuing without cache', error);
  }
}

export async function recallWithSnapshot(input: {
  store: RecallSnapshotStore | null;
  recall: (request: { visitorId: string; companionId: string; query: string; supplementalQueries?: string[] }) => Promise<RecalledMemory[]>;
  visitorId: string;
  companionId: string;
  query: string;
  supplementalQueries?: string[];
  messageText: string;
  /**
   * @deprecated 不要再传。扇出次数由本模块用 `recallQueries`（与 `service.recall` 同一套
   * 去重/截断规则）**内部推导**，上报值因此不可能与实际发出的 SEARCH 次数漂移。
   *
   * 背景（spec review r2 的 F3-b，用变异测试证明）：原先由调用方传数字，把 route 的
   * `recallQueries(...).length` 硬编码成 3 后整套测试仍然全绿 —— 成本度量可以与真实扇出
   * 各自漂移而无人发现。成本日志是本阶段唯一的成本度量，不能有这种自由度。
   *
   * 所以**这个入参已经被彻底删除**（2026-09-30，两轴评审清理）：曾经保留它只为兼容旧调用方、
   * 传进来就忽略并记一条日志 —— 但那条日志永远不会触发（唯一调用方传的是正确值），
   * 留下的只是「存在一个可以说谎的 API 面」。现在没有任何入口能影响这个数字。
   */
  now?: Date;
  ttlMs?: number;
  maxTurns?: number;
}): Promise<RecallOutcome> {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? resolveRecallTtlMs();
  const maxTurns = input.maxTurns ?? resolveRecallMaxTurns();
  const request = {
    visitorId: input.visitorId,
    companionId: input.companionId,
    query: input.query,
    ...(input.supplementalQueries?.length ? { supplementalQueries: input.supplementalQueries } : {}),
  };
  // 唯一来源：与 service.recall 共用 recallQueries，上报值 == 实际扇出次数。
  const searchesPerRecall = recallQueries(request).length;

  if (!input.store) {
    // 没有存储（记忆关闭 / 本地未建该表）：照旧实时召回。
    // 召不回来时如实返回 unavailable，而不是把异常抛给调用方 ——
    // 调用方拿到的是一个「可读出的结论」，不是一次需要自己兜底的失败。
    try {
      const memories = await input.recall(request);
      return {
        memories, source: 'live', searches: searchesPerRecall,
        reason: 'no-snapshot', memoriesTrusted: true,
      };
    } catch (error) {
      console.error('[memory:recall]', error);
      return {
        memories: [], source: 'unavailable', searches: searchesPerRecall,
        reason: 'no-snapshot', memoriesTrusted: false,
      };
    }
  }

  // 快照的读与写都必须**永不抛错**。
  //
  // 为什么（code review r1 的 F2，三个子问题都用真实代码复现过）：
  //   - read 抛错 → 整轮 reject → 调用方兜成 []，本轮零记忆，且结构化日志根本不执行
  //     （费用可观测性随依赖一起消失，恰好是「S0 让成本可见」的反面）；
  //   - 召回成功后的 write 抛错被当成「召回失败」→ 3 次检索已经付费、Mem0 也确实返回了记忆，
  //     却因为缓存写不进去而整条丢弃；
  //   - 复用路径的 write 抛错 → 明明有可用快照，整轮却崩掉。
  // 缓存是**加速器**，不是数据源：它坏了只能让这一轮多花一次检索，绝不能改变对话结果。
  const snapshot = await readSnapshotSafely(input.store);
  const decision = shouldRefreshRecall({ snapshot, messageText: input.messageText, now, ttlMs, maxTurns });

  if (!decision.refresh && snapshot) {
    await writeSnapshotSafely(input.store, markSnapshotReused(snapshot));
    return {
      memories: snapshot.memories, source: 'snapshot', searches: 0,
      reason: decision.reason, memoriesTrusted: isRecallTrusted('snapshot'),
    };
  }

  // 只有「真去召回」这一段需要 try/catch：写入快照已经永不抛错，
  // 因此 catch 里捕获到的失败一定是召回的失败，不会被记账失败冒名顶替。
  let memories: RecalledMemory[];
  try {
    memories = await input.recall(request);
  } catch (error) {
    // 刷新失败不等于失忆：能拿出上一次的快照就继续用，拿不出来才如实返回空。
    if (snapshot && snapshot.memories.length > 0) {
      console.error('[memory:recall] refresh failed, keeping the previous snapshot', error);
      return {
        memories: snapshot.memories, source: 'stale-fallback', searches: searchesPerRecall,
        reason: decision.reason, memoriesTrusted: isRecallTrusted('stale-fallback'),
      };
    }
    console.error('[memory:recall]', error);
    return {
      memories: [], source: 'unavailable', searches: searchesPerRecall,
      reason: decision.reason, memoriesTrusted: isRecallTrusted('unavailable'),
    };
  }

  // 召回已经成功、检索已经付费：后面的写快照失败绝不能把这份结果丢掉。
  await writeSnapshotSafely(input.store, { memories, refreshedAt: now.toISOString(), turnsSinceRefresh: 0 });
  return {
    memories, source: 'live', searches: searchesPerRecall,
    reason: decision.reason, memoriesTrusted: isRecallTrusted('live'),
  };
}

/**
 * 从召回结论算出「能不能把这份 memories 当写前召回的去重依据」。
 *
 * **这是这条判断的唯一出口**：所有调用方都走这里，而不是各自重写一遍
 * `source === 'unavailable' ? … : …`。两处各判一次就会漂移 —— 而这条判断漂移的代价
 * 不是少省一次检索，是把 Mem0 里已有的事实再 ADD 一遍（code review r1 的 F1：同一句话
 * 存成两条记忆，用真实代码复现过）。
 *
 * `unavailable` 交回 `undefined`，而不是 `[]`：`undefined` 的语义是「本轮没有可信的
 * 召回结果」，于是写路径会自己安全召回一次；`[]` 的语义是「召回过，确实没有既有记忆」，
 * 那会让去重被跳过。注意即使手里有一批记忆，只要来源不可信也一律交回 `undefined` ——
 * 不可信就是不可信。
 */
export function existingMemoriesForWrite(input: {
  source: RecallSource;
  memories: RecalledMemory[];
}): RecalledMemory[] | undefined {
  return isRecallTrusted(input.source) ? input.memories : undefined;
}

/**
 * 写入路径就地维护快照：刚写下的记忆下一轮立刻可用，且**不额外消耗检索**。
 *
 * 失败只记日志：记忆已经写进 Mem0 了，快照没跟上最多让下一轮多查一次，
 * 不该反过来影响对话或写入本身。
 */
/** 批量版本：一轮里整理器可能 ADD/UPDATE/DELETE 多条，只读写一次快照。 */
export async function applyMemoryWritesToSnapshot(input: {
  store: RecallSnapshotStore | null;
  writes: ReadonlyArray<{ kind: 'add' | 'update' | 'delete'; memory: RecalledMemory }>;
}): Promise<void> {
  if (!input.store || input.writes.length === 0) return;
  const snapshot = await readSnapshotSafely(input.store);
  if (!snapshot) return;
  const memories = input.writes.reduce(
    (current, write) => applyWriteToSnapshot(current, write),
    snapshot.memories,
  );
  await writeSnapshotSafely(input.store, { ...snapshot, memories });
}
