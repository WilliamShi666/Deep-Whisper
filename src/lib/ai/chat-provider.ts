import type { ChatProvider } from '@/lib/ai';
import { getProviderConfig, isE2EMockProviderMode } from '@/lib/config/runtime';
import { DeepSeekChatProvider } from './providers/deepseek-chat-provider';
import { E2EMockChatProvider } from './providers/e2e-mock-providers';

export function getChatProvider(): ChatProvider {
  if (isE2EMockProviderMode()) return new E2EMockChatProvider();
  const config = getProviderConfig().chat;
  return new DeepSeekChatProvider({ model: config.model });
}
