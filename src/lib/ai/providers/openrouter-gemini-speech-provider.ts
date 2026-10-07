import type {
  GeneratedSpeech,
  SpeechProvider,
  SpeechSynthesisRequest,
} from '@/lib/ai';
import { getSpeechModelFor } from '@/lib/config/runtime';
import { geminiFallbackVoiceFor } from '@/lib/characters';
import { toPublicVoiceId } from '@/lib/ai/qwen-voice-map';
import { readResponseBytes, readResponseJson } from '@/lib/ai/limited-response';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export const OPENROUTER_GEMINI_TTS_MODEL =
  'google/gemini-3.1-flash-tts-preview' as const;

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TEXT_LENGTH = 10_000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/pcm']);
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

interface OpenRouterErrorPayload {
  error?: { code?: string | number };
}

/**
 * 项目内部 voice key → Gemini TTS 音色：显式映射，绝不把旧供应商 voice ID 直接发送。
 *
 * - 30 项是 Gemini 的 30 个预置音色（key 与上游音色名一致，1:1）；
 * - 11 项是历史平台的 voice id 别名，保证老 companion 数据继续用同一位音色发声，
 *   不因音色表扩容而被静默换声。
 */
const GEMINI_VOICE_BY_PROJECT_VOICE: Readonly<Record<string, string>> = {
  Zephyr: 'Zephyr',
  Puck: 'Puck',
  Charon: 'Charon',
  Kore: 'Kore',
  Fenrir: 'Fenrir',
  Leda: 'Leda',
  Orus: 'Orus',
  Aoede: 'Aoede',
  Callirrhoe: 'Callirrhoe',
  Autonoe: 'Autonoe',
  Enceladus: 'Enceladus',
  Iapetus: 'Iapetus',
  Umbriel: 'Umbriel',
  Algieba: 'Algieba',
  Despina: 'Despina',
  Erinome: 'Erinome',
  Algenib: 'Algenib',
  Rasalgethi: 'Rasalgethi',
  Laomedeia: 'Laomedeia',
  Achernar: 'Achernar',
  Alnilam: 'Alnilam',
  Schedar: 'Schedar',
  Gacrux: 'Gacrux',
  Pulcherrima: 'Pulcherrima',
  Achird: 'Achird',
  Zubenelgenubi: 'Zubenelgenubi',
  Vindemiatrix: 'Vindemiatrix',
  Sadachbia: 'Sadachbia',
  Sadaltager: 'Sadaltager',
  Sulafat: 'Sulafat',

  // 历史平台 voice id 别名（旧 companion.voice_id / 旧数据迁移）
  'Chinese (Mandarin)_Gentle_Senior': 'Vindemiatrix',
  'qiaopi_mengmei': 'Laomedeia',
  'female-tianmei': 'Sulafat',
  'danya_xuejie': 'Achernar',
  'tianxin_xiaoling': 'Leda',
  'female-yujie': 'Kore',
  'Chinese (Mandarin)_Unrestrained_Young_Man': 'Fenrir',
  'lengdan_xiongzhang': 'Algenib',
  'Chinese (Mandarin)_Gentleman': 'Gacrux',
  'Chinese (Mandarin)_Lyrical_Voice': 'Algieba',
  'chunzhen_xuedi': 'Puck',
};

function requireApiKey(env: RuntimeEnvironment): string {
  const value = env.OPENROUTER_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: OPENROUTER_API_KEY');
  }
  return value;
}

function baseUrl(env: RuntimeEnvironment): string {
  const value = env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OPENROUTER_BASE_URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function requestSignal(input: SpeechSynthesisRequest): AbortSignal {
  const timeout = AbortSignal.timeout(input.timeoutMs ?? 120_000);
  return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
}

function networkFailureMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    /^[A-Z0-9_]+$/.test(cause.code)
      ? cause.code
      : undefined;
  return `OpenRouter Gemini TTS network failure${code ? ` (${code})` : ''}`;
}

async function requestFailureMessage(response: Response): Promise<string> {
  let code: string | undefined;
  try {
    const payload = await readResponseJson<OpenRouterErrorPayload>(response, 64 * 1024);
    const candidate = String(payload.error?.code ?? '');
    if (/^[a-z\d_-]{1,64}$/i.test(candidate)) code = candidate;
  } catch {
    // HTTP status is sufficient; never include an upstream response body.
  }
  return `OpenRouter Gemini TTS request failed (${response.status}${code ? `; code=${code}` : ''})`;
}

function pcmToWav(pcm: Uint8Array): Uint8Array {
  if (pcm.length % (PCM_BITS_PER_SAMPLE / 8) !== 0) {
    throw new Error('OpenRouter Gemini TTS returned invalid PCM audio data');
  }
  const header = Buffer.alloc(44);
  const byteRate = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

export class OpenRouterGeminiSpeechProvider implements SpeechProvider {
  constructor(
    private readonly env: RuntimeEnvironment = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(input: SpeechSynthesisRequest): Promise<GeneratedSpeech> {
    const text = input.text.trim();
    if (!text) throw new Error('Speech synthesis text is empty');
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Speech synthesis text is too long');

    const model = getSpeechModelFor('openrouter-gemini', this.env) || OPENROUTER_GEMINI_TTS_MODEL;
    const publicVoice = toPublicVoiceId(input.voice);
    const voice = GEMINI_VOICE_BY_PROJECT_VOICE[input.voice]
      ?? (publicVoice ? geminiFallbackVoiceFor(publicVoice) : undefined);
    if (!voice) {
      throw new Error(`Gemini TTS voice mapping is not configured for "${input.voice}"`);
    }
    const endpoint = `${baseUrl(this.env)}/audio/speech`;
    const apiKey = requireApiKey(this.env);

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
          input: text,
          voice,
          response_format: 'pcm',
        }),
        signal: requestSignal(input),
      });
    } catch (error) {
      throw new Error(networkFailureMessage(error));
    }
    if (!response.ok) {
      throw new Error(await requestFailureMessage(response));
    }

    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (!mediaType || !AUDIO_TYPES.has(mediaType)) {
      await response.body?.cancel();
      throw new Error('OpenRouter Gemini TTS returned an unsupported audio format');
    }
    const bytes = await readResponseBytes(response, MAX_AUDIO_BYTES);
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) {
      throw new Error('OpenRouter Gemini TTS returned invalid audio data');
    }

    const output = mediaType === 'audio/pcm' ? pcmToWav(bytes) : bytes;
    return {
      bytes: output,
      mediaType: mediaType === 'audio/pcm' ? 'audio/wav' : mediaType,
      model,
      providerRequestId: response.headers.get('x-generation-id') || undefined,
    };
  }
}
