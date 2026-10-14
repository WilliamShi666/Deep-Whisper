import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FallbackSpeechProvider } from '../src/lib/ai/providers/fallback-speech-provider';
import { geminiFallbackVoiceFor, GEMINI_FALLBACK_VOICE } from '../src/lib/characters';
import { getSpeechProvider } from '../src/lib/ai/speech-provider';

const audio = (model: string) => ({
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: 'audio/mpeg',
  model,
});

// 产品定稿：千问默认，**失败才回退 Gemini**；回退必须换音色，否则原样透传必然二次失败。
test('personal speech selection follows configured key capabilities',()=>{
 assert.throws(()=>getSpeechProvider({}),/FEATURE_NOT_CONFIGURED/);
 assert.equal(getSpeechProvider({DASHSCOPE_API_KEY:'fixture'}).constructor.name,'QwenAudioSpeechProvider');
 assert.equal(getSpeechProvider({OPENROUTER_API_KEY:'fixture'}).constructor.name,'OpenRouterGeminiSpeechProvider');
 assert.equal(getSpeechProvider({DASHSCOPE_API_KEY:'fixture',OPENROUTER_API_KEY:'fixture'}).constructor.name,'FallbackSpeechProvider');
 assert.equal(getSpeechProvider({AI_TTS_PROVIDER:'openrouter-gemini',OPENROUTER_API_KEY:'fixture'}).constructor.name,'OpenRouterGeminiSpeechProvider');
});

test('the fallback translates the voice instead of passing a foreign id through', async () => {
  const seen: string[] = [];
  const provider = new FallbackSpeechProvider(
    { async synthesize(input) { seen.push('primary:' + input.voice); throw new Error('upstream 503'); } },
    { async synthesize(input) { seen.push('fallback:' + input.voice); return audio('gemini') as never; } },
    { translateVoice: geminiFallbackVoiceFor },
  );

  const female = await provider.synthesize({ text: '晚安', voice: 'voice-zh-f-01' });
  assert.deepEqual(seen, ['primary:voice-zh-f-01', 'fallback:' + GEMINI_FALLBACK_VOICE.female]);
  assert.equal(female.model, 'gemini');

  seen.length = 0;
  await provider.synthesize({ text: '晚安', voice: 'voice-zh-m-01' });
  assert.deepEqual(seen, ['primary:voice-zh-m-01', 'fallback:' + GEMINI_FALLBACK_VOICE.male]);
});

test('the fallback never rewrites the voice when the primary succeeds', async () => {
  const seen: string[] = [];
  const provider = new FallbackSpeechProvider(
    { async synthesize(input) { seen.push(input.voice); return audio('qwen') as never; } },
    { async synthesize(input) { seen.push('FALLBACK:' + input.voice); return audio('gemini') as never; } },
    { translateVoice: geminiFallbackVoiceFor },
  );
  const result = await provider.synthesize({ text: '晚安', voice: 'voice-en-f-01' });
  assert.deepEqual(seen, ['voice-en-f-01']);
  assert.equal(result.model, 'qwen');
});

// 调用方取消绝不能触发第二次付费请求（沿用既有不变量）。
test('caller cancellation never starts a fallback request, even with a translator', async () => {
  const controller = new AbortController();
  controller.abort();
  let fallbackCalls = 0;
  const provider = new FallbackSpeechProvider(
    { async synthesize() { throw new DOMException('cancelled', 'AbortError'); } },
    { async synthesize() { fallbackCalls += 1; return audio('gemini') as never; } },
    { translateVoice: geminiFallbackVoiceFor },
  );
  await assert.rejects(
    provider.synthesize({ text: '晚安', voice: 'voice-zh-f-01', signal: controller.signal }),
  );
  assert.equal(fallbackCalls, 0);
});

// 回退音色必须是 Gemini 适配器真的能映射的值，否则回退等于必然二次失败。
test('both Gemini fallback voices exist in the Gemini adapter mapping', async () => {
  const source = await readFile(
    new URL('../src/lib/ai/providers/openrouter-gemini-speech-provider.ts', import.meta.url),
    'utf8',
  );
  for (const voice of Object.values(GEMINI_FALLBACK_VOICE)) {
    assert.ok(source.includes(voice + ':'), 'Gemini mapping missing fallback voice ' + voice);
  }
});
