'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/api';
import { useApiError, useT } from '@/lib/i18n-client';
import { toast } from 'sonner';

type LearnedPreference = { id: string; text: string };
type ProfileResponse = { profile?: { updated_at?: string; communication_prefs?: { explicit_feedback?: string[] } | null } | null };

/**
 * 手动偏好的写路径打到 `/api/profile`，所以要像 `conflictOf(data.conflict)` 那样转发它的判别字段：
 * 该 route 的 500 发 `detail: 'brief'`（契约 §6.4.1），据此取字典短文案
 * `errors.INTERNAL_ERROR.brief`（zh 逐字符 = 「服务器开了小差」）；不带该字段时回落通用长文案。
 * 只有 wire 明说 `'brief'` 才认，其余形态一律不给后缀。
 */
function detailOf(value: unknown): 'brief' | undefined {
  return value === 'brief' ? 'brief' : undefined;
}

export function CompanionPreferenceSettings({ open, visitorId, companionId }: {
  open: boolean; visitorId: string; companionId: string;
}) {
  const t = useT();
  const apiError = useApiError();
  const [manual, setManual] = useState<string[]>([]);
  const [learned, setLearned] = useState<LearnedPreference[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ kind: 'manual' | 'learned'; id: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmation, setConfirmation] = useState<{ kind: 'manual' | 'learned'; id?: string } | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const readyRef = useRef(false);
  const profileVersion = useRef<string | null>(null);

  const load = useCallback(async () => {
    const current = ++generation.current;
    readyRef.current = false;
    setLoading(true); setError(null);
    try {
      const [profileResponse, memoryResponse] = await Promise.all([
        apiFetch('/api/profile', { signal: AbortSignal.timeout(15_000) }),
        apiFetch(`/api/companions/${companionId}/preferences`, { signal: AbortSignal.timeout(15_000) }),
      ]);
      if (!profileResponse.ok || !memoryResponse.ok) throw new Error(t('chat.preference.load_failed'));
      const [profile, memory] = await Promise.all([profileResponse.json() as Promise<ProfileResponse>,
        memoryResponse.json() as Promise<{ memories: LearnedPreference[]; next_cursor: string | null }>]);
      if (generation.current !== current) return;
      setManual(profile.profile?.communication_prefs?.explicit_feedback ?? []);
      profileVersion.current = profile.profile?.updated_at ?? null;
      setLearned(memory.memories); setNextCursor(memory.next_cursor);
      readyRef.current = true;
    } catch { if (generation.current === current) setError(t('chat.preference.load_failed')); }
    finally { if (generation.current === current) setLoading(false); }
  }, [apiError, companionId]);

  useEffect(() => {
    setEdit(null); setConfirmation(null); setDraft('');
    setManual([]); setLearned([]); setNextCursor(null);
    if (open) void load();
    return () => { generation.current += 1; readyRef.current = false; };
  }, [open, visitorId, companionId, load]);

  const more = async () => {
    if (!nextCursor || busyRef.current || !readyRef.current) return;
    busyRef.current = true; setBusy(true);
    const current = generation.current;
    try {
      const response = await apiFetch(`/api/companions/${companionId}/preferences?before=${encodeURIComponent(nextCursor)}`,
        { signal: AbortSignal.timeout(15_000) });
      const data = await response.json() as { memories: LearnedPreference[]; next_cursor: string | null };
      if (!response.ok) throw new Error(t('chat.preference.load_failed_short'));
      if (generation.current !== current) return;
      setLearned((existing) => {
        const ids = new Set(existing.map((entry) => entry.id));
        return [...existing, ...data.memories.filter((entry) => !ids.has(entry.id))];
      });
      setNextCursor(data.next_cursor);
    } catch { if (generation.current === current) toast.error(t('chat.preference.more_failed')); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const mutate = async (kind: 'manual' | 'learned', remove: boolean, id?: string) => {
    if (!open || !readyRef.current || busyRef.current || loading) return;
    const text = draft.trim();
    if (!remove && !text) { toast.error(t('chat.preference.empty_text')); return; }
    busyRef.current = true; setBusy(true);
    const current = generation.current;
    try {
      const response = await apiFetch(kind === 'manual' ? '/api/profile' : `/api/companions/${companionId}/preferences`, {
        method: kind === 'learned' && remove ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'manual'
          ? { profile_updated_at: profileVersion.current, ...(remove
            ? { feedback_action: 'revoke', revoke_mode: 'explicit_feedback' } : { feedback_action: 'append', feedback: text }) }
          : { id, ...(remove ? {} : { text }) }),
        signal: AbortSignal.timeout(30_000),
      });
      // `detail` 只在 `kind === 'manual'`（打到 `/api/profile`）时存在；其它端点没有该字段，
      // 传 undefined 不影响既有分因与长文案。
      const data = await response.json() as { error?: string; detail?: string };
      if (generation.current !== current) return;
      if (!response.ok) throw new Error(apiError(data, {
        detail: detailOf(data.detail),
        fallback: t('chat.preference.update_unconfirmed'),
      }));
      setEdit(null); setConfirmation(null); setDraft('');
      await load();
      toast.success(remove ? t('chat.preference.revoked') : t('chat.preference.updated'));
    } catch (failure) {
      if (generation.current === current) {
        toast.error(failure instanceof Error ? failure.message : t('chat.preference.update_failed'));
        void load();
      }
    } finally { busyRef.current = false; setBusy(false); }
  };

  const editor = () => <div className="mt-2">
    <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={160} aria-label={t('chat.preference.editor_aria')} />
    <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit(null)}>{t('chat.preference.cancel')}</Button>
      <Button size="sm" disabled={busy || loading} onClick={() => edit && void mutate(edit.kind, false, edit.id)}>{t('chat.preference.save')}</Button></div>
  </div>;

  return <div className="rounded-xl border border-border bg-card/60 p-3" data-testid="companion-preference-settings">
    <h3 className="text-sm font-medium">{t('chat.preference.title')}</h3>
    {loading && <p className="mt-2 text-xs text-muted-foreground">{t('chat.preference.loading')}</p>}
    {error && <div className="mt-2 text-xs text-destructive">{error}<Button size="sm" variant="ghost" onClick={() => void load()}>{t('chat.preference.retry')}</Button></div>}
    <section className="mt-3"><h4 className="text-xs font-medium">{t('chat.preference.manual_section')}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t('chat.preference.manual_hint')}</p>
      {!loading && !error && !manual.length && <p className="mt-2 text-xs text-muted-foreground">{t('chat.preference.manual_empty')}</p>}
      {manual.map((text, index) => <div key={`${index}:${text}`} className="mt-2 rounded-lg border border-border p-2 text-xs">
        {text}<Button variant="ghost" size="sm" disabled={busy || loading || Boolean(error)}
          onClick={() => { setEdit({ kind: 'manual', id: String(index) }); setDraft(text); }}>{t('chat.preference.edit')}</Button>
      </div>)}
      {edit?.kind === 'manual' && editor()}
      {manual.length > 0 && <Button variant="ghost" size="sm" disabled={busy || loading || Boolean(error)}
        onClick={() => setConfirmation({ kind: 'manual' })}>{t('chat.preference.revoke_manual')}</Button>}
    </section>
    <section className="mt-4"><h4 className="text-xs font-medium">{t('chat.preference.learned_section')}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t('chat.preference.learned_hint')}</p>
      {!loading && !error && !learned.length && <p className="mt-2 text-xs text-muted-foreground">{t('chat.preference.learned_empty')}</p>}
      {learned.map((entry) => <div key={entry.id} className="mt-2 rounded-lg border border-border p-2 text-xs">
        {edit?.kind === 'learned' && edit.id === entry.id ? editor() : <>
          <p>{entry.text}</p><div className="mt-1 flex gap-2"><Button size="sm" variant="ghost" disabled={busy || loading || Boolean(error)}
            onClick={() => { setEdit({ kind: 'learned', id: entry.id }); setDraft(entry.text.replace(/^TA 明确提出过相处方式上的要求：/, '').replace(/（照此调整表达；TA 后来说的新说法优先）$/, '').slice(0, 160)); }}>{t('chat.preference.edit')}</Button>
          <Button size="sm" variant="ghost" disabled={busy || loading || Boolean(error)} onClick={() => setConfirmation({ kind: 'learned', id: entry.id })}>{t('chat.preference.revoke_one')}</Button></div>
        </>}
      </div>)}
      {nextCursor && <Button size="sm" variant="ghost" disabled={busy || loading} onClick={() => void more()}>{t('chat.preference.more')}</Button>}
    </section>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(value) => { if (!value) setConfirmation(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('chat.preference.confirm_title')}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation?.kind === 'manual' ? t('chat.preference.confirm_manual') : t('chat.preference.confirm_learned')}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('chat.preference.confirm_cancel')}</AlertDialogCancel>
        <AlertDialogAction disabled={busy || loading} onClick={() => confirmation && void mutate(confirmation.kind, true, confirmation.id)}>{t('chat.preference.confirm_action')}</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
