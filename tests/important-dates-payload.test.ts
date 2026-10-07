import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BIRTHDAY_DESCRIPTION,
  DATE_TYPES,
  IMPORTANT_DATES_MERGE_MODE,
  IMPORTANT_DATES_REPLACE_MODE,
  buildImportantDatesPayload,
  extractBirthday,
  isCanonicalBirthday,
  mergeImportantDates,
  parseImportantDatesWriteMode,
  resolveImportantDatesWrite,
  typeLabel,
  visibleImportantDates,
} from '../src/lib/profile/important-dates';
import type { ImportantDate } from '../src/lib/types';

/**
 * 重要日期的派生逻辑。
 *
 * 这一组测试存在的直接原因：审查发现 buildImportantDatesPayload 会把
 * 「重要日期」里类型为 birthday 的条目**静默丢弃**（先 filter 掉、再判断生日列为空
 * 就直接返回过滤结果），而设置侧又把这类条目从列表里隐藏起来 ——
 * 用户看不到它、保存后它消失、界面还提示成功。这类数据丢失必须被测试钉住。
 */

const others: ImportantDate[] = [
  { date: '2026-10-01', type: 'exam', description: '资格考试' },
  { date: '2026-05-01', type: 'anniversary', description: '在一起' },
];

test('a birthday present in the list is never dropped when the birthday field is empty', () => {
  const withBirthdayEntry: ImportantDate[] = [
    { date: '2026-12-25', type: 'birthday', description: '妈妈的生日' },
    ...others,
  ];

  const result = buildImportantDatesPayload('', withBirthdayEntry);

  // 回归点：生日列为空时，这条条目曾整条消失。
  assert.equal(result.length, 3, '生日列为空不得丢弃列表里已有的条目');
  assert.ok(
    result.some((entry) => entry.description === '妈妈的生日'),
    '用户录入的生日条目必须原样保留',
  );
});

test('the birthday field derives exactly one canonical birthday entry', () => {
  const result = buildImportantDatesPayload('1998-03-05', others);

  assert.equal(result.length, 3);
  // U7 / t8：派生生日条目现在**同时**带语言无关的 `kind: 'birthday'`（计划 §3.3 的结构性修复）。
  // 描述字段一字不改（中文态逐字符不变、存量数据零迁移），`kind` 只是新增的识别依据。
  assert.deepEqual(result[0], {
    date: '1998-03-05',
    type: 'birthday',
    description: BIRTHDAY_DESCRIPTION,
    recurring: true,
    kind: 'birthday',
  });
  assert.ok(result[0].recurring === true, '生日必须每年重复，否则第二年就不再触发');
});

test('saving repeatedly with the same birthday does not accumulate entries', () => {
  const once = buildImportantDatesPayload('1998-03-05', others);
  const twice = buildImportantDatesPayload('1998-03-05', once);
  const thrice = buildImportantDatesPayload('1998-03-05', twice);

  assert.equal(thrice.filter((entry) => entry.type === 'birthday').length, 1, '必须幂等');
  assert.equal(thrice.length, once.length);
});

test('clearing the birthday removes only the derived entry', () => {
  const withBirthday = buildImportantDatesPayload('1998-03-05', others);
  const cleared = buildImportantDatesPayload('', withBirthday);

  assert.equal(cleared.filter((entry) => entry.type === 'birthday').length, 0, '清空生日 = 删除该条目');
  assert.equal(cleared.length, others.length, '其他类型的条目一条都不能少');
  assert.deepEqual(cleared, others);
});

test('whitespace-only birthday counts as empty', () => {
  assert.deepEqual(buildImportantDatesPayload('   ', others), others);
});

test('a legacy birthday entry is normalized to the canonical one when the field is set', () => {
  const legacy: ImportantDate[] = [
    { date: '1998-03-05', type: 'birthday', description: '自己', recurring: false },
    ...others,
  ];

  const result = buildImportantDatesPayload('1998-03-05', legacy);

  assert.equal(result.filter((entry) => entry.type === 'birthday').length, 1);
  assert.equal(result[0].recurring, true, '旧的非重复生日条目必须被规范成每年重复');
  assert.equal(result[0].description, BIRTHDAY_DESCRIPTION);
});

test('the birthday round-trips through extract for the settings field', () => {
  const built = buildImportantDatesPayload('1998-03-05', others);
  assert.equal(extractBirthday(built), '1998-03-05');
  assert.equal(extractBirthday(others), '', '没有生日条目时返回空串而不是 undefined');
  assert.equal(extractBirthday(null), '');
});

test('the picker hides the derived birthday entry but keeps everything else', () => {
  const built = buildImportantDatesPayload('1998-03-05', others);
  const visible = visibleImportantDates(built);

  assert.equal(visible.filter((entry) => entry.type === 'birthday').length, 0);
  assert.equal(visible.length, others.length);
});

test('the picker never offers birthday or the removed medical type', () => {
  const values = DATE_TYPES.map((entry) => entry.value);
  assert.ok(!values.includes('birthday' as ImportantDate['type']), '生日走专用输入，不在选择器里');
  assert.ok(!values.includes('medical' as ImportantDate['type']), '复诊已移除');
  assert.match(typeLabel('exam'), /考试\/面试/);
  assert.equal(typeLabel('medical'), '复诊（历史）', '历史行仍需可读标签，不能显示原始 key');
  assert.equal(typeLabel('unknown-thing'), 'unknown-thing', '未知类型原样返回');
});

// ── 合并语义：onboarding /「重新遇见 TA」这类「只补充」的入口 ──
//
// 回归点（审查 F-1）：PUT /api/profile 对 important_dates 是整列替换。创建角色流程里的
// 编辑器从空列表起步，用户只填一次生日就把此前保存的纪念日全部清空了，界面还提示成功。

test('merging new entries keeps every previously saved date', () => {
  const stored: ImportantDate[] = [
    { date: '1998-03-05', type: 'birthday', description: BIRTHDAY_DESCRIPTION, recurring: true },
    { date: '2026-05-01', type: 'anniversary', description: '在一起', recurring: true },
    { date: '2026-10-01', type: 'exam', description: '资格考试' },
  ];

  // onboarding 里只填了一条新纪念日
  const incoming = buildImportantDatesPayload('', [
    { date: '2027-01-01', type: 'anniversary', description: '第一次旅行' },
  ]);
  const merged = mergeImportantDates(stored, incoming);

  assert.equal(merged.length, 4, '已存条目一条都不能丢');
  assert.ok(merged.some((entry) => entry.description === '在一起'), '历史纪念日必须保留');
  assert.ok(merged.some((entry) => entry.description === '资格考试'), '历史考试必须保留');
  assert.ok(merged.some((entry) => entry.description === '第一次旅行'), '新条目必须写入');
  // 本次没填生日 ≠ 要删生日
  assert.equal(extractBirthday(merged), '1998-03-05', '未提交生日时必须沿用已存的生日');
});

test('merging a new birthday replaces the derived entry instead of accumulating it', () => {
  const stored = buildImportantDatesPayload('1998-03-05', others);
  const incoming = buildImportantDatesPayload('1999-04-06', []);

  const merged = mergeImportantDates(stored, incoming);

  assert.equal(
    merged.filter((entry) => entry.type === 'birthday').length,
    1,
    '派生生日条目至多一条，否则来信会重复触发',
  );
  assert.equal(extractBirthday(merged), '1999-04-06', '新生日必须覆盖旧生日');
  assert.equal(merged[0]!.type, 'birthday', '生日条目排在首位，与 buildImportantDatesPayload 顺序一致');
  assert.equal(merged.length, others.length + 1, '其他条目一条不少');
});

test('merging the same entry twice is idempotent and keeps the submitted value', () => {
  const stored: ImportantDate[] = [{ date: '2026-05-01', type: 'anniversary', description: '在一起' }];
  const incoming: ImportantDate[] = [
    { date: '2026-05-01', type: 'anniversary', description: '在一起', recurring: true },
  ];

  const once = mergeImportantDates(stored, incoming);
  const twice = mergeImportantDates(once, incoming);

  assert.equal(once.length, 1, '同键条目必须覆盖而不是并排两份');
  assert.equal(once[0]!.recurring, true, '本次提交的值必须生效');
  assert.deepEqual(twice, once, '重复提交必须幂等');
});

test('merging into an empty or missing profile just returns what was submitted', () => {
  const incoming = buildImportantDatesPayload('1998-03-05', others);

  assert.deepEqual(mergeImportantDates(null, incoming), incoming);
  assert.deepEqual(mergeImportantDates(undefined, incoming), incoming);
  assert.deepEqual(mergeImportantDates([], incoming), incoming);
});

test('only the derived birthday entry is hidden from the list, never a user-entered one', () => {
  // 回归点：旧的 visibleImportantDates 过滤掉**所有** birthday 条目，
  // 于是「妈妈的生日」这种历史条目既不在列表里、保存时又被丢弃 —— 用户彻底看不到。
  const dates: ImportantDate[] = [
    { date: '1998-03-05', type: 'birthday', description: BIRTHDAY_DESCRIPTION, recurring: true },
    { date: '2026-12-25', type: 'birthday', description: '妈妈的生日' },
  ];

  const visible = visibleImportantDates(dates);

  assert.equal(visible.length, 1, '只应隐藏派生出来的那条');
  assert.equal(visible[0]!.description, '妈妈的生日', '用户录入的生日条目必须仍然可见');
  assert.ok(isCanonicalBirthday(dates[0]!), '派生条目必须能被识别');
  assert.ok(!isCanonicalBirthday(dates[1]!), '描述不同的 birthday 条目不是派生条目');
});

// ── 生日哨兵：新 kind 字段与旧中文哨兵**都要认**（零迁移零回填） ──

test('the canonical birthday is recognized by kind OR by the legacy Chinese sentinel', () => {
  // 新写入：kind 打标（描述仍逐字保留，中文态与存量数据都不受影响）。
  assert.ok(
    isCanonicalBirthday({ date: '1998-03-05', type: 'birthday', description: BIRTHDAY_DESCRIPTION, kind: 'birthday' }),
    '带 kind 的条目必须被认成派生生日条目',
  );
  // 存量行：只有中文哨兵、没有 kind —— 不做任何 UPDATE 也必须继续认（这就是零迁移的依据）。
  assert.ok(
    isCanonicalBirthday({ date: '1998-03-05', type: 'birthday', description: BIRTHDAY_DESCRIPTION }),
    '存量行（只有旧中文哨兵）必须继续被认成派生条目',
  );
  // 甚至连描述被改过，只要 kind 在，仍然认（这正是加字段的目的：识别不再依赖某个语言的字面量）。
  assert.ok(
    isCanonicalBirthday({ date: '1998-03-05', type: 'birthday', description: '我的生日（旧）', kind: 'birthday' }),
    'kind 是语言无关依据，不应再依赖描述字面量',
  );
  // 别人的生日：既没有 kind 也不是规范描述 —— 不是派生条目（不能被隐藏、也不能被丢弃）。
  assert.ok(
    !isCanonicalBirthday({ date: '2026-12-25', type: 'birthday', description: '妈妈的生日' }),
    '非派生条目不得被误认',
  );
});

test('the write decision tags the canonical entry with kind, without touching other entries', () => {
  const incoming: ImportantDate[] = [
    { date: '1998-03-05', type: 'birthday', description: BIRTHDAY_DESCRIPTION, recurring: true },
    { date: '2026-10-01', type: 'exam', description: '资格考试' },
  ];
  const written = resolveImportantDatesWrite(IMPORTANT_DATES_REPLACE_MODE, null, incoming);

  assert.equal(written[0]!.kind, 'birthday', '写入路径必须给规范生日条目打 kind');
  assert.equal(written[0]!.description, BIRTHDAY_DESCRIPTION, '描述不得被改写（中文态逐字符不变）');
  assert.equal(written[1]!.kind, undefined, '其它条目不得被误打标');
  // 合并语义同样打标（两条写入语义都要覆盖）。
  const merged = resolveImportantDatesWrite(IMPORTANT_DATES_MERGE_MODE, null, incoming);
  assert.equal(merged[0]!.kind, 'birthday');
});

// ── 写入语义决策：唯一会「清空用户数据」的判据 ──

test('an unknown or missing write mode defaults to replace, never to merge', () => {
  // 默认必须是 replace：设置页靠它删除条目。客户端拼错字符串时宁可维持旧语义，
  // 也不能把「合并」变成隐式默认（那会让删除静默失效）。
  assert.equal(parseImportantDatesWriteMode(undefined), IMPORTANT_DATES_REPLACE_MODE);
  assert.equal(parseImportantDatesWriteMode(null), IMPORTANT_DATES_REPLACE_MODE);
  assert.equal(parseImportantDatesWriteMode('MERGE'), IMPORTANT_DATES_REPLACE_MODE);
  assert.equal(parseImportantDatesWriteMode('mrege'), IMPORTANT_DATES_REPLACE_MODE);
  assert.equal(parseImportantDatesWriteMode(1), IMPORTANT_DATES_REPLACE_MODE);
  assert.equal(parseImportantDatesWriteMode(IMPORTANT_DATES_MERGE_MODE), IMPORTANT_DATES_MERGE_MODE);
});

test('resolveImportantDatesWrite in replace mode drops entries, in merge mode keeps them', () => {
  const stored: ImportantDate[] = [
    { date: '2026-05-01', type: 'anniversary', description: '在一起', recurring: true },
    { date: '2026-10-01', type: 'exam', description: '资格考试' },
  ];
  const incoming: ImportantDate[] = [
    { date: '2027-01-01', type: 'anniversary', description: '第一次旅行' },
  ];

  // 设置页：整列替换 —— 用户删掉的条目必须真的消失
  assert.deepEqual(resolveImportantDatesWrite(IMPORTANT_DATES_REPLACE_MODE, stored, incoming), incoming);

  // onboarding / 重新遇见 TA：只补充 —— 历史条目一条不丢（F-1）
  const merged = resolveImportantDatesWrite(IMPORTANT_DATES_MERGE_MODE, stored, incoming);
  assert.equal(merged.length, 3);
  assert.ok(merged.some((entry) => entry.description === '在一起'));
  assert.ok(merged.some((entry) => entry.description === '资格考试'));
  assert.ok(merged.some((entry) => entry.description === '第一次旅行'));
});

test('setting a birthday during onboarding keeps the previously saved dates', () => {
  // 审查 F-1 的完整场景：老用户走「重新遇见 TA」→ 捏人步只填生日 → 历史日期全没了。
  const stored: ImportantDate[] = [{ date: '2026-05-01', type: 'anniversary', description: '在一起' }];
  const incoming = buildImportantDatesPayload('1998-03-05', []);

  const written = resolveImportantDatesWrite(IMPORTANT_DATES_MERGE_MODE, stored, incoming);

  assert.equal(written.length, 2, '生日与历史纪念日必须同时存在');
  assert.equal(extractBirthday(written), '1998-03-05');
  assert.ok(written.some((entry) => entry.description === '在一起'));
});

// ── F-8：注入 AI 的画像里，用户自己的生日不能出现两次且措辞不分 ──

test('the profile prompt renders the own birthday once, but keeps other birthday entries', async () => {
  const { buildSystemPrompt } = await import('../src/lib/prompts');
  const { CHARACTER_PRESETS } = await import('../src/lib/characters');

  const profile = {
    id: 'p1', visitor_id: 'v1', display_name: null,
    birthday: '1998-03-05',
    occupation: null, city: null, timezone: null, family_members: null,
    important_dates: [
      // birthday 列派生出来的同步条目：不该再单独渲染一行
      { date: '1998-03-05', type: 'birthday' as const, description: BIRTHDAY_DESCRIPTION, recurring: true },
      // 用户自己录入的生日条目（例如家人的）：必须保留
      { date: '2026-12-25', type: 'birthday' as const, description: '妈妈的生日' },
      { date: '2026-10-01', type: 'exam' as const, description: '资格考试' },
    ],
    lifestyle: null, communication_prefs: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };

  const prompt = buildSystemPrompt(
    CHARACTER_PRESETS[0]!,
    { name: '小蓝', persona: '温柔直接', occupation: '编辑', user_title: '你', appearance_style: 'normal' },
    { gender: 'male' },
    { profile, snapshot: null },
  );

  const birthdayLines = prompt.split('\n').filter((line) => line.includes('生日'));
  assert.equal(
    birthdayLines.filter((line) => line.includes('1998-03-05')).length,
    1,
    `用户自己的生日只能出现一次，实际：\n${birthdayLines.join('\n')}`,
  );
  assert.ok(prompt.includes('妈妈的生日'), '用户录入的家人出生日期不能被一起隐藏');
  assert.ok(prompt.includes('资格考试'));
});
