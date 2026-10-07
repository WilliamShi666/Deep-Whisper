import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate } from '@/lib/i18n/messages';

/**
 * 照片在对象存储里的 key 形如 `images/<uuid>.<ext>`，回退产物为
 * `images/fallback/<uuid>.<ext>`。
 *
 * 这样 `messages.image_url` 自带「这张照片是上游拒绝后降级生成的」信息：前端只靠 URL
 * 就能显示说明，不需要新增数据库列，也不需要额外往返——与 `tts-voice-key.ts` 同一手法。
 *
 * 为什么需要这个标记：上游内容审核会拦掉一部分场景，此时 `/api/photo` 会按既有策略
 * 回退到保守场景重试并成功返回。用户因此会收到一张「能看、但不是刚要求的那张」照片，
 * 而角色台词仍然是答应过的口吻——不加说明就等于让产品替上游背锅。
 *
 * 老格式（`images/<uuid>.<ext>`，没有 fallback 段）解析为 false，表示「正常出图」。
 */

/** 回退标记段：只出现在 key 里，不出现在用户可见文案中 */
export const PHOTO_FALLBACK_SEGMENT = 'fallback';

/**
 * 用户可见说明。措辞约束：
 * - 不点名任何模型或供应商（产品不披露上游是谁）；
 * - 明确「不是本产品拒绝了你」，也明确这不是故障或额度问题；
 * - 说明这是替代照片，避免用户以为要求被无视。
 */
export function photoFallbackNotice(locale: Locale = DEFAULT_LOCALE): string {
  return translate(MESSAGES[locale], 'chat.bubble.photo_fallback_notice');
}

/**
 * 中文态副本（既有调用点与测试仍按它取值；等于 `photoFallbackNotice('zh-CN')`）。
 *
 * ⚠️ 与对象 key 的判定（`PHOTO_FALLBACK_SEGMENT` / `buildPhotoObjectKey` / `isFallbackPhotoUrl`）
 * 无关：那三个是**存储语义**，与语言无关、不随字典变动。
 */
export const PHOTO_FALLBACK_NOTICE: string = photoFallbackNotice(DEFAULT_LOCALE);

/** 对象存储 key：正常为 `images/<id>.<ext>`，回退为 `images/fallback/<id>.<ext>` */
export function buildPhotoObjectKey(input: {
  id: string;
  extension: string;
  fallback?: boolean;
}): string {
  const base = `images/${input.id}.${input.extension}`;
  return input.fallback ? `images/${PHOTO_FALLBACK_SEGMENT}/${base.slice('images/'.length)}` : base;
}

/**
 * 从 `image_url` 判断这张照片是否由上游拒绝后的保守场景回退生成。
 * 只认以 `/images/` 结尾的路径段 + 紧邻的 `fallback` 段，避免把文件名里
 * 恰好含 "fallback" 的普通图片误判为回退产物。
 */
export function isFallbackPhotoUrl(imageUrl: string | null | undefined): boolean {
  if (!imageUrl) return false;
  const path = imageUrl.split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  const imagesIndex = segments.lastIndexOf('images');
  if (imagesIndex < 0) return false;
  return segments[imagesIndex + 1] === PHOTO_FALLBACK_SEGMENT;
}
