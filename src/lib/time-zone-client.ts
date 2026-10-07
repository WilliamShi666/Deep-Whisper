'use client';

/**
 * 浏览器时区的一次性采集（第五轮 U6）。
 *
 * 背景：`user_profiles.timezone` 在产品里**从来没有写入方**，于是 `resolveUserTimeZone()` 永远回退
 * `Asia/Shanghai`；而提示词里那句「据此判断 TA 此刻是白天还是深夜」邀请模型去断言**用户那边**的
 * 时间，AI 因此编出了「你的下午三点」。修法的下半截就是这里：把浏览器**真实**时区采一次。
 *
 * 规则（规格 §4.10 判据 3 + 队长 2026-09-27 口径）：
 *   - 只在档案 `timezone` **为空或非法**时写一次（`shouldPersistTimeZone`）；**绝不覆盖**用户显式值；
 *   - 服务端用既有 `isValidTimeZone` 校验，非法值 400 且不落库；
 *   - 「档案合法时**零请求**」按**数所有 `/api/profile` 请求**判 —— 所以先用设备级记忆
 *     (`vl_tz_synced` = 上一次已确认的浏览器时区值)：**记忆命中时一次请求都不发**。
 *     稳态 boot = 0 请求；只有首次、浏览器时区变了、或上次失败时才重新探测（首次 1 GET + 0/1 PUT）。
 *     这条记忆顺带让开发模式下 React 双调用 effect 不会重复 PUT。
 *   - 本模块是**副作用**不是关键路径：GET/PUT 失败只 `console.warn`，绝不抛给调用方。
 */

import { apiFetch, getLocalVisitorId, getIdentityGeneration } from './api';
import { isValidTimeZone } from './memory/time-source';

/** 设备级记忆：上一次**已确认过**的浏览器时区值（不是「已同步」的布尔）。 */
export const TIME_ZONE_SYNC_STORAGE_KEY = 'vl_tz_synced';

/** 采集结果（调用方不需要区分时可以直接忽略）。 */
export type TimeZoneSyncOutcome = 'written' | 'skipped' | 'already-synced' | 'failed';

/**
 * 是否需要把浏览器时区写进档案（纯函数，零 IO）。
 *
 * 仅当「档案为空或非法」**且**「浏览器值是合法 IANA 时区」时为真：
 *   - 档案 `null` / `undefined` / `''` / 纯空白 → 空，需要写；
 *   - 档案是不合法时区 → 需要写（它现在只会被 `resolveUserTimeZone` 回退掉，等于没设置）；
 *   - 档案已是合法值 → **不写**，不覆盖用户显式设置的时区；
 *   - 浏览器值非法 / 缺失 → **不写**（宁可不写，也不写脏值）。
 */
export function shouldPersistTimeZone(profileTz: unknown, browserTz: unknown): boolean {
  if (!isValidTimeZone(typeof browserTz === 'string' ? browserTz : '')) return false;
  if (typeof profileTz !== 'string') return profileTz === null || profileTz === undefined;
  const candidate = profileTz.trim();
  return candidate === '' || !isValidTimeZone(candidate);
}

/** 浏览器真实时区；拿不到（SSR / 返回值非法）时给 `null`，不抛。 */
export function readBrowserTimeZone(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** 读设备级记忆（无 window / 存储被禁用 / 值不合法 → null，不抛）。 */
export function readSyncedTimeZone(visitorId?: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const owner = visitorId ?? getLocalVisitorId();
    const value = window.localStorage.getItem(TIME_ZONE_SYNC_STORAGE_KEY);
    const marker = value ? JSON.parse(value) as { visitorId?: string; timeZone?: string } : null;
    return marker?.visitorId === owner && typeof marker.timeZone === 'string' && isValidTimeZone(marker.timeZone)
      ? marker.timeZone : null;
  } catch {
    return null;
  }
}

/** 写设备级记忆（写不进去不影响主流程，不抛）。 */
export function writeSyncedTimeZone(value: string, visitorId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIME_ZONE_SYNC_STORAGE_KEY, JSON.stringify({ visitorId: visitorId ?? getLocalVisitorId(), timeZone: value }));
  } catch {
    // 无痕模式 / 配额满：记忆写不进去只会让下次多探测一次，不影响正确性。
  }
}

/** 清掉设备级记忆（PUT 失败时调用，让下次 boot 重新探测）。 */
export function clearSyncedTimeZone(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TIME_ZONE_SYNC_STORAGE_KEY);
  } catch {
    // 同上：清不掉最坏也只是下次少探测一次。
  }
}

/**
 * 模块级 in-flight：**同一页面加载内只探测一次**。
 *
 * React 开发模式会双调用 effect（StrictMode），若不做去重，两次调用都会抢在记忆写入之前通过
 * 短路判定 → 真机上就出现「一次加载 2×PUT」。这里让第二次调用直接复用第一次的 promise。
 */
const inFlight = new Map<string, Promise<TimeZoneSyncOutcome>>();

/**
 * 采集一次浏览器时区（可安全地重复调用）。
 *
 * 顺序：记忆命中 → **零请求**返回；否则 `GET /api/profile` 读当前档案值 → `shouldPersistTimeZone`
 * 判定 → 需要才 `PUT /api/profile { timezone }`。失败只记日志（并清掉记忆，下次还会重试）。
 */
export function persistBrowserTimeZoneOnce(): Promise<TimeZoneSyncOutcome> {
  let visitorId: string;
  try { visitorId = getLocalVisitorId(); } catch { return Promise.resolve('failed'); }
  const generation = getIdentityGeneration();
  const key = `${visitorId}:${generation}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const value = runPersistBrowserTimeZone(visitorId, generation).finally(() => inFlight.delete(key));
  inFlight.set(key, value);
  return value;
}

async function runPersistBrowserTimeZone(visitorId: string, generation: number): Promise<TimeZoneSyncOutcome> {
  const browserTimeZone = readBrowserTimeZone();
  if (!browserTimeZone) return 'skipped';

  // 记忆命中 = 这个浏览器时区已经确认过（写过了，或确认过档案里已有合法值）→ 一次请求都不发。
  if (readSyncedTimeZone(visitorId) === browserTimeZone) return 'already-synced';

  try {
    const read = await apiFetch('/api/profile', { signal: AbortSignal.timeout(10_000) });
    if (!read.ok) {
      console.warn('[time-zone] 读取画像失败，跳过本次时区采集', read.status);
      return 'failed';
    }
    const payload = (await read.json().catch(() => null)) as
      | { profile?: { timezone?: unknown; updated_at?: string } | null }
      | null;
    const profileTimeZone = payload?.profile?.timezone ?? null;
    if (generation !== getIdentityGeneration()) return 'failed';

    if (!shouldPersistTimeZone(profileTimeZone, browserTimeZone)) {
      // 档案里已有合法值：记住这次确认，后续 boot 零请求。
      writeSyncedTimeZone(browserTimeZone, visitorId);
      return 'skipped';
    }

    const saved = await apiFetch('/api/profile', {
      signal: AbortSignal.timeout(10_000),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: browserTimeZone, profile_updated_at: payload?.profile?.updated_at ?? null }),
    });
    if (!saved.ok) {
      console.warn('[time-zone] 写入浏览器时区失败，本次忽略（不影响对话）', saved.status);
      return 'failed';
    }
    if (generation !== getIdentityGeneration()) return 'failed';
    writeSyncedTimeZone(browserTimeZone, visitorId);
    return 'written';
  } catch (error) {
    console.warn('[time-zone] 采集浏览器时区时出错，已忽略（不影响对话）', error);
    return 'failed';
  }
}
