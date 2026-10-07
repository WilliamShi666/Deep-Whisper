import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageProvider,
} from '@/lib/ai/contracts';
import { ProviderError, type ProviderErrorCode } from '@/lib/ai/contracts';
import { readResponseJson } from '@/lib/ai/limited-response';

/**
 * 支持的图像模型。
 *
 * 两个模型走同一个 OpenRouter Unified `/images` 端点，但**生成参数并不相同**：
 * - Gemini Flash Lite Image：只接受 `resolution`（仅 `1K`），`n` 只能 1，参考图上限 14。
 * - GPT Image 2：**没有 `resolution` 参数**（改由 `quality` + `aspect_ratio` 决定出图尺寸），
 *   `n` 可到 10，参考图上限 16。
 *
 * 因此请求体必须按模型条件拼装：给 GPT 发 `resolution` 会被 OpenRouter 以 400 拒绝
 * （2026-09-19 实测同类错误：Gemini 收到不支持的参数同样 400）。
 * 上面两组上限都取自 `GET /api/v1/images/models/<slug>/endpoints` 的实时
 * `supported_parameters`，不照抄网页上的动态能力列表。
 */
import { OPENROUTER_GEMINI_IMAGE_MODEL, OPENROUTER_GPT_IMAGE_MODEL, OPENROUTER_IMAGE_MODELS, OPENROUTER_IMAGE_MODEL, type OpenRouterImageModel } from '../model-defaults';
export { OPENROUTER_GEMINI_IMAGE_MODEL, OPENROUTER_GPT_IMAGE_MODEL, OPENROUTER_IMAGE_MODELS, OPENROUTER_IMAGE_MODEL, type OpenRouterImageModel } from '../model-defaults';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

/** 应用层只用到 1:1；两个模型都支持，所以这里是两者的交集，保持不变。 */
const APP_ASPECT_RATIOS = new Set(['1:1']);

/**
 * GPT Image 2 的画质档位。默认用 low：成本最低，够验证保脸与服装一致性；
 * 出图质量需要更高时改这一个常量（medium/high 成本更高，失败不计费）。
 */
export const DEFAULT_GPT_QUALITY = 'low';
const GPT_QUALITY_VALUES = new Set(['auto', 'low', 'medium', 'high']);

const ALLOWED_OUTPUT_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const ALLOWED_REFERENCE_MEDIA_TYPES = new Set([
  ...ALLOWED_OUTPUT_MEDIA_TYPES,
  'image/gif',
]);

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

interface ProviderLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

interface OpenRouterImageProviderOptions {
  model: string;
  fetchImpl?: typeof fetch;
  env?: RuntimeEnvironment;
  logger?: ProviderLogger;
  maxOutputBytes?: number;
  retryDelayMs?: number;
  /** 仅 GPT Image 2 使用；Gemini 没有画质档位。 */
  quality?: string;
}

interface ImageApiError {
  code?: string | number;
  message?: string;
  error_type?: string;
  metadata?: Record<string, unknown>;
}

interface ImageApiResponse {
  id?: string;
  model?: string;
  data?: Array<{
    b64_json?: string;
    media_type?: string;
  }>;
  usage?: { cost?: number };
  error?: ImageApiError;
}

interface UpstreamErrorContext {
  redact: (value: string) => string;
  logger: ProviderLogger;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  const url = new URL(normalized);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OPENROUTER_BASE_URL must use http or https');
  }
  return normalized;
}

function requireApiKey(env: RuntimeEnvironment): string {
  const value = env.OPENROUTER_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: OPENROUTER_API_KEY');
  }
  return value;
}

function isSupportedModel(model: string): model is OpenRouterImageModel {
  return (OPENROUTER_IMAGE_MODELS as readonly string[]).includes(model);
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(
      normalized,
    )
  ) {
    throw new ProviderError(
      'OpenRouter Image returned malformed Base64',
      'invalid_response',
      false,
    );
  }
  return Buffer.from(normalized, 'base64');
}

// OpenRouter 的错误契约：内容政策/审核拒绝记为 403（error_type 为
// content_policy_violation / refusal / guardrail），参数问题才是 400。
// error_type 是规范字段，error.code 往往是数字状态码，人类可读原因只在 message 里，
// 所以三个来源都要看——只看 code 会把真实 403 误判成鉴权失败。
const POLICY_ERROR_TYPES = new Set([
  'content_policy_violation',
  'refusal',
  'guardrail',
  'moderation',
]);
const POLICY_MESSAGE_KEYWORDS = [
  'content policy',
  'content_policy',
  'moderation',
  'safety',
  'guardrail',
  'blocked',
  'flagged',
  'prohibited',
];

const MAX_DIAGNOSTIC_MESSAGE_CHARS = 300;
const REDACTED_KEY = '[redacted-key]';
const REDACTED_BLOB = '[redacted-blob]';
const REDACTED_PROMPT = '[redacted-prompt]';

function isPolicyRejection(error: ImageApiError | undefined): boolean {
  if (!error) return false;
  if (POLICY_ERROR_TYPES.has(String(error.error_type ?? '').toLowerCase())) {
    return true;
  }
  const message = String(error.message ?? '').toLowerCase();
  return POLICY_MESSAGE_KEYWORDS.some((keyword) => message.includes(keyword));
}

function classifyUpstreamError(
  status: number,
  error: ImageApiError | undefined,
): { code: ProviderErrorCode; retryable: boolean } {
  // 政策拒绝优先于 403 的「权限不足」语义：前者要走保守场景回退，不能当成鉴权失败。
  if (isPolicyRejection(error)) {
    return { code: 'policy_rejected', retryable: false };
  }
  if (status === 401 || status === 403) {
    return { code: 'unauthorized', retryable: false };
  }
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status === 408 || status === 504) return { code: 'timeout', retryable: true };
  if (status >= 500) return { code: 'upstream_unavailable', retryable: true };
  return { code: 'bad_request', retryable: false };
}

/**
 * 上游报错体可能回显请求内容，落日志前必须剔除 key、Base64 参考图与完整 prompt，
 * 再压缩空白并截断——否则诊断日志本身就成了凭据与用户内容的泄漏面。
 */
function createRedactor(
  apiKey: string | undefined,
  prompt: string,
): (value: string) => string {
  const trimmedPrompt = prompt.trim();
  return (value: string): string => {
    let output = value;
    if (apiKey) output = output.split(apiKey).join(REDACTED_KEY);
    output = output.replace(
      /data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi,
      `data:[redacted];base64,${REDACTED_BLOB}`,
    );
    output = output.replace(/[A-Za-z0-9+/]{64,}={0,2}/g, REDACTED_BLOB);
    if (trimmedPrompt.length >= 12) {
      output = output.split(trimmedPrompt).join(REDACTED_PROMPT);
    }
    const collapsed = output.replace(/\s+/g, ' ').trim();
    return collapsed.length > MAX_DIAGNOSTIC_MESSAGE_CHARS
      ? `${collapsed.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS)}…`
      : collapsed;
  };
}

/**
 * 没有这条日志时，上游拒绝只会呈现为一个裸状态码（曾因此无法定位真实 400 根因）。
 * 只记录分类与脱敏后的原因，不记录 prompt 全文、Base64 或凭据。
 */
function logUpstreamRejection(
  status: number,
  requestId: string | undefined,
  error: ImageApiError | undefined,
  context: UpstreamErrorContext,
): void {
  context.logger.warn('[image:provider] upstream rejected the request', {
    status,
    errorType: error?.error_type,
    errorCode: error?.code,
    message: error?.message ? context.redact(error.message) : undefined,
    providerRequestId: requestId,
  });
}

async function httpError(
  response: Response,
  context: UpstreamErrorContext,
): Promise<ProviderError> {
  let error: ImageApiError | undefined;
  try {
    const payload = await readResponseJson<ImageApiResponse>(response, 64 * 1024);
    error = payload.error;
  } catch {
    // 状态码仍足以分类；这一层只是没有可解析的报错体。
  }
  const classified = classifyUpstreamError(response.status, error);
  logUpstreamRejection(
    response.status,
    response.headers.get('x-request-id') ?? undefined,
    error,
    context,
  );
  return new ProviderError(
    `OpenRouter Image request failed with HTTP ${response.status}`,
    classified.code,
    classified.retryable,
  );
}

export class OpenRouterImageProvider implements ImageProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly env: RuntimeEnvironment;
  private readonly logger: ProviderLogger;
  private readonly baseUrl: string;
  private readonly maxOutputBytes: number;
  private readonly retryDelayMs: number;
  private readonly model: OpenRouterImageModel;
  private readonly quality: string;

  constructor(private readonly options: OpenRouterImageProviderOptions) {
    if (!isSupportedModel(options.model)) {
      throw new Error(
        `OpenRouter Image model must be one of: ${OPENROUTER_IMAGE_MODELS.join(', ')}`,
      );
    }
    this.model = options.model;
    this.quality = options.quality ?? DEFAULT_GPT_QUALITY;
    if (!GPT_QUALITY_VALUES.has(this.quality)) {
      throw new Error(
        `OpenRouter Image quality must be one of: ${[...GPT_QUALITY_VALUES].join(', ')}`,
      );
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.env = options.env ?? process.env;
    this.logger = options.logger ?? console;
    this.baseUrl = normalizeBaseUrl(
      this.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL,
    );
    this.maxOutputBytes =
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  async generate(input: ImageGenerationRequest): Promise<GeneratedImage> {
    // `size` 是应用层的分辨率档位：Gemini 用它填 `resolution`（且只支持 1K）；
    // GPT Image 2 没有该参数，出图尺寸由 quality 与 aspect_ratio 决定，因此忽略它。
    const resolution = input.size ?? '1K';
    if (this.model === OPENROUTER_GEMINI_IMAGE_MODEL && resolution !== '1K') {
      throw new ProviderError(
        'Gemini Flash Lite Image only supports 1K resolution',
        'bad_request',
        false,
      );
    }
    const aspectRatio = input.aspectRatio ?? '1:1';
    if (!APP_ASPECT_RATIOS.has(aspectRatio)) {
      throw new ProviderError(
        'OpenRouter Image received an unsupported aspect ratio',
        'bad_request',
        false,
      );
    }
    if (!input.prompt.trim()) {
      throw new ProviderError(
        'OpenRouter Image requires a prompt',
        'bad_request',
        false,
      );
    }
    for (const reference of input.referenceImages) {
      if (!ALLOWED_REFERENCE_MEDIA_TYPES.has(reference.mediaType)) {
        throw new ProviderError(
          'OpenRouter Image received an unsupported reference media type',
          'bad_request',
          false,
        );
      }
      if (!reference.bytes.length || reference.bytes.length > MAX_REFERENCE_BYTES) {
        throw new ProviderError(
          'OpenRouter Image reference exceeds the maximum size',
          'bad_request',
          false,
        );
      }
    }

    // 凭据在进入重试循环前解析：否则缺失 key 会被下面的 catch 归类成可重试的 network 错误。
    const apiKey = requireApiKey(this.env);
    const upstreamContext: UpstreamErrorContext = {
      redact: createRedactor(apiKey, input.prompt),
      logger: this.logger,
    };

    const startedAt = Date.now();

    // 按模型拼装：给 GPT 发 `resolution` 会被上游以 400 拒绝（该模型无此参数）。
    const requestBody = JSON.stringify({
      model: this.model,
      prompt: input.prompt,
      n: 1,
      ...(this.model === OPENROUTER_GPT_IMAGE_MODEL
        ? { quality: this.quality }
        : { resolution }),
      aspect_ratio: aspectRatio,
      input_references: input.referenceImages.map((reference) => ({
        type: 'image_url',
        image_url: {
          url: `data:${reference.mediaType};base64,${Buffer.from(reference.bytes).toString('base64')}`,
        },
      })),
    });
    const maxAttempts = Math.max(1, input.maxAttempts ?? 1);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response | undefined;
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = input.signal
          ? AbortSignal.any([input.signal, timeoutSignal])
          : timeoutSignal;
        response = await this.fetchImpl(`${this.baseUrl}/images`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: requestBody,
          signal,
        });
        if (response.ok) break;
        throw await httpError(response, upstreamContext);
      } catch (error) {
        if (input.signal?.aborted) {
          throw new ProviderError(
            'OpenRouter Image request aborted',
            'aborted',
            false,
          );
        }
        if (error instanceof ProviderError) lastError = error;
        else if (error instanceof DOMException && error.name === 'TimeoutError') {
          lastError = new ProviderError(
            'OpenRouter Image request timed out',
            'timeout',
            true,
          );
        } else {
          lastError = new ProviderError(
            'OpenRouter Image network request failed',
            'network',
            true,
          );
        }
        if (!lastError.retryable || attempt === maxAttempts) throw lastError;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.retryDelayMs * attempt),
      );
    }

    if (!response?.ok) {
      throw lastError ??
        new ProviderError(
          'OpenRouter Image request failed',
          'network',
          true,
        );
    }
    const maxEncodedLength = Math.ceil(this.maxOutputBytes / 3) * 4;
    const payload = await readResponseJson<ImageApiResponse>(response, maxEncodedLength + 1024 * 1024);
    if (payload.error) {
      // OpenRouter 也可能用 HTTP 200 承载错误体，同样要分类并留痕。
      const classified = classifyUpstreamError(response.status, payload.error);
      logUpstreamRejection(
        response.status,
        payload.id || response.headers.get('x-request-id') || undefined,
        payload.error,
        upstreamContext,
      );
      throw new ProviderError(
        'OpenRouter Image returned an error response',
        classified.code,
        classified.retryable,
      );
    }
    if (payload.model && payload.model !== this.model) {
      throw new ProviderError(
        'OpenRouter Image returned an unexpected model',
        'invalid_response',
        false,
      );
    }
    const image = payload.data?.[0];
    if (!image?.b64_json) {
      throw new ProviderError(
        'OpenRouter Image returned an empty image response',
        'invalid_response',
        false,
      );
    }
    if (!image.media_type || !ALLOWED_OUTPUT_MEDIA_TYPES.has(image.media_type)) {
      throw new ProviderError(
        'OpenRouter Image returned an unsupported image media type',
        'invalid_response',
        false,
      );
    }
    if (image.b64_json.length > maxEncodedLength) {
      throw new ProviderError('OpenRouter Image output exceeds the maximum size', 'invalid_response', false);
    }
    const bytes = decodeBase64(image.b64_json);
    if (!bytes.length || bytes.length > this.maxOutputBytes) {
      throw new ProviderError(
        'OpenRouter Image output exceeds the maximum size',
        'invalid_response',
        false,
      );
    }
    return {
      bytes,
      mediaType: image.media_type,
      model: payload.model ?? this.model,
      providerRequestId:
        payload.id || response.headers.get('x-request-id') || undefined,
      costUsd:
        typeof payload.usage?.cost === 'number'
          ? payload.usage.cost
          : undefined,
      durationMs: Date.now() - startedAt,
    };
  }
}
