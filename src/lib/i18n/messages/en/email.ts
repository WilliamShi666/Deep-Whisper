import type { email as zhEmail } from '../zh-CN/email';

/**
 * 邮件模板（伴侣来信 / 星光来信）的**英文文案**（**所有者：U6 / t10**）。
 *
 * 缺一条 key 报 `TS2739`、多一条报 `TS2353`（`pnpm ts-check`）；占位符集合（`{brand}` / `{name}`）
 * 与 zh 侧相同，由 `tests/i18n-messages.test.ts` 钉住。
 *
 * 语气口径沿用中文版：这是**一封信**，不是产品通知 —— 不用营销腔，也不加硬性 CTA。
 */
export const email: Record<keyof typeof zhEmail, string> = {
  'letter.kicker': '✦ {brand} · Starlight Letter',
  'letter.title': 'Thinking of you, in the blue of the night',
  'letter.subtitle': '{name} wanted to leave one small thing here for you.',
  'letter.preview': '{name} wrote you a letter',
  'letter.signature': '— {name} ✧',
  'letter.about': '{brand} · This letter was written to you by {name}. There is nothing to reply to, and no rush — read it whenever you like.',
  'letter.unsubscribe_question': 'Would you rather not hear from {name} again?',
  'letter.unsubscribe_action': 'Turn letters off',
  'personal.reply_hint': 'To reply, open your Deep Whisper app. Email replies are not read by your companion.',
  'personal.stop_copies': 'Stop email copies',
  'personal.unsubscribe_title': 'Email copies',
  'personal.unsubscribe_invalid': 'This link is invalid or expired.',
  'personal.unsubscribe_confirm': 'Stop future email copies? Your in-app letters will stay available.',
  'personal.unsubscribe_done': 'Email copies are stopped. Your in-app letter preference is unchanged.',
  'personal.unsubscribe_failed': 'Unable to save. Please try again.',
  'personal.unsubscribe_button': 'Stop email copies',
};
