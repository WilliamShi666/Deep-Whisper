import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate, type MessageKey } from '@/lib/i18n/messages';
import type { ForgetConversationReport } from '@/lib/types';

/**
 * 删除会话后的用户可见文案（AC-15「文案诚实化」）。
 *
 * 已确认没有残留、或长期记忆本来就没开启时，才允许给「已删除」这类正向反馈（具体措辞见字典）；
 * 其余状态必须如实说明，绝不能让用户以为长期记忆已经忘掉了。
 *
 * 文案**按 locale 取字典**（t61）：这三条原先以中文字面量写在本文件里，经
 * `chat-shell.tsx` 的 `toast.warning/success(notice.message)` 直接上屏 ⇒ en 态删会话会看到中文。
 * 字典是唯一真源（`chat.conversation.forget_*`）；本模块保持**纯函数 + 无 IO**
 * （只 import 纯层 `src/lib/i18n/{locale,messages}`，零 React / 零 DOM / 零 fetch）。
 */
export interface ForgetNotice {
  level: 'success' | 'warning';
  message: string;
}

/**
 * 遗忘状态 → 字典 key（唯一的映射处；组件不得再写一套）。
 *
 * `cleared` / `disabled` / 字段缺失（旧服务端）共用 `forget_cleared`：这三种都没有已知残留。
 */
const NOTICE_KEY: Readonly<Record<'partial' | 'unavailable' | 'cleared', MessageKey>> = {
  partial: 'chat.conversation.forget_partial',
  unavailable: 'chat.conversation.forget_unavailable',
  cleared: 'chat.conversation.forget_cleared',
};

/**
 * `locale` 缺省为 zh-CN（维持既有调用点的行为不变）；**上屏点必须显式传当前语言**，
 * 否则 en 界面会回落中文 —— `tests/i18n-messages.test.ts` 有一条断言钉住 chat-shell 传了它。
 */
export function deleteConversationNotice(
  forget: ForgetConversationReport | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): ForgetNotice {
  switch (forget?.status) {
    case 'partial':
      return {
        level: 'warning',
        message: translate(MESSAGES[locale], NOTICE_KEY.partial, { failed: forget.failed }),
      };
    case 'unavailable':
      return {
        level: 'warning',
        message: translate(MESSAGES[locale], NOTICE_KEY.unavailable),
      };
    default:
      // cleared / disabled / 字段缺失（旧服务端）都走这里：没有已知残留。
      return { level: 'success', message: translate(MESSAGES[locale], NOTICE_KEY.cleared) };
  }
}
