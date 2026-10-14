import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLetterRecallSection, LETTER_RECENT_LIMIT, LETTER_MIDDLE_LIMIT } from '../src/lib/letters/recall';

/**
 * 对话提示词里的「我最近写给 TA 的信」分区（计划 §6.4）。
 *
 * 计划原话：漏了这一步，人格会崩 —— 用户说「你上周给我写信了」，角色不认，
 * 这个不一致比不发信更伤。
 *
 * 三层设计（模仿真人记忆），各解决一个失败模式：
 *   - 近的细：用户提「上周那封」时接得住（只注入一封会漏）
 *   - 中的粗：只给主题，能对上「你写过关于面试的信」（全给细节则 prompt 膨胀）
 *   - 远的计：只给计数，角色永远不会说「我从没给你写过信」
 *
 * ⚠️ 注入的「内容」必须用 **anchorText（信里说了什么）**，不能用 subject。
 * subject 是**故意写成钩子**的（计划 §5.2：信件口吻，不是通知口吻），
 * 例如「楼下咖啡店换了新烘豆」故意不提面试。只用 subject 注入，角色就只会说
 * 「我发过咖啡店的邮件」，说不出「我安慰过你谈 AI 整合的紧张」。
 */

const letter = (day: string, subject: string, anchor: string) => ({
  sentAt: `${day}T12:00:00.000Z`,
  subject,
  anchorText: anchor,
  status: 'sent' as const,
});

test('the recent letters carry both the subject hook and what the letter actually said', () => {
  const section = buildLetterRecallSection([
    letter('2026-09-20', '楼下咖啡店换了新烘豆', 'TA 下周要找前老板谈 AI 整合，有点紧张'),
  ]);
  // 钩子：帮用户对上「哪封」。
  assert.match(section, /楼下咖啡店换了新烘豆/);
  // 内容：让角色说得出「信里说了什么」。缺了它就只能说咖啡店。
  assert.match(section, /TA 下周要找前老板谈 AI 整合，有点紧张/);
});

test('older letters are aggregated into a count instead of listed one by one', () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    letter(`2026-08-${String(index + 1).padStart(2, '0')}`, `主题${index}`, `锚点${index}`),
  );
  const section = buildLetterRecallSection(many);

  // 30 封按日期倒序：最近 5 封 = 主题29..25（带锚点），
  // 中间 10 封 = 主题24..15（只给主题），更早 15 封 = 主题14..0（只给计数）。
  assert.match(section, /主题29/, 'the newest letter is in the recent band');
  assert.match(section, /锚点29/, 'the recent band carries anchors');
  // 中间的只给主题，不给锚点。
  assert.match(section, /主题20/, 'the middle band carries subjects');
  assert.doesNotMatch(section, /锚点20/, 'the middle band must not carry anchors');
  // 更早的只给计数，不逐封列出。
  assert.doesNotMatch(section, /主题5(?!\d)/, 'the oldest band must be a count');
  assert.doesNotMatch(section, /锚点5(?!\d)/, 'the oldest band must not carry anchors');
  // 总数必须给出。
  assert.match(section, /30\s*封/);
});

test('the section is bounded no matter how many letters exist', () => {
  const many = Array.from({ length: 500 }, (_, index) =>
    letter('2026-09-20', `主题${index}`, `锚点${index}`),
  );
  const section = buildLetterRecallSection(many);
  const detailed = (section.match(/锚点\d+/g) ?? []).length;
  assert.equal(detailed, LETTER_RECENT_LIMIT, 'only the recent band carries anchors');
  const subjects = (section.match(/主题\d+/g) ?? []).length;
  assert.equal(subjects, LETTER_RECENT_LIMIT + LETTER_MIDDLE_LIMIT, 'middle band carries subjects only');
  assert.ok(section.length < 2500, `section must stay bounded, got ${section.length}`);
});

test('no letters means no section at all (zero-perception when empty)', () => {
  assert.equal(buildLetterRecallSection([]), '');
});

test('a cancelled or failed letter is never injected', () => {
  // 用户回来撤回的信（cancelled）根本没发出去；注入它等于让角色以为发过。
  const section = buildLetterRecallSection([
    { sentAt: '2026-09-20T12:00:00.000Z', subject: '撤回的信', anchorText: '锚点', status: 'cancelled' },
    { sentAt: '2026-09-19T12:00:00.000Z', subject: '失败的信', anchorText: '锚点', status: 'failed' },
    { sentAt: '2026-09-18T12:00:00.000Z', subject: '真发出的信', anchorText: '锚点2', status: 'sent' },
  ]);
  assert.doesNotMatch(section, /撤回的信/);
  assert.doesNotMatch(section, /失败的信/);
  assert.match(section, /真发出的信/);
  // 计数只能是真发出去的。
  assert.match(section, /1\s*封/);
});

test('the section admits the letters without reciting them', () => {
  const section = buildLetterRecallSection([letter('2026-09-20', '主题', '锚点')]);
  // 真人不会逐封复述自己写过的信；但也不能假装没写过。
  assert.match(section, /不要假装没写过|不要否认/);
  assert.match(section, /不要.*复述|不必.*逐封/);
});
