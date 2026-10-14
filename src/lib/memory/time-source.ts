/**
 * 时间语义的唯一入口。
 *
 * 解决的问题：整理器提示词里写死「默认时区为 Asia/Shanghai」，而写入侧的 now 用裸 UTC，
 * 两套口径会把「今天/明天/昨天」算错，尤其在用户不在东八区时。
 *
 * 约定：
 * - 时区来源是用户的 user_profiles.timezone；为空或非法时回退 DEFAULT_TIME_ZONE，绝不抛错。
 * - 对外输出的时间字符串一律是「带数字偏移量的 ISO-8601」，让整理器和模型都能确定时刻。
 */

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

const WEEKDAY_LABELS = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
] as const;

export function isValidTimeZone(timeZone: string): boolean {
  const candidate = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function resolveUserTimeZone(timeZone?: string | null): string {
  const candidate = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!candidate) return DEFAULT_TIME_ZONE;
  return isValidTimeZone(candidate) ? candidate : DEFAULT_TIME_ZONE;
}

type LocalWallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function offsetMinutes(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const pick = (type: string): number => {
    const raw = parts.find((part) => part.type === type)?.value ?? '0';
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour') % 24,
    pick('minute'),
    pick('second'),
  );
  return Math.round((asUtc - now.getTime()) / 60_000);
}

function localWallClock(now: Date, timeZone: string): LocalWallClock {
  const minutes = offsetMinutes(now, timeZone);
  const shifted = new Date(now.getTime() + minutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function dayPeriod(hour: number): string {
  if (hour < 5) return '凌晨';
  if (hour < 12) return '上午';
  if (hour < 13) return '中午';
  if (hour < 18) return '下午';
  return '晚上';
}

export function toLocalIso(now: Date, timeZone: string): string {
  const minutes = offsetMinutes(now, timeZone);
  const shifted = new Date(now.getTime() + minutes * 60_000);
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, '0');
  const offsetMinute = String(absolute % 60).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 19)}${sign}${offsetHour}:${offsetMinute}`;
}

export function formatLocalNowLine(now: Date, timeZone: string): string {
  const clock = localWallClock(now, timeZone);
  const hour = String(clock.hour).padStart(2, '0');
  const minute = String(clock.minute).padStart(2, '0');
  const weekday = WEEKDAY_LABELS[clock.weekday] ?? '';
  return `${clock.year}年${clock.month}月${clock.day}日 ${weekday} ${dayPeriod(clock.hour)} ${hour}:${minute}`;
}
