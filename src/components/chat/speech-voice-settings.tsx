'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Square, Volume2 } from 'lucide-react';
import { getVoicesForGender, resolveVoiceId, type CharacterGender } from '@/lib/characters';
import { formatVoiceLabel } from '@/lib/character-display';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useApiError, useLocale, useT } from '@/lib/i18n-client';
import type { SpeechPresentation } from '@/lib/personal/speech-presentation';

type PreviewState = 'idle' | 'loading' | 'playing' | 'error';

/**
 * 音色设置：只列**与该伴侣性别相符**的音色，中文在前、英文在后，界面只显示代号。
 *
 * 产品口径（2026-09-29 定稿）：
 *   - 女角色 → 中文女声 7 个 + 英文女声 6 个；男角色 → 中文男声 7 个 + 英文男声 5 个；
 *   - 一律用代号（\`肥鱼音色 N（女/男）\` / \`chubby fish voice N (female/male)\`），
 *     **不出现上游原名**；代号由 `formatVoiceLabel(option, locale)` 给出（英文形按 id 算式推导，
 *     t3 的 `character-display.ts` 是唯一入口，这里不再读 `option.label` 做展示）；
 *   - **显示顺序恒为「中文音色在前」**（AGENTS.md 硬约束③）：顺序不随界面语言变化，
 *     于是「代号里的编号」与「用户看到的顺序」在两种语言下都一致；
 *   - 服务端同样按性别校验（\`isSelectableVoiceId(id, gender)\`），所以这里过滤不是装饰。
 *
 * 这里没有「允许语音朗读」开关与语速滑杆：云端音色没有设备语音表，语速由模型决定；
 * 是否出声完全由用户点击消息上的播放键决定。选中的音色通过 onVoiceChange 上报，
 * 随「保存」一起 PATCH 进 companion.voice_id。
 */
export function SpeechVoiceSettings({
  voiceId,
  gender,
  onVoiceChange,
  previewEnabled = true,
  speechPresentation = { mode: 'catalog', fallback: 'none' },
}: {
  previewEnabled?: boolean;
  speechPresentation?: SpeechPresentation;
  voiceId: string | null;
  gender: CharacterGender;
  onVoiceChange: (voiceId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const apiError = useApiError();
  const voices = useMemo(() => getVoicesForGender(gender), [gender]);
  // 中文在前、英文在后；组内保持目录顺序（= 代号编号顺序）。
  const groups = useMemo(() => {
    return (['zh', 'en'] as const)
      .map((language) => ({ language, voices: voices.filter((voice) => voice.language === language) }))
      .filter((group) => group.voices.length > 0);
  }, [voices]);

  const [selected, setSelected] = useState(() => resolveVoiceId(voiceId, gender));
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const stopPreview = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    const element = audioRef.current;
    audioRef.current = null;
    if (element) {
      element.onplay = null;
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.src = '';
    }
    setPreviewState('idle');
  }, []);

  // 伴侣变了要把存着的音色重新归一化（旧别名 / 上一轮被裁掉的 id）。
  useEffect(() => {
    setSelected(resolveVoiceId(voiceId, gender));
  }, [voiceId, gender]);

  useEffect(() => () => {
    requestRef.current?.abort();
    const element = audioRef.current;
    if (!element) return;
    element.onplay = null;
    element.onended = null;
    element.onerror = null;
    element.pause();
    element.src = '';
  }, []);

  const preview = async () => {
    if (!previewEnabled) return;
    if (previewState === 'loading' || previewState === 'playing') {
      stopPreview();
      return;
    }
    stopPreview();
    setPreviewError(null);
    setPreviewState('loading');
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      /*
        试听文本：**英文音色在英文界面下用英文试听句**（用户 2026-10-03：
        「Qwen voice 也支持英文语音，这点也需要注意」）。
        中文音色一律不传 text（沿用服务端默认的中文试听句，逐字符不变）；
        英文音色的 zh 值与该默认句逐字符相同（`tests/chat-ux-contract.test.ts` 钉住），
        所以中文态显式传它得到的仍是同一句 —— 中文态零行为变化。
      */
      const previewVoice = voices.find((voice) => voice.id === selected) ?? null;
      const previewText = previewVoice?.language === 'en' ? t('chat.voice.preview_sample') : undefined;
      const res = await apiFetch('/api/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewText ? { voice_id: selected, text: previewText } : { voice_id: selected }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { audio_url?: string; error?: string };
      if (!res.ok || !data.audio_url) {
        throw new Error(apiError(data, { feature: 'tts_preview', fallback: t('chat.voice.preview_generate_failed') }));
      }
      if (requestRef.current !== controller) return;
      requestRef.current = null;
      const element = new Audio(data.audio_url);
      audioRef.current = element;
      element.onplay = () => setPreviewState('playing');
      element.onended = () => {
        if (audioRef.current === element) audioRef.current = null;
        setPreviewState('idle');
      };
      element.onerror = () => {
        if (audioRef.current === element) audioRef.current = null;
        setPreviewError(t('chat.voice.preview_play_failed'));
        setPreviewState('error');
      };
      await element.play();
    } catch (err) {
      if (controller.signal.aborted) return;
      if (requestRef.current === controller) requestRef.current = null;
      setPreviewError(err instanceof Error ? err.message : t('chat.voice.preview_generate_failed'));
      setPreviewState('error');
    }
  };

  const current = voices.find((voice) => voice.id === selected) ?? null;
  /** 组标签（中文音色 / 英文音色）走字典；显示顺序仍是中文在前，不随界面语言重排。 */
  const groupLabel = (language: 'zh' | 'en') => t(language === 'zh' ? 'chat.voice.group_zh' : 'chat.voice.group_en');
  const compatibility = speechPresentation.mode === 'compatibility';
  const descFor = (voice: (typeof voices)[number]) => compatibility ? '' : (locale === 'en' ? voice.descEn : voice.desc);
  const busy = previewState === 'loading' || previewState === 'playing';

  return (
    <div className="space-y-2" data-testid="speech-voice-settings">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Volume2 className="h-4 w-4" />{t('chat.voice.title')}
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">
          {t(compatibility ? 'chat.voice.code_count' : 'chat.voice.count', { count: voices.length })}
        </span>
      </div>

      {compatibility && <p data-testid="speech-compatibility-notice" className="text-xs text-muted-foreground">{t('chat.voice.compatibility')}</p>}
      {speechPresentation.fallback === 'gender-compatible' && <p data-testid="speech-fallback-notice" className="text-xs text-muted-foreground">{t('chat.voice.compatible_fallback')}</p>}

      <select
        value={selected}
        onChange={(event) => {
          stopPreview();
          setSelected(event.target.value);
          onVoiceChange(event.target.value);
        }}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        aria-label={t('chat.voice.title')}
      >
        {groups.map((group) => (
          <optgroup key={group.language} label={groupLabel(group.language)}>
            {group.voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {/* 代号由 formatVoiceLabel 按 id 算式推导；英文音色没有描述词
                    （产品要求不显示英音/美音），此时不留悬空的分隔符。 */}
                {descFor(voice) ? formatVoiceLabel(voice, locale) + ' · ' + descFor(voice) : formatVoiceLabel(voice, locale)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {current ? (descFor(current) || groupLabel(current.language)) : t('chat.voice.none')}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void preview()}
          disabled={!current || !previewEnabled}
        >
          {previewState === 'loading'
            ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />{t('chat.voice.generating')}</>
            : busy
              ? <><Square className="mr-1 h-3.5 w-3.5" />{t('chat.voice.stop_preview')}</>
              : <><Play className="mr-1 h-3.5 w-3.5" />{previewState === 'error' ? t('chat.voice.retry_preview') : t('chat.voice.preview')}</>}
        </Button>
      </div>
      <p aria-live="polite" className="text-[11px] text-muted-foreground">
        {previewState === 'loading'
          ? t('chat.voice.preview_loading')
          : previewState === 'playing'
            ? t('chat.voice.preview_playing')
            : previewState === 'error'
              ? (previewError ?? t('chat.voice.preview_failed'))
              : t('chat.voice.hint')}
      </p>
    </div>
  );
}
