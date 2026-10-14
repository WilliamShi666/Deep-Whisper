import { stripPhotoTags } from '@/lib/prompts';

/** 单条消息送去合成的默认上限；付费按 token 计，长文不能整篇上传。 */
export const TTS_TEXT_LIMIT = 300;

/**
 * TTS 文本准备：把一条助手消息转成适合直接朗读的文本。
 *
 * 顺序不能换：
 * 1. stripPhotoTags —— [PHOTO:场景] 是给前端的隐藏标记，绝不能被念出来；
 * 2. 去掉 emoji 与 markdown 符号 —— 上游会把它们逐字念成「星号」「下划线」；
 * 3. 压缩空白并按上限截断 —— 换行对语音没有意义，截断发生在 trim 之后，
 *    避免截出一段只有空白的句子。
 */
export function prepareTtsText(text: string, limit = TTS_TEXT_LIMIT): string {
  return stripPhotoTags(text)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .trim();
}
