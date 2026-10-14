import type {
  GeneratedSpeech,
  SpeechProvider,
  SpeechSynthesisRequest,
} from '@/lib/ai';
import { QWEN_TTS_MODEL, isQwenVoiceId } from '@/lib/ai/qwen-voices';
import { getSpeechModelFor, normalizeAiBaseUrl } from '@/lib/config/runtime';
import { toPublicVoiceId, upstreamVoiceIdFor } from '@/lib/ai/qwen-voice-map';
import { readResponseBytes, readResponseJson } from '@/lib/ai/limited-response';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * qwen-audio-3.1-tts-flash 适配器（千问AI平台 / MaaS 非实时语音合成）。
 *
 * 与 OpenRouter Gemini 适配器的**关键差别**：上游不返回音频字节，而是返回一个
 * **24 小时有效的临时 OSS 链接**。下载时升级到 HTTPS；契约要求 provider 不得把临时 URL
 * 交给 route，所以这里必须在同一个请求内完成「合成 → 下载 → 返回 bytes」两跳。
 *
 * 由此产生两条硬约束，测试里都有对应用例：
 * - 临时链接是**上游响应驱动的 SSRF 入口**：只走 HTTPS 白名单主机且不跟随重定向；
 * - 下载失败/超限/非音频一律 reject，绝不回退成「把 URL 交出去」。
 */
export const QWEN_AUDIO_TTS_MODEL = QWEN_TTS_MODEL;

const DEFAULT_BASE_URL = 'https://maas.qianwenaiapi.com/api/v1';
const DEFAULT_AUDIO_HOST_SUFFIX = '.aliyuncs.com';
const SYNTHESIS_PATH = '/services/audio/tts/SpeechSynthesizer';
const MAX_TEXT_LENGTH = 10_000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_SAMPLE_RATE = 24_000;
const AUDIO_FORMAT = 'mp3';
const DEFAULT_TIMEOUT_MS = 60_000;

interface QwenSynthesisPayload {
  request_id?: string;
  code?: string;
  message?: string;
  output?: { finish_reason?: string; audio?: { url?: string } };
}

function requireApiKey(env: RuntimeEnvironment): string {
  const value = env.AI_TTS_API_KEY?.trim() || env.DASHSCOPE_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: DASHSCOPE_API_KEY');
  }
  return value;
}

function baseUrl(env: RuntimeEnvironment): string {
  return normalizeAiBaseUrl(env.AI_TTS_BASE_URL?.trim() || env.DASHSCOPE_TTS_BASE_URL?.trim() || DEFAULT_BASE_URL, 'AI_TTS_BASE_URL / DASHSCOPE_TTS_BASE_URL');
}

function allowedAudioHostSuffix(env: RuntimeEnvironment): string {
  const value = env.DASHSCOPE_AUDIO_HOST_SUFFIX?.trim() || DEFAULT_AUDIO_HOST_SUFFIX;
  return value.startsWith('.') ? value : '.' + value;
}

/**
 * 校验上游给的临时音频链接。要求：HTTPS、无凭据、默认 TLS 端口与精确主机后缀。
 * 「以 .evil.test 结尾」这类绕过由 hostname 的精确后缀比对挡住（不是 includes）。
 */
function assertTrustedAudioUrl(rawUrl: string, env: RuntimeEnvironment): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Qwen TTS returned an invalid audio url');
  }
  // Qwen sometimes supplies an HTTP OSS link; use the same host/path over TLS.
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Qwen TTS audio url must use HTTPS');
  }
  const suffix = allowedAudioHostSuffix(env);
  const hostname = url.hostname.toLowerCase();
  const trusted = hostname === suffix.slice(1) || hostname.endsWith(suffix);
  if (!trusted) {
    throw new Error('Qwen TTS audio url host is not in the reviewed allowlist (audio host not allowed)');
  }
  return url;
}

function requestSignal(input: SpeechSynthesisRequest, timeoutMs?: number): AbortSignal {
  const timeout = AbortSignal.timeout(input.timeoutMs ?? timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
}

function networkFailureMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      && /^[A-Z0-9_]+$/.test(cause.code)
      ? cause.code
      : undefined;
  return `Qwen TTS network failure${code ? ` (${code})` : ''}`;
}

/**
 * 只暴露上游的机器可读 `code`；message 正文可能含内部标识，绝不外传。
 */
async function synthesisFailureMessage(response: Response): Promise<string> {
  let code: string | undefined;
  try {
    const payload = await readResponseJson<QwenSynthesisPayload>(response, 64 * 1024);
    const candidate = String(payload.code ?? '');
    if (/^[A-Za-z\d_-]{1,64}$/.test(candidate)) code = candidate;
  } catch {
    // HTTP status is sufficient; never include an upstream response body.
  }
  return `Qwen TTS request failed (${response.status}${code ? `; code=${code}` : ''})`;
}

function extensionForMediaType(mediaType: string): string {
  return mediaType.includes('mpeg') || mediaType.includes('mp3') ? 'mp3' : 'audio';
}

export class QwenAudioSpeechProvider implements SpeechProvider {
  constructor(
    private readonly env: RuntimeEnvironment = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(input: SpeechSynthesisRequest): Promise<GeneratedSpeech> {
    const text = input.text.trim();
    if (!text) throw new Error('Speech synthesis text is empty');
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Speech synthesis text is too long');

    const model = getSpeechModelFor('qwen-audio', this.env) || QWEN_AUDIO_TTS_MODEL;
    // 白名单校验必须排在取 key 之前：非法音色不能因为缺 key 而泄露配置状态，
    // 更要紧的是**绝不能发出付费请求**（测试断言 unmapped voice ⇒ 0 次网络调用）。
    const publicVoice = toPublicVoiceId(input.voice);
    const voice = publicVoice ? upstreamVoiceIdFor(publicVoice) : input.voice;
    if (!isQwenVoiceId(voice)) {
      throw new Error(`Qwen TTS voice is not in the reviewed catalog: "${input.voice}"`);
    }

    const endpoint = `${baseUrl(this.env)}${SYNTHESIS_PATH}`;
    const apiKey = requireApiKey(this.env);
    const signal = requestSignal(input);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: {
            text,
            voice,
            format: AUDIO_FORMAT,
            sample_rate: AUDIO_SAMPLE_RATE,
          },
        }),
        signal,
      });
    } catch (error) {
      throw new Error(networkFailureMessage(error));
    }
    if (!response.ok) {
      throw new Error(await synthesisFailureMessage(response));
    }

    let payload: QwenSynthesisPayload;
    try {
      payload = await readResponseJson<QwenSynthesisPayload>(response, 64 * 1024);
    } catch {
      throw new Error('Qwen TTS returned an unreadable response');
    }
    const temporaryUrl = payload.output?.audio?.url?.trim();
    if (!temporaryUrl) throw new Error('Qwen TTS returned no audio url');

    const audioUrl = assertTrustedAudioUrl(temporaryUrl, this.env);

    let audioResponse: Response;
    try {
      audioResponse = await this.fetchImpl(audioUrl.toString(), { method: 'GET', signal, redirect: 'error' });
    } catch (error) {
      throw new Error(networkFailureMessage(error));
    }
    if (!audioResponse.ok) {
      await audioResponse.body?.cancel();
      throw new Error(`Qwen TTS audio download failed (${audioResponse.status})`);
    }

    const declaredType = audioResponse.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
    if (!declaredType.startsWith('audio/')) {
      await audioResponse.body?.cancel();
      throw new Error('Qwen TTS returned an unsupported audio format');
    }
    const bytes = await readResponseBytes(audioResponse, MAX_AUDIO_BYTES);
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) {
      throw new Error('Qwen TTS returned invalid audio data');
    }

    return {
      bytes,
      mediaType: declaredType || `audio/${extensionForMediaType(declaredType)}`,
      model,
      providerRequestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
    };
  }
}
