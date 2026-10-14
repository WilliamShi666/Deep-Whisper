import { DEFAULT_LOCALE, parseLocale, type Locale } from '@/lib/i18n/locale';

/**
 * 分享卡与分享描述：**按语言取值**（U8 / t11）。
 *
 * 中文两项（`BRAND_SHARE_IMAGE` / `BRAND_DESCRIPTION`）的取值**逐字符不变** —— 既有页面
 * （`layout.tsx` / `love/page.tsx`）与 `tests/brand-assets.test.ts` 直接引用它们（H4）。
 * 英文是新卡 `social-card-en.png`（图上文字为英文），与中文卡并存、互不覆盖。
 *
 * 用法：需要按语言分发的调用点用 `brandShareImage(locale)` / `brandDescription(locale)`；
 * 缺省（不传或脏值）回落中文，不会出现半中半英的组合。
 */

/** 中文分享卡。 */
export const BRAND_SHARE_IMAGE = {
  url: '/brand/social-card.png',
  width: 1200,
  height: 630,
  alt: 'Deep Whisper — 月光琉璃小鲸拥抱爱心，陪你度过每一个深夜',
};

/** 英文分享卡：同一版式与尺寸（1200×630），图上文字全英文。 */
export const BRAND_SHARE_IMAGE_EN = {
  url: '/brand/social-card-en.png',
  width: 1200,
  height: 630,
  alt: 'Deep Whisper — a moonlit glass whale hugging a heart, keeping you company late at night',
};

export const BRAND_DESCRIPTION = '选择专属 DeepSeek AI 恋人，在深夜里自然聊天、听见回应，也分享彼此的照片。';

export const BRAND_DESCRIPTION_EN =
  'Choose your own AI companion: talk naturally late at night, hear them answer, and share photos with each other.';

export interface BrandShareImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** 按语言取分享卡。 */
export function brandShareImage(locale: unknown = DEFAULT_LOCALE): BrandShareImage {
  return parseLocale(locale) === 'en' ? BRAND_SHARE_IMAGE_EN : BRAND_SHARE_IMAGE;
}

/** 按语言取分享描述。 */
export function brandDescription(locale: unknown = DEFAULT_LOCALE): string {
  return parseLocale(locale) === 'en' ? BRAND_DESCRIPTION_EN : BRAND_DESCRIPTION;
}

/** 语言缺省为中文；`Locale` 与页面语言同域（`'zh-CN' | 'en'`）。 */
export type BrandLocale = Locale;
