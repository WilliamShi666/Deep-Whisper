import type { GeneratedSpeech, SpeechProvider, SpeechSynthesisRequest } from '@/lib/ai';

function isCallerAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

function safeFailureSummary(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown provider failure';
}

export interface FallbackSpeechOptions {
  /**
   * 跨厂商回退时的**音色翻译**。
   *
   * 为什么必须有：不同厂商的音色 id 空间完全不通。千问的 `longhan_v3.1` 对 Gemini
   * 没有任何意义，原样透传只会拿到「voice mapping is not configured」这种二次失败 ——
   * 那等于回退根本没生效。所以由注册表注入一个按性别（必要时按语言）收敛的映射。
   *
   * 只在**回退分支**调用：主 provider 正常时绝不改写入参。
   */
  translateVoice?: (voice: string) => string;
}

/**
 * Uses the configured primary provider first, with a fallback provider available
 * for recoverable upstream failures. A caller cancellation must never create a
 * second paid request.
 *
 * 注意：回退会**换掉实际发声的厂商与音色**（这正是「失败才回退」的代价）。
 * 翻译函数只保证「换成对方能播的、性别一致的音色」，不保证音色听感相同。
 */
export class FallbackSpeechProvider implements SpeechProvider {
  private readonly translateVoice: ((voice: string) => string) | undefined;

  constructor(
    private readonly primary: SpeechProvider,
    private readonly fallback: SpeechProvider,
    options: FallbackSpeechOptions = {},
  ) {
    this.translateVoice = options.translateVoice;
  }

  async synthesize(input: SpeechSynthesisRequest): Promise<GeneratedSpeech> {
    try {
      return await this.primary.synthesize(input);
    } catch (error) {
      if (isCallerAbort(error, input.signal)) throw error;
      const fallbackInput = this.translateVoice
        ? { ...input, voice: this.translateVoice(input.voice) }
        : input;
      try {
        return await this.fallback.synthesize(fallbackInput);
      } catch (fallbackError) {
        throw new Error(
          `Primary speech provider failed: ${safeFailureSummary(error)}; fallback speech provider failed: ${safeFailureSummary(fallbackError)}`,
        );
      }
    }
  }
}
