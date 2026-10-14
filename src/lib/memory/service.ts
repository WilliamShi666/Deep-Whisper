import {
  DEFAULT_TIME_ZONE,
  resolveUserTimeZone,
  toLocalIso,
} from './time-source';

export type MemoryLayer = 'L2' | 'L3';

export type MemoryBucket =
  | 'long_term_impression'
  | 'relationship_event'
  | 'key_detail';

export type MemoryDomain =
  | 'relationship'
  | 'identity'
  | 'preference'
  | 'emotion'
  | 'support'
  | 'communication'
  | 'routine'
  | 'goal'
  | 'event'
  | 'commitment'
  | 'other';

export type MemoryConfidence = 'explicit' | 'inferred';

export type MemoryTemporalStatus =
  | 'timeless'
  | 'upcoming'
  | 'ongoing'
  | 'resolved';

export type EffectiveMemoryTemporalStatus =
  | MemoryTemporalStatus
  | 'follow_up_due';

export type MemoryTimePrecision = 'exact' | 'day' | 'approximate';

/**
 * Single source of truth for the memory type taxonomy.
 * The organizer zod schema, the bucket mapping tables and the DTO union all derive
 * from this list, so adding a type never requires editing two enumerations.
 */
/**
 * A verbatim phrase the user explicitly asked to keep. Declared once so the type
 * list, the bucket table and the domain mapping cannot drift apart.
 */
const SHARED_QUOTE_TYPE = 'shared_quote';

/**
 * 「别提了 / 忘掉它」留下的**边界**（产品口径 2026-10-01）：人不会说忘就忘，
 * 所以不删除原记忆，而是另记一条「用户不希望再被提起：X」。
 * 它每轮都会被按类型取出、单独注入提示词（不依赖检索词），见 `listAvoidTopics`。
 */
export const AVOID_TOPIC_TYPE = 'avoid_topic';

export const MEMORY_TYPE_VALUES = [
  'relationship_milestone',
  'reconciliation',
  'trust_change',
  'shared_experience',
  'preference_summary',
  'emotional_pattern',
  'support_strategy',
  'communication_style',
  'ongoing_goal',
  'routine',
  'personal_impression',
  'relationship_impression',
  'preferred_name',
  'identity_detail',
  'gift',
  'event_reason',
  'time_bounded_commitment',
  'emotion',
  'preference',
  'event',
  'promise',
  'temporary_state',
  'personal_fact',
  SHARED_QUOTE_TYPE,
  AVOID_TOPIC_TYPE,
  'other',
] as const;

export type MemoryType = (typeof MEMORY_TYPE_VALUES)[number];

export interface ProviderMemory {
  id: string;
  memory?: string;
  data?: { memory?: string } | null;
  score?: number;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RecalledMemory {
  id: string;
  text: string;
  layer: MemoryLayer;
  bucket: MemoryBucket;
  domain: MemoryDomain;
  memoryType: MemoryType;
  importance: number;
  confidence: MemoryConfidence;
  evidenceMemoryIds: string[];
  score: number | null;
  observedAt: string | null;
  occurredAt: string | null;
  timePrecision: MemoryTimePrecision | null;
  validUntil: string | null;
  temporalStatus: EffectiveMemoryTemporalStatus;
  /**
   * P2-4 / AC-15：这条记忆的「来源会话」集合。
   * ADD 写入当前会话；UPDATE 只追加、绝不覆盖，否则记忆被别的会话改写后，
   * 删除原来的会话就再也认不出它——正是 AC-15 禁止的「界面已删除、记忆仍被引用」。
   * 只有一个来源时长度仍为 1（写入侧在单来源时保持字符串形状）。
   */
  sourceConversationIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MemoryGateway {
  listCommunicationPreferences?(input: { visitorId: string; companionId: string; appId: string; cursor?: string }):
    Promise<{ memories: ProviderMemory[]; nextCursor: string | null }>;
  getById?(id: string, scope: { visitorId: string; companionId: string; appId: string }): Promise<ProviderMemory | null>;
  search(query: string, filters: Record<string, unknown>): Promise<ProviderMemory[]>;
  add(
    text: string,
    options: {
      userId: string;
      appId: string;
      metadata: Record<string, unknown>;
      expirationDate?: string;
    },
  ): Promise<ProviderMemory>;
  update(
    id: string,
    update: {
      text?: string;
      metadata?: Record<string, unknown>;
      expirationDate?: string | null;
    },
  ): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * 可选能力：按**来源会话**穷尽列出记忆（不分页、不做相似度排序）。
   *
   * 为什么需要它：级联遗忘要回答的是「哪些记忆来自这个会话」，那是**列举**，不是检索。
   * 借用 `search()` 会让候选被检索上限截断 —— 修前 `forgetConversationMemories` 就是这样，
   * 一个伴侣超过 30 条记忆时，第 31 条起永远扫不到，**删会话时它们不会被清理**。
   *
   * 声明为可选以便优雅降级：实现不了这一能力的后端仍走 `search()` 回退路径。
   */
  listBySourceConversation?(input: {
    visitorId: string;
    companionId: string;
    conversationId: string;
    appId: string;
  }): Promise<ProviderMemory[]>;
  /**
   * 可选能力：数出这个伴侣名下**看不出归属**的记忆行数（`source_conversation_ids` 为空）。
   *
   * 为什么需要它：这类行**列不出来**（不是被上限截断，是根本无从归属），
   * 所以「按来源会话穷尽列举」看不见它们，`deleted` 也就无从统计它们 ——
   * 而汇总会据此报 `cleared`，用户以为删干净了（独立核验 t8 把它列为「路径 A」，并实测了 residue）。
   * 本机开发库当前就有 4 行处于该状态（修复前写入路径的产物），所以这不是理论。
   */
  countUnattributableMemories?(input: {
    visitorId: string;
    companionId: string;
  }): Promise<number>;
  /**
   * 可选能力：取出这个伴侣名下**全部**有效的 `avoid_topic` 边界（按类型列举，不做检索）。
   *
   * 为什么不能靠 `search()`：召回按当前这句话检索，用户聊别的时边界检索不到；
   * 而「近 72 小时跨会话片段」读的是原始消息、每轮都注入 —— 不每轮带上边界，
   * TA 就会从那里把用户不想提的事翻出来。Mem0 已停用，所以只有本地后端实现它。
   */
  listAvoidTopics?(input: {
    visitorId: string;
    companionId: string;
    appId: string;
  }): Promise<ProviderMemory[]>;
}

export interface MemoryOperation {
  action: 'ADD' | 'UPDATE' | 'DELETE';
  memoryId?: string;
  text?: string;
  layer?: MemoryLayer;
  bucket?: MemoryBucket;
  domain?: MemoryDomain;
  memoryType?: MemoryType;
  importance?: number;
  confidence?: MemoryConfidence;
  evidenceMemoryIds?: string[];
  occurredAt?: string | null;
  timePrecision?: MemoryTimePrecision | null;
  validUntil?: string | null;
  temporalStatus?: MemoryTemporalStatus;
  reason: string;
}

/** T-19 / AC-12：整理器可选输出的关系快照更新，复用 relationship_snapshots 现有列。 */
export interface RelationshipSnapshotUpdate {
  relationshipStage?: string | null;
  emotionalTone?: string | null;
  dynamicSummary?: string | null;
  keyMilestones?: string[];
}

export interface MemoryPlan {
  operations: MemoryOperation[];
  /**
   * T-18 写入侧：用户在本轮对话中明确表达的「相处方式」要求。
   * 由整理器可选输出；缺省表示本轮没有此类反馈。
   */
  communicationPrefsFeedback?: string[];
  /** T-19：仅在出现真实关系变化时才出现；普通闲聊必须为 undefined。 */
  relationshipSnapshot?: RelationshipSnapshotUpdate;
}

/** T-10：整理器可见的最近成对对话（仅用于解析指代与确认语境）。 */
export interface MemoryOrganizerTurn {
  userText: string;
  assistantText: string;
}

export interface MemoryOrganizerInput {
  nowIso: string;
  visitorId: string;
  companionId: string;
  userText: string;
  assistantText: string;
  existingMemories: RecalledMemory[];
  /**
   * T-10 / AC-07：最近 2–4 轮的成对文本，仅用于解析指代与确认语境。
   * 省略（undefined）时整理器行为与既有版本完全一致（向后兼容）。
   */
  recentTurns?: MemoryOrganizerTurn[];
}

export interface MemoryOrganizer {
  organize(input: MemoryOrganizerInput): Promise<MemoryPlan>;
}

export interface RecallInput {
  visitorId: string;
  companionId: string;
  query: string;
  supplementalQueries?: string[];
}

export interface RememberExchangeInput {
  visitorId: string;
  companionId: string;
  conversationId: string;
  userMessageId: string;
  userText: string;
  assistantMessageId: string;
  assistantText: string;
  /**
   * T-10：最近 2–4 轮的成对前文，仅用于解析指代与确认语境。
   * 省略（undefined）时整理器输入与既有版本完全一致。
   */
  recentTurns?: MemoryOrganizerTurn[];
  /**
   * 本轮上下文召回的结果（见 recall-snapshot.ts）。
   *
   * 传了就用它当去重依据，**不再单独 recall 一次** —— 这是「每轮 4 次检索」降到 1 次的关键：
   * 写记忆前的这次召回与上下文那次范围完全相同，纯属重复付费。
   *
   * 省略（undefined）时保持原行为（自己 recall 一次）。这个区分很重要：
   * `[]` 表示「召回成功但确实没有既有记忆」，`undefined` 表示「没有可信的召回结果」。
   */
  existingMemories?: RecalledMemory[];
}

/**
 * 一条真正落到 Mem0 的记忆变更。
 *
 * 存在的理由：会话级召回快照要在写入后**就地**更新（见 recall-snapshot.ts），
 * 否则「刚写下的记忆」只能靠下一轮重新召回才能被看到 —— 那等于把省下的检索又还回去。
 */
export interface MemoryWriteChange {
  kind: 'add' | 'update' | 'delete';
  memory: RecalledMemory;
}

export interface RememberResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  /**
   * T-18 写入侧：整理器在本轮识别出的相处方式反馈。
   * 缺省表示没有；由调用方（chat route）负责持久化，服务自身不写库。
   */
  feedback?: string[];
  /** T-19 写入侧：本轮整理器输出的关系快照更新（缺省表示无）。 */
  relationshipSnapshot?: RelationshipSnapshotUpdate;
  /**
   * 本轮真正落地的变更（缺省 = 没有变更，返回值因此与旧版本逐字节兼容）。
   * 调用方据此就地维护会话级召回快照，避免「写完就作废 → 下一轮再召回一次」。
   */
  changes?: MemoryWriteChange[];
}

interface MemoryServiceOptions {
  enabled: boolean;
  appId: string;
  gateway: MemoryGateway;
  organizer: MemoryOrganizer;
  organizerModel?: string;
  now?: () => Date;
  recallLimit?: number;
  /**
   * T-14：用户时区的唯一来源（user_profiles.timezone → Asia/Shanghai 回退）。
   * 缺省时固定使用 DEFAULT_TIME_ZONE，既有调用方与单测因此零感知。
   */
  resolveTimeZone?: (visitorId: string) => Promise<string>;
}

const MEMORY_LAYERS = new Set<MemoryLayer>(['L2', 'L3']);
const MEMORY_BUCKETS = new Set<MemoryBucket>([
  'long_term_impression',
  'relationship_event',
  'key_detail',
]);
const MEMORY_DOMAINS = new Set<MemoryDomain>([
  'relationship',
  'identity',
  'preference',
  'emotion',
  'support',
  'communication',
  'routine',
  'goal',
  'event',
  'commitment',
  'other',
]);
const MEMORY_CONFIDENCES = new Set<MemoryConfidence>(['explicit', 'inferred']);
const MEMORY_TEMPORAL_STATUSES = new Set<MemoryTemporalStatus>([
  'timeless',
  'upcoming',
  'ongoing',
  'resolved',
]);
const MEMORY_TIME_PRECISIONS = new Set<MemoryTimePrecision>([
  'exact',
  'day',
  'approximate',
]);
const MEMORY_TYPES = new Set<MemoryType>(MEMORY_TYPE_VALUES);

const RELATIONSHIP_EVENT_TYPES = new Set<MemoryType>([
  'relationship_milestone',
  'reconciliation',
  'trust_change',
  'shared_experience',
  'event',
]);

const LONG_TERM_IMPRESSION_TYPES = new Set<MemoryType>([
  'preference_summary',
  'emotional_pattern',
  'support_strategy',
  'communication_style',
  'ongoing_goal',
  'routine',
  'personal_impression',
  'relationship_impression',
  AVOID_TOPIC_TYPE,
  // Legacy types remain readable and writable without forcing a migration.
  'emotion',
  'preference',
  'promise',
  'temporary_state',
  'personal_fact',
  'other',
]);

const KEY_DETAIL_TYPES = new Set<MemoryType>([
  'preferred_name',
  'identity_detail',
  'gift',
  'event_reason',
  'time_bounded_commitment',
  'emotion',
  'preference',
  'event',
  'promise',
  'temporary_state',
  'personal_fact',
  SHARED_QUOTE_TYPE,
  'other',
]);

/**
 * Per-bucket reservation for recall. These numbers used to act as hard
 * per-bucket caps, which let a high-scoring impression bucket crowd out every
 * relationship event and key detail. They are now a floor: each bucket is
 * guaranteed this many slots before the remaining budget is filled by rank.
 */
export const RECALL_BUCKET_FLOOR: Record<MemoryBucket, number> = {
  long_term_impression: 2,
  relationship_event: 2,
  key_detail: 2,
};

/**
 * Hard cap on how many memories a single recall call may return. Declared
 * explicitly so the limit is a real ceiling instead of an implicit
 * `Number.POSITIVE_INFINITY`.
 *
 * This one cap replaced the old per-bucket ceilings (5 / 8 / 12). Those were a
 * budget each bucket could spend on its own, so the impression bucket could eat
 * the whole allowance and the companion would "remember" the user only as a
 * summary of moods. Spread is now a property of the selection
 * (`RECALL_BUCKET_FLOOR`) and relevance is a property of `memoryRank()`, which
 * leaves this constant one job: stop unbounded growth. It is not a ration on
 * what the companion is allowed to remember, so it is deliberately not tuned
 * down to the old 25 total.
 */
export const RECALL_LIMIT_DEFAULT = 30;

const RECALL_BUCKETS = Object.keys(RECALL_BUCKET_FLOOR) as MemoryBucket[];

export const MIN_KEY_DETAIL_IMPORTANCE = 0.6;

function memoryText(memory: ProviderMemory): string {
  return memory.memory?.trim() || memory.data?.memory?.trim() || '';
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataStringArray(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const value = metadata?.[key];
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === 'string' && Boolean(item.trim()),
      ),
    ),
  ];
}

function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function deriveBucket(
  layer: MemoryLayer,
  memoryType: MemoryType,
): MemoryBucket {
  if (layer === 'L3') return 'key_detail';
  return RELATIONSHIP_EVENT_TYPES.has(memoryType)
    ? 'relationship_event'
    : 'long_term_impression';
}

function isValidLayerBucket(
  layer: MemoryLayer,
  bucket: MemoryBucket,
): boolean {
  return layer === 'L3'
    ? bucket === 'key_detail'
    : bucket === 'long_term_impression' || bucket === 'relationship_event';
}

function isValidBucketType(
  bucket: MemoryBucket,
  memoryType: MemoryType,
): boolean {
  switch (bucket) {
    case 'long_term_impression':
      return LONG_TERM_IMPRESSION_TYPES.has(memoryType);
    case 'relationship_event':
      return RELATIONSHIP_EVENT_TYPES.has(memoryType);
    case 'key_detail':
      return KEY_DETAIL_TYPES.has(memoryType);
  }
}

function deriveDomain(memoryType: MemoryType): MemoryDomain {
  switch (memoryType) {
    case 'relationship_milestone':
    case 'reconciliation':
    case 'trust_change':
    case 'shared_experience':
    case 'relationship_impression':
      return 'relationship';
    case 'preferred_name':
    case 'identity_detail':
    case 'personal_fact':
    case 'personal_impression':
    case SHARED_QUOTE_TYPE:
      return 'identity';
    case 'preference':
    case 'preference_summary':
      return 'preference';
    case 'emotion':
    case 'emotional_pattern':
      return 'emotion';
    case 'support_strategy':
      return 'support';
    case 'communication_style':
    case AVOID_TOPIC_TYPE:
      return 'communication';
    case 'routine':
      return 'routine';
    case 'ongoing_goal':
      return 'goal';
    case 'promise':
    case 'temporary_state':
    case 'time_bounded_commitment':
      return 'commitment';
    case 'event':
    case 'gift':
    case 'event_reason':
      return 'event';
    default:
      return 'other';
  }
}

function defaultImportance(bucket: MemoryBucket): number {
  switch (bucket) {
    case 'relationship_event':
      return 0.8;
    case 'long_term_impression':
      return 0.75;
    case 'key_detail':
      return 0.65;
  }
}

function isExpired(validUntil: string | null, now: Date): boolean {
  if (!validUntil) return false;
  const timestamp = Date.parse(validUntil);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

function effectiveTemporalStatus(
  temporalStatus: MemoryTemporalStatus,
  occurredAt: string | null,
  timePrecision: MemoryTimePrecision | null,
  now: Date,
): EffectiveMemoryTemporalStatus {
  if (temporalStatus !== 'upcoming' || !occurredAt) return temporalStatus;
  const timestamp = Date.parse(occurredAt);
  const followUpTimestamp =
    timePrecision === 'day' ? timestamp + 86_400_000 : timestamp;
  return Number.isFinite(followUpTimestamp) && followUpTimestamp <= now.getTime()
    ? 'follow_up_due'
    : temporalStatus;
}

/**
 * 读取 metadata.source_conversation_id 的来源会话集合。
 * ADD 写入单个字符串（历史数据同样是字符串）；被多个会话先后改写过的记忆是字符串数组。
 * 两种形状都必须认得，否则旧数据会在列表化之后统统变成「无来源」而漏删。
 */
function sourceConversationIdsOf(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const value = (metadata as Record<string, unknown>).source_conversation_id;
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item && !ids.includes(item)) ids.push(item);
  }
  return ids;
}

/**
 * P2-4 / AC-15：UPDATE 时把当前会话并入来源集合，绝不覆盖既有来源。
 * 单来源仍写成字符串，避免改动只有一处来源的既有数据形状。
 */
function mergeSourceConversationId(
  existingIds: string[],
  conversationId: string,
): string | string[] {
  const ids = [...existingIds];
  if (!ids.includes(conversationId)) ids.push(conversationId);
  const [first, ...rest] = ids;
  return first !== undefined && rest.length === 0 ? first : ids;
}

function normalizeMemory(
  memory: ProviderMemory,
  scope: { visitorId: string; companionId: string; appId: string },
  now: Date,
): RecalledMemory | null {
  const metadata = memory.metadata;
  const text = memoryText(memory);
  const layer = metadataString(metadata, 'layer') as MemoryLayer | null;
  const rawMemoryType = metadataString(metadata, 'memory_type');
  const memoryType =
    rawMemoryType && MEMORY_TYPES.has(rawMemoryType as MemoryType)
      ? (rawMemoryType as MemoryType)
      : 'other';
  const rawBucket = metadataString(metadata, 'bucket');
  const bucket =
    rawBucket && MEMORY_BUCKETS.has(rawBucket as MemoryBucket)
      ? (rawBucket as MemoryBucket)
      : layer && MEMORY_LAYERS.has(layer)
        ? deriveBucket(layer, memoryType)
        : null;
  const rawDomain = metadataString(metadata, 'domain');
  const domain =
    rawDomain && MEMORY_DOMAINS.has(rawDomain as MemoryDomain)
      ? (rawDomain as MemoryDomain)
      : deriveDomain(memoryType);
  const rawImportance = metadataNumber(metadata, 'importance');
  const rawConfidence = metadataString(metadata, 'confidence');
  const confidence =
    rawConfidence && MEMORY_CONFIDENCES.has(rawConfidence as MemoryConfidence)
      ? (rawConfidence as MemoryConfidence)
      : 'inferred';
  const status = metadataString(metadata, 'status');
  const rawTemporalStatus = metadataString(metadata, 'temporal_status');
  const storedTemporalStatus =
    rawTemporalStatus &&
    MEMORY_TEMPORAL_STATUSES.has(rawTemporalStatus as MemoryTemporalStatus)
      ? (rawTemporalStatus as MemoryTemporalStatus)
      : 'timeless';
  const occurredAt = metadataString(metadata, 'occurred_at');
  const rawTimePrecision = metadataString(metadata, 'time_precision');
  const timePrecision =
    rawTimePrecision &&
    MEMORY_TIME_PRECISIONS.has(rawTimePrecision as MemoryTimePrecision)
      ? (rawTimePrecision as MemoryTimePrecision)
      : null;
  const validUntil = metadataString(metadata, 'valid_until');
  const importance =
    rawImportance === null
      ? defaultImportance(bucket ?? 'key_detail')
      : clampUnitInterval(rawImportance);

  if (!text || !layer || !MEMORY_LAYERS.has(layer)) return null;
  if (!bucket || !isValidLayerBucket(layer, bucket)) return null;
  if (!isValidBucketType(bucket, memoryType)) return null;
  if (
    bucket === 'key_detail' &&
    importance < MIN_KEY_DETAIL_IMPORTANCE
  ) {
    return null;
  }
  if (status !== 'active') return null;
  if (metadataString(metadata, 'visitor_id') !== scope.visitorId) return null;
  if (metadataString(metadata, 'companion_id') !== scope.companionId) return null;
  if (metadataString(metadata, 'app_id') !== scope.appId) return null;
  if (isExpired(validUntil, now)) return null;

  return {
    id: memory.id,
    text,
    layer,
    bucket,
    domain,
    memoryType,
    importance,
    confidence,
    evidenceMemoryIds: metadataStringArray(metadata, 'evidence_memory_ids'),
    score: typeof memory.score === 'number' ? memory.score : null,
    observedAt: metadataString(metadata, 'observed_at') ?? memory.createdAt ?? null,
    occurredAt,
    timePrecision,
    validUntil,
    temporalStatus: effectiveTemporalStatus(
      storedTemporalStatus,
      occurredAt,
      timePrecision,
      now,
    ),
    sourceConversationIds: sourceConversationIdsOf(metadata),
    createdAt: memory.createdAt ?? null,
    updatedAt: memory.updatedAt ?? null,
  };
}

function emptyRememberResult(skipped = 0): RememberResult {
  return { added: 0, updated: 0, deleted: 0, skipped };
}

function storedTemporalStatus(
  operation: MemoryOperation,
  target?: RecalledMemory,
): MemoryTemporalStatus {
  if (operation.temporalStatus) return operation.temporalStatus;
  if (!target) return 'timeless';
  return target.temporalStatus === 'follow_up_due'
    ? 'upcoming'
    : target.temporalStatus;
}

interface ResolvedClassification {
  layer: MemoryLayer;
  bucket: MemoryBucket;
  domain: MemoryDomain;
  memoryType: MemoryType;
  importance: number;
  confidence: MemoryConfidence;
  evidenceMemoryIds: string[];
}

function resolveOperationClassification(
  operation: MemoryOperation,
  target?: RecalledMemory,
): ResolvedClassification | null {
  const layer = operation.layer ?? target?.layer;
  const memoryType = operation.memoryType ?? target?.memoryType;
  if (!layer || !MEMORY_LAYERS.has(layer) || !memoryType || !MEMORY_TYPES.has(memoryType)) {
    return null;
  }

  const bucket = operation.bucket ?? target?.bucket ?? deriveBucket(layer, memoryType);
  if (
    !MEMORY_BUCKETS.has(bucket) ||
    !isValidLayerBucket(layer, bucket) ||
    !isValidBucketType(bucket, memoryType)
  ) {
    return null;
  }

  const domain = operation.domain ?? target?.domain ?? deriveDomain(memoryType);
  if (!MEMORY_DOMAINS.has(domain)) return null;

  const importance = operation.importance ?? target?.importance ?? defaultImportance(bucket);
  if (!Number.isFinite(importance) || importance < 0 || importance > 1) return null;

  const confidence = operation.confidence ?? target?.confidence ?? 'explicit';
  if (!MEMORY_CONFIDENCES.has(confidence)) return null;

  const evidenceMemoryIds = [
    ...new Set(operation.evidenceMemoryIds ?? target?.evidenceMemoryIds ?? []),
  ].filter((id) => Boolean(id.trim()));

  return {
    layer,
    bucket,
    domain,
    memoryType,
    importance,
    confidence,
    evidenceMemoryIds,
  };
}

function recencyScore(memory: RecalledMemory, now: Date): number {
  const rawTimestamp =
    memory.observedAt ?? memory.updatedAt ?? memory.createdAt;
  if (!rawTimestamp) return 0.4;
  const timestamp = Date.parse(rawTimestamp);
  if (!Number.isFinite(timestamp)) return 0.4;
  const ageDays = Math.max(0, now.getTime() - timestamp) / 86_400_000;
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.85;
  if (ageDays <= 30) return 0.65;
  if (ageDays <= 180) return 0.45;
  return 0.3;
}

function temporalUtility(memory: RecalledMemory): number {
  switch (memory.temporalStatus) {
    case 'follow_up_due':
      return 1;
    case 'upcoming':
      return 0.9;
    case 'ongoing':
      return 0.8;
    case 'timeless':
      return 0.55;
    case 'resolved':
      return 0.45;
  }
}

function memoryRank(memory: RecalledMemory, now: Date): number {
  const semanticScore =
    memory.score === null ? 0 : clampUnitInterval(memory.score);
  const confidenceScore = memory.confidence === 'explicit' ? 1 : 0.65;
  return (
    semanticScore * 0.45 +
    memory.importance * 0.25 +
    temporalUtility(memory) * 0.15 +
    recencyScore(memory, now) * 0.1 +
    confidenceScore * 0.05
  );
}

/**
 * 一次 recall 真正会发出的 query 列表。
 *
 * 抽出来是为了让「这一轮会打几次 Mem0」成为**可读出的确定值**，
 * 而不是靠日志里数数：去重、去空、上限 3 的规则只有这一处。
 */
export function recallQueries(input: Pick<RecallInput, 'query' | 'supplementalQueries'>): string[] {
  return [
    ...new Set(
      [input.query, ...(input.supplementalQueries ?? [])]
        .map((query) => query.trim())
        .filter(Boolean),
    ),
  ].slice(0, 3);
}

export function createMemoryService(options: MemoryServiceOptions) {
  const now = options.now ?? (() => new Date());
  const recallLimit =
    options.recallLimit !== undefined &&
    Number.isFinite(options.recallLimit) &&
    options.recallLimit > 0
      ? Math.floor(options.recallLimit)
      : RECALL_LIMIT_DEFAULT;

  async function recall(input: RecallInput): Promise<RecalledMemory[]> {
    if (!options.enabled || !input.query.trim()) return [];

    const filters = {
      AND: [
        { user_id: input.visitorId },
        { app_id: options.appId },
        { metadata: { companion_id: input.companionId } },
      ],
    };
    const queries = recallQueries(input);
    const searchResults = await Promise.allSettled(
      queries.map((query) => options.gateway.search(query, filters)),
    );
    const resultBatches = searchResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<ProviderMemory[]> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value);
    if (resultBatches.length === 0) {
      const firstFailure = searchResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      throw firstFailure?.reason ?? new Error('All memory searches failed');
    }
    const mergedById = new Map<string, ProviderMemory>();
    for (const memory of resultBatches.flat()) {
      const existing = mergedById.get(memory.id);
      if (!existing || (memory.score ?? 0) > (existing.score ?? 0)) {
        mergedById.set(memory.id, memory);
      }
    }
    const results = [...mergedById.values()];
    const seen = new Set<string>();
    const recalledAt = now();

    const normalized = results
      .map((memory) =>
        normalizeMemory(
          memory,
          {
            visitorId: input.visitorId,
            companionId: input.companionId,
            appId: options.appId,
          },
          recalledAt,
        ),
      )
      .filter((memory): memory is RecalledMemory => {
        if (!memory || seen.has(memory.id)) return false;
        seen.add(memory.id);
        return true;
      })
      .sort(
        (left, right) =>
          memoryRank(right, recalledAt) - memoryRank(left, recalledAt) ||
          right.importance - left.importance ||
          (right.score ?? 0) - (left.score ?? 0),
      );

    // Reserve a per-bucket floor first so relationship events and key details
    // cannot be squeezed out by a high-scoring impression bucket, then fill the
    // remaining budget in global rank order.
    //
    // The floor is dealt out round-robin and is itself bounded by the cap: when
    // the cap is tighter than the sum of the floors, the budget is spread across
    // the buckets instead of silently collapsing back to "top ranked overall",
    // which would hand every slot to whichever bucket scores highest. The cap
    // therefore always wins on size, and the floor still wins on diversity.
    const selected = new Set<string>();
    const reservedPerBucket = new Map<MemoryBucket, number>();
    let reserved = 0;
    let dealtInPass = true;
    while (reserved < recallLimit && dealtInPass) {
      dealtInPass = false;
      for (const bucket of RECALL_BUCKETS) {
        if (reserved >= recallLimit) break;
        if ((reservedPerBucket.get(bucket) ?? 0) >= RECALL_BUCKET_FLOOR[bucket]) {
          continue;
        }
        const next = normalized.find(
          (memory) => memory.bucket === bucket && !selected.has(memory.id),
        );
        if (!next) continue;
        selected.add(next.id);
        reservedPerBucket.set(bucket, (reservedPerBucket.get(bucket) ?? 0) + 1);
        reserved += 1;
        dealtInPass = true;
      }
    }
    for (const memory of normalized) {
      if (selected.size >= recallLimit) break;
      selected.add(memory.id);
    }
    // Belt and braces: the loops above already cannot exceed the cap, so this
    // slice only guards against a future edit breaking that invariant.
    return normalized
      .filter((memory) => selected.has(memory.id))
      .slice(0, recallLimit);
  }

  async function resolveTimeZoneFor(visitorId: string): Promise<string> {
    if (!options.resolveTimeZone) return DEFAULT_TIME_ZONE;
    try {
      return resolveUserTimeZone(await options.resolveTimeZone(visitorId));
    } catch (error) {
      console.error('[memory:timezone]', error);
      return DEFAULT_TIME_ZONE;
    }
  }

  async function rememberExchange(input: RememberExchangeInput): Promise<RememberResult> {
    if (!options.enabled || !input.userText.trim()) return emptyRememberResult(1);

    // 单一时间来源：整理器 nowIso 与落库 observed_at 共用同一个带偏移的时刻，
    // 相对日期（今天/明天）与观察时间因此不会各算各的。
    const observedAtIso = toLocalIso(now(), await resolveTimeZoneFor(input.visitorId));

    let existingMemories: RecalledMemory[];
    if (input.existingMemories) {
      // 本轮上下文已经召回过的同一批记忆，直接复用：
      // 同一 turn、同一伴侣、同一个过滤范围，几秒前的召回结果就是整理器需要的去重依据。
      // 显式传入才算数 —— `undefined` 表示「本轮没有可靠的召回结果」，那时仍然自己查一次，
      // 因为拿不到既有记忆就写库，会把同一条事实记成两份。
      existingMemories = input.existingMemories;
    } else {
      try {
        existingMemories = await recall({
          visitorId: input.visitorId,
          companionId: input.companionId,
          query: input.userText,
        });
      } catch (error) {
        // 召不回既有记忆时整理器可能写重、写错，因此整轮跳过写入并如实返回零效果。
        console.error('[memory:recall]', error);
        return emptyRememberResult(1);
      }
    }

    let plan: MemoryPlan;
    try {
      plan = await options.organizer.organize({
        nowIso: observedAtIso,
        visitorId: input.visitorId,
        companionId: input.companionId,
        userText: input.userText,
        assistantText: input.assistantText,
        existingMemories,
        recentTurns: input.recentTurns,
      });
    } catch (error) {
      // 整理器失败只意味着这一轮没有记忆产出，绝不把错误传播给对话主链路。
      console.error('[memory:organize]', error);
      return emptyRememberResult(1);
    }
    const existingById = new Map(existingMemories.map((memory) => [memory.id, memory]));
    const changes: MemoryWriteChange[] = [];
    const changeScope = { visitorId: input.visitorId, companionId: input.companionId, appId: options.appId };
    const result = emptyRememberResult();

    for (const operation of plan.operations.slice(0, 6)) {
      if (operation.action === 'ADD') {
        const classification = resolveOperationClassification(operation);
        if (
          !operation.text ||
          !classification ||
          (classification.bucket === 'key_detail' &&
            classification.importance < MIN_KEY_DETAIL_IMPORTANCE) ||
          (classification.bucket === 'long_term_impression' &&
            classification.confidence === 'inferred' &&
            classification.evidenceMemoryIds.length === 0)
        ) {
          result.skipped += 1;
          continue;
        }
        const metadata: Record<string, unknown> = {
          app_id: options.appId,
          visitor_id: input.visitorId,
          companion_id: input.companionId,
          layer: classification.layer,
          bucket: classification.bucket,
          domain: classification.domain,
          memory_type: classification.memoryType,
          importance: classification.importance,
          confidence: classification.confidence,
          evidence_memory_ids: classification.evidenceMemoryIds,
          status: 'active',
          observed_at: observedAtIso,
          occurred_at: operation.occurredAt ?? null,
          time_precision: operation.timePrecision ?? null,
          valid_until: operation.validUntil ?? null,
          temporal_status: storedTemporalStatus(operation),
          // 单来源写字符串；被别的会话改写后由 mergeSourceConversationId 扩成数组。
          source_conversation_id: input.conversationId,
          source_user_message_id: input.userMessageId,
          source_assistant_message_id: input.assistantMessageId,
          organizer_model: options.organizerModel ?? 'unknown',
          organizer_reason: operation.reason,
        };
        try {
          const created = await options.gateway.add(operation.text, {
            userId: input.visitorId,
            appId: options.appId,
            metadata,
            ...(operation.validUntil ? { expirationDate: operation.validUntil } : {}),
          });
          result.added += 1;
          const createdMemory = created?.id
            ? normalizeMemory({ id: created.id, memory: operation.text, metadata }, changeScope, now())
            : null;
          if (createdMemory) changes.push({ kind: 'add', memory: createdMemory });
        } catch (error) {
          // provider 契约不保证 add 幂等，重试可能写入重复记忆，因此只损失这一条并计入 skipped。
          console.error('[memory:add]', error);
          result.skipped += 1;
        }
        continue;
      }

      const target = operation.memoryId
        ? existingById.get(operation.memoryId)
        : undefined;
      if (!target) {
        result.skipped += 1;
        continue;
      }

      if (operation.action === 'DELETE') {
        try {
          await options.gateway.delete(target.id);
          existingById.delete(target.id);
          result.deleted += 1;
          changes.push({ kind: 'delete', memory: target });
        } catch (error) {
          console.error('[memory:delete]', error);
          result.skipped += 1;
        }
        continue;
      }

      const classification = resolveOperationClassification(operation, target);
      if (
        !operation.text ||
        !classification ||
        (classification.bucket === 'key_detail' &&
          classification.importance < MIN_KEY_DETAIL_IMPORTANCE) ||
        (classification.bucket === 'long_term_impression' &&
          classification.confidence === 'inferred' &&
          classification.evidenceMemoryIds.length === 0)
      ) {
        result.skipped += 1;
        continue;
      }
      const metadata: Record<string, unknown> = {
        app_id: options.appId,
        visitor_id: input.visitorId,
        companion_id: input.companionId,
        layer: classification.layer,
        bucket: classification.bucket,
        domain: classification.domain,
        memory_type: classification.memoryType,
        importance: classification.importance,
        confidence: classification.confidence,
        evidence_memory_ids: classification.evidenceMemoryIds,
        status: 'active',
        observed_at: observedAtIso,
        occurred_at: operation.occurredAt ?? target.occurredAt,
        time_precision: operation.timePrecision ?? target.timePrecision,
        valid_until: operation.validUntil ?? null,
        temporal_status: storedTemporalStatus(operation, target),
        // P2-4 / AC-15：来源会话只追加、不覆盖，删掉任一来源会话都必须认得这条记忆。
        source_conversation_id: mergeSourceConversationId(
          target.sourceConversationIds,
          input.conversationId,
        ),
        // 消息维度记录「最近一次塑造这条记忆的那轮交换」，按最新覆盖，且不参与级联判定。
        source_user_message_id: input.userMessageId,
        source_assistant_message_id: input.assistantMessageId,
        organizer_model: options.organizerModel ?? 'unknown',
        organizer_reason: operation.reason,
      };
      try {
        await options.gateway.update(target.id, {
          text: operation.text,
          metadata,
          expirationDate: operation.validUntil ?? null,
        });
        result.updated += 1;
        const updatedMemory = normalizeMemory({ id: target.id, memory: operation.text, metadata }, changeScope, now());
        if (updatedMemory) changes.push({ kind: 'update', memory: updatedMemory });
      } catch (error) {
        console.error('[memory:update]', error);
        result.skipped += 1;
      }
    }

    // T-18 / T-19：整理器识别出的相处方式反馈与关系快照只在存在时透出，
    // 由调用方（chat route）落库；缺省时不增加任何键，既有返回值因此逐字节兼容。
    if (changes.length) result.changes = changes;
    if (plan.communicationPrefsFeedback?.length) {
      result.feedback = plan.communicationPrefsFeedback;
    }
    if (plan.relationshipSnapshot) {
      result.relationshipSnapshot = plan.relationshipSnapshot;
    }

    return result;
  }

  /**
   * 这个伴侣名下全部有效的边界（`avoid_topic`）原文，按记下的先后排列。
   * 后端不支持按类型列举（Mem0）时返回空数组 —— 记忆照常工作，只是没有边界注入。
   */
  async function listAvoidTopics(input: { visitorId: string; companionId: string }): Promise<string[]> {
    if (!options.enabled || !options.gateway.listAvoidTopics) return [];
    const scope = { visitorId: input.visitorId, companionId: input.companionId, appId: options.appId };
    const rows = await options.gateway.listAvoidTopics(scope);
    const current = now();
    return rows
      .map((row) => normalizeMemory(row, scope, current))
      .filter((memory): memory is RecalledMemory => Boolean(memory && memory.memoryType === AVOID_TOPIC_TYPE))
      .map((memory) => memory.text);
  }

  return { recall, rememberExchange, listAvoidTopics };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
