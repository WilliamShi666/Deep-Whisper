import type { ChatProvider } from '@/lib/ai';
import { getProviderConfig, isE2EMockProviderMode } from '@/lib/config/runtime';
import { DeepSeekChatProvider } from './providers/deepseek-chat-provider';
import { OpenAICompatibleChatProvider } from './providers/openai-compatible-chat-provider';
import { E2EMockChatProvider } from './providers/e2e-mock-providers';
export function getChatProvider(): ChatProvider {
  if (isE2EMockProviderMode()) return new E2EMockChatProvider();
  const config = getProviderConfig().chat;
  return config.provider === 'openai-compatible' ? new OpenAICompatibleChatProvider(config) : new DeepSeekChatProvider(config);
}
