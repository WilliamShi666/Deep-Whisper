/**
 * 单条 AI 回复反馈的入参校验（纯函数，无 IO）。
 *
 * 规则与数据库约束保持一致：`rating` 不可为空且只能是 1 / -1，
 * 留言长度上限 500 字符，留言必须伴随评分（不能只留言不打分）。
 */

/** 一条反馈的评分：1 = 赞，-1 = 踩。 */
export type FeedbackRating = 1 | -1;

export interface FeedbackInput {
  message_id: string;
  rating: FeedbackRating | null;
  comment: string | null;
}

/**
 * 校验结果：`delete` 表示撤销该消息的反馈，`upsert` 表示写入或更新。
 * 用两个显式动作而不是让调用方自己推断，避免「空 rating + 空留言」被误写成一行空反馈。
 */
export type NormalizedFeedback =
  | { action: 'delete'; message_id: string }
  | { action: 'upsert'; message_id: string; rating: FeedbackRating; comment: string | null };

export type NormalizeResult =
  | { ok: true; value: NormalizedFeedback }
  | { ok: false; error: string };

/** 留言长度上限，与迁移里的 char_length(comment) <= 500 对齐。 */
export const MAX_COMMENT_LENGTH = 500;

/** messages.id 是 varchar(36)，超长的 id 不可能命中任何行。 */
const MAX_MESSAGE_ID_LENGTH = 36;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeFeedbackInput(raw: unknown): NormalizeResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: '反馈格式不正确' };
  }

  const rawMessageId = raw.message_id;
  if (typeof rawMessageId !== 'string') {
    return { ok: false, error: '缺少消息标识' };
  }
  const messageId = rawMessageId.trim();
  if (!messageId || messageId.length > MAX_MESSAGE_ID_LENGTH) {
    return { ok: false, error: '缺少消息标识' };
  }

  const rawRating = raw.rating;
  if (rawRating !== null && rawRating !== 1 && rawRating !== -1) {
    return { ok: false, error: '只能选择赞或踩' };
  }

  const rawComment = raw.comment;
  if (rawComment !== undefined && rawComment !== null && typeof rawComment !== 'string') {
    return { ok: false, error: '补充说明格式不正确' };
  }
  const comment = typeof rawComment === 'string' ? rawComment.trim() : '';
  if (comment.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `补充说明最多 ${MAX_COMMENT_LENGTH} 字` };
  }
  const normalizedComment = comment === '' ? null : comment;

  // 留言必须伴随评分：数据库里 rating 是 not null，只留言不打分无法表示。
  if (rawRating === null && normalizedComment !== null) {
    return { ok: false, error: '请先选择赞或踩，再补充说明' };
  }
  if (rawRating === null) {
    return { ok: true, value: { action: 'delete', message_id: messageId } };
  }

  return {
    ok: true,
    value: { action: 'upsert', message_id: messageId, rating: rawRating, comment: normalizedComment },
  };
}
