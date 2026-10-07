/**
 * 界面语言的**日期 / 数字格式化唯一入口**（U2 / t6，契约 §11.2）。
 *
 * 为什么必须有这一层（而不是各页面自己调 `Intl`）：
 *   - `new Date(...).toLocaleString()`（**无参**）用的是**运行时默认语言**，不是用户选的界面语言 ——
 *     英文访客会看到中文日期，中文访客在英文系统上会看到美式日期。全仓 11 处既有调用踩的正是这个。
 *   - `[]` 与 `'default'` 是同一种病：显式传了 options，却把 locale 留给运行时（`pricing` 与
 *     `calendar` 各踩过一处）。
 *
 * 因此本模块的每个函数**第一参数恒为 `locale: Locale`，没有默认值**：想要「跟运行时」必须自己写，
 * 而写出来的那一刻就会在评审里被看见。
 *
 * 零 React / 零 DOM / 零 IO：客户端组件、服务端组件与单测都能直接引用。
 * **不得**把 `Locale`（`'zh-CN' | 'en'`，wire/存储/类型的值域）与 `Intl` 的 BCP-47 标签混用 ——
 * 后者由 `toIntlLocale` 单向转出（契约 判据 11.2.3：`'en'` → `'en-US'`，而 `Locale` 永远是 `'en'`）。
 */

import type { Locale } from './locale';

/** `Locale` → `Intl` 的 BCP-47 标签。**单向**映射：只在这里出现，别处不得手写 `'en-US'`。 */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  'zh-CN': 'zh-CN',
  en: 'en-US',
};

/** 取 `Intl` 用的标签。`'en'` → `'en-US'`（日期/数字形态跟随美式英语）。 */
export function toIntlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

/** 格式化日期（`2026/10/3` / `10/3/2026`）。 */
export function formatDate(locale: Locale, value: string | number | Date): string {
  return toDate(value).toLocaleDateString(toIntlLocale(locale));
}

/** 格式化日期 + 时间。 */
export function formatDateTime(locale: Locale, value: string | number | Date): string {
  return toDate(value).toLocaleString(toIntlLocale(locale));
}

/** 格式化时间（时分，`19:23` / `7:23 PM`）。 */
export function formatTime(locale: Locale, value: string | number | Date): string {
  return toDate(value).toLocaleTimeString(toIntlLocale(locale), { hour: '2-digit', minute: '2-digit' });
}

/** 月份短名（日历头部用）。 */
export function formatMonthShort(locale: Locale, value: string | number | Date): string {
  return toDate(value).toLocaleString(toIntlLocale(locale), { month: 'short' });
}

/** 数字千分位（图表用）。 */
export function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(toIntlLocale(locale));
}

/**
 * 归一成 `Date`。
 *
 * 传入 `Date` 时原样返回（调用方传进来的常见就是 `new Date(...)`，不必再拷一份）；
 * 字符串/数字走 `new Date(value)`。非法值交给 `Intl` 输出 `Invalid Date` —— 不在这里吞掉，
 * 因为「拿到非法日期」是调用方的缺陷，静默变成空串只会让它更难被发现。
 */
function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
