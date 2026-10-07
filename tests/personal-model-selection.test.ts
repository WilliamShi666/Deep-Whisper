import assert from 'node:assert/strict';
import test from 'node:test';
import { getPersonalConfig, getProviderConfig, getSpeechModelFor } from '../src/lib/config/runtime';
import { DeepSeekChatProvider } from '../src/lib/ai/providers/deepseek-chat-provider';
import { OpenRouterImageProvider } from '../src/lib/ai/providers/openrouter-image-provider';
import { QwenAudioSpeechProvider } from '../src/lib/ai/providers/qwen-audio-speech-provider';
import { OpenRouterGeminiSpeechProvider } from '../src/lib/ai/providers/openrouter-gemini-speech-provider';

test('model overrides keep providers and preserve independent vision/default models', () => {
  const config = getPersonalConfig({ DEEPSEEK_API_KEY: 'fixture', DASHSCOPE_API_KEY: 'fixture',
    AI_CHAT_MODEL: 'deepseek-pro', AI_IMAGE_MODEL: 'vendor/reference-image',
    AI_TTS_MODEL: 'qwen-compatible-tts', AI_EMBEDDING_MODEL: 'compatible-embedding' });
  assert.deepEqual(config.providers.chat, { provider: 'deepseek', model: 'deepseek-pro' });
  assert.deepEqual(config.providers.visionSafety, { provider: 'deepseek', model: 'deepseek-flash' });
  assert.deepEqual(config.providers.image, { provider: 'openrouter', model: 'vendor/reference-image' });
  assert.deepEqual(config.providers.speech, { provider: 'qwen-audio', model: 'qwen-compatible-tts' });
  assert.deepEqual(config.providers.embedding, { provider: 'dashscope', model: 'compatible-embedding' });
  assert.equal(getProviderConfig({}).embedding.model, 'text-embedding-v4');
  assert.equal(getSpeechModelFor('openrouter-gemini', { DASHSCOPE_API_KEY: 'fixture', AI_TTS_MODEL: 'qwen-compatible-tts' }),
    'google/gemini-3.1-flash-tts-preview');
});

test('invalid model IDs fail offline before cloud requests', () => {
  for (const name of ['AI_CHAT_MODEL', 'AI_VISION_MODEL', 'AI_IMAGE_MODEL', 'AI_TTS_MODEL', 'AI_EMBEDDING_MODEL']) {
    assert.throws(() => getProviderConfig({ [name]: 'invalid model\n' }), new RegExp(name));
  }
});

test('selected DeepSeek model reaches completion and SSE transport', async () => {
  for (const stream of [false, true]) {
    let body: Record<string, unknown> = {};
    const provider = new DeepSeekChatProvider({ model: 'deepseek-pro', env: { DEEPSEEK_API_KEY: 'fixture' },
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return stream ? new Response('data: '+JSON.stringify({ model: 'deepseek-pro', choices: [{ delta: { content: 'hello' } }] })+'\n\ndata: [DONE]\n\n')
          : Response.json({ model: 'deepseek-pro', choices: [{ message: { content: 'hello' } }] });
      } });
    if (stream) { let result = ''; for await (const chunk of provider.stream({ messages: [] })) result += chunk; assert.equal(result, 'hello'); }
    else assert.equal((await provider.complete({ messages: [] })).content, 'hello');
    assert.equal(body.model, 'deepseek-pro');
  }
});

test('custom OpenRouter image model uses portable parameters with preserved reference images and bytes', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
  let body: Record<string, unknown> = {};
  const provider = new OpenRouterImageProvider({ model: 'vendor/reference-image', env: { OPENROUTER_API_KEY: 'fixture' },
    fetchImpl: async (_url, init) => { body = JSON.parse(String(init?.body));
      return Response.json({ model: 'vendor/reference-image', data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  const result = await provider.generate({ prompt: 'portrait', referenceImages: [{ bytes: new Uint8Array([1]), mediaType: 'image/png' }] });
  assert.equal(body.model, 'vendor/reference-image');
  assert.equal(body.quality, undefined);
  assert.equal(body.resolution, undefined);
  assert.equal((body.input_references as unknown[]).length, 1);
  assert.deepEqual(Buffer.from(result.bytes), Buffer.from(png, 'base64'));
});

test('selected Qwen TTS model reaches synthesis; temporary URL is downloaded and never returned', async () => {
  let body: Record<string, unknown> = {};
  let calls = 0;
  const provider = new QwenAudioSpeechProvider({ DASHSCOPE_API_KEY: 'fixture', AI_TTS_MODEL: 'qwen-compatible-tts' },
    async (_url, init) => { calls++;
      if (init?.method === 'POST') { body = JSON.parse(String(init.body)); return Response.json({ output: { audio: { url: 'https://audio.aliyuncs.com/sample.mp3' } } }); }
      return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } }); });
  const result = await provider.synthesize({ text: 'hello', voice: 'longhan_v3.1' });
  assert.equal(body.model, 'qwen-compatible-tts'); assert.equal(calls, 2);
  assert.equal(result.model, 'qwen-compatible-tts'); assert.deepEqual([...result.bytes], [1, 2]);
  assert.equal('url' in result, false);
});

test('selected Gemini TTS model reaches the same OpenRouter audio transport', async () => {
  let body: Record<string, unknown> = {};
  const provider = new OpenRouterGeminiSpeechProvider({ OPENROUTER_API_KEY: 'fixture', AI_TTS_PROVIDER: 'openrouter-gemini', AI_TTS_MODEL: 'google/compatible-tts' },
    async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } }); });
  const result = await provider.synthesize({ text: 'hello', voice: 'female-tianmei' });
  assert.equal(body.model, 'google/compatible-tts'); assert.equal(result.model, 'google/compatible-tts');
});
