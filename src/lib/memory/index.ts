import type { ForgetConversationReport } from '@/lib/types';
import {
  type ForgetConversationResult,
} from './cascade-forget';
import { createProviderMemoryOrganizer } from './organizer';
import {
  type MemoryOrganizer,
  type RecallInput,
  type RecalledMemory,
  type RememberExchangeInput,
  type RememberResult,
} from './service';
import { toLocalIso } from './time-source';
import { createProfileTimeZoneResolver } from './time-zone-resolver';
import { getMemoryDependencies, getMemoryService } from './dependencies';
import { getSqlite } from '@/storage/database/db';
import { forgetSqliteConversationMemories } from './sqlite-snapshot';

export { isLongTermMemoryEnabled, isMemoryEnabled, resolveMemoryBackend, getMemoryDependencies, getMemoryService } from './dependencies';
export { rememberCommunicationPreference } from './communication-preference';

export async function recallLongTermMemories(
  input: RecallInput,
): Promise<RecalledMemory[]> {
  const service = getMemoryService();
  if (!service) return [];
  return service.recall(input);
}

/** 「别提了」留下的边界：每轮都取（不依赖检索词），失败时返回空数组，不影响对话。 */
export async function listAvoidTopics(input: { visitorId: string; companionId: string }): Promise<string[]> {
  const service = getMemoryService();
  if (!service) return [];
  return service.listAvoidTopics(input);
}

let sideEffectsOrganizer: MemoryOrganizer | null = null;

function getSideEffectsOrganizer(): MemoryOrganizer {
  if (!sideEffectsOrganizer) sideEffectsOrganizer = createProviderMemoryOrganizer();
  return sideEffectsOrganizer;
}

/** 识别侧依赖：单测注入点；不注入时用真实整理器与画像时区。 */
export interface ExchangeSideEffectDeps {
  organizer?: MemoryOrganizer;
  resolveTimeZone?: (visitorId: string) => Promise<string>;
}

export async function extractExchangeSideEffects(
  input: RememberExchangeInput,
  deps: ExchangeSideEffectDeps = {},
): Promise<Pick<RememberResult, 'feedback' | 'relationshipSnapshot'>> {
  try {
    const resolveTimeZone = deps.resolveTimeZone ?? createProfileTimeZoneResolver();
    const organizer = deps.organizer ?? getSideEffectsOrganizer();
    // T-14：与 service 同源——整理器的 nowIso 必须和快照的 observedAt 用同一个时区。
    const nowIso = toLocalIso(new Date(), await resolveTimeZone(input.visitorId));
    const plan = await organizer.organize({
      nowIso,
      visitorId: input.visitorId,
      companionId: input.companionId,
      userText: input.userText,
      assistantText: input.assistantText,
      existingMemories: [],
      recentTurns: input.recentTurns,
    });
    // 与 service 同一约定：没有产物就不增加任何键，返回值因此逐字节可预期。
    const sideEffects: Pick<RememberResult, 'feedback' | 'relationshipSnapshot'> = {};
    if (plan.communicationPrefsFeedback?.length) {
      sideEffects.feedback = plan.communicationPrefsFeedback;
    }
    if (plan.relationshipSnapshot) {
      sideEffects.relationshipSnapshot = plan.relationshipSnapshot;
    }
    return sideEffects;
  } catch (error) {
    console.error('[memory:organize]', error);
    return {};
  }
}

export async function rememberLongTermExchange(
  input: RememberExchangeInput,
  deps: ExchangeSideEffectDeps = {},
): Promise<RememberResult> {
  const service = getMemoryService();
  if (!service) {
    // 记忆关闭 ≠ 用户的话白说：向量记忆这一轮没有产出，副作用仍照常识别并带出。
    return {
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 1,
      ...(await extractExchangeSideEffects(input, deps)),
    };
  }
  return service.rememberExchange(input);
}

/**
 * 把「我主动给 TA 写了一封信」写进长期记忆（计划 §6.4）。
 *
 * 为什么不能复用 `rememberLongTermExchange`：它要求 chat 消息 id
 * （`userMessageId` / `assistantMessageId`），而信不是聊天消息、没有这些 id。
 * 伪造 id 会污染按消息 id 去重/溯源的那条链路，所以单独走 gateway.add。
 *
 * 写入的是一条 `relationship_event`：这是真实发生过的交流，
 * 用户下次说「你上周给我写信了」时角色才认得出——计划原话：这个不一致比不发信更伤。
 *
 * 失败只记日志、绝不抛错：信已经发出去了、回滚不了，
 * 也不该因为记忆失败让调度器把这封信记成一次失败。
 */
export async function rememberSentLetter(input: {
  visitorId: string;
  companionId: string;
  conversationId: string;
  subject: string;
  anchorText: string;
  sentAt: string;
}): Promise<boolean> {
  try {
    const deps = getMemoryDependencies();
    const owned = getSqlite().prepare('SELECT id FROM conversations WHERE id=? AND visitor_id=? AND companion_id=?')
      .get(input.conversationId, input.visitorId, input.companionId);
    if (!owned) return false;
    await deps.gateway.add(`我在${input.sentAt}主动给 TA 写了一封信，主题是「${input.subject}」。信里提到：${input.anchorText}`, {
      userId: input.visitorId,
      appId: deps.appId,
      metadata: {
        visitor_id: input.visitorId,
        companion_id: input.companionId,
        layer: 'L2',
        bucket: 'relationship_event',
        domain: 'relationship',
        memory_type: 'event',
        importance: 0.8,
        confidence: 'explicit',
        evidence_memory_ids: [],
        status: 'active',
        observed_at: input.sentAt,
        occurred_at: input.sentAt,
        time_precision: 'day',
        valid_until: null,
        temporal_status: 'timeless',
        source_conversation_id: input.conversationId,
        source: 'companion_letter',
      },
    });
    return true;
  } catch (error) {
    console.error('[memory:letter]', error);
    return false;
  }
}

export interface ForgetConversationTarget {
  visitorId: string;
  companionId: string;
  conversationId: string;
}

export interface ForgetConversationOutcome extends ForgetConversationResult {
  enabled: boolean;
  /**
   * 快照里「来源为该会话」的条目是否已确认清干净。
   *
   * 为什么它必须进入汇总：快照会被注入提示词。清理失败时（返回 false）记忆行也许都删掉了，
   * 但缓存副本仍会让「界面已删除、记忆仍被引用」持续最多一个 TTL / 轮次上限
   * —— 只记日志、汇总却报 cleared，就是把一处真实失败从口径里抹掉（独立核验 t8 指出）。
   *
   * ⚠️ **必填而不是可选**（独立核验 t10 指出）：写成 `?:` 会让「没给这个字段」被读成
   * 「快照没问题」⇒ 一个忘了赋值的生产者就悄悄回到报 cleared。必填把这件事交给编译器管。
   */
  snapshotCleared: boolean;
}

/** For an atomic conversation delete, call the synchronous helper in the repository transaction. */
export async function forgetConversationMemories(input: ForgetConversationTarget): Promise<ForgetConversationOutcome> {
  const result = forgetSqliteConversationMemories(getSqlite(), input);
  return { ...result, enabled: true, scanned: result.deleted, skipped: 0, failed: 0, errors: [] };
}

/**
 * 把级联遗忘的实际结果折算成可以如实讲给用户的报告（AC-15）。
 *
 * `outcome === null` 表示遗忘调用本身抛错（例如 MEM0_ENABLED=1 但缺 MEM0_API_KEY）：
 * 这种情况既不是「已清理」也不是「没有可清理的内容」，只能是「未知」。
 */
export function summarizeForgetOutcome(
  outcome: ForgetConversationOutcome | null,
): ForgetConversationReport {
  if (!outcome) return { status: 'unavailable', deleted: 0, failed: 0 };
  if (!outcome.enabled) return { status: 'disabled', deleted: 0, failed: 0 };
  // 快照没清干净也算「没清完」：它留下的副本会被注入提示词。
  //
  // 读法是 `!== true` 而不是 `=== false`：字段虽已改为**必填**（拦未来新写的构造点），
  // 但必填拦不住运行时的遗漏 —— 我实测把类型退回可选时**编译器一处都不报**，因为现存构造点本来就都给了值。
  // 所以真正的护栏在这里：只有**明确说了「已清」**才允许继续往下判。
  if (outcome.snapshotCleared !== true) {
    return { status: outcome.scanned === 0 ? 'unavailable' : 'partial', deleted: outcome.deleted, failed: outcome.failed };
  }
  if (outcome.failed > 0) {
    // 检索阶段失败时 scanned 为 0：连候选都没拿到，剩余条数不可知。
    return {
      status: outcome.scanned === 0 ? 'unavailable' : 'partial',
      deleted: outcome.deleted,
      failed: outcome.failed,
    };
  }
  // ── 以下是「根因对策」：只有当**证明得了**干净时才报 cleared ──────────────
  //
  // 原先的成功判据是「每一次 delete 都返回了」——那计的是意图，不是效果。
  // 于是四条路径都能在库里还留着记忆的同时报 cleared（独立核验 t5→t8 逐个实测）：
  // 删除静默 no-op、删了却被上限挡住、行列不出来（无来源）、列举本身不穷尽。
  // 现在这三项各自都能把结论压回 partial：
  if (!outcome.exhaustive) {
    // 列举不穷尽 ⇒「没找到」与「不存在」不可区分。宁可说没清完，也不给未经证明的断言。
    return { status: 'partial', deleted: outcome.deleted, failed: outcome.failed };
  }
  if (outcome.remaining > 0) {
    // 删除后复核仍然看得见 ⇒ 删了没删掉。
    return { status: 'partial', deleted: outcome.deleted, failed: outcome.failed };
  }
  if (outcome.unattributable > 0) {
    // 有看不出归属的行 ⇒ 无法确认它们是否属于这段对话。
    return { status: 'partial', deleted: outcome.deleted, failed: outcome.failed };
  }
  return { status: 'cleared', deleted: outcome.deleted, failed: 0 };
}

export type { ForgetConversationResult } from './cascade-forget';
export type { RecalledMemory } from './service';
export { buildRecentTurns, MAX_RECENT_TURNS } from './recent-turns';
export type { RecentTurnRow } from './recent-turns';
export { persistExchangeMemories } from './exchange-persistence';
export { recallQueries } from './service';
export { buildRecallQuery, buildSupplementalRecallQueries, RECALL_IMAGE_SUBJECT, RECALL_SUPPLEMENTAL_IMAGE_SUBJECT } from './recall-query';
export { recallWithSnapshot, applyMemoryWritesToSnapshot, existingMemoriesForWrite, type RecallSnapshotStore, type RecallSource, type RecallOutcome } from './recall-snapshot-store';
export {
  DEFAULT_RECALL_MAX_TURNS,
  DEFAULT_RECALL_TTL_MS,
  SNAPSHOT_MAX_MEMORIES,
  applyWriteToSnapshot,
  hasRecallTrigger,
  isRecallTrusted,
  markSnapshotReused,
  resolveRecallMaxTurns,
  resolveRecallTtlMs,
  shouldRefreshRecall,
  type RecallRefreshReason,
  type RecallSnapshot,
} from './recall-snapshot';
export {
  MEMORY_RECALL_SNAPSHOTS_TABLE,
  createRecallSnapshotStore,
  forgetConversationSnapshot,
} from './recall-snapshot-db';
export type { ExchangeMemoryOutcome } from './exchange-persistence';
export { createProfileTimeZoneResolver } from './time-zone-resolver';
export { DEFAULT_TIME_ZONE, toLocalIso } from './time-source';
