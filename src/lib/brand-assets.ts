/**
 * 品牌常量（**客户端安全**：只依赖 `next` 的类型，零 server-only 依赖）。
 *
 * 为什么图标清单要单独成模块（U7 / t55）：
 * `src/app/manifest.ts` 现在要**按访客语言**取 PWA 文案（`getServerLocale()` → `next/headers` →
 * `server-only`），而 `tests/brand-assets.test.ts` 需要**静态 import** 图标清单做尺寸门禁 ——
 * 直接 import manifest 会在 import 期就抛
 * `This module cannot be imported from a Client Component module`（t51 实测过这堵墙并因此回退）。
 * 把常量抽到这里，门禁既能继续逐张核尺寸/集合/唯一性，又不必碰 server-only 链。
 *
 * 约定：本模块**不得** import `server-only` / `next/headers` / `@/lib/i18n-server`，
 * 也不得出现任何界面文案（`tests/brand-assets.test.ts` 有一条源码级断言钉住这两点）。
 */

/** PWA 安装图标（尺寸必须与 `public/brand/` 下的真实 PNG 一致，门禁逐张核）。 */
export interface BrandIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

/** 品牌名（两种语言下同一串：产品名不翻）。 */
export const BRAND_NAME = 'Deep Whisper';

/** PWA 短名（安装图标下的标签）。 */
export const BRAND_SHORT_NAME = 'Deep Whisper';

/** 安装图标清单（唯一事实来源：`manifest.ts` 与门禁都用这一份）。 */
export const BRAND_ICONS: readonly BrandIcon[] = [
  { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
