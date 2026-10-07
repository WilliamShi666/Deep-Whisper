'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { resolveVoiceId, type CharacterPreset } from '@/lib/characters';
import { getCharacterAvatar } from '@/lib/character-appearance';
import { apiFetch } from '@/lib/api';
import { useApiError, useT } from '@/lib/i18n-client';
import type { CompanionDTO } from '@/lib/types';
import type { SpeechPresentation } from '@/lib/personal/speech-presentation';
import { toast } from 'sonner';
import { PersonaEnhancer } from './persona-enhancer';
import { SpeechVoiceSettings } from './speech-voice-settings';
import { CompanionPreferenceSettings } from './companion-preference-settings';
import { CompanionImportantDates } from './companion-important-dates';
import { CompanionLetterSettings } from './companion-letter-settings';

interface CompanionSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companion: CompanionDTO;
  character: CharacterPreset;
  onSaved: (companion: CompanionDTO) => void;
  /** 跳转「重新遇见 TA」（重选角色模版） */
  onRepick: () => void;
  visitorId: string;
  speechEnabled: boolean;
  speechPresentation: SpeechPresentation;
  disableAppearance?: boolean;
}

/** 恋人设置：名字、称呼、性格补充、音色 */
export function CompanionSettings({
  open,
  onOpenChange,
  companion,
  character,
  onSaved,
  onRepick,
  visitorId,
  speechEnabled,
  speechPresentation,
  disableAppearance = false,
}: CompanionSettingsProps) {
  const t = useT();
  const apiError = useApiError();
  const [name, setName] = useState(companion.name);
  const [userTitle, setUserTitle] = useState(companion.user_title ?? '');
  const [persona, setPersona] = useState(companion.persona ?? '');
  const [appearanceStyle, setAppearanceStyle] = useState(companion.appearance_style ?? 'chibi');
  // 库里可能还留着历史平台音色 id：开框即归一化到当前的 Gemini 音色，保存时不再回传旧 id。
  const [voiceId, setVoiceId] = useState(() => resolveVoiceId(companion.voice_id, character.gender));
  const [saving, setSaving] = useState(false);

  const restoreSaved = () => {
    setName(companion.name);
    setUserTitle(companion.user_title ?? '');
    setPersona(companion.persona ?? '');
    setAppearanceStyle(companion.appearance_style ?? 'chibi');
    setVoiceId(resolveVoiceId(companion.voice_id, character.gender));
  };

  useEffect(() => {
    if (!open) return;
    setName(companion.name);
    setUserTitle(companion.user_title ?? '');
    setPersona(companion.persona ?? '');
    setAppearanceStyle(companion.appearance_style ?? 'chibi');
    setVoiceId(resolveVoiceId(companion.voice_id, character.gender));
  }, [open, companion, character.gender]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companions/${companion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || companion.name,
          user_title: userTitle.trim(),
          persona: persona.trim(),
          appearance_style: appearanceStyle,
          voice_id: voiceId,
        }),
      });
      const data = (await res.json()) as { companion?: CompanionDTO; error?: string };
      if (!res.ok || !data.companion) {
        restoreSaved();
        toast.error(apiError(data, { fallback: t('chat.settings.save_failed') }));
        return;
      }
      onSaved(data.companion);
      onOpenChange(false);
      toast.success(t('chat.settings.saved'));
    } catch {
      restoreSaved();
      toast.error(t('chat.settings.save_failed_retry'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] overflow-y-auto sm:max-w-md"
        data-testid="companion-settings"
        data-companion-id={companion.id}
        data-appearance-style={appearanceStyle}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 font-serif">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getCharacterAvatar(character.key, appearanceStyle) ?? character.avatar}
              alt={companion.name}
              className="h-10 w-10 rounded-full object-cover object-top"
            />
            {t('chat.settings.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          <div>
            <label htmlFor="companion-settings-name" className="text-sm font-medium text-foreground/80">{t('chat.settings.name')}</label>
            <Input
              id="companion-settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={12}
              className="mt-1.5"
            />
          </div>
          <div>
            <label htmlFor="companion-settings-user-title" className="text-sm font-medium text-foreground/80">{t('chat.settings.user_title')}</label>
            <Input
              id="companion-settings-user-title"
              value={userTitle}
              onChange={(e) => setUserTitle(e.target.value)}
              maxLength={12}
              className="mt-1.5"
              placeholder={t('chat.settings.user_title_placeholder')}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t('chat.settings.user_title_hint')}</p>
          </div>
          <div>
            <label htmlFor="companion-settings-persona" className="text-sm font-medium text-foreground/80">{t('chat.settings.persona')}</label>
            <Textarea
              id="companion-settings-persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              maxLength={600}
              className="mt-1.5"
              placeholder={t('chat.settings.persona_placeholder')}
            />
            <div className="mt-1 text-right text-[11px] text-muted-foreground">{persona.length}/600</div>
            <PersonaEnhancer value={persona} onAdopt={setPersona} />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/80">{t('chat.settings.appearance')}</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['chibi', 'normal'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  disabled={saving || disableAppearance}
                  onClick={() => setAppearanceStyle(style)}
                  className={`rounded-xl border p-2 text-left ${appearanceStyle === style ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
                  aria-pressed={appearanceStyle === style}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={getCharacterAvatar(character.key, style) ?? ''} alt={style === 'chibi' ? t('chat.settings.chibi_preview_alt') : t('chat.settings.normal_preview_alt')} className="h-24 w-full rounded-lg bg-muted/60 object-contain object-top" />
                  <span className="mt-1 block text-xs">{style === 'chibi' ? t('chat.settings.chibi') : t('chat.settings.normal')}</span>
                </button>
              ))}
            </div>
            {disableAppearance && <p className="mt-1 text-xs text-muted-foreground">{t('chat.settings.appearance_locked')}</p>}
          </div>

          <SpeechVoiceSettings voiceId={voiceId} gender={character.gender} onVoiceChange={setVoiceId} previewEnabled={speechEnabled} speechPresentation={speechPresentation} />
          {!speechEnabled && <p className="text-xs text-muted-foreground">{t('chat.config.speech')}</p>}


          {/* 相处方式偏好（AC-17）：只读回显 + 更正 / 撤销 */}
          <CompanionPreferenceSettings open={open} visitorId={visitorId} companionId={companion.id} />

          <CompanionLetterSettings open={open} />

          {/* 重要日期录入：生日/纪念日（每年重复）与面试/复查（一次性） */}
          <CompanionImportantDates open={open} visitorId={visitorId} />


          <Button onClick={save} disabled={saving || !name.trim()} className="mt-1 rounded-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('chat.settings.save')}
          </Button>

          {/* 重新遇见 TA：换角色模版，旧聊天记录保留 */}
          <button
            onClick={() => {
              onOpenChange(false);
              onRepick();
            }}
            className="mt-2 flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            <span>
              <span className="block text-sm font-medium text-foreground/80">{t('chat.settings.repick_question')}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t('chat.settings.repick_hint')}
              </span>
            </span>
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
