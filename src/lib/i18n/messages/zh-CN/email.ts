/**
 * 邮件模板（伴侣来信 / 星光来信）的**中文文案**（**所有者：U6 / t10**）。
 *
 * 模板本身（`src/lib/email/companion-letter-email.tsx`）里**不再有任何中文字面量**：
 * 它接受 `locale`，再从这里取值渲染 —— 于是「英文界面 = 英文邮件」不需要第二份模板。
 *
 * 值**逐字符等于改造前模板里的字面量**（H4：中文态邮件逐字符不变）；
 * `en/email.ts` 用 `Record<keyof typeof email, string>` 约束，缺一条 key 就 `pnpm ts-check` 红。
 * 占位符：`{brand}`（品牌名）、`{name}`（角色名）—— 中英两侧集合必须相同。
 */
export const email = {
  'letter.kicker': '✦ {brand} · 星光来信',
  'letter.title': '在蓝色的夜里，想起你',
  'letter.subtitle': '{name} 想把一句话，轻轻留在这里。',
  /** 正文首段为空时的收件箱预读文案（`Preview`）。 */
  'letter.preview': '{name} 给你写了一封信',
  'letter.signature': '—— {name} ✧',
  'letter.about': '{brand} · 这封信由「{name}」写给你。这封信不用回复；你什么时候想读都可以，也不用急着回。',
  'letter.unsubscribe_question': '不想再收到「{name}」的来信？',
  'letter.unsubscribe_action': '在这里关闭',
  'personal.reply_hint': '想回复 TA，请回到你的 Deep Whisper。TA 不会读取邮箱回复。',
  'personal.stop_copies': '停止邮箱副本',
  'personal.unsubscribe_title': '邮箱副本',
  'personal.unsubscribe_invalid': '链接无效或已过期。',
  'personal.unsubscribe_confirm': '停止接收邮箱副本？站内来信仍然可用。',
  'personal.unsubscribe_done': '已停止邮箱副本。站内来信开关保持不变。',
  'personal.unsubscribe_failed': '保存失败，请重试。',
  'personal.unsubscribe_button': '停止邮箱副本',
} as const;
