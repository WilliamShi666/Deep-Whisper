import type { CommunicationPrefs } from '../types';

/**
 * 提示词构建的**语言无关部分**（U7 / t8）。
 *
 * 这里只有三类东西，一律零文案：调用方的形状、纯数据处理（时间压缩 / 自由文本偏好收集）、
 * 以及 `[PHOTO:场景描述]` 这个**机器协议**（标记本身是语言中性的，中文版与英文版共用同一份
 * 解析，见 `extractPhotoScene` / `stripPhotoTags`）。
 *
 * 中英两版的 prompt 正文各自住在 `./zh` 与 `./en` —— 「英文是重写不是机翻」这条要求
 * 意味着两个文件必须能各自独立读通，共享的只有这里的纯逻辑。
 */

/** 伴侣实例的最小形状（route 传进来的是整行，这里只声明用得到的字段）。 */
export interface CompanionLike {
  name: string;
  persona: string | null;
  occupation: string | null;
  user_title: string | null;
  appearance_style?: 'chibi' | 'normal' | string | null;
}

/** 访客的最小形状。 */
export interface VisitorLike {
  gender: string | null;
  nickname?: string | null;
}

/** 开场白引导语的上下文。 */
export interface OpeningPromptContext {
  hasPriorConversation: boolean;
  hasRecalledMemory: boolean;
  hasRecentContext?: boolean;
}

/** `2026-09-16T01:00:00.000Z` → `2026-09-16 01:00`（语言无关的墙钟压缩）。 */
export function compactTime(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : normalized;
}

/** 枚举键：这些由各自的专门段落渲染，不当作自由文本重复渲染。 */
export const KNOWN_PREF_KEYS = new Set(['love_language', 'sensitivity', 'avoided_topics']);

/**
 * 结构化反馈里可能出现的技术字段：只把 TA 的原话喂给模型，
 * 时间戳、来源 id 之类的噪声一律不渲染。
 */
export const NOISE_PREF_KEYS = new Set([
  'at',
  'ts',
  'time',
  'timestamp',
  'created_at',
  'updated_at',
  'recorded_at',
  'source',
  'message_id',
]);

/** 纯 ISO-8601 时刻（例如 2026-09-16T01:00:00.000Z）：不是人说的话，不渲染。 */
export const ISO_TIMESTAMP_ONLY_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * 收集 communication_prefs 中「非枚举键」的自由文本（例如 TA 说「别每次都逗我」）。
 * 写入侧字段名已冻结为 explicit_feedback（按时间顺序由旧到新）；这里仍按值收集，
 * 以便兼容旧的自由文本键，同时不把时间戳等噪声渲染进提示词。
 */
export function collectFreeTextPrefs(prefs: CommunicationPrefs | null | undefined): string[] {
  const collected: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      const text = value.trim();
      if (text && !ISO_TIMESTAMP_ONLY_REGEX.test(text)) collected.push(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (NOISE_PREF_KEYS.has(key)) continue;
        walk(item);
      }
    }
  };
  for (const [key, value] of Object.entries((prefs ?? {}) as Record<string, unknown>)) {
    if (KNOWN_PREF_KEYS.has(key)) continue;
    walk(value);
  }
  return collected;
}

// ── `[PHOTO:场景描述]` 机器协议（语言中性：中文冒号与大小写都兼容） ──

/** 照片场景标记（完整）：[PHOTO:场景描述]，兼容中文冒号与大小写 */
const PHOTO_TAG_REGEX = /\[\s*PHOTO\s*[:：]\s*([^\]\n]{2,300}?)\s*\]/gi;
/** 流被截断时尾部可能出现的不完整标记 */
const PHOTO_TAG_TAIL_REGEX = /\[\s*PHOTO(?:\s*[:：][^\]]*|\s*)$/i;
/** 与完整标记相同的空白/大小写规则；末尾尚未确定的前缀必须等待后续 chunk。 */
const PHOTO_TAG_PREFIX_REGEX = /\[\s*PHOTO\s*[:：]/i;
const PHOTO_TAG_PARTIAL_REGEX = /\[\s*(?:P(?:H(?:O(?:T(?:O\s*)?)?)?)?)?$/i;

/** 可安全发送的前缀长度。完整 PHOTO 前缀之后保留到 done，普通方括号文字可继续发送。 */
export function getPhotoSafeStreamLength(text: string): number {
  const completePrefix = PHOTO_TAG_PREFIX_REGEX.exec(text);
  if (completePrefix) return completePrefix.index;
  const partialPrefix = PHOTO_TAG_PARTIAL_REGEX.exec(text);
  return partialPrefix?.index ?? text.length;
}

/** 从回复文本中提取照片场景描述（取最后一个完整标记），无则返回 null */
export function extractPhotoScene(text: string): string | null {
  let scene: string | null = null;
  for (const m of text.matchAll(PHOTO_TAG_REGEX)) {
    const s = (m[1] ?? '').trim();
    if (s.length >= 2) scene = s;
  }
  return scene;
}

/** 剔除回复中的照片标记（含尾部不完整标记），用于落库与展示，保证用户不可见 */
export function stripPhotoTags(text: string): string {
  return text.replace(PHOTO_TAG_REGEX, '').replace(PHOTO_TAG_TAIL_REGEX, '').replace(PHOTO_TAG_PARTIAL_REGEX, '').trim();
}
