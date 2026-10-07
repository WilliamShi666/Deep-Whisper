import type { server as zhServer } from '../zh-CN/server';

/**
 * 服务端面英文文案（**所有者：U7 / t8**）。缺一条 key 就 `pnpm ts-check` 红（TS2739）。
 *
 * 与 zh 侧逐 key 对齐；占位符集合必须相同（`{brand}` / `{name}` / `{count}`）。
 */
export const server: Record<keyof typeof zhServer, string> = {
  'letters.unsubscribe_doc_title': 'Stop companion letters · {brand}',
  'letters.unsubscribe_writer': 'A letter from {name}',
  'letters.unsubscribe_writer_meta': '{count} letters so far',
  'letters.unsubscribe_title': 'Stop companion letters',
  'letters.unsubscribe_intro': 'Once you confirm, we will stop sending companion letters to this account. Your chats with them are not affected and stay exactly as they are.',
  'letters.unsubscribe_confirm': 'Confirm and stop',
  'letters.unsubscribe_pause_hint': 'Just need some quiet? You can pause letters in Companion settings in the app instead of unsubscribing.',
  'letters.unsubscribe_link_note': 'This unsubscribe link works only for you. Please do not forward it.',
  'letters.unsubscribe_open_app': 'Open {brand}',
  'letters.unsubscribe_done_title': 'Letters stopped',
  'letters.unsubscribe_done_body': 'You will not receive this kind of companion letter again. Everything you two said stays exactly as it is.',
  'letters.unsubscribe_done_hint': 'Changed your mind? You can turn letters back on in the app — it only takes one clear yes from you.',
  'letters.unsubscribe_done_note': 'If this was not you, you can turn letters back on in Companion settings in the app.',
  'letters.unsubscribe_link_invalid': 'This link has expired',
  'letters.unsubscribe_invalid_body': 'This unsubscribe link is incomplete or has expired. Go back to the bottom of the most recent companion letter and tap the opt-out link there again.',
  'letters.unsubscribe_invalid_note': 'You can also pause or turn off letters in Companion settings in the app.',
  'letters.unsubscribe_failed_title': 'That did not save',
  'letters.unsubscribe_failed_body': 'The network may have dozed off. Please try once more — nothing extra gets sent either way.',
  'letters.unsubscribe_failed_retry': 'Try again',
  'letters.unsubscribe_failed_note': 'Still not working? Come back in through the email in a moment.',
};
