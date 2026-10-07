import type { MetadataRoute } from 'next';

import { BRAND_ICONS, BRAND_NAME, BRAND_SHORT_NAME } from '@/lib/brand-assets';
import { getServerLocale } from '@/lib/i18n-server';
import type { Locale } from '@/lib/i18n/locale';

/**
 * PWA 安装面上的文案 —— **用户可见**，因此按访客语言取（U7 / t55）。
 *
 * 背景：t51 实测 `curl /manifest.webmanifest` 在 `vl_locale=en` 与 `vl_locale=zh-CN` 两态
 * **都返回中文 description**（PWA 安装提示里就是那一行中文），违反「英文态不留汉字」的硬约束。
 * 根因是这个模块**没有语言输入**（同步函数 + 常量对象）——现在改成 `async` 并按 cookie 取语言。
 *
 * 语言来源：`getServerLocale()`（契约 §4 的服务端唯一来源；永不抛，取不到回落 zh-CN）。
 * 图标与品牌名抽到 `@/lib/brand-assets`（客户端安全）：这样 `tests/brand-assets.test.ts`
 * 的图标尺寸门禁不必静态 import 本模块，也就不会把 server-only 链带进单测（t51 踩过那堵墙）。
 *
 * `zh-CN` 取值**逐字符**等于改造前的那串（H4）。
 */
const MANIFEST_DESCRIPTION: Record<Locale, string> = {
  'zh-CN': '你的 AI 恋人与深夜陪伴',
  en: 'Your AI companion for the late nights',
};

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getServerLocale();
  return {
    name: BRAND_NAME,
    short_name: BRAND_SHORT_NAME,
    description: MANIFEST_DESCRIPTION[locale],
    start_url: '/',
    display: 'standalone',
    background_color: '#07152E',
    theme_color: '#07152E',
    icons: BRAND_ICONS.map((icon) => ({ ...icon })),
  };
}
