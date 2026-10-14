/**
 * T-18 / T-19 / T-20（route 侧）：把整理器产出的两类「越轮次副作用」落到库里。
 *
 * 整理器只负责**识别**——它说「这一轮用户提了相处方式的要求」、或者
 * 「关系状态出现了变化」。真正写库发生在 route，因为这里才有 visitorId、
 * companionId 与观察时刻，也才不会让记忆服务反向依赖画像表与关系表。
 *
 * 三条硬契约：
 * - **永不抛出**：对话主链路的 SSE 已经结束，这里失败只记结构化计数；
 * - **跨伴侣隔离**：每次快照写入都必须带上 companionId，不同伴侣互不覆盖；
 * - **静默轮零写入**：没有反馈、没有关系变化时连一次 io 都不做，并如实上报。
 */

import { rememberCommunicationPreference } from './communication-preference';
import {
  persistRelationshipSnapshot,
  type RelationshipSnapshotOutcome,
  type RelationshipSnapshotUpdate,
} from './relationship-snapshot';

export interface ExchangeMemoryDeps {
  /**
   * 2026-09-27（方案 B）：相处方式要求改写进**伴侣专属**的长期记忆，
   * 不再写 visitor 级的 communication_prefs.explicit_feedback——那条通道是所有伴侣共享的，
   * 一次误写会让之后新建的伴侣继承一段它没经历过的历史。
   */
  recordPreference: (input: {
    visitorId: string;
    companionId: string;
    conversationId: string;
    observedAt: string;
    text: string;
  }) => Promise<boolean>;
  persistSnapshot: (input: {
    visitorId: string;
    companionId: string;
    observedAt: string;
    update: RelationshipSnapshotUpdate | null | undefined;
  }) => Promise<RelationshipSnapshotOutcome>;
}

export interface PersistExchangeMemoriesInput {
  visitorId: string;
  companionId: string;
  /** 这条偏好来自哪个会话：伴侣级记忆要带上来源，删除会话时才能级联清理。 */
  conversationId: string;
  /** 这一轮结束那一刻（带偏移的本地时间），与整理器的 nowIso 同源。 */
  observedAt: string;
  feedback?: string[] | null;
  snapshotUpdate?: RelationshipSnapshotUpdate | null;
  /**
   * 本轮的「用户原话」来源（当前这一轮 + 整理器看到的最近几轮），用于反馈来源校验。
   *
   * 缺省（未提供 / 空数组）时**fail closed**：所有候选都被判为无来源、不写入。
   * 这条通道是 visitor 级、每个伴侣每次对话都会读到并渲染成「TA 提出的要求」，
   * 一次误写就会让之后新建的伴侣"记得"一件它没经历过的事，所以宁可少记。
   */
  userTexts?: string[] | null;
  /** 本轮的助手回复，用于识别「角色自己的台词被当成用户要求」这一类误写。 */
  assistantText?: string | null;
  deps?: Partial<ExchangeMemoryDeps>;
}

export interface ExchangeMemoryOutcome {
  feedback: {
    attempted: number;
    written: number;
    failed: number;
    /** 来源校验剔除的条数（assistantEcho + unverifiable）。 */
    dropped: number;
    /** 候选能在助手回复里找到：角色自己的台词。 */
    droppedAssistantEcho: number;
    /** 候选既不在用户原话里、也不在助手回复里：来源不明。 */
    droppedUnverifiable: number;
  };
  snapshot: RelationshipSnapshotOutcome;
  snapshotWritten: number;
  snapshotRejected: number;
  snapshotFailed: number;
}

const DEFAULT_DEPS: ExchangeMemoryDeps = {
  recordPreference: (input) => rememberCommunicationPreference(input),
  persistSnapshot: (input) => persistRelationshipSnapshot(input),
};

/**
 * 本轮的批内去重（按裁剪后的文本）+ 丢弃空白，保持首次出现顺序。
 * 跨轮重复由 appendExplicitFeedback 收敛（同一句原话提到末尾，不新增条目），
 * 这里只负责省掉同一次回复里的重复写入。
 */
function dedupeFeedback(feedback: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const pending: string[] = [];
  for (const raw of feedback ?? []) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    pending.push(text);
  }
  return pending;
}

export { normalizeFeedbackSource, filterFeedbackBySource } from './feedback-source';
import { filterFeedbackBySource } from './feedback-source';

/**
 * 逐条写入相处方式反馈。
 * 刻意串行：communication_prefs 是读改写一体的 jsonb 字段，并发写会丢更新。
 * 单条失败不影响其他条目，失败数如实计入。
 */
async function writeFeedback(
  input: PersistExchangeMemoriesInput,
  deps: ExchangeMemoryDeps,
): Promise<ExchangeMemoryOutcome['feedback']> {
  const pending = dedupeFeedback(input.feedback);
  const { kept, dropped } = filterFeedbackBySource(pending, {
    userTexts: input.userTexts,
    assistantText: input.assistantText,
  });

  if (dropped.length > 0) {
    // 这条日志是这次事故的可见性来源：整理器又想把不该写的东西写进用户偏好了吗？
    console.warn('[memory:feedback-source]', {
      visitorId: input.visitorId,
      companionId: input.companionId,
      dropped: dropped.map((entry) => entry.reason),
      sample: dropped.slice(0, 2).map((entry) => entry.text.slice(0, 40)),
    });
  }

  let written = 0;
  for (const text of kept) {
    try {
      const ok = await deps.recordPreference({
        visitorId: input.visitorId,
        companionId: input.companionId,
        conversationId: input.conversationId,
        observedAt: input.observedAt,
        text,
      });
      if (ok) written += 1;
    } catch (error) {
      console.error('[memory:feedback]', error);
    }
  }

  return {
    attempted: pending.length,
    written,
    failed: kept.length - written,
    dropped: dropped.length,
    droppedAssistantEcho: dropped.filter((entry) => entry.reason === 'assistant-echo').length,
    droppedUnverifiable: dropped.filter((entry) => entry.reason === 'unverifiable').length,
  };
}

/**
 * 落库本轮的两类副作用。返回结构化计数供调用方记日志，
 * 任何失败都只体现在计数里，不会传播给对话。
 */
export async function persistExchangeMemories(
  input: PersistExchangeMemoriesInput,
): Promise<ExchangeMemoryOutcome> {
  const deps: ExchangeMemoryDeps = { ...DEFAULT_DEPS, ...input.deps };
  const feedback = await writeFeedback(input, deps);

  const update = input.snapshotUpdate;
  let snapshot: RelationshipSnapshotOutcome;

  if (update === null || update === undefined) {
    // 多数轮次没有关系变化：此时连读库都不做，也避免把静默轮记成一次写入。
    snapshot = { status: 'skipped', reason: 'no-update' };
  } else {
    try {
      const outcome = await deps.persistSnapshot({
        visitorId: input.visitorId,
        companionId: input.companionId,
        observedAt: input.observedAt,
        update,
      });
      // persistRelationshipSnapshot 自身不抛；这里兜底只是为了不让 undefined 漏到调用方。
      snapshot = outcome ?? { status: 'failed', reason: 'write-failed' };
    } catch (error) {
      console.error('[memory:snapshot]', error);
      snapshot = { status: 'failed', reason: 'write-failed', error };
    }
  }

  return {
    feedback,
    snapshot,
    snapshotWritten: snapshot.status === 'written' ? 1 : 0,
    snapshotRejected: snapshot.status === 'rejected' ? 1 : 0,
    snapshotFailed: snapshot.status === 'failed' ? 1 : 0,
  };
}
