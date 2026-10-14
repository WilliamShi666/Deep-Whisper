'use client';

import type { MessageDTO } from '@/lib/types';
import type { CharacterPreset, CharacterTheme } from '@/lib/characters';
import { VoiceBar, type VoiceState, type VoiceStaleNotice } from './voice-bar';
import { MessageFeedback, type MessageFeedbackState } from './message-feedback';
import { photoFallbackNotice, isFallbackPhotoUrl } from '@/lib/ai/photo-object-key';
import { imagePlaceholderLabel, isImagePlaceholder } from '@/lib/chat/image-placeholder';
import {
  aiTextPresentation,
  type ToneMode,
} from '@/lib/chat-layout';
import type { PalettePreference } from '@/lib/palette';
import { useLocale, useT } from '@/lib/i18n-client';
import { cn } from '@/lib/utils';
import { CircleAlert } from 'lucide-react';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const timestampClass = [
  'mt-1 inline-flex w-fit rounded-full bg-background/90 px-1.5 py-0.5',
  'text-[10px] font-medium leading-none tabular-nums text-foreground/90',
  'shadow-sm ring-1 ring-foreground/10 backdrop-blur-md',
].join(' ');

interface BubbleProps {
  message: MessageDTO;
  /**
   * 气泡主题：**必传**，由调用方（chat-shell）把 palette 单一注入点算好的 `theme` 传进来
   * （即 `activeCharacter?.theme ?? applyChatPalette(RECOVERY_THEME, chatPalette)`）。
   *
   * 组件内**没有任何颜色兜底字面量**（t13 修复，队长裁决 B）：原先那份内联兜底正是 F1 的成因
   * —— 它绕过了 palette 注入，`character === null`（历史角色模板不可用的只读视图）时选了玫瑰
   * 气泡仍是旧蓝灰，与头部「在线」/ 流式光标 / 无壁纸氛围半切换。恢复色因此只在
   * `chat-shell.tsx` 的 `RECOVERY_THEME` 里有一份（`theme` 为必传 prop ⇒ 不会有第二份）。
   */
  theme: CharacterTheme;
  /** 角色模板；`null` = 历史角色模板不可用（只读视图，颜色仍来自上面必传的 `theme`）。 */
  character: CharacterPreset | null;
  companionName?: string;
  voiceState?: VoiceState;
  onPlayVoice?: () => void;
  /** 缓存音频的音色与当前选择不一致时，在播放按钮旁展示提示与重生成入口 */
  voiceStaleNotice?: VoiceStaleNotice | null;
  onRegenerateVoice?: () => void;
  /** 当前访客对这条回复的反馈（仅助手消息有意义） */
  feedback?: MessageFeedbackState | null;
  /** rating 为 null 表示撤销 */
  onFeedback?: (rating: 1 | -1 | null, comment: string | null) => Promise<void> | void;
  /**
   * 语音能力未配置时禁用播放，点击不发送合成请求。
   *
   * 追加在 props 末尾 —— `tests/character-palette.test.ts` 钉了解构前三个名字的顺序。
   */
  voiceLocked?: boolean;
  /**
   * 色调明暗（第五轮 U3）：`'light'` 时 AI 正文换成「84% --card 卡膜 + var(--foreground) + 无阴影」，
   * 修掉皮肤近白文字压在亮色调奶白 scrim 上的发灰发飘。缺省 `'dark'` = 今天的观感，零回归。
   * 取值由 t38 的 chat-shell 从 `uiTheme.mode` 传入（`resolveToneMode` 是唯一解析入口）。
   */
  toneMode?: ToneMode;
  /**
   * 已解析的风格（`'rose' | 'blue' | 'native' | null`）：朗读卡片的底色必须跟随用户选的风格，
   * 而不是继承当前 UI 色调的 `--primary`（sage 色调下会变绿）。
   *
   * 名字按本任务契约（`paletteSurface`），值域是**已解析的风格**而不是表面 id ——
   * VoiceBar 侧的同源 prop 叫 `palette`，由它自己调 `paletteSurfaceFor`（单一转换点）。
   * 缺省不传 = 卡片保持现状（与今天逐像素一致）。
   */
  paletteSurface?: PalettePreference | 'native';
}

/** 单条消息气泡（微信风格） */
export function MessageBubble({ message, theme, character, companionName, voiceState, onPlayVoice, voiceStaleNotice, onRegenerateVoice, feedback, onFeedback, voiceLocked, toneMode = 'dark', paletteSurface }: BubbleProps) {
  const t = useT();
  const { locale } = useLocale();
  const isMine = message.role === 'user';

  if (isMine) {
    return (
      <div
        className="anim-fade-in-up flex flex-col items-end"
        style={{ animationDuration: '0.3s' }}
        data-testid={`message-${message.id}`}
        data-content-type={message.content_type}
      >
        <div
          className={cn(
            'max-w-[78%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap',
            message.content_type === 'image' && 'p-1.5',
          )}
          style={{ backgroundColor: theme.myBubble, color: theme.myText }}
        >
          {message.content_type === 'image' && message.image_url ? (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.image_url}
                alt={t('chat.bubble.sent_alt')}
                className="max-h-64 max-w-full rounded-xl object-cover"
              />
              {message.content && (
                <p className="px-2.5 pt-1.5 pb-1">
                  {isImagePlaceholder(message.content) ? imagePlaceholderLabel(locale) : message.content}
                </p>
              )}
            </div>
          ) : (
            message.content
          )}
        </div>
        <span className={timestampClass} data-testid="message-timestamp">
          {formatTime(message.created_at)}
        </span>
      </div>
    );
  }

  return (
    <div
      className="anim-fade-in-up flex items-start gap-2.5"
      style={{ animationDuration: '0.3s' }}
      data-testid={`message-${message.id}`}
      data-content-type={message.content_type}
    >
      {character ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.avatar}
          // 图片 alt 是**单串场合**（契约 §10.3）：英文态只出拼音，绝不出汉字。
          alt={locale === 'en' ? character.nameRoman : character.defaultName}
          className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover object-top"
        />
      ) : (
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label={t('chat.bubble.unknown_character_aria', { name: companionName ?? t('chat.bubble.legacy_character') })}
        >
          <CircleAlert className="h-4 w-4" />
        </span>
      )}
      <div
        className={cn(
          'flex flex-col',
          message.content_type === 'image' ? 'max-w-[78%]' : 'min-w-0 flex-1',
        )}
      >
        <div
          className={cn(
            // 第七轮候选二：浅色档的底膜与它的 chrome（背景模糊 / 描边 / 圆角 / 内边距 / 投影）整段删除，
            // 正文只留这四个排版类 —— 几何回到第五轮之前，明暗两档的 DOM 结构完全一致，
            // 差异 100% 由 chat-layout.ts 的 aiTextPresentation(...) 内联表达（字色 + 提亮晕影）。
            // 原先给那层 chrome 选路的 `data-tone` 随之删除：它唯一的消费者（globals.css 里那条薄纱
            // 规则）已经不存在，留着就是孤立标记。胶囊类只作用于图片分支。
            'text-[15px] leading-relaxed break-words whitespace-pre-wrap',
            message.content_type === 'image' && 'rounded-2xl rounded-tl-md px-4 py-2.5 p-1.5',
            // 第七轮候选三：用户说浅色档 AI 正文「有点淡」「视力不太好的人可能会看不清楚」，并觉得
            // 用户消息更粗。**先量事实**：用户气泡那行与本行**都没有字重类（= 400）** —— 粗细差来自
            // **载体**（用户气泡有实底、笔画边缘不被壁纸纹理冲淡；AI 正文直接压壁纸，白晕还会在边缘
            // 漂白笔画）。所以只给**浅色档**补一档 `font-medium`（500）：深色档（用户已认可）不加，
            // 用户气泡一个字不改，图片分支有自己的胶囊几何也不掺字重。
            message.content_type !== 'image' && toneMode === 'light' && 'font-medium',
          )}
          style={message.content_type === 'image'
            ? { backgroundColor: theme.theirBubble, color: theme.theirText }
            // 第四个入参是**风格强调色**（`theme.accent`）：浅色档的梦幻色光晕取它 ⇒ 用户切换
            // 梦幻玫瑰 / 梦幻蓝 时光晕真的换色（`var(--primary)` 在消息列里不随风格变，见 chat-layout.ts）。
            : { ...aiTextPresentation(theme.theirBubble, toneMode, theme.theirText, theme.accent) }}
        >
          {message.content_type === 'image' && message.image_url ? (
            <div data-photo-fallback={isFallbackPhotoUrl(message.image_url) ? 'true' : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.image_url}
                alt={t('chat.bubble.received_alt')}
                className="max-h-72 max-w-full rounded-xl object-cover"
              />
              {isFallbackPhotoUrl(message.image_url) && (
                <p
                  data-testid="photo-fallback-notice"
                  className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-2 text-[12px] leading-relaxed text-amber-200"
                >
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{photoFallbackNotice(locale)}</span>
                </p>
              )}
            </div>
          ) : (
            message.content
          )}
        </div>
        {message.content_type === 'text' && voiceState && onPlayVoice && (
          <VoiceBar
            state={voiceState}
            accent={theme.accent}
            onPlay={onPlayVoice}
            staleNotice={voiceStaleNotice}
            onRegenerate={onRegenerateVoice}
            locked={voiceLocked}
            palette={paletteSurface}
          />
        )}
        <span className="mt-1 flex items-center gap-1.5">
          <span className={timestampClass} data-testid="message-timestamp">
            {formatTime(message.created_at)}
          </span>
          {onFeedback && (
            <MessageFeedback
              messageId={message.id}
              value={feedback ?? null}
              onSubmit={onFeedback}
              accent={theme.accent}
            />
          )}
        </span>
      </div>
    </div>
  );
}

/** 正在输入指示（三个跳动的点） */
export function TypingIndicator({ character }: { character: CharacterPreset }) {
  const { locale } = useLocale();
  return (
    <div className="flex items-start gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={character.avatar}
        alt={locale === 'en' ? character.nameRoman : character.defaultName}
        className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover object-top"
      />
      <div
        className="flex items-center gap-1.5 rounded-2xl rounded-tl-md px-4 py-3.5"
        style={{ backgroundColor: character.theme.theirBubble }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: character.theme.theirText,
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** "对方正在挑选照片…" 加载态 */
export function PhotoLoadingIndicator({ character }: { character: CharacterPreset }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex items-start gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={character.avatar}
        alt={locale === 'en' ? character.nameRoman : character.defaultName}
        className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover object-top"
      />
      <div
        className="flex items-center gap-2.5 rounded-2xl rounded-tl-md px-4 py-3 text-sm"
        style={{ backgroundColor: character.theme.theirBubble, color: character.theme.theirText }}
      >
        <span className="relative flex h-4 w-4">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: character.theme.accent }}
          />
          <span
            className="relative inline-flex h-4 w-4 rounded-full"
            style={{ backgroundColor: character.theme.accent }}
          />
        </span>
        {t('chat.status.photo')}
      </div>
    </div>
  );
}
