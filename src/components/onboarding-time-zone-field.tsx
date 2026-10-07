'use client';

import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n-client';
import { isValidTimeZone } from '@/lib/memory/time-source';

export function OnboardingTimeZoneField({ value, onChange, disabled }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const t = useT();
  const valid = isValidTimeZone(value.trim());
  return <div>
    <label htmlFor="onboarding-timezone" className="text-sm font-medium text-foreground/80">{t('entry.onboarding.timezone.label')}</label>
    <Input id="onboarding-timezone" data-testid="onboarding-timezone" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} maxLength={64} aria-invalid={!valid} aria-describedby="onboarding-timezone-help" className="mt-2" />
    <p id="onboarding-timezone-help" className={`mt-1.5 text-xs ${valid ? 'text-muted-foreground' : 'text-destructive'}`}>{t(valid ? 'entry.onboarding.timezone.hint' : 'entry.onboarding.timezone.invalid')}</p>
  </div>;
}
