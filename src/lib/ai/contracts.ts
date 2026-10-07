import type { AiMessage } from './types';

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatRequest extends ProviderRequestOptions {
  messages: AiMessage[];
  temperature?: number;
  maxAttempts?: number;
  /**
   * 思考模式开关。缺省 = `disabled`，这是产品级约定：
   * 面向用户的那条对话通道必须关掉思考，保证首字延迟与风格稳定。
   *
   * 目前只有记忆整理器显式开启（结构化抽取，准确率优先，且跑在回复之后的
   * 后台任务里，不占用户的等待时间）。注意 DeepSeek 侧思考模式**默认是开启且
   * effort = high**，所以显式开启时一定要同时给 reasoningEffort。
   */
  thinking?: 'enabled' | 'disabled';
  /** 思考强度。DeepSeek 的取值与映射见 docs/guides/thinking_mode；缺省按供应商默认（high）。 */
  reasoningEffort?: 'low' | 'high' | 'max';
}

export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface StructuredChatRequest<T> extends ChatRequest {
  outputSchema: StructuredOutputSchema;
  parse: (value: unknown) => T;
}

export interface ChatCompletion {
  content: string;
  model: string;
  finishReason?: string;
  providerRequestId?: string;
  usage?: AiTokenUsage;
}

export interface StructuredChatCompletion<T> extends ChatCompletion {
  data: T;
}

export interface ChatProvider {
  complete(input: ChatRequest): Promise<ChatCompletion>;
  stream(input: ChatRequest): AsyncIterable<string>;
  completeStructured<T>(
    input: StructuredChatRequest<T>,
  ): Promise<StructuredChatCompletion<T>>;
}

export interface BinaryAsset {
  bytes: Uint8Array;
  mediaType: string;
}

export interface VisionInspectionRequest extends ProviderRequestOptions {
  image: BinaryAsset;
  policy?: string;
}

export interface VisionInspectionResult {
  safe: boolean;
  reason?: string;
  reasonCode?: string;
  providerRequestId?: string;
}

export interface VisionSafetyProvider {
  inspect(input: VisionInspectionRequest): Promise<VisionInspectionResult>;
}

export interface ImageGenerationRequest extends ProviderRequestOptions {
  prompt: string;
  referenceImages: BinaryAsset[];
  size?: string;
  aspectRatio?: string;
  maxAttempts?: number;
}

export interface GeneratedImage extends BinaryAsset {
  model: string;
  providerRequestId?: string;
  costUsd?: number;
  durationMs?: number;
}

export type ProviderErrorCode =
  | 'aborted'
  | 'bad_request'
  | 'invalid_response'
  | 'network'
  | 'policy_rejected'
  | 'rate_limited'
  | 'timeout'
  | 'unauthorized'
  | 'upstream_unavailable';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ImageProvider {
  generate(input: ImageGenerationRequest): Promise<GeneratedImage>;
}

export interface SpeechSynthesisRequest extends ProviderRequestOptions {
  text: string;
  voice: string;
  speed?: number;
  emotion?: string;
}

export interface GeneratedSpeech extends BinaryAsset {
  model: string;
  durationMs?: number;
  providerRequestId?: string;
}

export interface SpeechProvider {
  synthesize(input: SpeechSynthesisRequest): Promise<GeneratedSpeech>;
}

export interface PutObjectRequest extends BinaryAsset {
  key: string;
  cacheControl?: string;
}

export interface StoredObject {
  key: string;
  url: string;
}

export interface ObjectStore {
  put(input: PutObjectRequest): Promise<StoredObject>;
}
