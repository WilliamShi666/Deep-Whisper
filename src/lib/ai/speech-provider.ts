import type { SpeechProvider } from '@/lib/ai';
import { getPersonalConfig, isE2EMockProviderMode, readConfiguredValue, type RuntimeEnvironment } from '@/lib/config/runtime';
import { E2EMockSpeechProvider } from './providers/e2e-mock-providers';
import { FallbackSpeechProvider } from './providers/fallback-speech-provider';
import { OpenRouterGeminiSpeechProvider } from './providers/openrouter-gemini-speech-provider';
import { QwenAudioSpeechProvider } from './providers/qwen-audio-speech-provider';
import { OpenAICompatibleSpeechProvider } from './providers/openai-compatible-speech-provider';
export function getSpeechProvider(env: RuntimeEnvironment = process.env): SpeechProvider {
  if (isE2EMockProviderMode(env)) return new E2EMockSpeechProvider();
  const config = getPersonalConfig(env, { strict: false });
  if (!config.capabilities.speech.enabled) throw new Error('FEATURE_NOT_CONFIGURED: Speech provider is not configured');
  const speech = config.providers.speech;
  if (speech.provider === 'openai-compatible') return new OpenAICompatibleSpeechProvider(speech);
  if (speech.provider === 'openrouter-gemini') return new OpenRouterGeminiSpeechProvider(env);
  const qwen = new QwenAudioSpeechProvider(env);
  // The fallback owns its legacy connection; primary TTS overrides cannot leak into it.
  const fallbackEnv = { ...env, AI_TTS_PROVIDER: 'openrouter-gemini', AI_TTS_MODEL: undefined, AI_TTS_BASE_URL: undefined, AI_TTS_API_KEY: undefined };
  return readConfiguredValue(env, 'OPENROUTER_API_KEY') ? new FallbackSpeechProvider(qwen, new OpenRouterGeminiSpeechProvider(fallbackEnv)) : qwen;
}
