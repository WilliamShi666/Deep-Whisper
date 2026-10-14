import { setTimeout as delay } from 'node:timers/promises';
import { ProviderError, type ProviderRequestOptions } from '../contracts';
import { normalizeAiBaseUrl } from '@/lib/config/runtime';

export interface CompatibleConnection {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}
export function normalizeApiBaseUrl(value: string): string {
  return normalizeAiBaseUrl(value, 'AI API base URL');
}
export function compatibleSignal(input: ProviderRequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(input.timeoutMs ?? 120_000)));
  return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
}
export function compatibleHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
export function compatibleFailure(error: unknown, signal: AbortSignal, input: ProviderRequestOptions): ProviderError {
  if (signal.aborted) return new ProviderError(input.signal?.aborted ? 'AI request aborted' : 'AI request timed out', input.signal?.aborted ? 'aborted' : 'timeout', false);
  return error instanceof ProviderError ? error : new ProviderError('AI network or response failure', 'network', true);
}
export function isCompatiblePolicyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const fields = error as { code?: unknown; type?: unknown; error_type?: unknown };
  return [fields.code, fields.type, fields.error_type].some(value => typeof value === 'string' && /content_policy|moderation|safety|refusal|guardrail/i.test(value));
}
function assertSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new ProviderError('AI response aborted or timed out', signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'aborted', false);
}
export async function compatibleRequest(connection: CompatibleConnection, path: string, init: RequestInit, input: ProviderRequestOptions & { maxAttempts?: number }, signal: AbortSignal): Promise<Response> {
  const attempts = Math.min(3, Math.max(1, Math.floor(input.maxAttempts ?? 1)));
  for (let attempt = 1; ; attempt++) {
    try {
      assertSignal(signal);
      const response = await (connection.fetchImpl ?? fetch)(`${normalizeApiBaseUrl(connection.baseUrl)}${path}`, { ...init, signal, redirect: 'error' });
      if (response.ok) return response;
      let policy = false;
      // Inspect a bounded machine-readable error code only; never propagate response text.
      try {
        const payload = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 64 * 1024, signal))) as { error?: { code?: unknown; type?: unknown } };
        policy = isCompatiblePolicyError(payload.error);
      } catch { /* Status remains sufficient to classify. */ }
      const status = response.status;
      const code = policy ? 'policy_rejected' : status === 401 || status === 403 ? 'unauthorized' : status === 429 ? 'rate_limited' : status === 408 || status === 504 ? 'timeout' : status >= 500 ? 'upstream_unavailable' : 'bad_request';
      throw new ProviderError(`AI request failed with HTTP ${status}`, code, !policy && (status === 408 || status === 429 || status >= 500));
    } catch (error) {
      const failure = compatibleFailure(error, signal, input);
      if (!failure.retryable || attempt >= attempts) throw failure;
      try { await delay(250 * attempt, undefined, { signal }); } catch { throw compatibleFailure(undefined, signal, input); }
    }
  }
}
/** Also bounds custom/mock body streams that do not honor the fetch signal. */
export async function boundedBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  assertSignal(signal);
  if (!response.body) throw new ProviderError('AI response body is missing', 'invalid_response', false);
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new ProviderError('AI response exceeds size limit', 'invalid_response', false); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      assertSignal(signal); const { done, value } = await reader.read(); assertSignal(signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderError('AI response exceeds size limit', 'invalid_response', false);
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function boundedJson<T>(response: Response, maxBytes: number, signal: AbortSignal): Promise<T> {
  try { return JSON.parse(new TextDecoder().decode(await boundedBytes(response, maxBytes, signal))) as T; }
  catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('AI returned invalid JSON or exceeded response limits', 'invalid_response', false); }
}
