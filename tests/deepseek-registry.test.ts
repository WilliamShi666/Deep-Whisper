import assert from 'node:assert/strict';
import test from 'node:test';

import { getChatProvider } from '../src/lib/ai/chat-provider';
import {
  DEEPSEEK_VISION_MODEL,
  DeepSeekChatProvider,
} from '../src/lib/ai/providers/deepseek-chat-provider';
import { ChatVisionSafetyProvider } from '../src/lib/ai/providers/chat-vision-safety-provider';
import { getVisionSafetyProvider } from '../src/lib/ai/vision-safety-provider';
import { getProviderConfig } from '../src/lib/config/runtime';

const PROVIDER_ENV_NAMES = [
  'AI_CHAT_PROVIDER',
  'AI_CHAT_MODEL',
  'AI_VISION_PROVIDER',
  'AI_VISION_MODEL',
  'OPENROUTER_LLM_MODEL',
] as const;

async function withProviderEnv(
  values: Partial<Record<(typeof PROVIDER_ENV_NAMES)[number], string>>,
  run: () => void | Promise<void>,
): Promise<void> {
  const original = Object.fromEntries(
    PROVIDER_ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of PROVIDER_ENV_NAMES) delete process.env[name];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const name of PROVIDER_ENV_NAMES) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('chat and vision default independently to the DeepSeek vision model', async () => {
  await withProviderEnv({}, () => {
    const config = getProviderConfig();
    assert.deepEqual(config.chat, {
      provider: 'deepseek',
      model: DEEPSEEK_VISION_MODEL,
    });
    assert.deepEqual(config.visionSafety, {
      provider: 'deepseek',
      model: DEEPSEEK_VISION_MODEL,
    });
    assert(getChatProvider() instanceof DeepSeekChatProvider);
    assert(getVisionSafetyProvider() instanceof ChatVisionSafetyProvider);
  });
});

test('legacy OpenRouter LLM model environment cannot change the DeepSeek model', async () => {
  await withProviderEnv(
    { OPENROUTER_LLM_MODEL: 'minimax/minimax-m3' },
    () => {
      assert.equal(
        getProviderConfig().chat.model,
        DEEPSEEK_VISION_MODEL,
      );
    },
  );
});

test('DeepSeek registry rejects a non-Vision model instead of falling back', async () => {
  await withProviderEnv(
    {
      AI_CHAT_PROVIDER: 'deepseek',
      AI_CHAT_MODEL: 'deepseek-v4-flash',
    },
    () => {
      assert.throws(
        () => getChatProvider(),
        /must be deepseek-flash/,
      );
    },
  );
});

test('OpenRouter cannot be selected for chat or vision after migration', async () => {
  await withProviderEnv({ AI_CHAT_PROVIDER: 'openrouter' }, () => {
    assert.throws(
      () => getProviderConfig(),
      /AI_CHAT_PROVIDER must be one of: deepseek/,
    );
  });
  await withProviderEnv({ AI_VISION_PROVIDER: 'openrouter' }, () => {
    assert.throws(
      () => getProviderConfig(),
      /AI_VISION_PROVIDER must be one of: deepseek/,
    );
  });
});
