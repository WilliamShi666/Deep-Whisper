import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
import type { ProfilePatch } from '@/lib/personal/core-repository';
import type { ImportantDate } from '@/lib/types';
import { parseImportantDatesWriteMode } from '@/lib/profile/important-dates';
import { isValidTimeZone } from '@/lib/memory/time-source';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return ownerRoute(request, (owner, repo) =>
    NextResponse.json({ profile: repo.getProfile(owner) }),
  );
}
/**
 * 规范化重要日期。
 *
 * 只接受形状正确的条目：日期必须是 YYYY-MM-DD，类型必须在白名单内。
 * `recurring` 只接受布尔 true；其它值一律丢弃，缺省即「一次性」——
 * 否则一个手写的 "true" 字符串会让面试被当成每年重复，明年又冒出来。
 * 坏条目直接丢弃而不是整次 400：一条坏数据不该让用户整个画像保存失败。
 */
function normalizeImportantDates(value: unknown): ImportantDate[] {
  if (!Array.isArray(value)) return [];
  // 'medical'（复诊）已从界面移除，但白名单必须保留它：
  // 历史行仍可能带这个类型，一旦不在白名单就会被下面的分支静默降级成 'other'，
  // 用户会看到自己的「复诊」莫名其妙变成「其他」。保留读取、不再新增即可。
  const allowed: ReadonlySet<string> = new Set([
    'birthday',
    'anniversary',
    'memorial',
    'exam',
    'medical',
    'other',
  ]);
  const normalized: ImportantDate[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<ImportantDate>;
    const date = typeof candidate.date === 'string' ? candidate.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const type =
      typeof candidate.type === 'string' && allowed.has(candidate.type)
        ? (candidate.type as ImportantDate['type'])
        : 'other';
    normalized.push({
      date,
      type,
      description:
        typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 40) : '',
      ...(candidate.recurring === true ? { recurring: true } : {}),
    });
  }
  return normalized;
}

export function PUT(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    const body = await readCoreBody(request);
    if (body.feedback_action !== undefined) {
      const existing = repo.getProfile(owner);
      const prefs = { ...(existing?.communication_prefs ?? {}) };
      if (body.feedback_action === 'append') {
        const feedback =
          typeof body.feedback === 'string'
            ? body.feedback.replace(/\s+/g, ' ').trim().slice(0, 160)
            : '';
        if (!feedback) return coreError(400, 'PREFERENCE_FEEDBACK_EMPTY');
        prefs.explicit_feedback = [
          ...(prefs.explicit_feedback ?? []).filter((x) => x !== feedback),
          feedback,
        ].slice(-8);
      } else if (body.feedback_action === 'revoke') {
        if (body.revoke_mode === undefined || body.revoke_mode === 'all')
          for (const key of Object.keys(prefs)) delete prefs[key as keyof typeof prefs];
        else if (body.revoke_mode === 'explicit_feedback') delete prefs.explicit_feedback;
        else return coreError(400, 'UNSUPPORTED_REVOKE_MODE');
      } else return coreError(400, 'UNSUPPORTED_PREF_ACTION');
      const profile = repo.saveProfile(
        owner,
        { communication_prefs: prefs },
        { expectedVersion: existing?.updated_at ?? null },
      );
      return NextResponse.json({
        profile,
        prefs_action: {
          action: body.feedback_action,
          explicit_feedback: prefs.explicit_feedback ?? [],
        },
      });
    }
    const update: ProfilePatch = {};
    for (const [key, max] of [
      ['display_name', 64],
      ['birthday', 10],
      ['occupation', 128],
      ['city', 64],
      ['timezone', 64],
    ] as const) {
      if (body[key] !== undefined) {
        if (body[key] !== null && typeof body[key] !== 'string')
          return coreError(400, 'INVALID_PROFILE');
        update[key] = body[key]?.trim().slice(0, max) || null;
      }
    }
    if (update.timezone && !isValidTimeZone(update.timezone))
      return coreError(400, 'INVALID_TIME_ZONE');
    if (body.family_members !== undefined) {
      if (!Array.isArray(body.family_members)) return coreError(400, 'INVALID_PROFILE');
      update.family_members = body.family_members;
    }
    for (const key of ['lifestyle', 'communication_prefs'] as const)
      if (body[key] !== undefined) {
        if (!body[key] || typeof body[key] !== 'object' || Array.isArray(body[key]))
          return coreError(400, 'INVALID_PROFILE');
        update[key] = body[key];
      }
    if (body.important_dates !== undefined)
      update.important_dates = normalizeImportantDates(body.important_dates);
    if (
      body.profile_updated_at !== undefined &&
      body.profile_updated_at !== null &&
      (typeof body.profile_updated_at !== 'string' ||
        !Number.isFinite(Date.parse(body.profile_updated_at)))
    )
      return coreError(400, 'INVALID_PROFILE_VERSION');
    return NextResponse.json({
      profile: repo.saveProfile(owner, update, {
        importantDatesMode: parseImportantDatesWriteMode(body.important_dates_mode),
        expectedVersion: body.profile_updated_at,
      }),
    });
  });
}
