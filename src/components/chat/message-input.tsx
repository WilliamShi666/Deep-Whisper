'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, SendHorizonal, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import {
  COMPOSER_BORDER_PX,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_MIN_HEIGHT_PX,
  composerMaxHeight,
  resolveComposerHeight,
  shouldSendOnEnter,
} from '@/lib/chat-composer';
import { CHAT_COMPOSER_CLASS, CHAT_COMPOSER_MAX_WIDTH_PX } from '@/lib/chat-layout';
import { useApiError, useT } from '@/lib/i18n-client';

interface MessageInputProps {
  disabled: boolean;
  uploadEnabled?: boolean;
  accent: string;
  onSend: (content: string, imagePath?: string) => void;
  /**
   * 输入框因内容增长而变高时回调一次（聊天页用它把消息列表重新贴底）。
   * 只在高度**真的变化**时调用，否则会把用户向上翻阅历史的位置强行拽回底部。
   */
  onGrow?: () => void;
}

/** 输入栏：文本 + 发图 */
export function MessageInput({ disabled, uploadEnabled = true, accent, onSend, onGrow }: MessageInputProps) {
  const t = useT();
  const apiError = useApiError();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ path: string; preview: string } | null>(null);
  useEffect(() => {
    const preview = pendingImage?.preview;
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [pendingImage?.preview]);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** compositionstart…compositionend 之间为 true：个别浏览器会把 nativeEvent.isComposing 重置掉，故留兜底 */
  const composingRef = useRef(false);
  /**
   * 上一个写入的高度。**只**用来决定要不要回调 onGrow：
   * 高度不变时不该把用户向上翻阅历史的位置拽回底部。它绝不能变成「跳过写 style」的早退
   * —— 写 style 是复位与上限的唯一手段，任何一次测量都必须写回。
   */
  const lastHeightRef = useRef(COMPOSER_MIN_HEIGHT_PX);
  /** 上一次观测到的内容盒宽度：ResizeObserver 只在宽度真变化时才重算高度 */
  const lastWidthRef = useRef<number | null>(null);
  /** 行高 / border 的实测值：首次挂载与常量漂移 > 0.5px 时以实测为准 */
  const metricsRef = useRef({ lineHeight: COMPOSER_LINE_HEIGHT, borderPx: COMPOSER_BORDER_PX });
  /** onGrow 用 ref 转发：调用处（聊天页）传的是内联箭头函数，这样底下的 effect 依赖可以保持稳定 */
  const onGrowRef = useRef(onGrow);
  onGrowRef.current = onGrow;

  const doSend = () => {
    const content = text.trim();
    if (disabled || uploading) return;
    if (!content && !pendingImage) return;
    onSend(content, pendingImage?.path);
    setText('');
    setPendingImage(null);
  };

  /**
   * 唯一的测量 → 纯函数 → 写 style 的地方。
   * DOM 只提供 scrollHeight 与 window.innerHeight，其余算术全在 `@/lib/chat-composer`。
   *
   * 三步固定顺序：① `height = 'auto'` 复位 → ② 读 `scrollHeight` → ③ 把纯函数算出的高度
   * **总是**写回。第 ① 步不能省：`scrollHeight` 的下界是当前 padding box（`scrollHeight ≥
   * clientHeight`），若先写死了 225px 再测量，内容变短（含发送后清空）时永远量到 ≥223px，
   * 高度就再也缩不回去（旧实现正是这个 bug）。两次写 style 在同一同步任务内完成，浏览器只在
   * 本任务结束后绘制一次，所以不会看到 `auto` 的中间态，也不会闪烁。
   */
  const syncHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeightPx = composerMaxHeight(window.innerHeight, metricsRef.current.lineHeight);
    el.style.maxHeight = `${maxHeightPx}px`;
    el.style.height = 'auto';
    // scrollHeight 含 padding 不含 border：实测 border 与常量漂移时把差值补进来（纯函数签名不变）
    const borderDelta = metricsRef.current.borderPx - COMPOSER_BORDER_PX;
    const { height } = resolveComposerHeight({ scrollHeight: el.scrollHeight + borderDelta, maxHeightPx });
    el.style.height = `${height}px`;
    // 这个比较只负责「要不要通知聊天页重新贴底」，不负责「要不要写 style」
    const previous = lastHeightRef.current;
    if (previous === height) return;
    lastHeightRef.current = height;
    onGrowRef.current?.();
  }, []);

  // 内容变化（输入、粘贴、发送后清空都会走这里）后重新测量并写入高度。
  // disabled / pendingImage 只在依赖里出现，高度没真变就不写 style、不回调。
  useEffect(() => {
    syncHeight();
  }, [syncHeight, text, pendingImage, disabled]);

  /**
   * 元素**宽度**变化也要重算：宽度决定折行数，折行数决定内容高（收起/展开侧栏即属此类）。
   * syncHeight 只写 height / maxHeight、从不写 width，所以观察者不会自触发回环；
   * 高度变化引起的通知因宽度未变而被跳过，同样不成环。
   */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const previous = lastWidthRef.current;
        lastWidthRef.current = width;
        // 宽度没变（含「高度变了」这类通知）→ 什么都不做
        if (previous === null || Math.abs(width - previous) < 0.5) continue;
        // 宽度 0 = 元素不可见（display:none，例如移动端切到「列表」窗格）：此时量不到真实
        // 内容高，写入的只会是底限；等它重新可见那次通知（width 0 → 真实宽度）再算。
        if (width === 0) continue;
        syncHeight();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncHeight]);

  // 首次挂载实测真实行高与 border：与常量相差 > 0.5px 以实测为准（未来改字号/行高时上限不会静默变化）。
  // 视口高度变化会让比例那一路的上限变化，所以顺带监听 resize。
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      const style = window.getComputedStyle(el);
      const measuredLineHeight = Number.parseFloat(style.lineHeight);
      if (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0
        && Math.abs(measuredLineHeight - COMPOSER_LINE_HEIGHT) > 0.5) {
        metricsRef.current.lineHeight = measuredLineHeight;
      }
      const measuredBorder = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      if (Number.isFinite(measuredBorder) && Math.abs(measuredBorder - COMPOSER_BORDER_PX) > 0.5) {
        metricsRef.current.borderPx = measuredBorder;
      }
      syncHeight();
    }
    window.addEventListener('resize', syncHeight);
    return () => window.removeEventListener('resize', syncHeight);
  }, [syncHeight]);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/api/upload', { method: 'POST', body: form });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !data.path) {
        toast.error(apiError(data, { fallback: t('chat.input.upload_failed') }));
        return;
      }
      setPendingImage({ path: data.path, preview: URL.createObjectURL(file) });
    } catch {
      toast.error(t('chat.input.upload_failed_retry'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-border/40 bg-background/35 px-3 pt-2.5 pb-3 backdrop-blur-md">
      {/* 列宽走「输入区」专属来源（第五轮 U2 把消息列与输入区拆成两个常量，输入区保持不动）；border-t 仍横贯整宽 */}
      <div className={CHAT_COMPOSER_CLASS} style={{ maxWidth: CHAT_COMPOSER_MAX_WIDTH_PX }}>
        {pendingImage && (
          <div className="relative mb-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImage.preview}
              alt={t('chat.input.pending_alt')}
              className="h-16 w-16 rounded-lg border border-border object-cover"
            />
            <button
              onClick={() => setPendingImage(null)}
              className="absolute -top-1.5 -right-1.5 rounded-full bg-black/70 p-0.5 text-white/80 hover:text-white"
              aria-label={t('chat.input.remove_image')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={disabled || uploading || !uploadEnabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
            aria-label={t('chat.input.send_image')}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          </button>
          <textarea
            ref={textareaRef}
            data-testid="message-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 判定全在纯函数里：isComposing / keyCode 229 / 组词期间的 ref 三信号任一成立就
              // 不发送、也不 preventDefault（Enter 交给输入法消费）。禁止防抖与时间窗。
              const send = shouldSendOnEnter({
                key: e.key,
                shiftKey: e.shiftKey,
                isComposing: e.nativeEvent.isComposing === true,
                keyCode: e.keyCode,
                composing: composingRef.current,
              });
              if (!send) return;
              e.preventDefault();
              doSend();
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder={pendingImage ? t('chat.input.placeholder_pending') : t('chat.input.placeholder')}
            rows={1}
            disabled={disabled}
            className="min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl border border-border bg-muted/50 px-4 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={doSend}
            disabled={disabled || uploading || (!text.trim() && !pendingImage)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
            style={{ backgroundColor: accent, color: '#1a1210' }}
            aria-label={t('chat.input.send')}
          >
            <SendHorizonal className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
