import type { VisionSafetyProvider } from '@/lib/ai';
import { getProviderConfig, isE2EMockProviderMode } from '@/lib/config/runtime';
import { DeepSeekChatProvider } from './providers/deepseek-chat-provider';
import { ChatVisionSafetyProvider } from './providers/chat-vision-safety-provider';
import { E2EMockVisionSafetyProvider } from './providers/e2e-mock-providers';

export function getVisionSafetyProvider(): VisionSafetyProvider {
  if (isE2EMockProviderMode()) return new E2EMockVisionSafetyProvider();
  const config = getProviderConfig().visionSafety;
  return new ChatVisionSafetyProvider(
    new DeepSeekChatProvider({ model: config.model }),
  );
}
