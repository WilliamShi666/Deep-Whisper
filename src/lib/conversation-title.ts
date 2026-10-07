import { DEFAULT_LOCALE, LOCALE_VALUES, type Locale } from './i18n/locale';
import { MESSAGES, translate } from './i18n/messages';

/**
 * 会话**默认标题**的构造与识别（U7 / t8，计划 §3.3 第二处中文哨兵的结构性修复）。
 *
 * 问题：`/api/conversations` 建会话时把标题写成 `和${name}的聊天`，而 `/api/chat`
 * 在第一条用户消息到达时用 `title.startsWith('和')` 判断「标题还是自动生成的」再把它换成
 * 首句内容。两处各写一半的中文形态 —— 英文态下标题永远不会被替换（英文标题不以「和」开头），
 * 而中文判据也硬写死在代码里。
 *
 * 修法（**不加列、零数据迁移**）：默认标题从字典按语言取（中文态取值逐字符不变），
 * 判定改为**语言无关** —— 精确匹配任一语言的默认形态，或匹配「默认标题的形状」
 * （名字段通配：用户改过伴侣名字后，老会话的标题里还是旧名字，精确匹配会判成用户自定义标题，
 * 于是标题永远停在旧名字上）。
 *
 * 本文件零中文：文案在 `messages/{zh-CN,en}/chat.ts` 的 `default_title`（全量键 = `chat.default_title`）。
 */

/** 模板里的名字占位符（与字典侧逐字符一致）。 */
const NAME_PLACEHOLDER = '{name}';

function templateFor(locale: Locale): string {
  return translate(MESSAGES[locale], 'chat.conversation.default_title', { name: NAME_PLACEHOLDER });
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 由模板推导「形状」正则：把 `{name}` 换成通配的名字段。 */
function shapeOf(template: string): RegExp {
  const parts = template.split(NAME_PLACEHOLDER).map(escapeRegExp);
  return new RegExp(`^${parts.join('.+')}$`);
}

/** 按语言构造默认标题（`{name}` 填伴侣名）。 */
export function buildDefaultConversationTitle(name: string, locale: Locale = DEFAULT_LOCALE): string {
  return translate(MESSAGES[locale], 'chat.conversation.default_title', { name });
}

/**
 * 「这个标题还是自动生成的默认标题吗」—— **语言无关**判定，与当前界面语言无关：
 * 存量数据里是中文默认标题、新建的可能是英文默认标题，两种都必须认。
 */
export function isDefaultConversationTitle(title: string | null | undefined, name: string): boolean {
  const value = title?.trim();
  if (!value) return false;
  for (const locale of LOCALE_VALUES) {
    if (value === buildDefaultConversationTitle(name, locale)) return true;
    if (shapeOf(templateFor(locale)).test(value)) return true;
  }
  return false;
}
