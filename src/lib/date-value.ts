/**
 * 日期字符串 ↔ `Date` 的纯函数（契约 t55 / 规格 §4.11）。
 *
 * 值域与原生日期输入**逐字兼容**：`'YYYY-MM-DD'` 或 `''`（未设置）——
 * 数据层与 API 一字不改。
 *
 * 为什么全部**手工拆串 + 本地年月日**：把日期串直接交给 `Date` 构造器会按 **UTC** 解析，
 * 把它序列化成 ISO 字符串又会按 **UTC** 回退 —— 二者在非 UTC 时区下都会把日期挪一天。
 * 生日/纪念日挪一天的代价是「记错日子」，所以这里两者都不用。
 * 零 React / 零 DOM / 零 IO。
 */

/** 严格 `YYYY-MM-DD`（月/日必须补零；不匹配的输入一律非法）。 */
const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `'YYYY-MM-DD'` → 本地 `Date`（00:00）；非法 → `null`（不抛）。
 *
 * 越界年份（例如 `'1899-12-31'`）**仍按字面解析** —— 可视区间由 UI 层的
 * `fromYear`/`toYear` 夹住，不属于纯函数的职责。
 */
export function parseDateValue(value: string): Date | null {
  const match = DATE_VALUE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // `Date` 会把越界分量归一化（2026-02-30 → 3 月 2 日、2026-13-01 → 2027 年 1 月），
  // 所以必须回读校验，否则「不存在的日子」会被静默接受。
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** `Date` → `'YYYY-MM-DD'`（**本地**年月日，补零；绝不走 ISO 序列化）。 */
export function formatDateValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 展示用标签：`''` → `''`（调用点据此显示占位符），否则 `'YYYY/MM/DD'`（同一套手工拆串口径）。 */
export function formatDateLabel(value: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return formatDateValue(date).split('-').join('/');
}
