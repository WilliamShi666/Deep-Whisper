import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { formatDateLabel, formatDateValue, parseDateValue } from '../src/lib/date-value';

/**
 * 日期值纯函数（契约 t55 / 规格 §4.11 判据 6/7）：真值表 + 时区安全。
 *
 * 值域与原生 `<input type="date">` 逐字兼容：`'YYYY-MM-DD'` 或 `''`（数据层零改动）。
 * 零 mock、零 DOM —— 纯函数真值表 + 一处源码契约（不许回到 UTC 解析）。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const DATE_VALUE = 'src/lib/date-value.ts';

/** 断言解析成功并交出非空 `Date`（`assert.ok` 在本仓的 @types/node 下不做类型收窄）。 */
function parsedValue(value: string): Date {
  const parsed = parseDateValue(value);
  if (!parsed) assert.fail(`${value} 必须解析成功`);
  return parsed;
}

test('parseDateValue builds a local date by splitting the string', () => {
  const parsed = parsedValue('2026-09-28');
  assert.ok(parsed instanceof Date);
  // 本地年月日 === (2026, 8, 28)，而不是 UTC 的同一天
  assert.deepEqual([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()], [2026, 8, 28]);
  assert.equal(parsed.getHours(), 0);
  assert.equal(parsed.getMinutes(), 0);

  // 规格真值表：'1998-07-04' → 本地 1998/6/4
  const july = parsedValue('1998-07-04');
  assert.deepEqual([july.getFullYear(), july.getMonth(), july.getDate()], [1998, 6, 4]);

  // 闰年 2-29 合法
  const leap = parsedValue('2024-02-29');
  assert.deepEqual([leap.getFullYear(), leap.getMonth(), leap.getDate()], [2024, 1, 29]);

  // 越界年份仍按字面解析（越界由 UI 层的 fromYear/toYear 夹住，纯函数不判）
  const outOfRange = parsedValue('1899-12-31');
  assert.deepEqual(
    [outOfRange.getFullYear(), outOfRange.getMonth(), outOfRange.getDate()],
    [1899, 11, 31],
  );
  assert.ok(parseDateValue('2100-01-01'));
});

test('parseDateValue rejects everything that is not a strict, real YYYY-MM-DD', () => {
  const invalid = [
    '',
    '2026-9-8',        // 不补零
    '2026/09/28',      // 分隔符错误
    '2026-02-30',      // 不存在的日子
    '2026-13-01',      // 不存在的月份
    '2026-00-10',      // 月份 0
    '2026-09-00',      // 日 0
    '2026-02-29',      // 2026 不是闰年
    'abcd-ef-gh',
    'abc',
    '1998',            // 只有年
    '1998-07',         // 只有年月
    '1998-13-40',      // 月份与日都越界
    ' 2026-09-28',     // 前后空白不算合法
    '2026-09-28 ',
    '2026-09-28T00:00:00Z',
    '-2026-09-28',
  ];
  for (const raw of invalid) {
    assert.doesNotThrow(() => parseDateValue(raw), `${raw} 不得抛异常`);
    assert.equal(parseDateValue(raw), null, `${raw} 必须解析为 null`);
  }
});

test('formatDateValue writes the local year/month/day and round-trips', () => {
  // 补零 + 本地年月日（不是 ISO 序列化的 UTC 口径）
  assert.equal(formatDateValue(new Date(1998, 6, 4)), '1998-07-04');
  assert.equal(formatDateValue(new Date(2026, 8, 28)), '2026-09-28');
  assert.equal(formatDateValue(new Date(2026, 0, 1)), '2026-01-01');

  // 往返恒等：任何合法值 parse → format 都不变
  for (const value of ['1900-01-01', '1998-07-04', '2026-09-28', '2024-02-29', '2100-12-31']) {
    assert.equal(formatDateValue(parsedValue(value)), value, `${value} 往返必须恒等`);
  }

  // 本地正午/本地午夜都必须稳定落在同一天（时区偏移最常见的翻车点）
  assert.equal(formatDateValue(new Date(2026, 8, 28, 12, 0, 0)), '2026-09-28');
  assert.equal(formatDateValue(new Date(2026, 8, 28, 0, 0, 0)), '2026-09-28');
  assert.equal(formatDateValue(new Date(2026, 8, 28, 23, 59, 59)), '2026-09-28');
});

test('formatDateLabel renders YYYY/MM/DD and keeps the empty value empty', () => {
  assert.equal(formatDateLabel(''), '');
  assert.equal(formatDateLabel('2026-09-28'), '2026/09/28');
  assert.equal(formatDateLabel('1998-07-04'), '1998/07/04');
  // 非法值一律退化成空串（调用点据此显示占位符）
  for (const raw of ['abc', '1998', '1998-07', '1998-13-40', '2026-02-30']) {
    assert.equal(formatDateLabel(raw), '', `${raw} 的展示标签必须是空串`);
  }
});

test('the date value functions stay in the local timezone, never UTC', () => {
  const parsed = parsedValue('2026-09-28');
  // 解析结果必须与「本地构造」逐毫秒相同 —— 这是「手册拆串」的可判定证据
  assert.equal(parsed.getTime(), new Date(2026, 8, 28).getTime());
  assert.equal(parsed.getTimezoneOffset(), new Date(2026, 8, 28).getTimezoneOffset());

  // 非 UTC 机器上：不得等于 Date.UTC 的那个瞬间（`new Date('2026-09-28')` 正是它）
  const localOffset = new Date(2026, 8, 28).getTimezoneOffset();
  if (localOffset !== 0) {
    assert.notEqual(
      parsed.getTime(),
      Date.UTC(2026, 8, 28),
      '不得按 UTC 解析（把日期串直接交给 Date 构造器的行为）',
    );
    assert.equal(
      new Date(2026, 8, 28).toISOString().slice(0, 10) === '2026-09-28',
      localOffset >= 0,
      'ISO 序列化在非 UTC 时区下会挪一天，这正是不能用它做实现的原因',
    );
  }

  // 源码契约：不许回到 UTC 解析 / ISO 序列化，必须手工按 '-' 拆串
  const source = read(DATE_VALUE);
  assert.match(source, /split\('-'\)/, "必须手工按 '-' 拆串构造本地日期");
  assert.doesNotMatch(source, /toISOString/, '不得用 ISO 序列化（UTC 口径会把日期挪一天）');
  assert.doesNotMatch(source, /Date\.parse/, '不得用 Date.parse');
  assert.doesNotMatch(source, /new Date\(\s*(?:value|raw|input|str|text)\b/, '不得把日期串直接交给 Date 构造器（按 UTC 解析）');
});
