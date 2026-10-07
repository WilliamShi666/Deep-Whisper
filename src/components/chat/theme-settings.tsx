'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import {
  DEFAULT_CHAT_THEME_ID,
  DEFAULT_UI_THEME_ID,
  type ChatTheme,
  type UiTheme,
} from '@/lib/chat-themes';
import { cn } from '@/lib/utils';
import { useApiError, useLocale, useT } from '@/lib/i18n-client';
import { toast } from 'sonner';

interface ThemeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 应用新皮肤（null = 恢复默认无背景） */
  onApply: (theme: ChatTheme | null) => void;
  /** 应用新 UI 色调 */
  onApplyUi: (ui: UiTheme) => void;
  conversationId: string;
  companionId: string;
}

/**
 * 聊天装扮：UI 色调 + 二次元背景皮肤。
 * 色调与性别无关；背景皮肤池由服务端按当前 TA 的性别过滤下发。
 *
 * 第五轮 U4：**本弹窗不再托管氛围圆圈**（用户：「不需要在装扮弹窗以及支付页里面再放置这两个圈圈」）。
 * 那颗圆圈现在在聊天头部的调色板图标左侧（`chat-shell.tsx`），落位判据见
 * `tests/palette-surfaces.test.ts` 与 `tests/character-palette.test.ts`。
 */
export function ThemeSettings({
  open,
  onOpenChange,
  onApply,
  onApplyUi,
  conversationId,
  companionId,
}: ThemeSettingsProps) {
  const t = useT();
  const { locale } = useLocale();
  const apiError = useApiError();
  /** 壁纸 / 色调的**英文名与英文副标题**来自 `chat-themes.ts` 的 `nameEn` / `descEn`（t3 产出）。 */
  const themeName = (theme: ChatTheme | UiTheme) => (locale === 'en' ? theme.nameEn : theme.name);
  const themeDesc = (theme: ChatTheme) => (locale === 'en' ? theme.descEn : theme.desc);
  const [themes, setThemes] = useState<ChatTheme[]>([]);
  const [currentId, setCurrentId] = useState<string>(DEFAULT_CHAT_THEME_ID);
  const [uiThemes, setUiThemes] = useState<UiTheme[]>([]);
  const [currentUiId, setCurrentUiId] = useState<string>(DEFAULT_UI_THEME_ID);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch(`/api/themes?conversation_id=${encodeURIComponent(conversationId)}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          themes?: ChatTheme[];
          current_id?: string;
          ui_themes?: UiTheme[];
          current_ui_id?: string;
          error?: string;
        };
        if (!res.ok || !data.themes) throw new Error(apiError(data, { fallback: t('chat.conversation.load_failed') }));
        setThemes(data.themes);
        setCurrentId(data.current_id ?? DEFAULT_CHAT_THEME_ID);
        setUiThemes(data.ui_themes ?? []);
        setCurrentUiId(data.current_ui_id ?? DEFAULT_UI_THEME_ID);
      })
      .catch(() => toast.error(t('chat.theme.list_failed')))
      .finally(() => setLoading(false));
  }, [open, conversationId]);

  const select = async (id: string) => {
    if (switching || id === currentId) return;
    setSwitching(id);
    try {
      const res = await apiFetch(`/api/companions/${companionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_id: id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(apiError(data, { fallback: t('chat.theme.switch_failed') }));
      setCurrentId(id);
      onApply(id === DEFAULT_CHAT_THEME_ID ? null : (themes.find((t) => t.id === id) ?? null));
      toast.success(id === DEFAULT_CHAT_THEME_ID ? t('chat.theme.restored') : t('chat.theme.applied'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('chat.theme.switch_failed_retry'));
    } finally {
      setSwitching(null);
    }
  };

  const selectUi = async (id: string) => {
    if (switching || id === currentUiId) return;
    setSwitching(`ui:${id}`);
    try {
      const res = await apiFetch('/api/visitor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui_theme: id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(apiError(data, { fallback: t('chat.theme.switch_failed') }));
      const ui = uiThemes.find((t) => t.id === id);
      if (!ui) throw new Error(t('chat.theme.ui_missing'));
      setCurrentUiId(id);
      onApplyUi(ui);
      toast.success(t('chat.theme.ui_applied', { name: themeName(ui) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('chat.theme.switch_failed_retry'));
    } finally {
      setSwitching(null);
    }
  };

  const renderBadge = (id: string) => {
    if (switching === id) {
      return (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/70">
          <Loader2 className="h-3 w-3 animate-spin text-white/80" />
        </span>
      );
    }
    if (currentId === id) {
      return (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-400/90">
          <Check className="h-3 w-3 text-white" />
        </span>
      );
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-lg border-border bg-popover text-popover-foreground"
        data-testid="theme-settings"
        data-companion-id={companionId}
        data-conversation-id={conversationId}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{t('chat.theme.title')}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t('chat.theme.subtitle')}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            {/* UI 色调 */}
            <section>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t('chat.theme.section_ui')}</p>
              <div className="grid grid-cols-4 gap-2">
                {uiThemes.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => void selectUi(u.id)}
                    disabled={switching !== null}
                    className={cn(
                      'group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all',
                      currentUiId === u.id
                        ? 'border-rose-300/60 ring-2 ring-rose-300/40'
                        : 'border-border hover:border-foreground/25',
                    )}
                  >
                    <span
                      className="h-8 w-full rounded-lg border border-black/10"
                      style={{
                        background: `linear-gradient(135deg, ${u.swatch} 55%, ${u.accent})`,
                      }}
                    />
                    <span className="text-[11px] text-foreground/80">{themeName(u)}</span>
                    {switching === `ui:${u.id}` ? (
                      <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70">
                        <Loader2 className="h-2.5 w-2.5 animate-spin text-white/80" />
                      </span>
                    ) : currentUiId === u.id ? (
                      <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400/90">
                        <Check className="h-2.5 w-2.5 text-white" />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>

            {/* 聊天背景 */}
            <section>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t('chat.theme.section_background')}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* 默认：无背景 */}
                <button
                  onClick={() => void select(DEFAULT_CHAT_THEME_ID)}
                  disabled={switching !== null}
                  className={cn(
                    'group relative overflow-hidden rounded-xl border text-left transition-all',
                    currentId === DEFAULT_CHAT_THEME_ID
                      ? 'border-rose-300/60 ring-2 ring-rose-300/40'
                      : 'border-border hover:border-foreground/25',
                  )}
                >
                  <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 bg-muted">
                    <Sparkles className="h-5 w-5 text-muted-foreground/60" />
                    <span className="text-xs text-muted-foreground">{t('chat.theme.no_background')}</span>
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="text-xs font-medium text-foreground/85">{t('chat.theme.default')}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{t('chat.theme.default_desc')}</p>
                  </div>
                  {renderBadge(DEFAULT_CHAT_THEME_ID)}
                </button>

                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => void select(t.id)}
                    disabled={switching !== null}
                    className={cn(
                      'group relative overflow-hidden rounded-xl border text-left transition-all',
                      currentId === t.id
                        ? 'border-rose-300/60 ring-2 ring-rose-300/40'
                        : 'border-border hover:border-foreground/25',
                    )}
                  >
                    <div className="aspect-[3/4] overflow-hidden bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.thumbnail ?? t.image}
                        alt={themeName(t)}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <div className="bg-card px-2.5 py-2">
                      <p className="text-xs font-medium text-foreground/85">{themeName(t)}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{themeDesc(t)}</p>
                    </div>
                    {renderBadge(t.id)}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
