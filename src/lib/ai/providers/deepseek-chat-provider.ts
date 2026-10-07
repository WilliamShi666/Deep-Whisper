import type { AiMessage } from '@/lib/ai/types';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ProviderError,
  type AiTokenUsage,
  type ChatCompletion,
  type ChatProvider,
  type ChatRequest,
  type StructuredChatCompletion,
  type StructuredChatRequest,
  type StructuredOutputSchema,
} from '@/lib/ai/contracts';

import { DEEPSEEK_VISION_MODEL } from '../model-defaults';
import { readModelId } from '@/lib/config/runtime';
export { DEEPSEEK_VISION_MODEL } from '../model-defaults';

// DeepSeek 官方会静默改名：旧名仍可请求，但响应里的 model 会被规范化成新名。
// 保留旧名别名并让新旧互认，避免下一次改名再次把整条对话直接打成 error。
const DEEPSEEK_MODEL_ALIASES: readonly string[] = [
  'deepseek-v4-flash-vision-exp',
];

const DEEPSEEK_SUPPORTED_MODELS: ReadonlySet<string> = new Set([
  DEEPSEEK_VISION_MODEL,
  ...DEEPSEEK_MODEL_ALIASES,
]);

function isSupportedModel(model: string | undefined): boolean {
  return typeof model === 'string' && DEEPSEEK_SUPPORTED_MODELS.has(model);
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

interface DeepSeekChatProviderOptions {
  model: string;
  fetchImpl?: typeof fetch;
  env?: RuntimeEnvironment;
  retryDelayMs?: number;
}

interface DeepSeekErrorResponse {
  error?: unknown;
}

interface DeepSeekMessage {
  content?: string | Array<{ type?: string; text?: string }> | null;
}

interface DeepSeekCompletionResponse extends DeepSeekErrorResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: DeepSeekMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface DeepSeekStreamChunk extends DeepSeekErrorResponse {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

class DeepSeekHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`DeepSeek request failed with HTTP ${status}`);
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  const url = new URL(normalized);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('DEEPSEEK_BASE_URL must use http or https');
  }
  return normalized;
}

function requireApiKey(env: RuntimeEnvironment): string {
  const value = env.DEEPSEEK_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: DEEPSEEK_API_KEY');
  }
  return value;
}

function textContent(content: DeepSeekMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

/**
 * 取第一个**配平**的 `{...}`（正确处理字符串与转义），找不到返回 null。
 *
 * 为什么需要它：provider 只请求了 `response_format: { type: 'json_object' }`
 * —— 通用 JSON 模式，不是严格 schema —— 模型偶尔会在 JSON 前后带一句话
 * （「好的，这是完善后的性格：{...}」）或包一层围栏再补一段说明。
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 解析结构化输出。
 *
 * 原实现只 `JSON.parse`（外加剥掉首尾围栏），任何夹带散文的响应都会直接判成
 * malformed。实测「一键完善」因此有约 20% 的请求失败（见
 * tests/persona-enhancement.test.ts 的解析失败重试用例）。这里加一条退化路径：
 * 从散文里挑出第一个配平的 JSON 对象再解析。
 *
 * 仍然无法解析时抛 `ProviderError('invalid_response', retryable)`，让调用方
 * 能按类型判断「值得再试一次」，而不是靠匹配错误文案。
 */
function parseStructuredJson(content: string): unknown {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(stripped);
    if (extracted !== null) {
      try {
        return JSON.parse(extracted) as unknown;
      } catch {
        // 落到下面统一抛错
      }
    }
    throw new ProviderError(
      'DeepSeek returned malformed structured JSON',
      'invalid_response',
      true,
    );
  }
}

function usageFrom(
  usage: DeepSeekCompletionResponse['usage'],
): AiTokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function structuredMessages(
  messages: AiMessage[],
  outputSchema?: StructuredOutputSchema,
): AiMessage[] {
  if (!outputSchema) return messages;
  return [
    {
      role: 'system',
      content:
        `Return only valid JSON matching schema "${outputSchema.name}": ` +
        JSON.stringify(outputSchema.schema),
    },
    ...messages,
  ];
}

export class DeepSeekChatProvider implements ChatProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly env: RuntimeEnvironment;
  private readonly baseUrl: string;
  private readonly retryDelayMs: number;

  constructor(private readonly options: DeepSeekChatProviderOptions) {
    readModelId(options.model, 'AI_CHAT_MODEL / AI_VISION_MODEL');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.env = options.env ?? process.env;
    this.baseUrl = normalizeBaseUrl(
      this.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
    );
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  private assertResponseModel(model: string | undefined): void {
    if (!model) return;
    // 新旧名都在支持集合内即视为正常（供应商会把别名规范化成正式名）。
    if (model === this.options.model || (isSupportedModel(this.options.model) && isSupportedModel(model))) return;
    throw new Error('DeepSeek returned an unexpected model');
  }

  private async request(
    input: ChatRequest,
    stream: boolean,
    outputSchema?: StructuredOutputSchema,
  ): Promise<Response> {
    // performance.now() budgets are fractional; native AbortSignal needs integer ms.
    const timeoutMs = Math.floor(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // One deadline covers attempts, backoff and consumption of the returned body.
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const maxAttempts = Math.max(
      1,
      input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    );
    // 思考模式按调用方显式指定；缺省关闭（产品级约定：对话通道固定关闭）。
    const thinkingEnabled = input.thinking === 'enabled';
    const requestBody = JSON.stringify({
      model: this.options.model,
      messages: structuredMessages(input.messages, outputSchema),
      // 思考模式下 temperature 不起作用（供应商文档：传了不报错，但也不会生效），
      // 所以开启时干脆不带该字段，避免"看起来设了、其实没生效"。
      ...(thinkingEnabled ? {} : { temperature: input.temperature ?? 0 }),
      stream,
      thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
      // 供应商默认 effort 是 high；这里只在显式开启时下发，且缺省压到 low。
      ...(thinkingEnabled ? { reasoning_effort: input.reasoningEffort ?? 'low' } : {}),
      ...(outputSchema
        ? { response_format: { type: 'json_object' } }
        : {}),
    });

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        signal.throwIfAborted();
        const response = await this.fetchImpl(
          `${this.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${requireApiKey(this.env)}`,
              'Content-Type': 'application/json',
            },
            body: requestBody,
            signal,
          },
        );
        if (response.ok) return response;

        await response.body?.cancel();

        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        throw new DeepSeekHttpError(response.status, retryable);
      } catch (error) {
        if (signal.aborted) {
          throw new Error(input.signal?.aborted ? 'DeepSeek request aborted' : 'DeepSeek request timed out');
        }
        lastError =
          error instanceof Error
            ? error
            : new Error('DeepSeek request failed');
        if (error instanceof DeepSeekHttpError && !error.retryable) {
          throw error;
        }
        if (attempt === maxAttempts) throw lastError;
      }

      await delay(this.retryDelayMs * attempt, undefined, { signal });
    }

    throw lastError ?? new Error('DeepSeek request failed');
  }

  async complete(input: ChatRequest): Promise<ChatCompletion> {
    const response = await this.request(input, false);
    const payload = (await response.json()) as DeepSeekCompletionResponse;
    if (payload.error) throw new Error('DeepSeek returned an error response');
    this.assertResponseModel(payload.model);
    const choice = payload.choices?.[0];
    const content = textContent(choice?.message?.content);
    if (!content) throw new Error('DeepSeek returned an empty completion');
    return {
      content,
      model: payload.model ?? this.options.model,
      finishReason: choice?.finish_reason ?? undefined,
      providerRequestId: payload.id,
      usage: usageFrom(payload.usage),
    };
  }

  async completeStructured<T>(
    input: StructuredChatRequest<T>,
  ): Promise<StructuredChatCompletion<T>> {
    const response = await this.request(input, false, input.outputSchema);
    const payload = (await response.json()) as DeepSeekCompletionResponse;
    if (payload.error) throw new Error('DeepSeek returned an error response');
    this.assertResponseModel(payload.model);
    const choice = payload.choices?.[0];
    const content = textContent(choice?.message?.content);
    if (!content) {
      throw new Error('DeepSeek returned an empty structured completion');
    }
    const data = input.parse(parseStructuredJson(content));
    return {
      data,
      content,
      model: payload.model ?? this.options.model,
      finishReason: choice?.finish_reason ?? undefined,
      providerRequestId: payload.id,
      usage: usageFrom(payload.usage),
    };
  }

  async *stream(input: ChatRequest): AsyncIterable<string> {
    const response = await this.request(input, true);
    if (!response.body) throw new Error('DeepSeek returned an empty stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

    const consume = (event: string): string | undefined => {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return undefined;
      if (data === '[DONE]') {
        completed = true;
        return undefined;
      }
      let chunk: DeepSeekStreamChunk;
      try {
        chunk = JSON.parse(data) as DeepSeekStreamChunk;
      } catch {
        throw new Error('DeepSeek returned malformed streaming data');
      }
      if (chunk.error) throw new Error('DeepSeek stream returned an error');
      this.assertResponseModel(chunk.model);
      const finishReason = chunk.choices?.[0]?.finish_reason;
      if (finishReason) {
        if (finishReason !== 'stop') throw new Error('DeepSeek reply did not complete normally');
        completed = true;
      }
      return chunk.choices?.[0]?.delta?.content ?? undefined;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer = (
          buffer + decoder.decode(value, { stream: !done })
        ).replace(/\r\n/g, '\n');
        if (buffer.length > 1024 * 1024) throw new Error('DeepSeek streaming frame is too large');
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const content = consume(event);
          if (content) yield content;
          if (completed) break;
          boundary = buffer.indexOf('\n\n');
        }
        if (done || completed) break;
      }
      if (!completed && buffer.trim()) {
        const content = consume(buffer);
        if (content) yield content;
      }
      if (!completed) throw new Error('DeepSeek stream ended before the reply completed');
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
