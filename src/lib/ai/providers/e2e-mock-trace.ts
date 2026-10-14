export type E2EImageFailureCode = 'policy_rejected' | 'network' | 'timeout' | 'rate_limited' | 'upstream_unavailable';

export interface E2EMockTraceConfig {
  personaDelayMs: number;
  chatChunkDelayMs: number;
  chatReplyPrefix: string;
  imageDelayMs: number;
  imageFailuresRemaining: number;
  imageFailureCode: E2EImageFailureCode;
  speechDelayMs: number;
  emailDelayMs: number;
}

export interface E2EMockImageCall {
  prompt: string;
  referenceSha256: string[];
  referenceByteLengths: number[];
  size?: string;
  aspectRatio?: string;
  outcome: 'success' | E2EImageFailureCode;
}

export interface E2EMockEmailCall {
  to: string;
  from: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface E2EMockTraceState {
  config: E2EMockTraceConfig;
  chatStreams: Array<{ latestUser: string | null; photoRequested: boolean }>;
  chatSystemPrompts: string[];
  structuredCalls: Array<{ schema: string; latestUser: string | null }>;
  imageCalls: E2EMockImageCall[];
  speechCalls: Array<{ text: string; voice: string }>;
  embeddingCalls: Array<{ count: number }>;
  emailCalls: E2EMockEmailCall[];
}

const TRACE_KEY = '__aiLoverE2EMockTrace';
type TraceGlobal = typeof globalThis & { [TRACE_KEY]?: E2EMockTraceState };

function emptyState(config: Partial<E2EMockTraceConfig> = {}): E2EMockTraceState {
  return {
    config: {
      personaDelayMs: config.personaDelayMs ?? 0,
      chatChunkDelayMs: config.chatChunkDelayMs ?? 0,
      chatReplyPrefix: config.chatReplyPrefix ?? '',
      imageDelayMs: config.imageDelayMs ?? 0,
      imageFailuresRemaining: config.imageFailuresRemaining ?? 0,
      imageFailureCode: config.imageFailureCode ?? 'policy_rejected',
      speechDelayMs: config.speechDelayMs ?? 0,
      emailDelayMs: config.emailDelayMs ?? 0,
    },
    chatStreams: [],
    chatSystemPrompts: [],
    structuredCalls: [],
    imageCalls: [],
    speechCalls: [],
    embeddingCalls: [],
    emailCalls: [],
  };
}

export function getE2EMockTrace(): E2EMockTraceState {
  const target = globalThis as TraceGlobal;
  target[TRACE_KEY] ??= emptyState();
  return target[TRACE_KEY];
}

export function resetE2EMockTrace(config: Partial<E2EMockTraceConfig> = {}): E2EMockTraceState {
  const target = globalThis as TraceGlobal;
  target[TRACE_KEY] = emptyState(config);
  return target[TRACE_KEY];
}

export function snapshotE2EMockTrace(): E2EMockTraceState {
  return structuredClone(getE2EMockTrace());
}

export function consumeE2EImageFailure(): boolean {
  const state = getE2EMockTrace();
  if (state.config.imageFailuresRemaining <= 0) return false;
  state.config.imageFailuresRemaining -= 1;
  return true;
}
