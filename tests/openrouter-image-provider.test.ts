import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GPT_QUALITY,
  OPENROUTER_GEMINI_IMAGE_MODEL,
  OPENROUTER_GPT_IMAGE_MODEL,
  OPENROUTER_IMAGE_MODEL,
  OpenRouterImageProvider,
} from '../src/lib/ai/providers/openrouter-image-provider';
import { shouldRetryWithSafePhotoScene } from '../src/lib/ai/image-generation-policy';

function asFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

interface CapturedLog {
  message: string;
  context: Record<string, unknown>;
}

const silentLogger = { warn: () => {} };

function providerWith(
  fetchImpl: typeof fetch,
  logger: { warn(message: string, context: Record<string, unknown>): void } =
    silentLogger,
): OpenRouterImageProvider {
  return new OpenRouterImageProvider({
    model: OPENROUTER_IMAGE_MODEL,
    fetchImpl,
    logger,
    env: {
      OPENROUTER_API_KEY: 'contract-test-key',
      OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1/',
    },
  });
}

test('OpenRouter Image uses Unified /images with reference-image editing and returns bytes', async () => {
  let requestUrl = '';
  let requestBody: Record<string, unknown> | undefined;
  const provider = providerWith(
    asFetch(async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(
        {
          id: 'image-request-1',
          model: OPENROUTER_IMAGE_MODEL,
          data: [
            {
              b64_json: Buffer.from([1, 2, 3, 4]).toString('base64'),
              media_type: 'image/png',
            },
          ],
          usage: { cost: 0.0336 },
        },
        { headers: { 'x-request-id': 'header-request-id' } },
      );
    }),
  );

  const result = await provider.generate({
    prompt: 'portrait in warm light',
    referenceImages: [
      { bytes: new Uint8Array([9, 8, 7]), mediaType: 'image/jpeg' },
    ],
    size: '1K',
    aspectRatio: '1:1',
  });

  assert.equal(requestUrl, 'https://openrouter.test/api/v1/images');
  assert.equal(requestBody?.model, OPENROUTER_GPT_IMAGE_MODEL);
  assert.equal(OPENROUTER_IMAGE_MODEL, OPENROUTER_GPT_IMAGE_MODEL);
  // GPT Image 2 没有 resolution 参数，改由 quality 决定出图档位；发 resolution 会被上游 400。
  assert.equal(requestBody?.resolution, undefined);
  assert.equal(requestBody?.quality, DEFAULT_GPT_QUALITY);
  assert.equal(requestBody?.aspect_ratio, '1:1');
  assert.equal(requestBody?.n, 1);
  assert.deepEqual(requestBody?.input_references, [
    {
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,CQgH' },
    },
  ]);
  assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
  assert.equal(result.mediaType, 'image/png');
  assert.equal(result.model, OPENROUTER_IMAGE_MODEL);
  assert.equal(result.providerRequestId, 'image-request-1');
  assert.equal(result.costUsd, 0.0336);
  assert.equal(typeof result.durationMs, 'number');
});

test('OpenRouter Image rejects malformed Base64 instead of returning corrupt media', async () => {
  const provider = providerWith(
    asFetch(async () =>
      Response.json({
        model: OPENROUTER_IMAGE_MODEL,
        data: [{ b64_json: '%%%not-base64%%%', media_type: 'image/png' }],
      }),
    ),
  );

  await assert.rejects(
    provider.generate({ prompt: 'portrait', referenceImages: [] }),
    /malformed Base64/,
  );
});

test('OpenRouter Image rejects empty output, unsupported MIME, and oversized bytes', async (t) => {
  await t.test('empty data', async () => {
    const provider = providerWith(
      asFetch(async () =>
        Response.json({ model: OPENROUTER_IMAGE_MODEL, data: [] }),
      ),
    );
    await assert.rejects(
      provider.generate({ prompt: 'portrait', referenceImages: [] }),
      /empty image response/,
    );
  });

  await t.test('unsupported MIME', async () => {
    const provider = providerWith(
      asFetch(async () =>
        Response.json({
          model: OPENROUTER_IMAGE_MODEL,
          data: [{ b64_json: 'AQID', media_type: 'image/svg+xml' }],
        }),
      ),
    );
    await assert.rejects(
      provider.generate({ prompt: 'portrait', referenceImages: [] }),
      /unsupported image media type/,
    );
  });

  await t.test('oversized output', async () => {
    const provider = new OpenRouterImageProvider({
      model: OPENROUTER_IMAGE_MODEL,
      maxOutputBytes: 2,
      fetchImpl: asFetch(async () =>
        Response.json({
          model: OPENROUTER_IMAGE_MODEL,
          data: [{ b64_json: 'AQID', media_type: 'image/png' }],
        }),
      ),
      env: { OPENROUTER_API_KEY: 'contract-test-key' },
    });
    await assert.rejects(
      provider.generate({ prompt: 'portrait', referenceImages: [] }),
      /exceeds the maximum size/,
    );
  });
});

test('OpenRouter Image rejects malformed model IDs, resolution, and aspect-ratio drift', async () => {
  assert.throws(
    () =>
      new OpenRouterImageProvider({
        model: 'invalid model',
        fetchImpl: asFetch(async () => new Response()),
        env: { OPENROUTER_API_KEY: 'contract-test-key' },
      }),
    /AI_IMAGE_MODEL/,
  );

  // Gemini 只支持 1K：给它别的档位必须本地就拒绝，不发请求。
  const gemini = new OpenRouterImageProvider({
    model: OPENROUTER_GEMINI_IMAGE_MODEL,
    fetchImpl: asFetch(async () => new Response()),
    env: { OPENROUTER_API_KEY: 'contract-test-key' },
  });
  await assert.rejects(
    gemini.generate({
      prompt: 'portrait',
      referenceImages: [],
      size: '2K',
    }),
    /only supports 1K/,
  );

  // GPT Image 2 没有 resolution 参数：应用层仍可传 size，但必须被忽略而不是透传。
  let geminiBody: Record<string, unknown> | undefined;
  const geminiOk = new OpenRouterImageProvider({
    model: OPENROUTER_GEMINI_IMAGE_MODEL,
    fetchImpl: asFetch(async (_input, init) => {
      geminiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        model: OPENROUTER_GEMINI_IMAGE_MODEL,
        data: [{ b64_json: 'AQID', media_type: 'image/png' }],
      });
    }),
    env: { OPENROUTER_API_KEY: 'contract-test-key' },
  });
  await geminiOk.generate({
    prompt: 'portrait',
    referenceImages: [],
    size: '1K',
    aspectRatio: '1:1',
  });
  assert.equal(geminiBody?.resolution, '1K');
  assert.equal(geminiBody?.quality, undefined);

  await assert.rejects(
    providerWith(asFetch(async () => new Response())).generate({
      prompt: 'portrait',
      referenceImages: [],
      aspectRatio: '8:1',
    }),
    /unsupported aspect ratio/,
  );
});

test('OpenRouter Image classifies retryable and non-retryable errors without leaking upstream text', async () => {
  let attempts = 0;
  const logs: CapturedLog[] = [];
  const provider = providerWith(
    asFetch(async () => {
      attempts += 1;
      return Response.json(
        { error: { message: 'contract-test-key and private prompt' } },
        { status: 429 },
      );
    }),
    { warn: (message, context) => logs.push({ message, context }) },
  );

  await assert.rejects(
    provider.generate({
      prompt: 'private prompt',
      referenceImages: [],
      maxAttempts: 1,
    }),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message.includes('contract-test-key'), false);
      assert.equal(error.message.includes('private prompt'), false);
      assert.equal(
        (error as Error & { retryable?: boolean }).retryable,
        true,
      );
      return true;
    },
  );
  assert.equal(attempts, 1);
  // 诊断日志必须留痕，但同样不得回显凭据与 prompt 原文。
  assert.equal(logs.length, 1);
  assert.equal(logs[0].context.status, 429);
  assert.equal(logs[0].context.message, '[redacted-key] and [redacted-prompt]');
});

// OpenRouter 的内容政策拒绝是 403（error_type 为 content_policy_violation），不是 400。
// 修好分类后这条路径必须真正产出 policy_rejected，才能让 /api/photo 的保守场景回退生效
// ——此前它是一段永远走不到的死代码。
test('OpenRouter Image classifies an upstream content-policy rejection as policy_rejected', async () => {
  const logs: CapturedLog[] = [];
  const provider = providerWith(
    asFetch(async () =>
      Response.json(
        {
          error: {
            code: 403,
            error_type: 'content_policy_violation',
            message: 'Image generation was blocked by the provider content policy',
          },
        },
        { status: 403 },
      ),
    ),
    { warn: (message, context) => logs.push({ message, context }) },
  );

  await assert.rejects(
    provider.generate({
      prompt: '场景：穿着浅色蕾丝内衣站在卧室暖灯下',
      referenceImages: [],
      maxAttempts: 1,
    }),
    (error: unknown) => {
      assert(error instanceof Error);
      const providerError = error as Error & {
        code?: string;
        retryable?: boolean;
      };
      assert.equal(providerError.code, 'policy_rejected');
      assert.equal(providerError.retryable, false);
      // 关键回归：必须触发 route 的保守场景回退，而不是被当成鉴权失败。
      assert.equal(shouldRetryWithSafePhotoScene(error, true), true);
      return true;
    },
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].context.errorType, 'content_policy_violation');
});

test('OpenRouter Image keeps a plain 403 unauthorized and never retries a 400', async (t) => {
  await t.test('plain 403 stays unauthorized', async () => {
    const provider = providerWith(
      asFetch(async () =>
        Response.json(
          { error: { code: 403, message: 'Insufficient permissions' } },
          { status: 403 },
        ),
      ),
    );
    await assert.rejects(
      provider.generate({ prompt: 'portrait', referenceImages: [], maxAttempts: 2 }),
      (error: unknown) => {
        assert.equal((error as Error & { code?: string }).code, 'unauthorized');
        assert.equal(shouldRetryWithSafePhotoScene(error, true), false);
        return true;
      },
    );
  });

  await t.test('400 bad request never retries and never falls back', async () => {
    let attempts = 0;
    const logs: CapturedLog[] = [];
    const provider = providerWith(
      asFetch(async () => {
        attempts += 1;
        return Response.json(
          {
            error: {
              code: 400,
              error_type: 'image_too_large',
              message: 'The reference image exceeds the provider size limit',
            },
          },
          { status: 400 },
        );
      }),
      { warn: (message, context) => logs.push({ message, context }) },
    );

    await assert.rejects(
      provider.generate({ prompt: 'portrait', referenceImages: [], maxAttempts: 3 }),
      (error: unknown) => {
        const providerError = error as Error & {
          code?: string;
          retryable?: boolean;
        };
        assert.equal(providerError.code, 'bad_request');
        assert.equal(providerError.retryable, false);
        assert.equal(shouldRetryWithSafePhotoScene(error, true), false);
        return true;
      },
    );
    assert.equal(attempts, 1);
    // 真实 400 根因必须留在日志里，这正是此前无法定位的那次失败。
    assert.equal(logs[0].context.errorType, 'image_too_large');
    assert.equal(
      logs[0].context.message,
      'The reference image exceeds the provider size limit',
    );
  });
});
