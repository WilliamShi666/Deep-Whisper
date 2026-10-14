'use client';
import type { CSSProperties } from 'react';
import { CircleAlert, Loader2, Play, Pause, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n-client';
export type VoiceState = 'ready' | 'loading' | 'playing' | 'error';
export interface VoiceStaleNotice {
  audioVoice: string;
  currentVoice: string;
}
export function VoiceBar({
  state,
  accent,
  onPlay,
  staleNotice,
  onRegenerate,
  locked,
}: {
  state: VoiceState;
  accent: string;
  onPlay: () => void;
  staleNotice?: VoiceStaleNotice | null;
  onRegenerate?: () => void;
  locked?: boolean;
  palette?: unknown;
}) {
  const t = useT();
  const playing = state === 'playing';
  const loading = state === 'loading';
  const failed = state === 'error';
  const contrastStyle = {
    '--voice-accent-contrast': `color-mix(in oklab, ${accent} 40%, var(--foreground))`,
  } as CSSProperties;
  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
      style={contrastStyle}
      data-voice-stale={staleNotice ? 'true' : 'false'}
    >
      <button
        type="button"
        data-testid="voice-bar"
        onClick={onPlay}
        disabled={locked}
        title={locked ? t('chat.config.speech_play') : undefined}
        aria-label={
          loading
            ? t('chat.voice.wave_loading')
            : playing
              ? t('chat.voice.wave_stop')
              : failed
                ? t('chat.voice.wave_retry')
                : t('chat.voice.wave_play')
        }
        className={cn(
          'inline-flex items-center gap-2 rounded-full bg-foreground/5 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-foreground/10 disabled:opacity-50',
        )}
      >
        {loading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : playing ? (
          <Pause className="size-3" />
        ) : failed ? (
          <RotateCcw className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
        <span className="flex items-center gap-[3px]">
          {[0.9, 0.5, 1.1, 0.7, 1].map((d, i) => (
            <span
              key={i}
              className={cn('w-[2px] rounded-full', playing && 'voice-wave-bar')}
              style={{
                height: `${6 + i * 2}px`,
                backgroundColor: 'var(--voice-accent-contrast)',
                animationDelay: playing ? `${d * 0.15}s` : undefined,
                opacity: playing ? 1 : 0.6,
              }}
            />
          ))}
        </span>
        {loading
          ? t('chat.voice.label_loading')
          : playing
            ? t('chat.voice.label_playing')
            : failed
              ? t('chat.voice.label_failed')
              : t('chat.voice.label_ready')}
      </button>
      {staleNotice && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground/90 shadow-sm ring-1 ring-foreground/15 backdrop-blur-md"
          data-testid="voice-stale-notice"
        >
          <CircleAlert
            className="h-3 w-3 shrink-0"
            style={{ color: 'var(--voice-accent-contrast)' }}
          />
          {t('chat.voice.stale', { voice: staleNotice.audioVoice })}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={loading || !onRegenerate}
            className="ml-0.5 rounded-full bg-foreground/10 px-2 py-0.5 transition-colors hover:bg-foreground/20 disabled:opacity-50"
            data-testid="voice-regenerate"
            aria-label={t('chat.voice.regenerate_aria', { voice: staleNotice.currentVoice })}
          >
            {t('chat.voice.regenerate', { voice: staleNotice.currentVoice })}
          </button>
        </span>
      )}
    </div>
  );
}
