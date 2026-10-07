'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocaleSwitch } from '@/components/locale-switch';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n-client';
import { PaletteSwitch } from '@/components/palette-switch';
import { usePaletteSurface, useResolvedPalette } from '@/lib/palette-client';
export default function LoginClient() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const t = useT();
  const surface = usePaletteSurface('entry');
  const palettePreference = useResolvedPalette('entry');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (status === 'authed') router.replace('/');
  }, [status, router]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/owner/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(t(response.status === 429 ? 'entry.owner.rate_limited' : 'entry.owner.invalid'));
        return;
      }
      setPassword('');
      if (await refresh()) router.replace('/');
      else setError(t('entry.owner.network'));
    } catch {
      setError(t('entry.owner.network'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      data-surface={surface}
      className="flex min-h-screen items-center justify-center bg-background px-6"
    >
      <LocaleSwitch className="fixed right-12 top-4 z-20" persist="local" />
      <PaletteSwitch
        className="fixed right-4 top-4 z-20"
        value={palettePreference}
        persist="local"
      />
      <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="owner-login">
        <Heart className="mx-auto size-12 text-primary" />
        <div className="text-center">
          <h1 className="font-serif text-2xl">Deep Whisper</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('entry.owner.subtitle')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="owner-password">{t('entry.owner.password')}</Label>
          <Input
            id="owner-password"
            data-testid="owner-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          data-testid="owner-sign-in"
          className="w-full"
          disabled={busy || status === 'loading'}
        >
          {t(busy ? 'entry.owner.unlocking' : 'entry.owner.unlock')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('entry.owner.help')}</p>
      </form>
    </main>
  );
}
