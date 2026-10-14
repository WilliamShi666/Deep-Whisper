/**
 * system prompt / 开场白引导语的**唯一入口**（U7 / t8）。
 *
 * 分层：
 *   - `./prompts/shared`：语言无关部分 —— 调用方形状、纯数据处理、`[PHOTO:场景描述]` 机器协议；
 *   - `./prompts/zh`：中文 prompt（模型可见、用户不可见；逐字符保持改造前的行为）；
 *   - `./prompts/en`：英文 prompt（**重写**，不是机翻；角色文案消费 `characters.ts` 的 `en.*`）；
 *   - 本文件：薄 barrel —— 只做「按语言分发」与「转出语言无关的解析函数」，不承载任何文案。
 *
 * 签名（t4 契约未逐字符规定 prompt 签名，故此处定稿并在此声明）：
 *   - `buildSystemPrompt(character, companion, visitor, memory?, now?, locale = 'zh-CN')`
 *   - `buildOpeningPrompt(companionName, context?, locale = 'zh-CN')`
 *   - `buildIdentityFacts(character, style, locale = 'zh-CN')`
 * `locale` 一律是**末尾可选参数且缺省 `DEFAULT_LOCALE`**：既有调用点（含全部既有测试）不传它时
 * 行为逐字符不变（H4），新调用点显式传当前语言。语言取值域来自 `./i18n/locale`，不在这里另造一份比对。
 */

import type { AppearanceStyle, CharacterPreset } from './characters';
import { DEFAULT_LOCALE, type Locale } from './i18n/locale';
import type { MemoryContext } from './types';
import {
  buildIdentityFacts as buildIdentityFactsEn,
  buildOpeningPrompt as buildOpeningPromptEn,
  buildSystemPrompt as buildSystemPromptEn,
  OPENING_DIRECTIVE_PREFIX as OPENING_DIRECTIVE_PREFIX_EN,
  PHOTO_UNAVAILABLE_NOTICE as PHOTO_UNAVAILABLE_NOTICE_EN,
} from './prompts/en';
import {
  buildIdentityFacts as buildIdentityFactsZh,
  buildOpeningPrompt as buildOpeningPromptZh,
  buildSystemPrompt as buildSystemPromptZh,
  OPENING_DIRECTIVE_PREFIX as OPENING_DIRECTIVE_PREFIX_ZH,
  PHOTO_UNAVAILABLE_NOTICE as PHOTO_UNAVAILABLE_NOTICE_ZH,
} from './prompts/zh';
import type { CompanionLike, OpeningPromptContext, VisitorLike } from './prompts/shared';

export type { CompanionLike, OpeningPromptContext, VisitorLike };

/**
 * 开场白引导语的起始标记，**按语言给出**（机器协议：E2E 替身据此区分「系统交代开场要求」
 * 与「用户在索要照片」）。
 *
 * 刻意是 `Record<Locale, string>` 而不是单个字符串：`content.startsWith(OPENING_DIRECTIVE_PREFIX)`
 * 这种写法会**类型不过**，于是 `src/lib/ai/providers/e2e-mock-providers.ts` 的消费点在被改到时
 * 立刻暴露（过去那个坑正是「改了前缀、替身还在比旧前缀 → 开场白链路静默失效」）。
 */
export const OPENING_DIRECTIVE_PREFIX: Readonly<Record<Locale, string>> = {
  'zh-CN': OPENING_DIRECTIVE_PREFIX_ZH,
  en: OPENING_DIRECTIVE_PREFIX_EN,
};

/** 「本次会话不能发照片」的补充说明，按语言给出（由 `/api/chat` 追加在 system prompt 末尾）。 */
export const PHOTO_UNAVAILABLE_NOTICE: Readonly<Record<Locale, string>> = {
  'zh-CN': PHOTO_UNAVAILABLE_NOTICE_ZH,
  en: PHOTO_UNAVAILABLE_NOTICE_EN,
};

/** 角色自身的身份事实（8 个身份共用同一实现路径），按语言给出。 */
export function buildIdentityFacts(
  character: CharacterPreset,
  style: AppearanceStyle,
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  return locale === 'en'
    ? buildIdentityFactsEn(character, style)
    : buildIdentityFactsZh(character, style);
}

/** 组装角色 system prompt：预设人设 + 用户捏人信息 + 记忆上下文 + 聊天规则（按语言）。 */
export function buildSystemPrompt(
  character: CharacterPreset,
  companion: CompanionLike,
  visitor: VisitorLike,
  memory?: MemoryContext | null,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): string {
  return locale === 'en'
    ? buildSystemPromptEn(character, companion, visitor, memory, now)
    : buildSystemPromptZh(character, companion, visitor, memory, now);
}

/** 新会话开场白引导（角色主动发第一句），按语言给出。 */
export function buildOpeningPrompt(
  companionName: string,
  context?: OpeningPromptContext,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return locale === 'en'
    ? buildOpeningPromptEn(companionName, context)
    : buildOpeningPromptZh(companionName, context);
}

// `[PHOTO:场景描述]` 机器协议：语言中性，中英两版共用同一份实现（标记本身不翻译）。
export {
  extractPhotoScene,
  getPhotoSafeStreamLength,
  stripPhotoTags,
} from './prompts/shared';
