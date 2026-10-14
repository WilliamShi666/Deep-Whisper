import type { ImageProvider } from '@/lib/ai';
import { getProviderConfig, isE2EMockProviderMode } from '@/lib/config/runtime';
import { OpenRouterImageProvider } from './providers/openrouter-image-provider';
import { OpenAICompatibleImageProvider } from './providers/openai-compatible-image-provider';
import { E2EMockImageProvider } from './providers/e2e-mock-providers';
export function getImageProvider(): ImageProvider {
  if (isE2EMockProviderMode()) return new E2EMockImageProvider();
  const config = getProviderConfig().image;
  return config.provider === 'openai-compatible' ? new OpenAICompatibleImageProvider(config) : new OpenRouterImageProvider(config);
}
