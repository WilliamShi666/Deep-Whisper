/**
 * **服务端面**面向用户的文案（**所有者：U7 / t8**）。
 *
 * 这个 area 装的是「服务端读得到、且会送到用户眼前」的文案 —— 不是错误码（那些在 `./errors.ts`）。
 * 目前两类：
 *   1. 服务端生成的**默认会话标题**（`src/lib/conversation-title.ts` 构造 + 语言无关判定）；
 *   2. `/api/letters/unsubscribe` 的**退订确认页**（用户从邮件里点进来看到的 HTML 页）。
 *
 * 语言来源：这些链路都没有客户端语言上下文，一律读 `visitors.locale`
 * （`src/lib/i18n/visitor-locale.ts`），读不到就回落默认语言。
 *
 * 本文件是 `en/server.ts` 的类型源：那边少一条 key 就 `pnpm ts-check` 红（TS2739）。
 */
export const server = {
  /** 新建会话的默认标题；`{name}` 由 `buildDefaultConversationTitle` 填充。 */
    // ── 退订确认页（邮件里的「停止来信」链接） ──
  // 占位符：`{brand}`（品牌名）、`{name}`（伴侣名）、`{count}`（已写信件数）—— 中英两侧集合必须相同。
  'letters.unsubscribe_doc_title': '停止恋人来信 · {brand}',
  /** 写信人一行；刻意不写「她/他」——伙伴性别不该被一句文案假设，也不需要代词。 */
  'letters.unsubscribe_writer': '{name} 写给你的信',
  'letters.unsubscribe_writer_meta': '已经给你写过 {count} 封',
  'letters.unsubscribe_title': '停止恋人来信',
  'letters.unsubscribe_intro': '确认后，我们不会再向这个账号发送恋人来信。你和 TA 的聊天记录不受影响，会原样保留。',
  'letters.unsubscribe_confirm': '确认停止',
  'letters.unsubscribe_pause_hint': '只是想安静一阵？也可以在 App 的「恋人设置」里暂停来信，不必退订。',
  'letters.unsubscribe_link_note': '这条退订链接只对你有效，请勿转发。',
  'letters.unsubscribe_open_app': '打开 {brand}',
  'letters.unsubscribe_done_title': '已停止来信',
  'letters.unsubscribe_done_body': '之后不会再收到这类恋人来信。你和 TA 说过的一切都原样保留。',
  'letters.unsubscribe_done_hint': '改主意了？在 App 里可以随时重新开启来信 —— 只需要你明确同意一次。',
  'letters.unsubscribe_done_note': '如果不是你本人操作，可以在 App 的「恋人设置」里重新开启。',
  'letters.unsubscribe_link_invalid': '链接已失效',
  'letters.unsubscribe_invalid_body': '这个退订链接不完整或已过期。回到最近一封恋人来信的底部，重新点一次「在这里关闭」就行。',
  'letters.unsubscribe_invalid_note': '也可以在 App 的「恋人设置」里暂停或关闭来信。',
  'letters.unsubscribe_failed_title': '暂时没有保存成功',
  'letters.unsubscribe_failed_body': '可能是网络打了个盹。再试一次就好，我们不会因此多发送任何一封来信。',
  'letters.unsubscribe_failed_retry': '重试',
  'letters.unsubscribe_failed_note': '还是不行的话，稍后从邮件里再进来一次即可。',
} as const;
