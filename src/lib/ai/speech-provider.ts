import type {SpeechProvider} from '@/lib/ai';
import {getPersonalConfig,isE2EMockProviderMode,readConfiguredValue,type RuntimeEnvironment} from '@/lib/config/runtime';
import {E2EMockSpeechProvider} from './providers/e2e-mock-providers';
import {FallbackSpeechProvider} from './providers/fallback-speech-provider';
import {OpenRouterGeminiSpeechProvider} from './providers/openrouter-gemini-speech-provider';
import {QwenAudioSpeechProvider} from './providers/qwen-audio-speech-provider';
export function getSpeechProvider(env:RuntimeEnvironment=process.env):SpeechProvider {
 if(isE2EMockProviderMode(env)) return new E2EMockSpeechProvider();
 const config=getPersonalConfig(env,{strict:false});
 if(!config.capabilities.speech.enabled) throw new Error('FEATURE_NOT_CONFIGURED: Speech provider is not configured');
 if(config.providers.speech.provider==='openrouter-gemini') return new OpenRouterGeminiSpeechProvider(env);
 const qwen=new QwenAudioSpeechProvider(env);
 return readConfiguredValue(env,'OPENROUTER_API_KEY')?new FallbackSpeechProvider(qwen,new OpenRouterGeminiSpeechProvider(env)):qwen;
}
