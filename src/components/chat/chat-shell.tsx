'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, CircleAlert, Loader2, MoreHorizontal, Palette, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { CharacterPreset, CharacterTheme } from '@/lib/characters';
import { getCharacter, resolveVoiceId, voiceLabelForKeySlug, VOICE_OPTIONS } from '@/lib/characters';
// toVoiceKeySlug 已由 tts-voice-key 提供（见下方 import），这里保持单一来源。
import { getCharacterAvatar } from '@/lib/character-appearance';
import { formatVoiceLabel, type DisplayLocale } from '@/lib/character-display';
import { useApiError, useLocale, useT } from '@/lib/i18n-client';
import type { MessageKey } from '@/lib/i18n/messages';
import { UNCONFIGURED_SPEECH_PRESENTATION, type SpeechPresentation } from '@/lib/personal/speech-presentation';
import { LocaleSwitch } from '@/components/locale-switch';
import { extractVoiceKeySlug, toVoiceKeySlug } from '@/lib/ai/tts-voice-key';
import type {
  ChatSSEEvent,
  CompanionDTO,
  ForgetConversationReport,
  MessageDTO,
  MessageFeedbackDTO,
  VisitorDTO,
} from '@/lib/types';
import { getChatTheme, getUiTheme, type ChatTheme, type UiTheme } from '@/lib/chat-themes';
import {
  CHAT_MESSAGE_COLUMN_CLASS,
  CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX,
  aiTextPresentation,
  noWallpaperBackdrop,
} from '@/lib/chat-layout';
import {
  applyChatPalette,
  paletteSurfaceFor,
  resolveChatPalette,
  resolvePalettePreference,
  type ChatPalette,
  type PalettePreference,
  type PaletteValue,
} from '@/lib/palette';
import { readPalettePreference, writePalettePreference } from '@/lib/palette-client';
import { PaletteSwitch } from '@/components/palette-switch';
import { PaletteSurfaceProvider } from '@/components/palette-surface-context';
import {
  ConversationList,
  type ConversationWithCompanion,
} from './conversation-list';
import { MessageBubble, TypingIndicator, PhotoLoadingIndicator } from './message-bubble';
import { MessageInput } from './message-input';
import { CompanionSettings } from './companion-settings';
import { ThemeSettings } from './theme-settings';
import type { VoiceState } from './voice-bar';
import type { MessageFeedbackState } from './message-feedback';
import { apiFetch, ensureVisitorIdentity, errorCopy, syncLocalVisitorId } from '@/lib/api';
import {
  CHAT_BOOT_TIMEOUT_MS,
  CONVERSATION_LOAD_TIMEOUT_MS,
  resolveActiveConversationId,
  withTimeout,
} from '@/lib/startup';
import { deleteConversationNotice } from '@/lib/memory/forget-notice';
import { useAuth } from '@/lib/auth';
import { UserPanel } from './user-panel';
import { cn } from '@/lib/utils';
import {
  PHOTO_SCAN_BLOCKED_USER_COPY,
  PHOTO_SCAN_REVIEW_USER_COPY,
  isPhotoFailure,
  isPhotoStatusType,
} from '@/lib/photo-status';
import { IMAGE_PLACEHOLDER } from '@/lib/chat/image-placeholder';

type Phase = 'idle' | 'loading' | 'sending' | 'streaming' | 'photo_loading';

/**
 * 桌面端侧栏收起状态的持久化键。
 *
 * 与移动端的 `mobileView`（切「列表 / 聊天」两个窗格）是两件事：移动端窄屏本来
 * 就装不下侧栏，这里只管桌面端像 ChatGPT 那样把左侧对话列表收起来。
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'vl_sidebar_collapsed';

/**
 * 拍照失败文案（**服务端落库/下发的那个中文字符串**）→ 错误 code。
 *
 * 为什么需要它：`/api/photo` 按契约 §6 只回「中文 `error` + 语言无关 `code`」，而
 * `messages.content` 里落库的是**改造前的中文串**（零迁移：老行的 content 不会回填）。
 * 于是在英文态下，界面必须把这两个来源**按值反查**回 code，才能经 `useApiError` 出英文文案。
 * 查不到就归到 `PHOTO_FAILED`（与改造前的通用兜底逐字符相同）。
 */
function photoFailureCode(content: string | null | undefined): string {
  if (content === PHOTO_SCAN_BLOCKED_USER_COPY) return 'PHOTO_SCAN_BLOCKED';
  if (content === PHOTO_SCAN_REVIEW_USER_COPY) return 'PHOTO_SCAN_REVIEW';
  return 'PHOTO_FAILED'; // 含 PHOTO_FAILED_USER_COPY 与一切未知形态（旧行为即通用兜底）
}

/** 查不到对应音色时给的**中性占位**（字典 key；英文态 = Legacy voice），绝不回显 URL 里的原始 slug。 */
const UNKNOWN_VOICE_LABEL: MessageKey = 'chat.voice.legacy';

/**
 * key 里的音色 slug → **当前语言**的展示代号。
 *
 * 必须连别名一起查（`voiceLabelForKeySlug`）：Gemini 时代缓存的音频 slug 是 `sulafat`，
 * 本轮之前缓存的还可能是上游参数（`anyuqing_v3.1`）。这些词**一个都不能回显给用户**
 * —— 产品口径是界面只出现代号。所以查不到时退回中性占位，而不是退回 slug。
 *
 * 查到中文代号后**再反查回音色对象**，交给 `formatVoiceLabel(option, locale)` 出当前语言的代号：
 * 英文态是算式推导的 `chubby fish voice N (female)`，于是「旧音色提示」在英文界面下也不出汉字。
 */
function voiceLabelForSlug(slug: string, locale: DisplayLocale, unknownLabel: string): string {
  const label = voiceLabelForKeySlug(slug);
  if (!label) return unknownLabel;
  const option = VOICE_OPTIONS.find((voice) => voice.label === label);
  return option ? formatVoiceLabel(option, locale) : label;
}

const RECOVERY_THEME: CharacterTheme = {
  chatBg: '#111827',
  theirBubble: '#273244',
  theirText: '#f3f4f6',
  myBubble: '#475569',
  myText: '#f8fafc',
  accent: '#94a3b8',
};

/** 聊天主界面：会话列表 + 微信风格聊天窗 */
export function ChatShell() {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const t = useT();
  const { locale } = useLocale();
  const apiError = useApiError();

  const [booted, setBooted] = useState(false);
  /** 启动失败时的可操作提示（**字典 key**，渲染时才取值 —— 切语言后旧提示也跟着换语言）。null = 正常。 */
  const [bootError, setBootError] = useState<MessageKey | null>(null);
  /** 递增以重新执行启动链（启动失败后的「重试」按钮）。 */
  const [retryNonce, setRetryNonce] = useState(0);
  /** 会话列表补齐中：界面已可用，仅在侧栏显示轻量加载态。 */
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [companion, setCompanion] = useState<CompanionDTO | null>(null);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [companionsById, setCompanionsById] = useState<Record<string, CompanionDTO>>({});
  const [character, setCharacter] = useState<CharacterPreset | null>(null);
  const [conversations, setConversations] = useState<ConversationWithCompanion[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [moreConversationsLoading, setMoreConversationsLoading] = useState(false);
  const moreConversationsRef = useRef(false);
  const [messageCursors, setMessageCursors] = useState<Record<string, string | null>>({});
  const [olderMessagesLoading, setOlderMessagesLoading] = useState<Record<string, boolean>>({});
  const olderMessagesRef = useRef(new Set<string>());
  const streamControllersRef = useRef(new Map<string, AbortController>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, MessageDTO[]>>({});
  const [streamingTextByConversation, setStreamingTextByConversation] = useState<Record<string, string | null>>({});
  const [phaseByConversation, setPhaseByConversation] = useState<Record<string, Phase>>({});
  const [photoInFlightByCompanion, setPhotoInFlightByCompanion] = useState<Record<string, number>>({});
  const [voiceStates, setVoiceStates] = useState<Record<string, VoiceState>>({});
  /** 每条助手消息的反馈，按会话隔离（与 voiceStates 同风格） */
  const [feedbackByConversation, setFeedbackByConversation] = useState<
    Record<string, Record<string, MessageFeedbackState>>
  >({});
  const [capabilities, setCapabilities] = useState({chat:false,speech:false,image:false,upload:false});
  const [speechPresentation, setSpeechPresentation] = useState<SpeechPresentation>(UNCONFIGURED_SPEECH_PRESENTATION);
  const speechEnabled = capabilities.speech;
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('chat');
  /** 桌面端侧栏收起（ChatGPT 式）：状态在挂载后从 localStorage 读回，避免 hydration 不一致。 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [chatTheme, setChatTheme] = useState<ChatTheme | null>(null);
  const [uiTheme, setUiTheme] = useState<UiTheme>(getUiTheme(null));
  /**
   * 访客级「红蓝风格」偏好（`'rose' | 'blue' | null`，null = 未选择）。
   *
   * 与 `chatPalette` 刻意分开：装扮弹窗的选中态要看**存储值**（null 时两个选项都不高亮），
   * 而界面换色只关心「是不是 rose」。
   */
  const [palettePreference, setPalettePreference] = useState<PalettePreference>(null);
  /** 聊天强调层的取值（只有 'rose' 才换色；null / 'blue' 都是角色原生色）。 */
  const [chatPalette, setChatPalette] = useState<ChatPalette>('native');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioMessageIdRef = useRef<string | null>(null);
  const audioRequestRef = useRef<AbortController | null>(null);
  const audioUrlCacheRef = useRef<Record<string, string>>({});
  /** 已生成音频的音色 slug：合成/命中后写入，用来判断缓存音频是不是换音色前的旧音频 */
  const audioVoiceSlugRef = useRef<Record<string, string | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const openingFiredRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const tempMessageSeqRef = useRef(0);
  const loadGenerationRef = useRef<Record<string, number>>({});
  const chatGenerationRef = useRef<Record<string, number>>({});
  const photoGenerationRef = useRef<Record<string, number>>({});
  const rebuildRequestedRef = useRef(false);
  const pendingTempIdRef = useRef<Record<string, string | null>>({});
  /**
   * 会话列表请求的代次。
   * M1：迟到的 /api/conversations 响应既不能改状态，也不能覆盖用户已点选的会话。
   * 卸载时递增一次，让所有在途响应立即失效。
   */
  const conversationsGenerationRef = useRef(0);
  activeIdRef.current = activeId;

  // 卸载时让在途的会话列表响应立即失效（M1 的 cancelled 检查）
  useEffect(() => () => {
    conversationsGenerationRef.current += 1;
  }, []);

  // 侧栏收起状态：只在挂载后读一次，避免服务端渲染与客户端首帧不一致
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1') setSidebarCollapsed(true);
    } catch {
      // 隐私模式等场景下 localStorage 不可用：保持默认展开即可
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // 存不下就只在本次会话里生效，不影响功能
      }
      return next;
    });
  }, []);

  /**
   * 「切换风格 → 强调层换色」的**唯一实现**（聊天头部的圆圈调它）。
   *
   * 只回写状态、不写库：写库由 `PaletteSwitch` 自己完成（`persist="server"` 非乐观 PATCH），
   * 成功之后才回调到这里 —— 于是四处组件与同源派生点（流式光标、在线圆点、语音条对比色…）
   * 同帧换色，不需要重新 boot。全文件只允许这一份等价实现。
   */
  const applyPalette = useCallback((value: PaletteValue) => {
    setPalettePreference(value);
    setChatPalette(resolveChatPalette(value, null));
  }, []);

  const refreshCapabilities = useCallback(async () => {
    try {
      const response = await apiFetch('/api/capabilities', {signal:AbortSignal.timeout(6000)});
      if (!response.ok) throw new Error('capabilities unavailable');
      const data = await response.json() as {capabilities:Record<string,{enabled:boolean}>;speechPresentation:SpeechPresentation};
      setCapabilities({chat:data.capabilities.chat.enabled,speech:data.capabilities.speech.enabled,image:data.capabilities.image.enabled,upload:data.capabilities.upload.enabled});
      setSpeechPresentation(data.speechPresentation ?? UNCONFIGURED_SPEECH_PRESENTATION);
    } catch {setCapabilities({chat:false,speech:false,image:false,upload:false});setSpeechPresentation(UNCONFIGURED_SPEECH_PRESENTATION);}
  }, []);
  useEffect(()=>{if(authStatus==='loading')return;void refreshCapabilities();const refresh=()=>{void refreshCapabilities();};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[authStatus,refreshCapabilities]);

  const setConversationMessages = useCallback(
    (conversationId: string, update: MessageDTO[] | ((previous: MessageDTO[]) => MessageDTO[])) => {
      setMessagesByConversation((all) => ({
        ...all,
        [conversationId]: typeof update === 'function' ? update(all[conversationId] ?? []) : update,
      }));
    },
    [],
  );

  const setConversationStream = useCallback((conversationId: string, value: string | null | ((previous: string | null) => string | null)) => {
    setStreamingTextByConversation((all) => ({
      ...all,
      [conversationId]: typeof value === 'function' ? value(all[conversationId] ?? null) : value,
    }));
  }, []);

  const setConversationPhase = useCallback((conversationId: string, value: Phase) => {
    setPhaseByConversation((all) => ({ ...all, [conversationId]: value }));
  }, []);

  const beginGeneration = useCallback((store: MutableRefObject<Record<string, number>>, conversationId: string) => {
    const token = ++requestSequenceRef.current;
    store.current[conversationId] = token;
    return token;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }, []);

  /* ---------- 配置的云端语音：用户点击后合成 ---------- */
  const stopAudio = useCallback(() => {
    audioRequestRef.current?.abort();
    audioRequestRef.current = null;
    const element = audioRef.current;
    const interrupted = audioMessageIdRef.current;
    audioRef.current = null;
    audioMessageIdRef.current = null;
    if (element) {
      element.onplay = null;
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.src = '';
    }
    if (interrupted) {
      setVoiceStates((states) => {
        const current = states[interrupted];
        if (current !== 'loading' && current !== 'playing') return states;
        return { ...states, [interrupted]: 'ready' };
      });
    }
  }, []);

  // force = 用户在「旧音色」提示里显式点了重新生成：跳过前端 URL 缓存，让服务端按当前音色重合成
  const playVoice = useCallback(
    async (messageId: string, options?: { force?: boolean }) => {
      const force = options?.force === true;
      // 再点一次同一条 = 停止；生成中点击也能取消（重生成是显式意图，不参与这个开关）
      if (!force && audioMessageIdRef.current === messageId) {
        stopAudio();
        return;
      }
      stopAudio();
      audioMessageIdRef.current = messageId;
      setVoiceStates((states) => ({ ...states, [messageId]: 'loading' }));

      let audioUrl = force ? undefined : audioUrlCacheRef.current[messageId];
      if (!audioUrl) {
        const controller = new AbortController();
        audioRequestRef.current = controller;
        try {
          const res = await apiFetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(force ? { message_id: messageId, regenerate: true } : { message_id: messageId }),
            signal: controller.signal,
          });
          const data = (await res.json()) as { audio_url?: string; error?: string };
          if (!res.ok || !data.audio_url) throw new Error(apiError(data, { feature: 'tts', fallback: t('chat.voice.generate_failed') }));
          audioUrl = data.audio_url;
          audioUrlCacheRef.current[messageId] = audioUrl;
          audioVoiceSlugRef.current[messageId] = extractVoiceKeySlug(audioUrl);
        } catch (error) {
          if (audioRequestRef.current === controller) audioRequestRef.current = null;
          if (controller.signal.aborted || audioMessageIdRef.current !== messageId) return;
          audioMessageIdRef.current = null;
          setVoiceStates((states) => ({ ...states, [messageId]: 'error' }));
          toast.error(errorCopy(error, t, t('chat.voice.generate_failed')));
          return;
        }
        audioRequestRef.current = null;
      }
      // 生成期间被取消/切走时不要再出声
      if (audioMessageIdRef.current !== messageId) return;

      const fail = () => {
        if (audioMessageIdRef.current === messageId) {
          audioRef.current = null;
          audioMessageIdRef.current = null;
        }
        setVoiceStates((states) => ({ ...states, [messageId]: 'error' }));
        toast.error(t('chat.voice.play_failed'));
      };
      const element = new Audio(audioUrl);
      audioRef.current = element;
      element.onplay = () => setVoiceStates((states) => ({ ...states, [messageId]: 'playing' }));
      element.onended = () => {
        if (audioMessageIdRef.current === messageId) {
          audioRef.current = null;
          audioMessageIdRef.current = null;
        }
        setVoiceStates((states) => ({ ...states, [messageId]: 'ready' }));
      };
      element.onerror = fail;
      try {
        await element.play();
      } catch {
        fail();
      }
    },
    [stopAudio, apiError, t],
  );

  /** 历史消息与刚落库的回复默认就是「可播」状态，点击时才真正去合成 */
  const prepareVoice = useCallback((messageId: string) => {
    setVoiceStates((states) => ({ ...states, [messageId]: 'ready' }));
  }, []);

  useEffect(() => () => {
    for (const controller of streamControllersRef.current.values()) controller.abort();
    streamControllersRef.current.clear();
  }, []);

  /* ---------- SSE 流式消费 ---------- */
  const consumeChatStream = useCallback(
    async (
      conversationId: string,
      generation: number,
      body: Record<string, unknown>,
      handlers: {
        onUserMessage?: (m: MessageDTO) => void;
        onDone?: (m: MessageDTO, photoRequest: boolean, photoScene?: string | null) => void;
      },
      signal?: AbortSignal,
    ) => {
      const requestStartedAt = performance.now();
      let firstChunkSeen = false;
      const controller = new AbortController();
      streamControllersRef.current.get(conversationId)?.abort();
      streamControllersRef.current.set(conversationId, controller);
      const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      let timedOut = false;
      const expire = () => { timedOut = true; controller.abort(); };
      const totalTimer = setTimeout(expire, 270_000);
      let idleTimer = setTimeout(expire, 125_000);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: requestSignal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          // 带上服务端的 code：额度用完（reply_limit）时，游客与登录用户看到的出路不同。
          throw Object.assign(
            new Error(apiError(data, { fallback: t('chat.stream.send_failed') })),
            { code: data.code },
          );
        }
        reader = res.body.getReader();
        const requestId = res.headers.get('x-chat-request-id');
        const decoder = new TextDecoder();
        let buffer = '';
        let sawDone = false;
        stream: for (;;) {
          const { done, value } = await reader.read();
          clearTimeout(idleTimer);
          idleTimer = setTimeout(expire, 125_000);
          if (done) break;
          if (chatGenerationRef.current[conversationId] !== generation) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 1024 * 1024) throw new Error(t('chat.stream.invalid_response'));
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith('data: ')) continue;
            let parsed: ChatSSEEvent;
            try {
              parsed = JSON.parse(line.slice(6)) as ChatSSEEvent;
            } catch {
              continue;
            }
            if (chatGenerationRef.current[conversationId] !== generation) continue;
            if (parsed.type === 'user_message') {
              handlers.onUserMessage?.(parsed.message);
            } else if (parsed.type === 'chunk') {
              if (!firstChunkSeen) {
                firstChunkSeen = true;
                console.info('[chat:client-timing]', { requestId, firstVisibleChunkMs: Math.round(performance.now() - requestStartedAt) });
              }
              setConversationStream(conversationId, (prev) => (prev ?? '') + parsed.text);
              setConversationPhase(conversationId, 'streaming');
              if (activeIdRef.current === conversationId) scrollToBottom();
            } else if (parsed.type === 'done') {
              console.info('[chat:client-timing]', { requestId, completeMs: Math.round(performance.now() - requestStartedAt) });
              sawDone = true;
              handlers.onDone?.(parsed.message, parsed.photo_request, parsed.photo_scene);
              break stream;
            } else if (parsed.type === 'error') {
              // SSE 的 error 事件目前只带 `error` 串、不带 `code`（`src/lib/types.ts` 的 ChatSSEEvent
              // 与 `/api/chat` 的发送点归 U8/t32）；这里仍走同一个本地化入口：
              // 没有 code 时按契约 §6.6.1 第二级回落服务端原文。
              throw new Error(apiError(parsed, { fallback: t('chat.stream.disconnected') }));
            }
          }
        }
        // 流被对端提前关闭（网关超时 / 连接中断）时不会再有 done 事件。
        // 早先这里直接返回，调用方的 .catch 永远不会触发，phase 就永久卡在 sending / streaming。
        if (!sawDone && chatGenerationRef.current[conversationId] === generation) {
          throw new Error(t('chat.stream.disconnected'));
        }
      } catch (error) {
        if (timedOut) throw new Error(t('chat.stream.reply_timeout'));
        throw error;
      } finally {
        clearTimeout(totalTimer);
        clearTimeout(idleTimer);
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
        if (streamControllersRef.current.get(conversationId) === controller) {
          streamControllersRef.current.delete(conversationId);
        }
      }
    },
    [scrollToBottom, setConversationPhase, setConversationStream, t, apiError],
  );

  /* ---------- 照片生成（用户主动索要时；photoScene 为 LLM 在对话中描述的当下场景） ---------- */
  const triggerPhoto = useCallback(
    (conversationId: string, companionId: string, appearanceStyle: 'chibi' | 'normal', photoScene?: string | null) => {
      const generation = beginGeneration(photoGenerationRef, conversationId);
      setConversationPhase(conversationId, 'photo_loading');
      setPhotoInFlightByCompanion((all) => ({ ...all, [companionId]: (all[companionId] ?? 0) + 1 }));
      if (activeIdRef.current === conversationId) scrollToBottom();
      apiFetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          appearance_style: appearanceStyle,
          ...(photoScene ? { photo_scene: photoScene } : {}),
        }),
      })
        .then(async (res) => {
          const data = (await res.json()) as { message?: MessageDTO | null; error?: string };
          // 成功是 image，失败是 photo_failed（服务端已把 pending 那一行改好）：两种都进消息列表，
          // 刷新前后看到的一样，TA 下一轮也知道照片到底发没发出去。
          if (data.message && photoGenerationRef.current[conversationId] === generation) {
            setConversationMessages(conversationId, (prev) => [...prev.filter((m) => m.id !== data.message!.id), data.message!]);
          }
          if ((data.error || !res.ok) && activeIdRef.current === conversationId) {
            toast.error(apiError(data, { feature: 'photo', detail: 'missing', fallback: t('chat.stream.photo_failed') }));
          }
        })
        .catch(() => {
          if (activeIdRef.current === conversationId) {
            toast.error(t('chat.stream.photo_failed'));
          }
        })
        .finally(() => {
          setPhotoInFlightByCompanion((all) => {
            const next = { ...all };
            const remaining = Math.max(0, (next[companionId] ?? 1) - 1);
            if (remaining === 0) delete next[companionId];
            else next[companionId] = remaining;
            return next;
          });
          if (photoGenerationRef.current[conversationId] === generation) {
            setConversationPhase(conversationId, 'idle');
          }
        });
    },
    [beginGeneration, scrollToBottom, setConversationMessages, setConversationPhase, apiError, t],
  );

  /* ---------- 开场白 ---------- */
  const fireOpening = useCallback(
    async (conversationId: string) => {
      if (openingFiredRef.current.has(conversationId)) return;
      openingFiredRef.current.add(conversationId);
      const generation = beginGeneration(chatGenerationRef, conversationId);
      setConversationPhase(conversationId, 'sending');
      setConversationStream(conversationId, null);
      consumeChatStream(
        conversationId,
        generation,
        { conversation_id: conversationId, opening: true },
        {
          onDone: (msg) => {
            setConversationStream(conversationId, null);
            setConversationPhase(conversationId, 'idle');
            setConversationMessages(conversationId, (prev) => [...prev, msg]);
            prepareVoice(msg.id);
            setConversations((prev) =>
              prev.map((c) =>
                c.id === conversationId
                  ? { ...c, title: msg.content?.slice(0, 20) ?? c.title, updated_at: msg.created_at }
                  : c,
              ),
            );
            if (activeIdRef.current === conversationId) scrollToBottom();
          },
        },
      ).catch((e: unknown) => {
        if (chatGenerationRef.current[conversationId] === generation) {
          setConversationStream(conversationId, null);
          setConversationPhase(conversationId, 'idle');
          if (activeIdRef.current === conversationId) {
            toast.error(errorCopy(e, t, t('chat.stream.opening_failed')));
          }
        }
      });
    },
    [beginGeneration, consumeChatStream, prepareVoice, scrollToBottom, setConversationMessages, setConversationPhase, setConversationStream, t],
  );

  /* ---------- 消息反馈（👍/👎 + 可选留言） ---------- */
  const setConversationFeedback = useCallback(
    (
      conversationId: string,
      update:
        | Record<string, MessageFeedbackState>
        | ((previous: Record<string, MessageFeedbackState>) => Record<string, MessageFeedbackState>),
    ) => {
      setFeedbackByConversation((all) => ({
        ...all,
        [conversationId]:
          typeof update === 'function' ? update(all[conversationId] ?? {}) : update,
      }));
    },
    [],
  );

  const feedbackPendingRef = useRef(new Set<string>());
  const feedbackRevisionRef = useRef(0);
  /**
   * 拉取当前访客在本会话的反馈，用于刷新后还原按钮状态。
   * 失败只记录日志：反馈状态缺失不该打断聊天。
   */
  const loadFeedback = useCallback(
    async (conversationId: string) => {
      const revision = feedbackRevisionRef.current;
      if (feedbackPendingRef.current.size > 0) return;
      try {
        const res = await apiFetch(
          `/api/feedback?conversation_id=${encodeURIComponent(conversationId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { feedback?: MessageFeedbackDTO[] };
        if (revision !== feedbackRevisionRef.current) return;
        if (!Array.isArray(data.feedback)) return;
        setConversationFeedback(
          conversationId,
          Object.fromEntries(
            data.feedback.map((item) => [item.message_id, { rating: item.rating, comment: item.comment }]),
          ),
        );
      } catch (error) {
        console.warn('[chat-shell] 反馈状态加载失败', error);
      }
    },
    [setConversationFeedback],
  );

  /** 乐观提交：先改本地状态，失败再回滚并提示 */
  const submitFeedback = useCallback(
    async (conversationId: string, messageId: string, rating: 1 | -1 | null, comment: string | null) => {
      if (feedbackPendingRef.current.has(messageId)) return;
      feedbackPendingRef.current.add(messageId);
      feedbackRevisionRef.current += 1;
      const previous = feedbackByConversation[conversationId]?.[messageId] ?? null;
      setConversationFeedback(conversationId, (current) => {
        const next = { ...current };
        if (rating === null) delete next[messageId];
        else next[messageId] = { rating, comment };
        return next;
      });

      return apiFetch('/api/feedback', {
        signal: AbortSignal.timeout(15_000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, rating, comment }),
      })
        .then(async (res) => {
          if (res.ok) return;
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(apiError(data, { fallback: t('chat.feedback.save_failed') }));
        })
        .catch((error: unknown) => {
          setConversationFeedback(conversationId, (current) => {
            const next = { ...current };
            if (previous === null) delete next[messageId];
            else next[messageId] = previous;
            return next;
          });
          toast.error(errorCopy(error, t, t('chat.feedback.save_failed_retry')));
        })
        .finally(() => {
          feedbackPendingRef.current.delete(messageId);
          feedbackRevisionRef.current += 1;
        });
    },
    [feedbackByConversation, setConversationFeedback, apiError, t],
  );

  /* ---------- 加载会话消息 ---------- */
  const loadMessages = useCallback(
    (conversationId: string, allowOpening = true) => {
      if ((phaseByConversation[conversationId] ?? 'idle') !== 'idle') return;
      const hasCachedMessages = messagesByConversation[conversationId] !== undefined;
      if (!hasCachedMessages) setConversationPhase(conversationId, 'loading');
      const generation = beginGeneration(loadGenerationRef, conversationId);
      const chatGenerationAtStart = chatGenerationRef.current[conversationId];
      const photoGenerationAtStart = photoGenerationRef.current[conversationId];
      apiFetch(`/api/conversations/${conversationId}/messages`, { signal: AbortSignal.timeout(15_000) })
        .then(async (response) => {
          const data = (await response.json()) as {
            messages?: MessageDTO[];
            next_cursor?: string | null;
            error?: string;
          };
          if (!response.ok) throw new Error(apiError(data, { fallback: t('chat.conversation.messages_failed') }));
          if (!Array.isArray(data.messages)) throw new Error(t('chat.conversation.invalid_response'));
          return data;
        })
        .then((data: { messages?: MessageDTO[]; next_cursor?: string | null }) => {
          const list = data.messages ?? [];
          if (loadGenerationRef.current[conversationId] !== generation) return;
          if (chatGenerationRef.current[conversationId] !== chatGenerationAtStart
            || photoGenerationRef.current[conversationId] !== photoGenerationAtStart) {
            return;
          }
          setMessageCursors((all) => ({ ...all, [conversationId]: data.next_cursor ?? null }));
          setConversationMessages(conversationId, list);
          if (activeIdRef.current === conversationId) scrollToBottom(false);
          // 已有语音的历史消息直接标记可播
          setVoiceStates((prev) => {
            const next = { ...prev };
            for (const m of list) {
              if (m.role === 'assistant' && m.content_type === 'text') {
                next[m.id] = 'ready';
              }
            }
            return next;
          });
          // 反馈状态与消息并行拉取，不阻塞首屏渲染。
          void loadFeedback(conversationId);
          if (allowOpening && list.length === 0 && activeIdRef.current === conversationId) {
            fireOpening(conversationId);
          } else if (!hasCachedMessages) {
            setConversationPhase(conversationId, 'idle');
          }
        })
        .catch(() => {
          if (loadGenerationRef.current[conversationId] === generation
            && chatGenerationRef.current[conversationId] === chatGenerationAtStart
            && photoGenerationRef.current[conversationId] === photoGenerationAtStart) {
            if (!hasCachedMessages) setConversationPhase(conversationId, 'idle');
            if (activeIdRef.current === conversationId) toast.error(t('chat.conversation.messages_failed'));
          }
        });
    },
    [beginGeneration, fireOpening, loadFeedback, messagesByConversation, phaseByConversation, scrollToBottom, setConversationMessages, setConversationPhase, apiError, t],
  );

  const loadOlderMessages = useCallback(async (conversationId: string) => {
    const cursor = messageCursors[conversationId];
    if (!cursor || olderMessagesRef.current.has(conversationId)
      || (phaseByConversation[conversationId] ?? 'idle') !== 'idle') return;
    olderMessagesRef.current.add(conversationId);
    setOlderMessagesLoading((all) => ({ ...all, [conversationId]: true }));
    const generation = loadGenerationRef.current[conversationId];
    try {
      const response = await apiFetch(`/api/conversations/${conversationId}/messages?before=${encodeURIComponent(cursor)}`,
        { signal: AbortSignal.timeout(15_000) });
      const data = await response.json() as { messages?: MessageDTO[]; next_cursor?: string | null };
      if (!response.ok || !Array.isArray(data.messages)) throw new Error(t('chat.conversation.load_failed'));
      if (loadGenerationRef.current[conversationId] !== generation) return;
      const el = activeIdRef.current === conversationId ? scrollRef.current : null;
      const previousHeight = el?.scrollHeight ?? 0;
      const previousTop = el?.scrollTop ?? 0;
      setConversationMessages(conversationId, (current) => {
        const existing = new Set(current.map((message) => message.id));
        return [...data.messages!.filter((message) => !existing.has(message.id)), ...current];
      });
      setMessageCursors((all) => ({ ...all, [conversationId]: data.next_cursor ?? null }));
      setVoiceStates((current) => {
        const next = { ...current };
        for (const message of data.messages!) {
          if (message.role === 'assistant' && message.content_type === 'text') next[message.id] ??= 'ready';
        }
        return next;
      });
      requestAnimationFrame(() => {
        if (el && activeIdRef.current === conversationId) el.scrollTop = previousTop + el.scrollHeight - previousHeight;
      });
    } catch { toast.error(t('chat.conversation.older_failed')); }
    finally {
      olderMessagesRef.current.delete(conversationId);
      setOlderMessagesLoading((all) => ({ ...all, [conversationId]: false }));
    }
  }, [messageCursors, phaseByConversation, setConversationMessages, t]);

  /* ---------- 选择 / 新建 / 删除会话 ---------- */
  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) {
        setMobileView('chat');
        return;
      }
      stopAudio();
      activeIdRef.current = id;
      setActiveId(id);
      setMobileView('chat');
      const selected = conversations.find((item) => item.id === id);
      loadMessages(id, Boolean(selected?.companion_character_key
        && getCharacter(selected.companion_character_key)));
    },
    [conversations, loadMessages, stopAudio],
  );

  const createConversation = useCallback(async () => {
    const current = conversations.find((item) => item.id === activeIdRef.current);
    const companionId = current?.companion_id ?? companion?.id;
    if (!companionId) return;
    try {
      const res = await apiFetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companion_id: companionId }),
      });
      const data = (await res.json()) as { conversation?: ConversationWithCompanion };
      if (!res.ok || !data.conversation) throw new Error(t('chat.conversation.create_failed'));
      setConversations((prev) => [data.conversation!, ...prev]);
      stopAudio();
      activeIdRef.current = data.conversation.id;
      setActiveId(data.conversation.id);
      setMobileView('chat');
      loadMessages(data.conversation.id, Boolean(data.conversation.companion_character_key
        && getCharacter(data.conversation.companion_character_key)));
    } catch {
      toast.error(t('chat.conversation.create_failed'));
    }
  }, [companion, conversations, loadMessages, stopAudio, t]);

  const deleteConversation = useCallback(
    (id: string) => {
      apiFetch(`/api/conversations/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(290_000) })
        .then(async (res) => {
          if (!res.ok) {
            const error = await res.json().catch(() => null) as { error?: string } | null;
            throw new Error(apiError(error, { fallback: t('chat.conversation.delete_failed') }));
          }
          const payload = (await res.json().catch(() => null)) as
            | { forget?: ForgetConversationReport }
            | null;
          streamControllersRef.current.get(id)?.abort();
          delete loadGenerationRef.current[id];
          delete chatGenerationRef.current[id];
          delete photoGenerationRef.current[id];
          setMessagesByConversation((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setStreamingTextByConversation((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setPhaseByConversation((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setFeedbackByConversation((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setConversations((prev) => {
            const next = prev.filter((c) => c.id !== id);
            if (activeIdRef.current === id) {
              if (next.length > 0) {
                selectConversation(next[0].id);
              } else {
                activeIdRef.current = null;
                setActiveId(null);
                void createConversation();
              }
            }
            return next;
          });
          // 文案诚实化（AC-15）：长期记忆可能没清理干净，只有确认没有残留时才说「已删除」。
          // 上屏点必须显式传当前语言：缺省是 zh-CN，不传就会在 en 界面里回落中文（t61）。
          const notice = deleteConversationNotice(payload?.forget, locale);
          if (notice.level === 'warning') toast.warning(notice.message);
          else toast.success(notice.message);
        })
        .catch((error: unknown) => toast.error(errorCopy(error, t, t('chat.conversation.delete_failed'))));
    },
    [createConversation, selectConversation, apiError, locale, t],
  );

  /* ---------- 发送消息 ---------- */
  const sendMessage = useCallback(
    (content: string, imagePath?: string) => {
      const conversationId = activeIdRef.current;
      const current = conversations.find((item) => item.id === conversationId);
      if (!conversationId || !current) {
        if (!rebuildRequestedRef.current) {
          rebuildRequestedRef.current = true;
          toast.error(t('chat.conversation.expired'));
          void createConversation();
        }
        return;
      }
      if (!getCharacter(current.companion_character_key ?? '')) return;
      const tempId = `temp-${++tempMessageSeqRef.current}`;
      // 乐观插入：气泡的唯一数据源原本是服务端 SSE 回显，模型慢时用户消息会迟迟不出现。
      // 临时字段按 src/lib/types.ts 的 MessageDTO 必填契约自造，created_at 必须是合法 ISO，
      // 否则 message-bubble 的 formatTime 会渲染成 NaN:NaN。
      const optimisticMessage: MessageDTO = {
        id: tempId,
        conversation_id: conversationId,
        role: 'user',
        content_type: imagePath ? 'image' : 'text',
        // 无文字配图时的占位内容：与服务端落库值共用**同一个共享常量**
        // （`src/lib/chat/image-placeholder.ts` 的 IMAGE_PLACEHOLDER）。
        // 落库哨兵只有这一个（存量行同值，零迁移）；**显示**由 message-bubble 按语言渲染。
        content: content || (imagePath ? IMAGE_PLACEHOLDER : ''),
        image_url: imagePath ?? null,
        audio_url: null,
        created_at: new Date().toISOString(),
      };
      pendingTempIdRef.current[conversationId] = tempId;
      setConversationMessages(conversationId, (prev) => [
        ...prev.filter((item) => !item.id.startsWith('temp-')),
        optimisticMessage,
      ]);
      if ((phaseByConversation[conversationId] ?? 'idle') !== 'idle') {
        setConversationStream(conversationId, null);
        setConversationPhase(conversationId, 'idle');
      }
      const generation = beginGeneration(chatGenerationRef, conversationId);
      const companionId = current.companion_id;
      const appearanceStyle = current.companion_appearance_style ?? 'chibi';
      setConversationPhase(conversationId, 'sending');
      setConversationStream(conversationId, null);
      scrollToBottom();
      consumeChatStream(
        conversationId,
        generation,
        { conversation_id: conversationId, content, image_path: imagePath },
        {
          onUserMessage: (m) => {
            // 服务端已回显该条消息：若存在乐观气泡则原位替换，避免出现两条
            const pendingTempId = pendingTempIdRef.current[conversationId];
            pendingTempIdRef.current[conversationId] = null;
            setConversationMessages(conversationId, (prev) => (pendingTempId
              ? prev.map((item) => (item.id === pendingTempId ? m : item))
              : [...prev, m]));
            if (activeIdRef.current === conversationId) scrollToBottom();
          },
          onDone: (m, photoRequest, photoScene) => {
            setConversationStream(conversationId, null);
            setConversationPhase(conversationId, 'idle');
            setConversationMessages(conversationId, (prev) => [...prev, m]);
            prepareVoice(m.id);
            setConversations((prev) =>
              prev.map((c) =>
                c.id === conversationId ? { ...c, updated_at: m.created_at } : c,
              ),
            );
            if (activeIdRef.current === conversationId) scrollToBottom();
            if (photoRequest && capabilities.image) {
              triggerPhoto(
                conversationId,
                companionId,
                appearanceStyle,
                photoScene,
              );
            }
          },
        },
      ).catch((e: unknown) => {
        if (chatGenerationRef.current[conversationId] === generation) {
          // 失败处置：服务端从未回显（未落库）→ 撤掉乐观气泡；已回显（只是流中断）→ 保留
          const pendingTempId = pendingTempIdRef.current[conversationId];
          pendingTempIdRef.current[conversationId] = null;
          if (pendingTempId) {
            setConversationMessages(conversationId, (prev) => prev.filter((item) => item.id !== pendingTempId));
          }
          setConversationStream(conversationId, null);
          setConversationPhase(conversationId, 'idle');
          if (activeIdRef.current === conversationId) {
            toast.error(errorCopy(e, t, t('chat.stream.send_failed_retry')));
          }
        }
      });
    },
    [capabilities.image, beginGeneration, consumeChatStream, conversations, createConversation, phaseByConversation, prepareVoice, scrollToBottom, setConversationMessages, setConversationPhase, setConversationStream, triggerPhoto, t],
  );

  /**
   * 拉取（必要时创建）会话列表。
   *
   * 从启动链里抽出来，因为它同时是「重试」按钮的目标：弱网下这一步最容易失败，
   * 而失败不该让整个聊天界面不可用 —— 用户至少应该能重试，而不是刷新整页。
   *
   * 两处审查修复：
   *   - M1：用 generation 判定「这个响应还算不算数」，并且**绝不覆盖用户已点选的会话**。
   *     原先无条件 `activeIdRef.current = list[0].id`，弱网下用户先点了 B，
   *     迟到的列表响应会把选择弹回 A。
   *   - F-6：整个流程加超时。请求挂起时不能永远停在「会话加载中」。
   */
  const loadMoreConversations = useCallback(async () => {
    if (!conversationCursor || moreConversationsRef.current) return;
    moreConversationsRef.current = true;
    setMoreConversationsLoading(true);
    const generation = conversationsGenerationRef.current;
    try {
      const response = await apiFetch(`/api/conversations?before=${encodeURIComponent(conversationCursor)}`,
        { signal: AbortSignal.timeout(15_000) });
      const data = await response.json() as { conversations?: ConversationWithCompanion[]; next_cursor?: string | null };
      if (!response.ok || !Array.isArray(data.conversations)) throw new Error(t('chat.conversation.load_failed'));
      if (generation !== conversationsGenerationRef.current) return;
      setConversations((current) => {
        const existing = new Set(current.map((conversation) => conversation.id));
        return [...current, ...data.conversations!.filter((conversation) => !existing.has(conversation.id))];
      });
      setConversationCursor(data.next_cursor ?? null);
    } catch { toast.error(t('chat.conversation.topics_failed')); }
    finally { moreConversationsRef.current = false; setMoreConversationsLoading(false); }
  }, [conversationCursor, t]);

  const loadConversations = useCallback(async (comp: CompanionDTO) => {
    const generation = ++conversationsGenerationRef.current;
    const live = () => conversationsGenerationRef.current === generation;

    setConversationsLoading(true);
    try {
      const ok = await withTimeout(
        (async () => {
          const convRes = await apiFetch('/api/conversations');
          const convData = (await convRes.json()) as {
            conversations?: ConversationWithCompanion[];
            next_cursor?: string | null;
          };
          if (!convRes.ok) throw new Error(t('chat.boot.conversations_error'));
          let list = convData.conversations ?? [];
          if (list.length === 0) {
            const res = await apiFetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companion_id: comp.id }),
            });
            const data = (await res.json()) as { conversation?: ConversationWithCompanion };
            if (!res.ok || !data.conversation) throw new Error(t('chat.boot.create_failed'));
            list = [data.conversation];
          }
          // 迟到的响应不得改动任何状态（用户可能已经切走或点了别的会话）
          if (!live()) return true;

          setConversationCursor(convData.next_cursor ?? null);
          setConversations(list);
          const next = resolveActiveConversationId(
            activeIdRef.current,
            list.map((item) => item.id),
          );
          if (next && next !== activeIdRef.current) {
            activeIdRef.current = next;
            setActiveId(next);
          }
          if (next) {
            const target = list.find((item) => item.id === next);
            loadMessages(next, Boolean(target?.companion_character_key
              && getCharacter(target.companion_character_key)));
          }
          return true;
        })(),
        CONVERSATION_LOAD_TIMEOUT_MS,
        false,
      );
      if (!ok) throw new Error(t('chat.boot.conversations_timeout'));
      return true;
    } catch {
      if (live()) setBootError('chat.boot.conversations_failed');
      return false;
    } finally {
      if (live()) setConversationsLoading(false);
    }
  }, [t, loadMessages]);

  /* ---------- 启动（等待主人访问状态，再读取实例数据） ---------- */
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus === 'guest') { router.replace('/login'); return; }
    let cancelled = false;
    (async () => {
      try {
        setBootError(null);
        // F-6：身份解析 + 伴侣查询整体加超时。这两个请求任一挂起时，
        // 原先会永远停在骨架屏上（bootError 只在 booted 之后才渲染）。
        const visitorData = await withTimeout(
          (async () => {
            await ensureVisitorIdentity();
            const visitorRes = await apiFetch('/api/visitor');
            /*
              E2E-2：必须检查 res.ok。
              5xx 的响应体是 `{error: '...'}` —— 一个真值对象，于是下面
              `!visitorData.visitor || !visitorData.companion` 成立，会**静默**
              router.replace('/onboarding')：没有提示、没有重试，把服务端抖动的
              老用户直接送进创建新角色的流程（与 F-5 同类风险）。
              这里让失败走错误路径（外层 catch → bootError + 重试入口），
              只有 200 且确实没有伴侣才跳 /onboarding。
            */
            if (!visitorRes.ok) throw new Error(t('chat.boot.visitor_http', { status: visitorRes.status }));
            return (await visitorRes.json()) as {
              visitor: VisitorDTO | null;
              companion: CompanionDTO | null;
              visitor_id?: string;
            };
          })(),
          CHAT_BOOT_TIMEOUT_MS,
          null,
        );
        if (cancelled) return;
        if (!visitorData) throw new Error(t('chat.boot.timeout'));
        if (visitorData.visitor_id) syncLocalVisitorId(visitorData.visitor_id);
        if (!visitorData.visitor || !visitorData.companion) {
          router.replace('/onboarding');
          return;
        }
        const comp = visitorData.companion;
        const ch = getCharacter(comp.character_key);
        setCompanion(comp);
        const resolvedVisitorId = visitorData.visitor_id ?? comp.visitor_id;
        setVisitorId(resolvedVisitorId);
        setCompanionsById({ [comp.id]: comp });
        setCharacter(ch ?? null);

        // 兼容首次加载；活动会话就绪后会切换到其 companion.theme_id。
        const storedTheme = getChatTheme(comp.theme_id);
        setChatTheme(storedTheme && ch && storedTheme.gender === ch.gender ? storedTheme : null);
        setUiTheme(getUiTheme(visitorData.visitor.ui_theme));

        // 风格偏好：唯一一条解析链「访客档案 > 设备镜像」（§4.6 判据 2），只在 boot 的 effect 里做，
        // 渲染期绝不读 localStorage。`mirrorPalette` 回写设备镜像（§4.6 判据 6），让不读档案的
        // 页面（登录页、支付页）在正常路径下也能跟随访客选择；登出只清身份、不清这个镜像。
        const mirrorPalette = resolvePalettePreference(visitorData.visitor.palette, readPalettePreference());
        setPalettePreference(mirrorPalette);
        writePalettePreference(mirrorPalette);
        setChatPalette(resolveChatPalette(visitorData.visitor.palette, readPalettePreference()));

        // 身份与伴侣已经就绪 —— 立刻放行界面，不再等会话列表。
        //
        // 原先 booted 要等整条链（含"没有会话时新建一个"的写请求）走完才置 true，
        // 于是任何一步慢或失败都会让用户停在光秃秃的转圈上；而"新建会话"恰恰是
        // 弱网下最容易超时的写请求。现在先把聊天界面渲染出来，会话在后台补齐。
        setBooted(true);

        // 会话列表异步补齐：失败不阻塞界面，但要让用户看得见并可以重试。
        await loadConversations(comp);
      } catch {
        if (!cancelled) {
          // 失败要给可操作结果，而不是无限转圈或一句泛泛的提示。
          setBootError('chat.boot.unreachable');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // retryNonce：启动失败后点「重试」要能重新跑一遍整条启动链
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, retryNonce]);

  useEffect(() => {
    const active = conversations.find((item) => item.id === activeId);
    if (!active) return;
    const preset = active.companion_character_key
      ? getCharacter(active.companion_character_key)
      : undefined;
    const storedTheme = getChatTheme(active.companion_theme_id);
    setChatTheme(storedTheme && preset && storedTheme.gender === preset.gender ? storedTheme : null);
    if (companionsById[active.companion_id]) return;
    let cancelled = false;
    apiFetch(`/api/companions/${active.companion_id}`)
      .then(async (response) => {
        const data = (await response.json()) as { companion?: CompanionDTO };
        if (!cancelled && response.ok && data.companion) {
          setCompanionsById((items) => ({ ...items, [data.companion!.id]: data.companion! }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId, companionsById, conversations]);

  // UI 色调：挂到 <html data-ui-theme>，globals.css 中的作用域变量块接管全局配色（含 portal 弹层）
  useEffect(() => {
    document.documentElement.dataset.uiTheme = uiTheme.id;
    return () => {
      delete document.documentElement.dataset.uiTheme;
    };
  }, [uiTheme.id]);

  /* ---------- 渲染 ---------- */
  if (!booted || !companion) {
    /*
      启动失败（含超时）时必须给出可操作的重试入口。
      F-6：bootError 原先只在 booted 之后才渲染，而启动失败恰恰不会置 booted ——
      所以失败信息一次都显示不出来，用户看到的是永久骨架屏。
    */
    if (bootError) {
      return (
        <div className="flex h-dvh items-center justify-center bg-background px-6" role="alert">
          <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
            <CircleAlert className="size-8 text-destructive" aria-hidden />
            <p className="text-sm text-foreground">{t(bootError)}</p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="rounded-full border border-border bg-background/70 px-4 py-1.5 text-sm transition-colors hover:border-primary/50"
            >
              {t('chat.boot.retry')}
            </button>
          </div>
        </div>
      );
    }

    // 启动中：渲染聊天界面的骨架，而不是一个孤零零的转圈。
    // 用户能看出"正在准备聊天"，弱网下也不会以为页面坏了。
    return (
      <div className="flex h-dvh bg-background" role="status" aria-live="polite">
        <aside className="hidden w-72 shrink-0 flex-col gap-3 border-r border-border/40 p-4 sm:flex">
          <div className="h-9 w-full animate-pulse rounded-xl bg-muted/70" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-muted/40" />
          ))}
        </aside>
        <section className="flex flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
            <div className="size-9 animate-pulse rounded-full bg-muted/70" />
            <div className="h-4 w-28 animate-pulse rounded-full bg-muted/60" />
          </header>
          <div className="flex flex-1 flex-col justify-end gap-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-10 animate-pulse rounded-2xl bg-muted/40 ${i % 2 === 0 ? 'w-2/5 self-start' : 'w-1/2 self-end'}`}
              />
            ))}
          </div>
          <div className="border-t border-border/40 p-3">
            <div className="h-11 w-full animate-pulse rounded-full bg-muted/50" />
          </div>
        </section>
      </div>
    );
  }

  // 当前会话对应的角色与恋人名（多恋人场景：旧会话保持原角色主题，不串台）
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const activePreset =
    (activeConversation?.companion_character_key
      ? getCharacter(activeConversation.companion_character_key)
      : undefined) ?? (activeConversation ? null : character);
  const activeCompanion = activeConversation
    ? (companionsById[activeConversation.companion_id]
      ?? (activeConversation.companion_id === companion.id ? companion : null))
    : companion;
  const activeCompanionName = activeCompanion?.name ?? activeConversation?.companion_name ?? companion.name;
  const activeAvatar = activePreset
    ? (activeConversation?.companion_avatar
      ?? getCharacterAvatar(activePreset.key, activeCompanion?.appearance_style)
      ?? activePreset.avatar)
    : null;
  /**
   * 聊天强调层的**唯一注入点**（t3 §4.7 判据 3）。
   *
   * 全文件只在这里调用一次 `applyChatPalette`，并同时覆盖「角色原生 theme」与
   * `RECOVERY_THEME` 兜底：`native` 时 `applyChatPalette` 原样返回入参引用，因此
   * 未选择 / 选了「梦幻蓝」的用户拿到的仍是原来的 theme 对象（逐像素不变）；
   * `'rose'` 时换成全局 `ROSE_CHAT_THEME`（chatBg 不动）。
   *
   * 下游全部读这个对象，所以四处组件（用户气泡 / AI 气泡 / 发送键 /「在线」）与同源派生点
   * （流式光标、typing/photo 指示器、侧栏在线圆点、语音条对比色、反馈选中色、无壁纸氛围）
   * 必然同帧一致 —— 禁止在 message-bubble / message-input / conversation-list 里各写一份。
   */
  const paletteSourceTheme: CharacterTheme = activePreset?.theme ?? RECOVERY_THEME;
  const injectedTheme = applyChatPalette(paletteSourceTheme, chatPalette);
  const activeCharacter: CharacterPreset | null = activePreset && activeAvatar
    ? { ...activePreset, avatar: activeAvatar, theme: injectedTheme }
    : null;
  const theme = activeCharacter?.theme ?? injectedTheme;

  /**
   * AI 正文的明暗呈现档位（第五轮 U3）：取自当前 UI 色调的 `mode`。
   *
   * 流式段与 `message-bubble` 的落库气泡必须**同一帧同一套呈现**（否则流式期间文字发灰、
   * 落库后突然变成另一个颜色），所以这里派生一次、两条消费路径共用。
   */
  const toneMode = uiTheme.mode;

  /**
   * **三区**（侧栏 / 聊天头部 / 输入区）的表面 id（第六轮 N1：按当前色调明暗自动配对）。
   *
   * 两条规则叠起来，正好是用户要的「深色色调配深色版、浅色色调配浅色版」：
   *   1. **风格**（圆圈）决定家族：`'rose'` → 玫瑰家族，其余一切（`'blue'` / `'native'` / 脏值）
   *      → 蓝家族 —— 判定收在 `paletteSurfaceFor` 里，不在这里自写三元；
   *   2. **色调明暗**决定深浅档：`toneMode`（= 当前 UI 色调的 `mode`）为 `'light'` 时取
   *      `*-soft`，否则取现有两块深色表面。
   *
   * `palettePreference === null`（**从没选过风格**，用户：「还是如果没选过，那就界面不变吧」）
   * 时给 `undefined`：React 会把属性整个省略，三区逐像素等于今天。
   * 这里**刻意不做**「null 一律当梦幻蓝」的回落 —— 那是规格 §4.9 判据 2 明确否掉的备选。
   *
   * 同一个值挂三处**各自**的属性（不挂共享祖先：消息区要留在外面透出壁纸）。
   */
  const chromeSurface = palettePreference === null ? undefined : paletteSurfaceFor(palettePreference, toneMode);

  /**
   * **浮层**（被 portal 到 `body` 的对话框 / 确认框 / 弹层…）的表面 id：**无条件**求值。
   *
   * 与 `chromeSurface` 的 `null` 语义**刻意相反**，两者**不得合并成一个表达式**
   * （合并就是把用户先前报的「点退出登录跳出诡异绿弹窗」那个缺陷带回来）：
   *
   *   - 三区承载的是**外观偏好**：用户没表达过就不施加 → `null` ⇒ 不写属性、界面不变；
   *   - 浮层承载的是**缺陷修复**：不写属性时它们会继承 `html[data-ui-theme]` 的 `--primary`
   *     （`sage-night` 下实测 `lab(66.09% -19.57 15.50)` = 绿），那是 off-brand 的重音色，
   *     不是任何一种「用户偏好」。**绿色是缺陷、不是偏好** —— 所以「从没选过」不该成为
   *     「继续显示缺陷」的理由。用户 2026-09-27 原话：「浮层用不绿，没选过的话就永远用
   *     梦幻蓝，选过的话和用户的选择一致」。
   *
   * 于是 `null` ⇒ `paletteSurfaceFor(null, toneMode)` = 蓝家族（深色色调 `dream-blue`、
   * 浅色色调 `dream-blue-soft`）；选过则与用户的选择一致。两条原则不同 ⇒ 两个值分开命名。
   */
  const overlaySurface = paletteSurfaceFor(palettePreference, toneMode);

  // 换音色提示：拿缓存音频的音色 slug（audio_url 自带，见 lib/ai/tts-voice-key.ts）与当前选择的音色比对。
  // 老格式 URL 解析出 null = 音色未知，视为一致不报提示，避免误报；重新生成一次后即带上音色。
  const currentVoiceId = resolveVoiceId(activeCompanion?.voice_id, activeCharacter?.gender);
  const currentVoiceSlug = toVoiceKeySlug(currentVoiceId);
  const currentVoiceOption = VOICE_OPTIONS.find((voice) => voice.id === currentVoiceId) ?? null;
  const currentVoiceLabel = currentVoiceOption
    ? formatVoiceLabel(currentVoiceOption, locale)
    : t(UNKNOWN_VOICE_LABEL);
  const staleNoticeFor = (message: MessageDTO) => {
    const audioSlug = audioVoiceSlugRef.current[message.id] ?? extractVoiceKeySlug(message.audio_url);
    if (!audioSlug || audioSlug === currentVoiceSlug) return null;
    return { audioVoice: voiceLabelForSlug(audioSlug, locale, t(UNKNOWN_VOICE_LABEL)), currentVoice: currentVoiceLabel };
  };

  const messages = activeId ? (messagesByConversation[activeId] ?? []) : [];
  const streamingText = activeId ? (streamingTextByConversation[activeId] ?? null) : null;
  const phase = activeId ? (phaseByConversation[activeId] ?? 'idle') : 'idle';

  const busy = phase !== 'idle';
  const hasKnownCharacter = activeCharacter !== null;
  const appearanceLocked = activeCompanion
    ? (photoInFlightByCompanion[activeCompanion.id] ?? 0) > 0
    : false;
  return (
    <PaletteSurfaceProvider surface={overlaySurface}>
      <div
        className="relative flex h-dvh overflow-hidden bg-background text-foreground"
        data-testid="chat-shell"
        data-active-conversation-id={activeConversation?.id ?? ''}
        data-active-companion-id={activeCompanion?.id ?? ''}
        data-appearance-style={activeCompanion?.appearance_style ?? ''}
        data-theme-id={chatTheme?.id ?? 'default'}
      >
        {/*
          启动降级提示：会话列表没能加载时给出可操作的重试入口。
          界面其余部分仍然可用 —— 弱网下用户至少能重试，而不是刷新整页。
        */}
        {bootError && (
          <div
            role="alert"
            className="absolute inset-x-0 top-0 z-30 flex flex-wrap items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-foreground backdrop-blur-md"
          >
            <span>{t(bootError)}</span>
            <button
              type="button"
              onClick={() => {
                setBootError(null);
                void loadConversations(companion);
              }}
              disabled={conversationsLoading}
              className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs transition-colors hover:border-primary/50 disabled:opacity-50"
            >
              {conversationsLoading ? t('chat.boot.retrying') : t('chat.boot.retry')}
            </button>
          </div>
        )}

        {/* 全屏背景层：二次元皮肤铺满整个屏幕（侧栏下方也透出），scrim 随 UI 色调 */}
        {chatTheme ? (
          <div className="pointer-events-none absolute inset-0 z-0">
            <picture className="block h-full w-full">
              {chatTheme.desktopImage && (
                <source media="(min-width: 768px) and (min-aspect-ratio: 4/3)" srcSet={chatTheme.desktopImage} />
              )}
                            <img
                src={chatTheme.image}
                alt=""
                className="h-full w-full object-cover"
                style={{
                  filter: 'brightness(' + (chatTheme.brightness ?? 1.4) + ') saturate('
                    + (chatTheme.saturation ?? 1.05) + ')',
                  objectPosition: chatTheme.mobilePosition ?? '50% 50%',
                } as CSSProperties}
              />
            </picture>
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(to bottom, ${uiTheme.scrim}cc 0%, ${uiTheme.scrim}8c 45%, ${uiTheme.scrim}cc 100%)`,
              }}
            />
          </div>
        ) : (
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              // 第七轮 t83（用户当场裁决「甲」）：无壁纸时底色**跟着色调走** —— 浅色调套用该色调的
              // `uiTheme.scrim`（与有壁纸分支同一个色调来源、同一个机制）⇒ 浅底；深色调仍是原样的
              // `theme.chatBg`（逐像素不变）。`toneMode` 就是上面已经解析过一次的 `uiTheme.mode`，
              // 这里只复用它，**没有第二份色调解析**。
              backgroundColor: toneMode === 'light'
                ? noWallpaperBackdrop(theme.chatBg, uiTheme.scrim)
                : theme.chatBg,
              // 角色 accent 径向原样保留：角色色相在这里（不是换一块纯色底）。
              backgroundImage: `radial-gradient(ellipse 80% 40% at 50% -10%, ${theme.accent}18, transparent)`,
            }}
          />
        )}

        {/* 侧栏：半透明玻璃，背景从底下透过来，与聊天区无割裂 */}
        <aside
          id="chat-sidebar"
          data-surface={chromeSurface}
          className={cn(
            'relative z-10 flex w-full shrink-0 flex-col border-r border-sidebar-border backdrop-blur-xl md:flex md:w-80',
            // 联动启用时把玻璃压得更实（浅色表面下 /35 会让文字压不住壁纸）；off 档一字不改。
            chromeSurface ? 'bg-sidebar/60' : 'bg-sidebar/35',
            mobileView === 'chat' && 'hidden',
            // 桌面端收起：只有 md 及以上生效，移动端的窗格切换逻辑不受影响
            sidebarCollapsed && 'md:hidden',
          )}
        >
          {/* 列表区 flex-1 占满剩余高度并内部滚动，底部用户区固定可见 */}
          <div className="min-h-0 flex-1">
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              character={activeCharacter}
              companion={activeCompanion ?? companion}
              disableNew={!hasKnownCharacter}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
              onSelect={selectConversation}
              onNew={() => void createConversation()}
              onDelete={deleteConversation}
              hasMore={Boolean(conversationCursor)}
              loadingMore={moreConversationsLoading}
              onLoadMore={() => void loadMoreConversations()}
            />
          </div>
          <div className="shrink-0 border-t border-sidebar-border p-3">
            <UserPanel />
          </div>
        </aside>

        {/* 聊天窗 */}
        <section
          className={cn(
            'relative z-10 flex min-w-0 flex-1 flex-col md:flex',
            mobileView === 'list' && 'hidden',
          )}
        >
          {/* 头部 */}
          <header
            className="relative z-10 flex items-center gap-3 border-b border-border/40 bg-background/35 px-3 py-2.5 backdrop-blur-md"
            data-testid="active-companion-header"
            data-companion-id={activeCompanion?.id ?? ''}
            data-surface={chromeSurface}
          >
            <button
              onClick={() => setMobileView('list')}
              className="rounded-full p-1.5 text-foreground/60 hover:bg-foreground/10 md:hidden"
              aria-label={t('chat.header.back')}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            {/*
              桌面端：收起 / 展开左侧对话列表（ChatGPT 式）。
              互斥渲染：展开态由侧栏头部渲染同一个 testid，这里返回空 —— 两处同时存在会让
              Playwright 严格模式解析到 2 个元素。移动端由上面那个按钮切窗格。
            */}
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="hidden rounded-full p-1.5 text-foreground/60 transition-colors hover:bg-foreground/10 md:inline-flex"
                aria-label={sidebarCollapsed ? t('chat.header.expand') : t('chat.header.collapse')}
                aria-expanded={!sidebarCollapsed}
                aria-controls="chat-sidebar"
                title={sidebarCollapsed ? t('chat.header.expand') : t('chat.header.collapse')}
                data-testid="sidebar-toggle"
              >
                {sidebarCollapsed
                  ? <PanelLeftOpen className="h-5 w-5" />
                  : <PanelLeftClose className="h-5 w-5" />}
              </button>
            )}
            {activeCharacter ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeCharacter.avatar}
                alt={activeCompanionName}
                className="h-9 w-9 rounded-full object-cover object-top"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                <CircleAlert className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-foreground/90">{activeCompanionName}</p>
              <p className="text-[11px]" style={{ color: theme.accent }}>
                {!hasKnownCharacter
                  ? t('chat.status.missing_character')
                  : phase === 'loading'
                    ? t('chat.status.loading')
                  : phase === 'sending' || phase === 'streaming'
                  ? t('chat.status.typing')
                  : phase === 'photo_loading'
                    ? t('chat.status.photo')
                    : t('chat.status.online')}
              </p>
            </div>
            <LocaleSwitch className="mr-0.5" />
            <PaletteSwitch
              value={palettePreference}
              onChange={applyPalette}
              className="mr-0.5"
            />
            <button
              onClick={() => setThemeOpen(true)}
              disabled={!hasKnownCharacter}
              className="rounded-full p-2 text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('chat.header.appearance')}
            >
              <Palette className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                stopAudio();
                setSettingsOpen(true);
              }}
              disabled={!hasKnownCharacter}
              className="rounded-full p-2 text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('chat.header.settings')}
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </header>

          {/* 消息区 */}
          <div ref={scrollRef} data-testid="message-list-scroll" className="relative z-10 flex-1 overflow-y-auto px-3 py-4 md:px-6">
            <div className={cn(CHAT_MESSAGE_COLUMN_CLASS, 'flex flex-col gap-4')} style={{ maxWidth: CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX }}>
              {activeId && messageCursors[activeId] && (
                <button type="button" className="mx-auto rounded-full px-4 py-2 text-sm text-muted-foreground disabled:opacity-50"
                  disabled={Boolean(olderMessagesLoading[activeId]) || (phaseByConversation[activeId] ?? 'idle') !== 'idle'}
                  onClick={() => void loadOlderMessages(activeId)}>
                  {olderMessagesLoading[activeId] ? t('chat.conversation.loading') : t('chat.conversation.earlier_messages')}
                </button>
              )}
              {!hasKnownCharacter && (
                <div
                  role="alert"
                  data-testid="unknown-character-recovery"
                  className="rounded-2xl border border-border bg-card/90 p-4 shadow-sm backdrop-blur"
                >
                  <div className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{t('chat.conversation.unknown_title')}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('chat.conversation.unknown_body')}</p>
                      <button
                        type="button"
                        onClick={() => router.push('/onboarding?repick=1')}
                        className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {t('chat.conversation.repick')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m) => isPhotoStatusType(m.content_type) ? (
                // 拍照状态行不是气泡：进行中由下方「正在生成数字形象照片…」表示；
                // 失败（或卡死的 pending）只留一行小字，不带朗读与反馈。
                isPhotoFailure(m.content_type, m.created_at, new Date()) ? (
                  <p key={m.id} data-testid="photo-failed-notice" className="px-12 py-1 text-xs text-muted-foreground">
                    {apiError({ code: photoFailureCode(m.content) })}
                  </p>
                ) : null
              ) : (
                <MessageBubble
                  key={m.id}
                  message={m}
                  // t13（队长裁决 B，唯一授权的一行）：把注入后的 theme 传给气泡。
                  // 历史角色模板不可用时 activeCharacter 为 null，这条 prop 是气泡换色的唯一来源。
                  theme={theme}
                  character={activeCharacter}
                  // 与流式段同源的 AI 正文呈现档位 + 已解析的风格（不是表面 id）：
                  // MessageBubble 需要「是不是 rose」来给朗读条选对比色。
                  toneMode={toneMode}
                  paletteSurface={palettePreference}
                  // 免费用户也要看到朗读按钮（契约 t25）：voiceState 与 onPlayVoice 都去门控 ——
                  // message-bubble 的渲染条件是「文本 + voiceState + onPlayVoice」，少一个整条按钮就没了。
                  // 「点了不合成」由 VoiceBar 的 locked 分支负责，不靠在调用方不传 prop。
                  voiceState={m.role === 'assistant' && m.content_type === 'text'
                    ? (voiceStates[m.id] ?? 'ready')
                    : undefined}
                  companionName={activeCompanionName}
                  onPlayVoice={m.role === 'assistant' && m.content_type === 'text' && m.content && activeCharacter
                    ? () => void playVoice(m.id)
                    : undefined}
                  voiceLocked={!speechEnabled}
                  // 语音能力可用时提供旧音色提示与重生成入口。
                  voiceStaleNotice={speechEnabled && m.role === 'assistant' && m.content_type === 'text' && m.content && activeCharacter
                    ? staleNoticeFor(m)
                    : null}
                  onRegenerateVoice={speechEnabled && m.role === 'assistant' && m.content_type === 'text' && m.content && activeCharacter
                    ? () => void playVoice(m.id, { force: true })
                    : undefined}
                  feedback={m.role === 'assistant' ? (feedbackByConversation[activeId ?? '']?.[m.id] ?? null) : null}
                  onFeedback={m.role === 'assistant' && activeId
                    ? (rating, comment) => submitFeedback(activeId, m.id, rating, comment)
                    : undefined}
                />
              ))}

              {/* 流式气泡 */}
              {activeCharacter && streamingText !== null && streamingText !== '' && (
                <div className="flex items-start gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeCharacter.avatar}
                    alt={activeCompanionName}
                    className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover object-top"
                  />
                  <div
                    // 与落库气泡**逐字符同一份 classList**（第七轮候选二删掉底膜与 chrome、候选三加上
                    // 浅色档字重条件后，两侧都是「四个排版类 + 同一个 `toneMode === 'light' &&
                    // 'font-medium'`」，也都不再挂 `data-tone`）+ 同一个 `aiTextPresentation(...)` 调用
                    // ⇒ 流式期间与落库后不可能出现两种观感（含粗细）。
                    className={cn(
                      'text-[15px] leading-relaxed break-words whitespace-pre-wrap',
                      toneMode === 'light' && 'font-medium',
                    )}
                    // 与落库气泡**逐字符同一个调用**：流式期间与落库后不许出现两种呈现。
                    style={aiTextPresentation(theme.theirBubble, toneMode, theme.theirText, theme.accent)}
                  >
                    {streamingText}
                    <span
                      className="ml-1 inline-block h-3.5 w-[2px] animate-pulse align-middle"
                      style={{ backgroundColor: theme.accent }}
                    />
                  </div>
                </div>
              )}

              {activeCharacter && phase === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('chat.status.loading')}
                </div>
              )}

              {activeCharacter && phase === 'sending' && (streamingText === null || streamingText === '') && (
                <TypingIndicator character={activeCharacter} />
              )}
              {activeCharacter && phase === 'photo_loading' && <PhotoLoadingIndicator character={activeCharacter} />}
            </div>
          </div>

          {/* 输入栏 */}
          <div
            data-surface={chromeSurface}
            className={cn('relative z-10', chromeSurface && 'bg-background/60')}
          >
            {!capabilities.chat && <p className="px-4 py-2 text-center text-xs text-muted-foreground">{t('chat.config.chat')}</p>}
            {/* 输入框长高会把贴底的最后一条消息顶出视口，故用既有 scrollToBottom(false) 重新贴底 */}
            <MessageInput
              disabled={busy || !hasKnownCharacter || !capabilities.chat}
              uploadEnabled={capabilities.upload}
              accent={theme.accent}
              onSend={sendMessage}
              onGrow={() => scrollToBottom(false)}
            />
          </div>
        </section>

        {activeCompanion && activeCharacter && visitorId && (
          <CompanionSettings
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            companion={activeCompanion}
            character={activeCharacter}
            visitorId={visitorId}
            speechEnabled={speechEnabled}
            speechPresentation={speechPresentation}
            disableAppearance={appearanceLocked}
            onSaved={(saved) => {
              setCompanionsById((items) => ({ ...items, [saved.id]: saved }));
              if (saved.id === companion.id) setCompanion(saved);
              const avatar = saved.avatar
                ?? getCharacterAvatar(saved.character_key, saved.appearance_style);
              setConversations((items) => items.map((item) => item.companion_id === saved.id
                ? {
                    ...item,
                    companion_name: saved.name,
                    companion_avatar: avatar,
                    companion_appearance_style: saved.appearance_style,
                    companion_theme_id: saved.theme_id,
                  }
                : item));
            }}
            onRepick={() => router.push('/onboarding?repick=1')}
          />
        )}
        {activeConversation && activeCompanion && activeCharacter && (
          <ThemeSettings
            open={themeOpen}
            onOpenChange={setThemeOpen}
            conversationId={activeConversation.id}
            companionId={activeCompanion.id}
            onApply={(selected) => {
              setChatTheme(selected);
              setConversations((items) => items.map((item) => item.companion_id === activeCompanion.id
                ? { ...item, companion_theme_id: selected?.id ?? null }
                : item));
            }}
            onApplyUi={(u) => setUiTheme(u)}
          />
        )}
      </div>
    </PaletteSurfaceProvider>
  );
}
