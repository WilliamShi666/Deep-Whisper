import assert from 'node:assert/strict';
import test from 'node:test';

import { selectImportantDateLetter } from '../src/lib/letters/important-dates';

/**
 * 用户录入的重要日期（`user_profiles.important_dates`）。
 *
 * 现状缺口（已核实）：该字段早已注入 system prompt（prompts.ts:125），PUT /api/profile 也接受它，
 * 但 `src/components/` 里没有任何 UI 入口，而且**没有「每年重复」的概念**——
 * 用户填了生日，明年不会自动触发。本次补齐这两点。
 *
 * 触发口径：一次性按「年月日」精确匹配；每年重复按「月-日」匹配，跨年仍生效。
 */

test('a one-off date fires on its exact local day only', () => {
  const dates = [{ date: '2026-10-01', type: 'exam' as const, description: '资格考试' }];

  assert.equal(selectImportantDateLetter(dates, '2026-10-01')?.description, '资格考试');
  // 前后一天都不该触发。
  assert.equal(selectImportantDateLetter(dates, '2026-09-30'), null);
  assert.equal(selectImportantDateLetter(dates, '2026-10-02'), null);
  // 明年同一天也不该触发（一次性）。
  assert.equal(selectImportantDateLetter(dates, '2027-10-01'), null);
});

test('a recurring date fires on the same month and day every year', () => {
  const dates = [{ date: '2026-03-05', type: 'anniversary' as const, description: '生日', recurring: true }];

  assert.equal(selectImportantDateLetter(dates, '2026-03-05')?.description, '生日');
  assert.equal(selectImportantDateLetter(dates, '2027-03-05')?.description, '生日');
  assert.equal(selectImportantDateLetter(dates, '2030-03-05')?.description, '生日');
  // 同月其他日子不触发。
  assert.equal(selectImportantDateLetter(dates, '2027-03-06'), null);
  assert.equal(selectImportantDateLetter(dates, '2027-04-05'), null);
});

test('a recurring date without an explicit flag is treated as one-off', () => {
  const dates = [{ date: '2026-03-05', type: 'other' as const, description: '某件事' }];
  assert.equal(selectImportantDateLetter(dates, '2026-03-05')?.description, '某件事');
  assert.equal(selectImportantDateLetter(dates, '2027-03-05'), null, '缺省是一次性，不得自动每年重复');
});

test('29 February only recurs in a leap year', () => {
  const dates = [{ date: '2028-02-29', type: 'anniversary' as const, description: '闰日纪念', recurring: true }];

  assert.equal(selectImportantDateLetter(dates, '2028-02-29')?.description, '闰日纪念');
  assert.equal(selectImportantDateLetter(dates, '2032-02-29')?.description, '闰日纪念');
  // 平年没有 2 月 29 日，绝不能顺延到 2 月 28 日或 3 月 1 日。
  assert.equal(selectImportantDateLetter(dates, '2027-02-28'), null);
  assert.equal(selectImportantDateLetter(dates, '2027-03-01'), null);
});

test('the first match wins when several dates share a day', () => {
  const dates = [
    { date: '2026-05-01', type: 'anniversary' as const, description: '第一个' },
    { date: '2026-05-01', type: 'memorial' as const, description: '第二个' },
  ];
  assert.equal(selectImportantDateLetter(dates, '2026-05-01')?.description, '第一个');
});

test('an empty or missing list never fires', () => {
  assert.equal(selectImportantDateLetter([], '2026-05-01'), null);
  assert.equal(selectImportantDateLetter(null, '2026-05-01'), null);
  assert.equal(selectImportantDateLetter(undefined, '2026-05-01'), null);
});

test('a malformed date is skipped instead of throwing', () => {
  const dates = [
    { date: '不是日期', type: 'other' as const, description: '坏的' },
    { date: '2026-05-01', type: 'other' as const, description: '好的' },
  ];
  assert.equal(selectImportantDateLetter(dates, '2026-05-01')?.description, '好的');
});

test('the settings dialog exposes a real important-dates entry wired to the profile API', async () => {
  const { readFileSync } = await import('node:fs');
  const component = readFileSync(new URL('../src/components/chat/companion-important-dates.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/components/chat/companion-settings.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/profile/route.ts', import.meta.url), 'utf8');

  // 组件必须真的调用画像接口，并且带上 important_dates。
  assert.match(component, /apiFetch\('\/api\/profile/);
  assert.match(component, /important_dates/);
  assert.match(component, /data-testid="companion-important-dates"/);
  // 必须能选「每年重复」，否则生日第二年就没了。
  assert.match(component, /每年重复/);
  assert.match(component, /recurring/);

  // 必须真的挂到设置弹窗里，否则入口等于不存在。
  assert.match(settings, /CompanionImportantDates/);

  // 服务端必须校验，不能把任意形状直接落库。
  assert.match(route, /normalizeImportantDates/);
});

// ── C2：重要日期类型表一致性与「无条件触发」回归 ──
//
// 背景：类型列表原先散在四处且互不一致（组件的 DATE_TYPES、服务端的 allowed 白名单、
// 注入 AI 的 DATE_TYPE_LABEL、types.ts 的联合类型），漏改任一处就会出现
// 「界面能选、服务端静默降级成 other」。
//
// 现在类型表与标签表由 src/lib/profile/important-dates.ts 单点提供，测试**直接 import
// 该模块**而不是正则扫源码 —— 扫源码的断言只要注释里出现同样的字符串就会通过，
// 证明不了运行时行为（审查 M5）。服务端白名单与提示词标签表仍是两份独立实现，
// 所以继续按文件内容钉住它们的一致性。
test('every ImportantDate type survives the server whitelist and renders a real label', async () => {
  const { readFileSync } = await import('node:fs');
  const { DATE_TYPES, typeLabel } = await import('../src/lib/profile/important-dates');
  const types = readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/profile/route.ts', import.meta.url), 'utf8');
  // U7 / t8：提示词已按语言拆成 prompts/{zh,en}.ts（barrel 只做分发）。类型标签表现在是**两份**
  // （中文取自 zh.ts、英文取自 en.ts），所以两处都要钉住 —— 否则某一侧漏一个类型，
  // 那种语言下模型就会看到原始英文 key。
  const promptsZh = readFileSync(new URL('../src/lib/prompts/zh.ts', import.meta.url), 'utf8');
  const promptsEn = readFileSync(new URL('../src/lib/prompts/en.ts', import.meta.url), 'utf8');

  // 从联合类型里取出真实取值集合，而不是硬编码一份副本。
  const union = /export interface ImportantDate[\s\S]*?type:\s*([^;]+);/.exec(types);
  assert.ok(union, 'ImportantDate.type 必须是一个字面量联合类型');
  const values = [...union![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(values.length >= 4, '类型集合不应为空');
  assert.ok(values.includes('birthday'), '必须包含 birthday（用户自己的生日）');
  assert.ok(!values.includes('medical'), '复诊必须从类型集合移除');

  const offered = new Set(DATE_TYPES.map((entry) => entry.value as string));
  // 生日走专用输入（MyBirthdayField + user_profiles.birthday 列），故意不在选择器里。
  const hasDedicatedInput = new Set(['birthday']);

  for (const value of values) {
    // 服务端白名单：缺一个就会把该类型静默降级成 other。
    assert.match(route, new RegExp("'" + value + "'"), `服务端白名单缺少 ${value}`);
    // AI 提示词标签：缺一个就会让模型看到原始英文 key（中英两侧都必须有）。
    assert.match(promptsZh, new RegExp(value + ":\\s*'"), `中文 DATE_TYPE_LABEL 缺少 ${value}`);
    assert.match(promptsEn, new RegExp(value + ":\\s*'"), `英文 DATE_TYPE_LABEL 缺少 ${value}`);
    // 用户可见路径：要么在选择器里能选到，要么有专用输入。
    assert.ok(
      offered.has(value) || hasDedicatedInput.has(value),
      `${value} 既不在选择器里也没有专用输入，用户永远填不了`,
    );
    // 回显：任何类型都必须能渲染成中文，不能把原始 key 直接摊给用户。
    assert.notEqual(typeLabel(value), value, `typeLabel 缺少 ${value} 的中文标签`);
  }
});

test('the exam label reads 考试/面试 and 复诊 is gone from the picker', async () => {
  const { DATE_TYPES, typeLabel } = await import('../src/lib/profile/important-dates');

  const offered = DATE_TYPES.map((entry) => entry.value as string);
  assert.ok(offered.includes('exam'), '考试必须在选择器里');
  assert.deepEqual(
    DATE_TYPES.find((entry) => entry.value === 'exam')?.label,
    '考试/面试',
    '考试应改名为「考试/面试」',
  );
  assert.ok(!offered.includes('medical' as never), '选择器里不得再有「复诊」');
  assert.ok(!offered.includes('birthday' as never), '生日走专用输入，不在选择器里重复出现');
  // 历史行仍要能读：不能把老数据显示成原始 key "medical"。
  assert.equal(typeLabel('medical'), '复诊（历史）');
});

test('the birthday is exposed as a dedicated yearly-recurring entry', async () => {
  const { readFileSync } = await import('node:fs');
  const component = readFileSync(new URL('../src/components/chat/companion-important-dates.tsx', import.meta.url), 'utf8');
  // 用户自己的生日走 user_profiles.birthday 独立列，必须与 important_dates 同步写入。
  assert.match(component, /birthday/, '组件必须能写入 user_profiles.birthday');
});

test('an important date fires without a chat memory anchor or an interaction window', async () => {
  const { decideLetterEligibility } = await import('../src/lib/letters/policy');
  const date = { date: '2026-09-23', type: 'birthday' as const, description: '我的生日', recurring: true };

  // 重要日期通道：没有任何记忆锚点、没有互动窗口，也必须发信。
  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled',
    anchor: null,
    windowStartedAt: null,
    importantDate: date,
    now: new Date('2026-09-23T04:00:00.000Z'),
  });

  assert.equal(decision.kind, 'L0', '重要日期必须走 L0 口吻');
  assert.ok(decision.anchor, '必须自带合成锚点，而不是要求聊天记忆');
  assert.equal(decision.skipReason, undefined);
});

test('an important date still loses to the once-per-day visitor limit', async () => {
  const { decideLetterEligibility } = await import('../src/lib/letters/policy');
  const date = { date: '2026-09-23', type: 'birthday' as const, description: '我的生日', recurring: true };

  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled',
    anchor: null,
    windowStartedAt: null,
    importantDate: date,
    hasLetterToday: true,
    now: new Date('2026-09-23T04:00:00.000Z'),
  });

  assert.equal(decision.skipReason, 'daily_limit', '每天一封是访客级硬闸门，重要日期也不得豁免');
});

test('a disabled preference still suppresses an important date', async () => {
  const { decideLetterEligibility } = await import('../src/lib/letters/policy');
  const date = { date: '2026-09-23', type: 'birthday' as const, description: '我的生日', recurring: true };

  const decision = decideLetterEligibility({
    preferenceStatus: 'disabled',
    anchor: null,
    windowStartedAt: null,
    importantDate: date,
    now: new Date('2026-09-23T04:00:00.000Z'),
  });

  assert.equal(decision.skipReason, 'preference_disabled', '用户关掉来信后，生日也不该发');
});

// ── F-9：合成锚点的中文必须读得通 ──
//
// U7 / t8：`anchorLabel` 现在带 locale（末尾可选参数、缺省中文 → 上面这些断言语义不变）。
// 英文态必须**不出现汉字**：固定中文哨兵「我的生日」映射成 `birthday`，领属前缀走英文表。

test('the important-date anchor reads naturally for the user’s own birthday', async () => {
  const { anchorLabel } = await import('../src/lib/letters/policy');
  const { BIRTHDAY_DESCRIPTION } = await import('../src/lib/profile/important-dates');

  // 描述是用户视角的（「我的生日」），拼进「今天是 TA 的…」会重复人称
  assert.equal(anchorLabel(BIRTHDAY_DESCRIPTION), '生日');
  assert.equal(anchorLabel('我的纪念日'), '纪念日');
  assert.equal(anchorLabel('妈妈的生日'), '妈妈的生日', '非领属前缀的描述原样保留');
  assert.equal(anchorLabel('资格考试'), '资格考试');
  assert.equal(anchorLabel(''), '这个特别的日子', '缺描述时要有兜底文案');
  assert.equal(anchorLabel(undefined), '这个特别的日子');
  assert.equal(anchorLabel('我的'), '这个特别的日子', '剥掉前缀后为空也要兜底');

  // 显式传 'zh-CN' 与缺省必须完全一致（既有调用点的行为逐字符不变）。
  assert.equal(anchorLabel(BIRTHDAY_DESCRIPTION, 'zh-CN'), anchorLabel(BIRTHDAY_DESCRIPTION));
  assert.equal(anchorLabel('我的纪念日', 'zh-CN'), anchorLabel('我的纪念日'));
});

test('英文态的 anchorLabel 不出现汉字（存量中文哨兵映射成英文）', async () => {
  const { anchorLabel } = await import('../src/lib/letters/policy');
  const { BIRTHDAY_DESCRIPTION } = await import('../src/lib/profile/important-dates');
  const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

  // 存量数据里那条派生生日条目的描述就是中文哨兵：英文信里绝不能原样带出去。
  assert.equal(anchorLabel(BIRTHDAY_DESCRIPTION, 'en'), 'birthday');
  assert.equal(anchorLabel('my birthday', 'en'), 'birthday');
  assert.equal(anchorLabel('Your anniversary', 'en'), 'anniversary');
  assert.equal(anchorLabel('their exam', 'en'), 'exam');
  assert.equal(anchorLabel('', 'en'), 'special day');
  assert.equal(anchorLabel(undefined, 'en'), 'special day');
  assert.equal(anchorLabel('my', 'en'), 'special day', '剥掉前缀后为空也要兜底');
  // 用户自己输入的描述原样保留（那是用户数据，不是产品文案）——但固定哨兵必须已被映射掉。
  assert.equal(anchorLabel('资格考试', 'en'), '资格考试');

  for (const [description, locale] of [[BIRTHDAY_DESCRIPTION, 'en'], ['my birthday', 'en'], ['', 'en']] as const) {
    assert.ok(!HAN.test(anchorLabel(description, locale)), `英文 anchorLabel 不得出现汉字：${description}`);
  }
});
