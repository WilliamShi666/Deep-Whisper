import { isValidTimeZone } from '@/lib/memory/time-source';

export const DEFAULT_ONBOARDING_TIME_ZONE = 'Asia/Shanghai';

export function initialOnboardingTimeZone(read: () => string | null): string {
  try {
    const zone = read();
    return zone && isValidTimeZone(zone) ? zone : DEFAULT_ONBOARDING_TIME_ZONE;
  } catch {
    return DEFAULT_ONBOARDING_TIME_ZONE;
  }
}

/** Repicking a companion cannot replace a saved owner time zone. Version fences protect concurrent edits. */
export function onboardingTimeZonePatch({ repick, timeZone, profile }: {
  repick: boolean;
  timeZone: string;
  profile: { timezone?: string | null; updated_at: string } | null;
}): { timezone?: string; profile_updated_at?: string | null } {
  if (repick && profile?.timezone && isValidTimeZone(profile.timezone)) return {};
  const zone = timeZone.trim();
  if (!isValidTimeZone(zone)) throw new Error('INVALID_TIME_ZONE');
  return { timezone: zone, profile_updated_at: profile?.updated_at ?? null };
}
