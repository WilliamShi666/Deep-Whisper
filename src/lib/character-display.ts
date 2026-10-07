/**
 * 角色 / 音色的**显示层纯函数**。
 *
 * 零 React / 零 DOM / 零 IO：客户端组件、服务端 route 与单测都能直接引用；
 * 语言取值域与 i18n 内核的 `Locale` 同域，但**不 import 内核** —— 显示层先落地，
 * 内核接线（U3 / U6）时把 Locale 原样传进来即可。
 *
 * 界面渲染角色名 / 音色代号的唯一入口都在这里（含 `formatVoiceLabel` 的转出），
 * 避免同一个名字在多个组件里各拼一遍。
 */

import { formatVoiceLabel, type DisplayLocale } from './characters';

export { formatVoiceLabel };
export type { DisplayLocale };

/** 显示名所需的最小形状：调用方不必为了拿一个名字去构造整个 preset。 */
export interface CharacterDisplaySource {
  defaultName: string;
  nameRoman: string;
  en: { name: string };
}

/** 英文面双名的分隔符：中点 U+00B7，前后各一个空格（用户 2026-10-03 定稿口径 `Lanxi · Marina`）。 */
const ROMAN_NAME_SEPARATOR = ' · ';

/**
 * 角色在界面上的名字。
 *
 * - `zh-CN` → 中文名（`澜汐`），与既有行为逐字符一致。
 * - `en` → `${nameRoman} · ${en.name}`（`Lanxi · Marina`）—— **只出拉丁字母**，
 *   绝不出现汉字。
 *
 * 单串场合（onboarding 名字预填 / `companions.name` / 会话默认标题 / 图片 alt）不要用
 * 这个函数，直接用 `preset.nameRoman`。
 */
export function characterDisplayName(
  preset: CharacterDisplaySource,
  locale: DisplayLocale,
): string {
  if (locale !== 'en') return preset.defaultName;
  return `${preset.nameRoman}${ROMAN_NAME_SEPARATOR}${preset.en.name}`;
}
