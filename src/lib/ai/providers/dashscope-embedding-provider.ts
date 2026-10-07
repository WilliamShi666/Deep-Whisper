import type { EmbeddingProvider, EmbeddingRequest, RuntimeEnvironment } from '@/lib/ai/embedding-contracts';
import { getProviderConfig } from '@/lib/config/runtime';

/** Personal hybrid retrieval adapter. Requests at most 10 inputs per provider call.
 * Model and dimension are persisted with every vector; incompatible spaces never mix.
 * Returns all vectors in input order, or rejects the entire operation.
 */
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_MODEL = 'text-embedding-v4';

const DEFAULT_BASE_URL = 'https://maas.qianwenaiapi.com/compatible-mode/v1';
const EMBEDDINGS_PATH = '/embeddings';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TEXTS_PER_REQUEST = 10;
const MAX_TEXTS_PER_CALL = 250;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;

interface EmbeddingPayload {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
}

function requireApiKey(env: RuntimeEnvironment): string {
  const value = env.DASHSCOPE_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: DASHSCOPE_API_KEY');
  }
  return value;
}

function baseUrl(env: RuntimeEnvironment): string {
  const value = env.DASHSCOPE_EMBEDDING_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('DASHSCOPE_EMBEDDING_BASE_URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function isFiniteVector(value: unknown, expected: number): boolean {
  return Array.isArray(value)
    && value.length === expected
    && value.every((component) => typeof component === 'number' && Number.isFinite(component));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DashScopeEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly env: RuntimeEnvironment = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(request: EmbeddingRequest): Promise<number[][]> {
    const texts = request.texts.map((text) => text.trim());
    if (texts.length === 0) return [];
    if (texts.some((text) => !text)) {
      throw new Error('Embedding text must not be empty');
    }
    if (texts.length > MAX_TEXTS_PER_CALL) {
      throw new Error(`Embedding batch is too large (max ${MAX_TEXTS_PER_CALL})`);
    }
    // 白名单/配置校验排在取 key 之前：缺 key 也要先确认「这不是一次白付的调用」。
    const model = getProviderConfig(this.env).embedding.model;
    const apiKey = requireApiKey(this.env);
    const result: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_TEXTS_PER_REQUEST) {
      const batch = texts.slice(offset, offset + MAX_TEXTS_PER_REQUEST);
      result.push(...await this.embedBatch(batch, request.signal, apiKey, model));
    }
    return result;
  }

  private async embedBatch(texts: string[], signal: AbortSignal | undefined, apiKey: string, model: string): Promise<number[][]> {
    for (let attempt = 1; ; attempt += 1) {
      // 契约要求：既传调用方的 signal，**又**保留一个有限超时。
      // 写成 `request.signal ?? AbortSignal.timeout(...)` 是错的 —— 调用方一旦传了 signal，
      // 超时就被顶掉，等于没有超时；兄弟适配器一律用 AbortSignal.any 合成。
      const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      const response = await this.fetchImpl(`${baseUrl(this.env)}${EMBEDDINGS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
          encoding_format: 'float',
        }),
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      });

      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
          await delay(RETRY_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(`Embedding request failed (${response.status})`);
      }

      const payload = (await response.json()) as EmbeddingPayload;
      const entries = payload.data;
      const indexed = entries?.some((entry) => entry.index !== undefined);
      if (indexed && (!entries?.every((entry) => Number.isInteger(entry.index)
        && entry.index! >= 0 && entry.index! < texts.length)
        || new Set(entries.map((entry) => entry.index)).size !== texts.length)) {
        throw new Error('Embedding response indexes are invalid');
      }
      const raw = (indexed ? entries?.slice().sort((a, b) => a.index! - b.index!) : entries)?.map((entry) => entry.embedding);
      if (!raw || raw.length !== texts.length) {
        throw new Error(`Embedding vector count mismatch: expected ${texts.length}, got ${raw?.length ?? 0}`);
      }
      for (const vector of raw) {
        if (!isFiniteVector(vector, EMBEDDING_DIMENSIONS)) {
          throw new Error(`Embedding vector is invalid: expected ${EMBEDDING_DIMENSIONS} finite dimensions`);
        }
      }
      return raw as number[][];
    }
  }
}
