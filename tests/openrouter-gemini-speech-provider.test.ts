import assert from 'node:assert/strict';
import test from 'node:test';

import { getSpeechProvider } from '../src/lib/ai/speech-provider';
import { FallbackSpeechProvider } from '../src/lib/ai/providers/fallback-speech-provider';
import {
  OPENROUTER_GEMINI_TTS_MODEL,
  OpenRouterGeminiSpeechProvider,
} from '../src/lib/ai/providers/openrouter-gemini-speech-provider';

const TEST_ENDPOINT = 'https://openrouter.test/api/v1';

test('Gemini TTS uses OpenRouter audio/speech and maps the stable project voice', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new OpenRouterGeminiSpeechProvider(
    {
      AI_TTS_PROVIDER: 'openrouter-gemini',
      OPENROUTER_API_KEY: 'test-key-not-real',
      OPENROUTER_BASE_URL: TEST_ENDPOINT,
    },
    async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: {
          'content-type': 'audio/pcm',
          'x-generation-id': 'or-tts-request-test',
        },
      });
    },
  );

  const result = await provider.synthesize({
    text: '晚安。',
    voice: 'Chinese (Mandarin)_Gentle_Senior',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${TEST_ENDPOINT}/audio/speech`);
  assert.equal(calls[0]?.init?.method, 'POST');
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-key-not-real');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: OPENROUTER_GEMINI_TTS_MODEL,
    input: '晚安。',
    voice: 'Vindemiatrix',
    response_format: 'pcm',
  });
  assert.equal(Buffer.from(result.bytes.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.equal(Buffer.from(result.bytes.subarray(8, 12)).toString('ascii'), 'WAVE');
  assert.deepEqual([...result.bytes.subarray(-4)], [1, 2, 3, 4]);
  assert.equal(result.mediaType, 'audio/wav');
  assert.equal(result.model, OPENROUTER_GEMINI_TTS_MODEL);
  assert.equal(result.providerRequestId, 'or-tts-request-test');
});

// 2026-09-29 定稿：**默认是千问**，Gemini 是它的失败回退（见 tests/speech-fallback.test.ts）。
// 这里只钉住「默认走 FallbackSpeechProvider 包装」+「显式选 Gemini 时缺 key 会报错」，
// 默认链路究竟是谁由 speech-fallback 那条用例负责。
test('the default speech provider is wrapped in a fallback chain', async () => {
  const primary = getSpeechProvider({DASHSCOPE_API_KEY:'fixture',OPENROUTER_API_KEY:'fixture'});
  assert.equal(primary.constructor.name, 'FallbackSpeechProvider');

  const gemini = new OpenRouterGeminiSpeechProvider({
    AI_TTS_PROVIDER: 'openrouter-gemini',
  });
  await assert.rejects(
    gemini.synthesize({ text: 'test', voice: 'female-tianmei' }),
    /OPENROUTER_API_KEY/,
  );
});

test('Gemini TTS rejects malformed model IDs, unmapped voices, and malformed audio before persistence', async () => {
  const invalidModel = new OpenRouterGeminiSpeechProvider({
    AI_TTS_PROVIDER: 'openrouter-gemini',
    AI_TTS_MODEL: 'invalid model',
    OPENROUTER_API_KEY: 'test-key-not-real',
    OPENROUTER_BASE_URL: TEST_ENDPOINT,
  });
  await assert.rejects(
    invalidModel.synthesize({ text: 'test', voice: 'female-tianmei' }),
    /AI_TTS_MODEL/,
  );

  let calls = 0;
  const invalidVoice = new OpenRouterGeminiSpeechProvider(
    {
      AI_TTS_PROVIDER: 'openrouter-gemini',
      OPENROUTER_API_KEY: 'test-key-not-real',
      OPENROUTER_BASE_URL: TEST_ENDPOINT,
    },
    async () => {
      calls += 1;
      return new Response();
    },
  );
  await assert.rejects(
    invalidVoice.synthesize({ text: 'test', voice: 'unmapped-legacy-voice' }),
    /voice mapping is not configured/,
  );
  assert.equal(calls, 0);

  const invalidAudio = new OpenRouterGeminiSpeechProvider(
    {
      AI_TTS_PROVIDER: 'openrouter-gemini',
      OPENROUTER_API_KEY: 'test-key-not-real',
      OPENROUTER_BASE_URL: TEST_ENDPOINT,
    },
    async () => new Response('not audio', { headers: { 'content-type': 'text/plain' } }),
  );
  await assert.rejects(
    invalidAudio.synthesize({ text: 'test', voice: 'female-tianmei' }),
    /unsupported audio format/,
  );
});

test('Gemini TTS surfaces only a safe upstream error code', async () => {
  const provider = new OpenRouterGeminiSpeechProvider(
    {
      AI_TTS_PROVIDER: 'openrouter-gemini',
      OPENROUTER_API_KEY: 'test-key-not-real',
      OPENROUTER_BASE_URL: TEST_ENDPOINT,
    },
    async () =>
      Response.json(
        { error: { code: 'unsupported_parameter', message: 'sensitive upstream detail' } },
        { status: 400 },
      ),
  );

  await assert.rejects(
    provider.synthesize({ text: 'test', voice: 'female-tianmei' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'OpenRouter Gemini TTS request failed (400; code=unsupported_parameter)',
  );
});

test('caller cancellation never starts a MiniMax fallback request', async () => {
  const controller = new AbortController();
  controller.abort();
  let fallbackCalls = 0;
  const provider = new FallbackSpeechProvider(
    {
      async synthesize() {
        throw new DOMException('cancelled', 'AbortError');
      },
    },
    {
      async synthesize() {
        fallbackCalls += 1;
        throw new Error('fallback should not run');
      },
    },
  );

  await assert.rejects(
    provider.synthesize({ text: '晚安。', voice: 'female-tianmei', signal: controller.signal }),
    /cancelled/,
  );
  assert.equal(fallbackCalls, 0);
});
