import { randomUUID } from 'node:crypto';
import type { MessageDTO, ChatSSEEvent } from '@/lib/types';
import { extractPhotoScene, stripPhotoTags, getPhotoSafeStreamLength } from '@/lib/prompts';

export function createPersonalChatStream(input: {
  userMessage: MessageDTO | null;
  photoEnabled: boolean;
  timeoutMs: number;
  stream: (signal: AbortSignal) => AsyncIterable<string>;
  finishReply: (text: string) => MessageDTO;
  onFinish?: () => Promise<void>;
}) {
  const requestId = randomUUID();
  const encoder = new TextEncoder();
  let closed = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatSSEEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        if (input.userMessage) send({ type: 'user_message', message: input.userMessage });
        const signal = AbortSignal.timeout(Math.max(1, Math.floor(input.timeoutMs)));
        let fullText = '';
        let sentLength = 0;
        // A disconnected browser closes the writer only. The independent server
        // deadline bounds generation, and the completed reply still commits once.
        const iterator = input.stream(signal)[Symbol.asyncIterator]();
        let abort!: () => void;
        const deadline = new Promise<never>((_resolve, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
        try {
          while (true) {
            const step = await Promise.race([iterator.next(), deadline]);
            if (step.done) break;
            signal.throwIfAborted();
            fullText += step.value;
            const safeLength = getPhotoSafeStreamLength(fullText);
            if (safeLength > sentLength) {
              send({ type: 'chunk', text: fullText.slice(sentLength, safeLength) });
              sentLength = safeLength;
            }
          }
        } finally {
          signal.removeEventListener('abort', abort);
          // Do not await an adapter that ignored cancellation and stalled next().
          if (signal.aborted) void iterator.return?.().catch(() => {});
        }
        signal.throwIfAborted();
        const photoScene = extractPhotoScene(fullText);
        const cleanText = stripPhotoTags(fullText);
        const message = input.finishReply(cleanText || '……');
        send({
          type: 'done',
          message,
          photo_request: input.photoEnabled && photoScene !== null,
          photo_scene: photoScene,
        });
      } catch (error) {
        console.error('[personal:chat-stream]', {
          requestId,
          error: error instanceof Error ? error.name : 'unknown',
        });
        send({
          type: 'error',
          error: 'The reply could not be finished. Please try again in a moment.',
          code: 'CHAT_REPLY_FAILED',
        });
      } finally {
        await input.onFinish?.().catch(() => console.error('[personal:chat-lease]', { requestId }));
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed by the transport */
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Chat-Request-Id': requestId,
    },
  });
}
