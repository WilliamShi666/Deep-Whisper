import type { ImportantDate } from '@/lib/types';

/**
 * 用户录入的重要日期（`user_profiles.important_dates`）。
 *
 * 两类日期，触发口径不同：
 *   - 一次性（`recurring` 非 true）：按完整「年月日」精确匹配，只在那一年生效。
 *   - 每年重复（`recurring === true`）：按「月-日」匹配，跨年仍生效。
 *
 * 为什么必须区分：用户填「生日」期望每年都被记得；填「资格考试」只该那年触发。
 * 之前没有这个标记，两种日期都只会触发一次，于是生日第二年就静默消失了。
 */

/** 取 ISO 日期（`YYYY-MM-DD`）的「月-日」部分；格式不对返回 null。 */
function monthDay(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[2]}-${match[3]}`;
}

/**
 * 今天该不该因为某个重要日期写信。
 *
 * 返回第一条命中的日期（同日多条时按录入顺序取第一条），没有命中返回 null。
 * 格式错误的条目直接跳过而不是抛错：一条坏数据不该让整个调度失败。
 */
export function selectImportantDateLetter(
  dates: readonly ImportantDate[] | null | undefined,
  localDate: string,
): ImportantDate | null {
  if (!dates?.length) return null;
  const today = monthDay(localDate);
  if (!today) return null;

  for (const entry of dates) {
    const entryMonthDay = monthDay(entry.date);
    if (!entryMonthDay) continue;
    if (entry.recurring === true) {
      // 每年重复：只看月-日。平年没有 2/29，因此 2/29 的纪念日只在闰年触发，
      // 不会顺延到 2/28 或 3/1 —— 那是另一个日子，不该被冒名顶替。
      if (entryMonthDay === today) return entry;
      continue;
    }
    if (entry.date.trim() === localDate.trim()) return entry;
  }
  return null;
}
