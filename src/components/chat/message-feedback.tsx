'use client';

import { useEffect, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { MAX_COMMENT_LENGTH } from '@/lib/feedback/validate';
import { useT } from '@/lib/i18n-client';
import { cn } from '@/lib/utils';

export interface MessageFeedbackState {
  rating: 1 | -1;
  comment: string | null;
}

interface MessageFeedbackProps {
  messageId: string;
  value: MessageFeedbackState | null;
  /** rating 为 null 表示撤销这条反馈 */
  onSubmit: (rating: 1 | -1 | null, comment: string | null) => Promise<void> | void;
  accent?: string;
}

const iconButtonClass = [
  'inline-flex h-7 w-7 items-center justify-center rounded-full',
  'text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
  'disabled:opacity-50',
].join(' ');

/**
 * 单条助手回复的反馈控件：👍/👎 一键提交，随后可选补充说明。
 *
 * 交互决策：
 * - 点击即提交（不等留言），因为「一条回复一个动作」是主路径；
 * - 再点同一个按钮 = 撤销，符合「改主意」的直觉；
 * - 留言面板只在已有评分后展开——留言必须伴随评分。
 */
export function MessageFeedback({ messageId, value, onSubmit, accent }: MessageFeedbackProps) {
  const t = useT();
  const [commentOpen, setCommentOpen] = useState(false);
  const [draft, setDraft] = useState(value?.comment ?? '');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  // 服务端状态变化（切换会话、重新加载）时同步草稿。
  useEffect(() => {
    setDraft(value?.comment ?? '');
  }, [value?.comment, messageId]);

  const rating = value?.rating ?? null;

  async function submit(nextRating: 1 | -1 | null, nextComment: string | null) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await onSubmit(nextRating, nextComment);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function toggle(next: 1 | -1) {
    if (rating === next) {
      setCommentOpen(false);
      void submit(null, null);
      return;
    }
    setCommentOpen(true);
    void submit(next, draft.trim() === '' ? null : draft.trim());
  }

  return (
    <span className="inline-flex flex-col gap-1" data-testid={`feedback-${messageId}`}>
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          aria-label={t('chat.feedback.helpful')}
          aria-pressed={rating === 1}
          disabled={pending}
          data-testid="feedback-up"
          onClick={() => toggle(1)}
          className={cn(iconButtonClass, rating === 1 && 'bg-foreground/10')}
          style={rating === 1 && accent ? { color: accent } : undefined}
        >
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('chat.feedback.unhelpful')}
          aria-pressed={rating === -1}
          disabled={pending}
          data-testid="feedback-down"
          onClick={() => toggle(-1)}
          className={cn(iconButtonClass, rating === -1 && 'bg-foreground/10')}
          style={rating === -1 && accent ? { color: accent } : undefined}
        >
          <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
        </button>
        {rating !== null && !commentOpen && (
          <button
            type="button"
            className="ml-1 text-[11px] text-foreground/55 underline hover:text-foreground"
            data-testid="feedback-add-comment"
            onClick={() => setCommentOpen(true)}
          >
            {value?.comment ? t('chat.feedback.edit_note') : t('chat.feedback.add_note')}
          </button>
        )}
      </span>

      {commentOpen && rating !== null && (
        <span className="flex flex-col gap-1" data-testid="feedback-comment-panel">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
            maxLength={MAX_COMMENT_LENGTH}
            rows={2}
            data-testid="feedback-comment-area"
            placeholder={t('chat.feedback.note_placeholder')}
            aria-label={t('chat.feedback.note_aria')}
            className="w-full min-w-48 resize-none rounded-lg border border-foreground/15 bg-background/60 px-2 py-1.5 text-[12px] leading-relaxed"
          />
          <span className="flex items-center gap-2">
            <button
              type="button"
              data-testid="feedback-save-comment"
              disabled={pending}
              className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-[11px] hover:bg-foreground/20"
              onClick={() => {
                setCommentOpen(false);
                void submit(rating, draft.trim() === '' ? null : draft.trim());
              }}
            >
              {t('chat.feedback.save')}
            </button>
            <button
              type="button"
              className="text-[11px] text-foreground/55 underline hover:text-foreground"
              onClick={() => {
                setDraft(value?.comment ?? '');
                setCommentOpen(false);
              }}
            >
              {t('chat.feedback.skip')}
            </button>
            <span className="ml-auto text-[10px] tabular-nums text-foreground/45">
              {draft.length}/{MAX_COMMENT_LENGTH}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
