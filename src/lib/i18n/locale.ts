/**
 * 界面语言（locale）的**唯一纯函数契约**（U1 / t5）。
 *
 * 分层（与 `src/lib/palette.ts` 同构，不要让调用方各自造约定）：
 *   - 本文件：零 React、零 DOM、零 IO —— 服务端 route、页面、聊天组件都只准从这里取值。
 *     解析优先级的唯一一条链写在 `resolveLocale`：访客档案 > 设备镜像 > 默认值。
 *   - `src/lib/i18n-client.tsx`：`'use client'` 边界（设备镜像读写 + Provider + hook）。
 *     **服务端 route 不得 import 它**。
 *   - `src/lib/i18n-server.ts`：服务端边界（`getServerLocale()` 只读 cookie，**无 cookie 时**取地理默认）。
 *
 * 语义要点：
 *   - 值域**恰好**两个：`'zh-CN'` 与 `'en'`。没有第三态、没有 `'en-US'`、不做大小写或区域归一 ——
 *     写进库/写进 device 镜像/写进 cookie 的永远是这两个字面量之一。
 *   - `null` 是「从未选择过」而不是某个语言的别名；链的末端是**地理默认**
 *     （`localeForCountry`，t67；取不到国家值时回落 `DEFAULT_LOCALE`），因此
 *     `resolveLocale` 的返回值**永不为 null**。
 *   - `Locale` 与 `src/lib/characters.ts` 的 `DisplayLocale`（经 `src/lib/character-display.ts` 转出）
 *     成员集合相同；`tests/i18n-locale.test.ts` 用双向可赋值断言钉住两者不漂移。
 */

/** 界面语言。成员顺序即 `LOCALE_VALUES` 的顺序（`'zh-CN'` 在前）。 */
export type Locale = 'zh-CN' | 'en';

/** 值域（唯一来源）。顺序与 `Locale` 的成员顺序逐字符一致。 */
export const LOCALE_VALUES: readonly Locale[] = ['zh-CN', 'en'];

/** 默认语言：中文。未选择的访客、以及一切解析失败的情形都落在这里。 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/**
 * 设备级语言镜像的键名（与 `vl_palette` / `vl_visitor_id` 并列，互不覆盖）。
 *
 * 刻意与 `vl_visitor_id`（身份）分开：登出只清身份、不清它 —— 语言偏好不携带身份信息。
 */
export const LOCALE_STORAGE_KEY = 'vl_locale';

/**
 * SSR 读语言的 cookie 名。与 `LOCALE_STORAGE_KEY` 同名（同一个键名便于排障），
 * 但它是**非 httpOnly** 的：服务端要读、客户端要写（`writeLocale` 双写，见 i18n-client）。
 */
export const LOCALE_COOKIE = 'vl_locale';

/** cookie 寿命（秒，一年）—— 与访客身份 cookie 同寿。 */
export const LOCALE_COOKIE_MAX_AGE = 31536000;

/**
 * `<html lang>` 的取值。
 *
 * 注意：`<html>` 的**首帧**恒为静态 `'zh-CN'`（`src/app/layout.tsx` 不读 cookie，避免整站转动态渲染），
 * 真实 `lang` 由 `LocaleProvider` 在挂载后写入 —— 因此这里给的是「挂载后要写的值」。
 */
export const HTML_LANG: Readonly<Record<Locale, string>> = {
  'zh-CN': 'zh-CN',
  en: 'en',
};

/** 类型守卫：是不是值域里的语言。 */
export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}

/**
 * 解析任意输入为语言。值域之外的**一切**（大小写不同、空串、`'en-US'`、数字、布尔、对象、数组）
 * 都回落 `null`，不抛异常、不做归一化、不 trim。
 */
export function parseLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}

/**
 * **中文地区**的国家码集合（ISO 3166-1 alpha-2，大写）。
 *
 * 依据：用户 2026-10-04 直接需求 ——「中国大陆 / 香港 / 台湾 / 新加坡 / 其他使用中文的地区 IP
 * ⇒ 默认中文；其他地方的 IP ⇒ 默认英文」。**这是单一真源**：服务端（`i18n-server.ts`）与
 * 客户端（经只读端点 `GET /api/locale-default`）都只经下面那个纯函数，**不许各写一份集合**。
 */
export const GEO_CHINESE_COUNTRIES: readonly string[] = ['CN', 'HK', 'TW', 'SG', 'MO'];

/**
 * 由**可信网络国家**推「默认语言」（地理默认，t67）。
 *
 *   - **取不到国家值**（`undefined` / `null` / 空串 / 非字符串）⇒ `DEFAULT_LOCALE`（`zh-CN`）。
 *     理由：那是「**未知**」而不是「**非中文地区**」。本地开发、单测、非 Vercel 环境都没有这个头，
 *     把它们的默认翻成英文会污染所有本地与测试场景（也会让既有中文断言莫名变红）。
 *   - 命中 `GEO_CHINESE_COUNTRIES` ⇒ `'zh-CN'`；其余**有值**的国家 ⇒ `'en'`。
 *   - 大小写不敏感（头的值可能是小写 `us`），会 trim。
 *
 * **它只是默认值**：不得写进档案、不得写进设备镜像；用户显式选择必须永久胜出（`resolveLocale` 的顺序保证）。
 */
export function localeForCountry(country: unknown): Locale {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (code === '') return DEFAULT_LOCALE;
  return GEO_CHINESE_COUNTRIES.includes(code) ? 'zh-CN' : 'en';
}

/**
 * 解析优先级的唯一一条链：**访客档案 > 设备镜像 > 默认值**。
 *
 * 非法档案值（如 `'en-US'`、`'EN'`、`''`）不是有效语言，必须继续看设备镜像，
 * 不得短路（否则一个脏档案值会让本地选择整体失效 —— 与 `resolvePalettePreference` 同口径）。
 * 返回值永不为 `null`：链的末端是 `fallbackValue`（t67 起传**地理默认**；缺省仍是 `DEFAULT_LOCALE`）。
 */
export function resolveLocale(
  profileValue: unknown,
  storageValue: unknown,
  fallbackValue: unknown = DEFAULT_LOCALE,
): Locale {
  return parseLocale(profileValue) ?? parseLocale(storageValue) ?? parseLocale(fallbackValue) ?? DEFAULT_LOCALE;
}

/**
 * 单控件开关「点击将应用的值」：当前是 `'en'` 就切回中文，其余（含脏值）一律切到英文。
 *
 * 与 palette 的 `data-palette-value` 语义同构（那里是「点击将应用的值」，不是「当前值」）。
 */
export function nextLocale(current: unknown): Locale {
  return parseLocale(current) === 'en' ? 'zh-CN' : 'en';
}

/**
 * 语言的**自称**（完整名）：`'zh-CN'` → `中文`、`'en'` → `English`。
 *
 * 用它自己的文字写语言名 —— 零基础用户也认得出该点哪个。供 toast 与 aria-label 的宾语使用。
 */
export function localeSelfName(locale: Locale): string {
  return locale === 'en' ? 'English' : '中文';
}

/**
 * 开关上的**可见徽标**（短形式，语言无关的写法）：`'zh-CN'` → `中文`、`'en'` → `EN`。
 *
 * 恒为**目标语言**的徽标：中文态显示 `EN`（点它切英文）、英文态显示 `中文`（点它切中文）。
 */
export function localeBadge(locale: Locale): string {
  return locale === 'en' ? 'EN' : '中文';
}
