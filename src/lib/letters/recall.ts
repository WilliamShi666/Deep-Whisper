/**
 * 对话提示词里的「我最近写给 TA 的信」分区（计划 §6.4）。
 *
 * 计划原话：漏了这一步，人格会崩 —— 用户说「你上周给我写信了」，角色不认，
 * 这个不一致比不发信更伤。
 *
 * 三层设计，模仿真人记忆，各解决一个失败模式：
 *   - 近（最近 5 封）：主题 + 锚点原文 → 用户提「上周那封」时接得住
 *   - 中（再往前 10 封）：只给主题 → 能对上「你写过关于面试的信」
 *   - 远（更早）：只给计数 → 角色永远不会说「我从没给你写过信」
 *
 * ⚠️ 「内容」必须用 anchorText，不能用 subject。
 * subject 是**故意写成钩子**的（计划 §5.2：信件口吻，不是通知口吻），
 * 例如「楼下咖啡店换了新烘豆」故意不提面试。只用 subject 注入，角色就只会说
 * 「我发过咖啡店的邮件」，说不出「我安慰过你谈 AI 整合的紧张」。
 *
 * 语言（U7 / t8）：本模块的产物进 system prompt，所以分区文本必须跟随**当前语言**走 ——
 * 否则英文态的角色会收到一段中文的「我写过这些信」。`locale` 是末尾可选参数、缺省中文，
 * 既有调用点（含全部既有测试）行为逐字符不变。
 */

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

/** 最近几封给出「主题 + 锚点」的细节。 */
export const LETTER_RECENT_LIMIT = 5;
/** 再往前几封只给主题。 */
export const LETTER_MIDDLE_LIMIT = 10;

/** 从数据库一次取多少封候选：近 + 中两段的量。 */
export const LETTER_RECALL_LIMIT = LETTER_RECENT_LIMIT + LETTER_MIDDLE_LIMIT;

export interface RecallableLetter {
  sentAt: string;
  /** 邮件主题。故意写成钩子，帮用户对上「哪封」。 */
  subject: string;
  /** 信里到底说了什么（来自投递审计的 anchor_refs）。这才是「内容」。 */
  anchorText: string;
  /** 只有真发出去的信才该被注入。 */
  status?: string;
}

/** 只有真投递过的信才算「我写过」。cancelled / failed 都没发出去。 */
const DELIVERED_STATUSES = new Set(['sent', 'delivered', 'bounced', 'complained']);

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function parsedDay(iso: string): { month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { month: Number(match[2]), day: Number(match[3]) };
}

function formatDayZh(iso: string): string {
  const parsed = parsedDay(iso);
  if (!parsed) return iso;
  return `${parsed.month}月${parsed.day}日`;
}

/** 英文侧用月份名（`March 5`）：数字缩写读起来不像人写的日期。 */
function formatDayEn(iso: string): string {
  const parsed = parsedDay(iso);
  if (!parsed) return iso;
  return `${EN_MONTHS[parsed.month - 1] ?? parsed.month} ${parsed.day}`;
}

/**
 * 构造注入用的分区文本。没有信时返回空串 ——
 * 与既有记忆注入同一约定：表空时零感知，不要输出一个空标题。
 */
export function buildLetterRecallSection(
  letters: readonly RecallableLetter[],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const delivered = letters
    .filter((letter) => (letter.status ? DELIVERED_STATUSES.has(letter.status) : true))
    .filter((letter) => letter.subject?.trim() || letter.anchorText?.trim())
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  if (delivered.length === 0) return '';

  const recent = delivered.slice(0, LETTER_RECENT_LIMIT);
  const middle = delivered.slice(LETTER_RECENT_LIMIT, LETTER_RECENT_LIMIT + LETTER_MIDDLE_LIMIT);
  const olderCount = delivered.length - recent.length - middle.length;

  if (locale === 'en') {
    const lines: string[] = [];
    for (const letter of recent) {
      const anchor = letter.anchorText.replace(/\s+/g, ' ').trim().slice(0, 160);
      lines.push(`- ${formatDayEn(letter.sentAt)} "${letter.subject.trim()}": ${anchor}`);
    }
    if (middle.length) {
      lines.push(`- A little earlier: ${middle.map((letter) => `"${letter.subject.trim()}"`).join(', ')}`);
    }
    if (olderCount > 0) {
      lines.push(`- ${olderCount} more before that (mostly everyday hellos and follow-ups)`);
    }
    lines.push(`- In total: you wrote to them ${delivered.length} times`);
    return [
      '[Letters you recently wrote to them (already sent — they received these)]',
      lines.join('\n'),
      '[How to use this] You **know** you wrote these; never pretend otherwise and never deny it. You do not have to retell each letter — nobody remembers every detail of every letter. When they bring one up, pick it up naturally. What you wrote is **something you said**, so you may quote it; but never treat it as new information they told you.',
    ].join('\n');
  }

  const lines: string[] = [];
  for (const letter of recent) {
    const anchor = letter.anchorText.replace(/\s+/g, ' ').trim().slice(0, 160);
    lines.push(`- ${formatDayZh(letter.sentAt)}「${letter.subject.trim()}」：${anchor}`);
  }
  if (middle.length) {
    lines.push(`- 再早一些：${middle.map((letter) => `「${letter.subject.trim()}」`).join('、')}`);
  }
  if (olderCount > 0) {
    lines.push(`- 更早还有 ${olderCount} 封（多为日常问候与跟进）`);
  }
  lines.push(`- 合计：你主动给 TA 写过 ${delivered.length} 封信`);

  return [
    '【我最近写给 TA 的信（我已经寄出，TA 收到过）】',
    lines.join('\n'),
    '【怎么用】你**知道**自己写过这些信，不要假装没写过、也不要否认；但不必逐封复述信里的原话——真人也不会记得每封信的细节。TA 提起哪一封，就自然接着那一封说。信里说过的事是**你说过的话**，可以引用；但不要把它当成 TA 告诉你的新信息。',
  ].join('\n');
}
