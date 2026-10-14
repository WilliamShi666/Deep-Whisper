'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiError, useT } from '@/lib/i18n-client';

export function PersonaEnhancer({ value, onAdopt }: { value: string; onAdopt: (value: string) => void }) {
  const t = useT();
  const apiError = useApiError();
  const [loading, setLoading] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [basedOn, setBasedOn] = useState('');
  const [error, setError] = useState('');

  const enhance = async () => {
    const draft = value.trim();
    if (!draft || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/persona-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: draft }),
      });
      const data = (await response.json()) as { persona?: string; based_on?: string; error?: string };
      if (!response.ok || !data.persona) throw new Error(apiError(data, { fallback: t('chat.persona.enhance_failed') }));
      setCandidate(data.persona);
      setBasedOn(data.based_on ?? draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('chat.persona.enhance_failed_retry'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void enhance()} disabled={loading || !value.trim()}>
        {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {t('chat.persona.enhance')}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {candidate && (
        <div
          className="rounded-xl border border-primary/30 bg-primary/5 p-3"
          data-testid="persona-enhancement-preview"
          data-based-on={basedOn}
        >
          <p className="text-xs font-medium text-foreground/80">{t('chat.persona.preview')}</p>
          {value.trim() !== basedOn && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{t('chat.persona.stale_draft')}</p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/75">{candidate}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={() => { onAdopt(candidate); setCandidate(null); }}>{t('chat.persona.adopt')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCandidate(null)}>{t('chat.persona.keep')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
