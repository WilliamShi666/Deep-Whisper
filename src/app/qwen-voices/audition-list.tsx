'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * 音色试听列表（客户端，因为要挂 <audio> 播放）。
 *
 * 交互契约（用户要求）：**每句都要点一下才播，且一次只播一句**。
 * 一句话判断不出音色的性格，所以每个音色给 3 句不同的话；三句对所有音色完全相同，
 * 保证横向对比是同口径。
 *
 * 语言分栏（用户 2026-09-29 第二轮）：中文 3 句对**全部**音色保留（英文音色也保留，
 * 它们同时是「中文发音是否自然」的观测点）；15 个英文音色**再各加 3 句英文**。
 * 英文档位单独一行，标签写成「英文 第一句」，与中文档位不会看混。
 *
 * 全页面共用一个播放器实例：切换句子/音色会立刻停掉上一条，避免多处同时出声
 * （也避免用户以为「点了没反应」）。
 */

export type AuditionLanguage = 'zh' | 'en';

export interface AuditionSampleView {
  language: AuditionLanguage;
  index: number;
  text: string;
  fileName: string;
}

export interface AuditionVoiceView {
  id: string;
  nameZh: string;
  gender: string;
  section: string;
  trait: string;
  scenes: string;
  samples: AuditionSampleView[];
}

export interface AuditionGroupView {
  id: string;
  label: string;
  note: string;
  voices: AuditionVoiceView[];
}

const GENDER_LABEL: Record<string, string> = { female: '女声', male: '男声' };
const ORDINAL = ['第一句', '第二句', '第三句'];
const LANGUAGE_LABEL: Record<AuditionLanguage, string> = { zh: '中文', en: '英文' };
const LANGUAGE_ORDER: AuditionLanguage[] = ['zh', 'en'];

function ordinalLabel(index: number): string {
  return ORDINAL[index - 1] ?? '第 ' + index + ' 句';
}


export function QwenAuditionList({
  groups,
  basePath,
}: {
  groups: AuditionGroupView[];
  basePath: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const element = audioRef.current;
    audioRef.current = null;
    if (element) {
      element.onplay = null;
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.src = '';
    }
    setActive(null);
    setPending(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback((key: string, fileName: string) => {
    setError(null);
    if (active === key) { stop(); return; }
    stop();
    const element = new Audio(basePath + '/' + fileName);
    audioRef.current = element;
    setPending(key);
    element.onplay = () => {
      if (audioRef.current === element) { setPending(null); setActive(key); }
    };
    element.onended = () => {
      if (audioRef.current === element) { audioRef.current = null; setActive(null); }
    };
    element.onerror = () => {
      if (audioRef.current !== element) return;
      audioRef.current = null;
      setPending(null);
      setActive(null);
      setError('播放失败，请重试。');
    };
    void element.play().catch(() => {
      if (audioRef.current !== element) return;
      audioRef.current = null;
      setPending(null);
      setActive(null);
      setError('播放失败，请重试。');
    });
  }, [active, basePath, stop]);

  const renderSample = (voiceId: string, sample: AuditionSampleView) => {
    const key = voiceId + '--' + sample.language + sample.index;
    const isActive = active === key;
    const isPending = pending === key;
    return (
      <div key={key} className="rounded-lg border border-border/70 bg-muted/20 p-2">
        <Button
          type="button"
          variant={isActive ? 'default' : 'outline'}
          size="sm"
          className="w-full"
          aria-pressed={isActive}
          aria-label={voiceId + ' ' + LANGUAGE_LABEL[sample.language] + ordinalLabel(sample.index)}
          onClick={() => play(key, sample.fileName)}
        >
          {isPending
            ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />加载中</>
            : isActive
              ? <><Square className="mr-1 h-3.5 w-3.5" />停止</>
              : <><Play className="mr-1 h-3.5 w-3.5" />{sample.language === 'en' ? '英文 · ' : ''}{ordinalLabel(sample.index)}</>}
        </Button>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{sample.text}</p>
      </div>
    );
  };

  return (
    <>
      <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">
        {error
          ? error
          : active
            ? '正在播放；再点同一句可停止。'
            : '点任意一句才播放，一次只播一句 —— 同一个音色请把每一句都听一遍再下判断。'}
      </p>

      {groups.map((group) => (
        <section key={group.id} className="mt-10">
          <h2 className="text-lg font-medium">
            {group.label}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {group.voices.length} 个音色
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{group.note}</p>

          <ul className="mt-4 space-y-3">
            {group.voices.map((voice) => {
              const languages = LANGUAGE_ORDER.filter((language) =>
                voice.samples.some((sample) => sample.language === language));
              return (
                <li key={voice.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">{voice.nameZh}</span>
                    <code className="text-xs text-muted-foreground">{voice.id}</code>
                    <span className="text-xs text-muted-foreground">
                      {GENDER_LABEL[voice.gender] ?? voice.gender}
                      {/* trait 已在服务端（page.tsx）清洗过。**这里不要再用 displayTrait**：
                          本组件是客户端组件，import 它等于把 /^(英式|美式)(女声|男声)$/
                          整本送进浏览器 chunk —— 用来抹掉口音的东西自己泄漏了口音词。 */}
                      {voice.trait ? ' · ' + voice.trait : ''}
                      {voice.scenes ? ' · 官方场景：' + voice.scenes : ''}
                    </span>
                    {languages.includes('en') && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        中英双语
                      </span>
                    )}
                  </div>

                  {languages.map((language) => (
                    <div key={language} className="mt-2">
                      {languages.length > 1 && (
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {LANGUAGE_LABEL[language]}
                        </p>
                      )}
                      <div className="mt-1 grid gap-2 sm:grid-cols-3">
                        {voice.samples
                          .filter((sample) => sample.language === language)
                          .map((sample) => renderSample(voice.id, sample))}
                      </div>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
