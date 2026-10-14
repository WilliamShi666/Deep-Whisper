import type { Metadata } from 'next';

import { brandDescription, brandShareImage } from '@/lib/brand-metadata';
import { DEFAULT_LOCALE, parseLocale, type Locale } from '@/lib/i18n/locale';

/**
 * 页面 head 的**分享块**（`openGraph` + `twitter`）—— 按语言出，四处页面共用。
 *
 * ## 为什么必须**整块**给（t50 实测、t54 修）
 *
 * Next 的 metadata 是**按字段合并**的：页面只覆写 `title`/`description` 而**不声明**
 * `openGraph`/`twitter` 时，这两块会**整块继承**根 `layout.tsx` 的中文档 ——
 * 于是英文态出现「`<title>` 是英文、分享卡片却是中文」的半修形态（`/login`、`/chat`、
 * `/terms`、`/privacy` 四页实测四个字段全中文、`og:locale` 还是 `zh_CN`、图还是中文卡）。
 * 对照：`/love`、`/pricing` 自带 `openGraph`，四项就是干净的。
 * ⇒ **只修自己声明过的字段，会让未声明的整块继承** —— 半修比不修更危险，它会用「已修」的读数掩盖剩余泄漏。
 *
 * ## 取值口径（不另造字符串）
 *
 *   - `title`/`description` 复用**调用页自己的**按语言标题与描述（没有自己的描述时退回
 *     `brandDescription(locale)`，它正是根 layout 里 `BRAND_DESCRIPTION` 的按语言版本）；
 *   - 分享卡复用 `brandShareImage(locale)`（英文卡 `social-card-en.png`）；
 *   - `og:locale` 随语言：`en` → `en_US`，其余 → `zh_CN`。
 *
 * ## 只给 en（zh 一个字都不改）
 *
 * 中文态是用户可见的既有行为（H4）：页面对 `openGraph`/`twitter` 的**任何**覆写都会改掉中文分享卡
 * （tz 里的 `og:title` 会从继承来的通用品牌句变成页面专属标题 —— 这是可观察变化）。
 * 所以本模块**只在 en 时给分享块**；zh（含脏值）返回**空对象**，于是这两块继续**继承根 layout 的中文档**
 * ⇒ 中文态逐字符复原，且**不需要在页面里硬编码父级文案**。
 * 代价（刻意接受）：zh 的分享卡标题保持「通用品牌句」而非页面专属；要让中文页也页面专属，
 * 那是另一件产品改动，不在本轮。
 *
 * 本模块**只给分享块**，页面自己的 `title`/`description`/`alternates` 仍由各页声明
 * （`/chat` 那类用 `title: { absolute }` 的页面继续自己钉中文态逐字符不变）。
 */

/** Open Graph 的 `og:locale` 写法（下划线，不是 BCP-47 的连字符）。 */
export const OPEN_GRAPH_LOCALE_EN = 'en_US';

/** 站点名（与根 layout 的 `openGraph.siteName` 同值）。 */
export const SITE_NAME = 'Deep Whisper';

function normalize(locale: unknown): Locale {
  return parseLocale(locale) ?? DEFAULT_LOCALE;
}

export interface PageSocialInput {
  /** 页面当前语言（`'zh-CN' | 'en'`；脏值回落 `zh-CN`）。 */
  locale: unknown;
  /** 分享卡的标题：一般就是页面自己的按语言标题。 */
  title: string;
  /** 分享卡的描述：不传则用 `brandDescription(locale)`。 */
  description?: string;
}

/**
 * 生成页面 head 的 `openGraph` + `twitter` 两块（可直接展开进 `Metadata`）。
 *
 * **只在 en 时给**：zh 返回空对象 ⇒ 两块继续继承根 layout 的中文档，中文态逐字符不变（H4）。
 * `images` 用 `brandShareImage(locale)`，它同时带**按语言的 `alt`**
 * （`BRAND_SHARE_IMAGE.alt` 中文 / `BRAND_SHARE_IMAGE_EN.alt` 英文）—— 分享卡的
 * `og:image:alt`/`twitter:image:alt` 因此跟着语言走，这就是 t54 验收第 3 条说的「品牌层共因」。
 */
export function pageSocialMetadata(input: PageSocialInput): Pick<Metadata, 'openGraph' | 'twitter'> {
  const locale = normalize(input.locale);
  if (locale !== 'en') return {};
  const description = input.description ?? brandDescription(locale);
  const images = [brandShareImage(locale)];
  return {
    openGraph: {
      title: input.title,
      description,
      siteName: SITE_NAME,
      type: 'website',
      locale: OPEN_GRAPH_LOCALE_EN,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description,
      images,
    },
  };
}
