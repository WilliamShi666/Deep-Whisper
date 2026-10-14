import assert from 'node:assert/strict';
import test from 'node:test';

import { getImageProvider } from '../src/lib/ai/image-provider';
import {
  OPENROUTER_GEMINI_IMAGE_MODEL,
  OPENROUTER_GPT_IMAGE_MODEL,
  OPENROUTER_IMAGE_MODEL,
  OpenRouterImageProvider,
} from '../src/lib/ai/providers/openrouter-image-provider';
import { getProviderConfig } from '../src/lib/config/runtime';

const IMAGE_ENV_NAMES = ['AI_IMAGE_PROVIDER', 'AI_IMAGE_MODEL'] as const;

async function withImageEnv(
  values: Partial<Record<(typeof IMAGE_ENV_NAMES)[number], string>>,
  run: () => void | Promise<void>,
): Promise<void> {
  const original = Object.fromEntries(
    IMAGE_ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of IMAGE_ENV_NAMES) delete process.env[name];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const name of IMAGE_ENV_NAMES) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// 2026-09-19：默认模型换成画质更可靠的 GPT Image 2。Gemini 分支仍保留，
// 改回 AI_IMAGE_MODEL 一行即可回滚。
test('image generation defaults to the locked OpenRouter GPT Image model', async () => {
  await withImageEnv({}, () => {
    const config = getProviderConfig().image;
    assert.deepEqual({provider:config.provider,model:config.model}, {
      provider: 'openrouter',
      model: OPENROUTER_GPT_IMAGE_MODEL,
    });
    assert.equal(OPENROUTER_IMAGE_MODEL, OPENROUTER_GPT_IMAGE_MODEL);
    assert(getImageProvider() instanceof OpenRouterImageProvider);
  });
});

test('the Gemini image model stays selectable as a rollback path', async () => {
  await withImageEnv(
    {
      AI_IMAGE_PROVIDER: 'openrouter',
      AI_IMAGE_MODEL: OPENROUTER_GEMINI_IMAGE_MODEL,
    },
    () => {
      assert.equal(
        getProviderConfig().image.model,
        OPENROUTER_GEMINI_IMAGE_MODEL,
      );
      assert(getImageProvider() instanceof OpenRouterImageProvider);
    },
  );
});

test('image registry accepts another configured OpenRouter image model', async () => {
  await withImageEnv(
    {
      AI_IMAGE_PROVIDER: 'openrouter',
      AI_IMAGE_MODEL: 'openai/gpt-image-1',
    },
    () => {
      assert(getImageProvider() instanceof OpenRouterImageProvider);
      assert.equal(getProviderConfig().image.model, 'openai/gpt-image-1');
    },
  );
});

test('legacy Ark cannot be selected after Gemini migration', async () => {
  await withImageEnv({ AI_IMAGE_PROVIDER: 'legacy-ark' }, () => {
    assert.throws(
      () => getProviderConfig(),
      /AI_IMAGE_PROVIDER must be one of: openrouter/,
    );
  });
});
