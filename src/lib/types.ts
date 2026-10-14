/** 前后端共享类型 */

export interface VisitorDTO {
  id: string;
  gender: string | null;
  orientation: string | null;
  nickname: string | null;
  theme_id: string | null;
  ui_theme: string | null;
  /** 访客级「红蓝风格」偏好：'rose' | 'blue' | null（null = 未选择，按页面默认）。 */
  palette: string | null;
  /** 访客级界面语言：'zh-CN' | 'en' | null（null = 未选择，按默认 zh-CN）。 */
  locale: string | null;
  auth_user_id: string | null;
  created_at: string;
}

/** 登录态信息（GET /api/visitor 返回） */
export interface AuthInfo {
  authed: boolean;
  email: string | null;
}

export interface CompanionDTO {
  id: string;
  visitor_id: string;
  character_key: string;
  name: string;
  persona: string | null;
  occupation: string | null;
  user_title: string | null;
  voice_id: string | null;
  appearance_style: 'chibi' | 'normal';
  theme_id: string | null;
  avatar?: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ConversationDTO {
  id: string;
  visitor_id: string;
  companion_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationWithCompanionDTO extends ConversationDTO {
  companion_name: string;
  companion_avatar: string | null;
  companion_character_key: string;
  companion_appearance_style: 'chibi' | 'normal';
  companion_theme_id: string | null;
}

export interface MessageDTO {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  /** `photo_pending` / `photo_failed`：拍照状态行（见 src/lib/photo-status.ts），不是气泡。 */
  content_type: 'text' | 'image' | 'photo_pending' | 'photo_failed';
  content: string | null;
  image_url: string | null;
  audio_url: string | null;
  created_at: string;
}

/** 单条助手回复的反馈（GET /api/feedback 与 POST /api/feedback 共用） */
export interface MessageFeedbackDTO {
  message_id: string;
  rating: 1 | -1;
  comment: string | null;
  updated_at: string;
}

/** SSE 事件类型 */
export type ChatSSEEvent =
  | { type: 'user_message'; message: MessageDTO }
  | { type: 'chunk'; text: string }
  | { type: 'done'; message: MessageDTO; photo_request: boolean; photo_scene: string | null }
  // U7 / t32（契约 §6「SSE error 通道」）：error 事件**必须**带稳定 code。
  // `error` 是中文兜底（保持逐字符不变），`code` 供客户端按三级回退取本地化文案。
  | { type: 'error'; error: string; code: string };

// ── L1 核心画像 ──

export interface FamilyMember {
  name: string;
  relationship: string;
  birthday?: string;
}

export interface ImportantDate {
  date: string;
  type: 'birthday' | 'anniversary' | 'memorial' | 'exam' | 'other';
  description: string;
  /**
   * 每年重复（生日、纪念日）。缺省为一次性（面试、复查）。
   * 重复按「月-日」匹配，跨年仍生效；一次性按完整「年月日」匹配。
   */
  recurring?: boolean;
  /**
   * 语言无关的条目角色（计划 §3.3 的结构性修复，U7 / t8）。
   *
   * 只有「用户自己的生日」那条派生条目带 `kind: 'birthday'`。存在的理由：这条条目原先只能靠
   * 中文固定描述「我的生日」（`BIRTHDAY_DESCRIPTION`）识别，于是英文态要么显示汉字、要么认不出来。
   * **零迁移零回填**：读取侧同时接受新字段与旧中文哨兵（`isCanonicalBirthday`），
   * 存量行不需要任何 UPDATE；新写入由 `resolveImportantDatesWrite` 打标。
   */
  kind?: 'birthday';
}

export interface Lifestyle {
  sleep_schedule?: string;
  hobbies?: string[];
  food_preferences?: string;
}

export interface CommunicationPrefs {
  love_language?: 'words' | 'acts' | 'playful';
  sensitivity?: 'low' | 'medium' | 'high';
  avoided_topics?: string[];
  /**
   * TA 对相处方式的原话反馈，按时间顺序由旧到新排列。
   * 冲突时以数组最后一条为准（新说法优先），因此不需要删除旧条目。
   */
  explicit_feedback?: string[];
}

export interface UserProfileDTO {
  id: string;
  visitor_id: string;
  display_name: string | null;
  birthday: string | null;
  occupation: string | null;
  city: string | null;
  timezone: string | null;
  family_members: FamilyMember[] | null;
  important_dates: ImportantDate[] | null;
  lifestyle: Lifestyle | null;
  communication_prefs: CommunicationPrefs | null;
  created_at: string;
  updated_at: string;
}

// ── L2 关系状态快照 ──

export interface KeyMilestone {
  type: string;
  date: string;
  description: string;
}

export interface RelationshipSnapshotDTO {
  id: string;
  visitor_id: string;
  companion_id: string;
  relationship_stage: string | null;
  emotional_tone: string | null;
  dynamic_summary: string | null;
  key_milestones: KeyMilestone[] | null;
  created_at: string;
  updated_at: string;
}

// ── 对话注入用的记忆上下文 ──

export type LongTermMemoryBucket =
  | 'long_term_impression'
  | 'relationship_event'
  | 'key_detail';

export type LongTermMemoryDomain =
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

export type LongTermMemoryType =
  | 'relationship_milestone'
  | 'reconciliation'
  | 'trust_change'
  | 'shared_experience'
  | 'preference_summary'
  | 'emotional_pattern'
  | 'support_strategy'
  | 'communication_style'
  | 'ongoing_goal'
  | 'routine'
  | 'personal_impression'
  | 'relationship_impression'
  | 'preferred_name'
  | 'identity_detail'
  | 'gift'
  | 'event_reason'
  | 'time_bounded_commitment'
  | 'emotion'
  | 'preference'
  | 'event'
  | 'promise'
  | 'temporary_state'
  | 'personal_fact'
  | 'shared_quote'
  | 'avoid_topic'
  | 'other';

export interface LongTermMemoryDTO {
  id: string;
  text: string;
  layer: 'L2' | 'L3';
  /** Optional only for compatibility with already constructed pre-taxonomy contexts. */
  bucket?: LongTermMemoryBucket;
  domain?: LongTermMemoryDomain;
  memoryType: LongTermMemoryType;
  importance?: number;
  confidence?: 'explicit' | 'inferred';
  evidenceMemoryIds?: string[];
  score: number | null;
  observedAt: string | null;
  occurredAt: string | null;
  timePrecision: 'exact' | 'day' | 'approximate' | null;
  validUntil: string | null;
  temporalStatus:
    | 'timeless'
    | 'upcoming'
    | 'ongoing'
    | 'resolved'
    | 'follow_up_due';
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * 删除会话后的长期记忆清理结果（`DELETE /api/conversations/[id]` 响应的 `forget` 字段）。
 *
 * AC-15 要求「删除失败要有明确结果，不得静默成功」，也要求用户可见文案与真实行为一致：
 * 只有 `cleared` / `disabled` 才允许说「已删除」，其余状态必须如实告知残留。
 */
export interface ForgetConversationReport {
  /**
   * disabled=长期记忆未开启（没有可遗忘的内容）；cleared=已全部清理；
   * partial=有记忆未能清理；unavailable=检索失败，剩余条数未知。
   */
  status: 'disabled' | 'cleared' | 'partial' | 'unavailable';
  /** 已从长期记忆清理的条数 */
  deleted: number;
  /** 未能清理的条数（unavailable 时可能是 0：失败发生在检索阶段） */
  failed: number;
}

export interface MemoryContext {
  profile: UserProfileDTO | null;
  snapshot: RelationshipSnapshotDTO | null;
  recalled?: LongTermMemoryDTO[];
  recentEpisodes?: Array<{
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
  }>;
  /** 「别提了 / 忘掉它」留下的边界原文（每轮都带，优先于近期片段与开场白要求）。 */
  avoidTopics?: string[];
  /** 我主动写给 TA 的信（计划 §6.4）：让角色知道发过什么信，用户提起时能接住。 */
  recentLetters?: Array<{
    sentAt: string;
    subject: string;
    anchorText: string;
    status?: string;
  }>;
}
