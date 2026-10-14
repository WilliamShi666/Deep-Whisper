import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { synthesizeToObjectStore } from '../src/lib/ai/speech-service';
import { getSpeechMode } from '../src/lib/config/runtime';

// 方案 I：SpeechMode 的既有语义完全不动（产品语音已改为云端 Gemini TTS，
// 但 APP_SPEECH_MODE=web 仍是本地开发口径），这里继续钉死它，
// 防止有人把 'provider' 之类的取值塞进 getSpeechMode。
test('the obsolete browser speech mode is only a compatibility return value',()=>{
 assert.equal(getSpeechMode({}),'web');
});

test('the speech service no longer blocks before the provider layer', async () => {
  const source = await readFile(new URL('../src/lib/ai/speech-service.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('WebSpeechRequiredError'), 'web speech gate must stay removed');
  assert.ok(!source.includes('export function assertPaidSpeechDisabled'), 'unconditional paid-speech gate must stay removed');
  assert.ok(!source.includes('export class WebSpeechRequiredError'), 'free web speech error must stay removed');
  const provider = source.indexOf('getSpeechProvider()');
  const firstThrow = source.indexOf('throw new ');
  assert.ok(firstThrow === -1 || firstThrow > provider, 'the service must not throw before reaching the provider layer');
  assert.ok(source.includes('getSpeechProvider()'), 'speech service must reach the provider contract');
  assert.ok(source.includes('getObjectStore()'), 'speech service must still persist audio');
  assert.equal(typeof synthesizeToObjectStore, 'function');
});

test('legacy speech routes no longer short-circuit with WEB_SPEECH_REQUIRED', async () => {
  for (const relative of ['../src/app/api/tts/route.ts', '../src/app/api/tts-preview/route.ts']) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.ok(!source.includes('WEB_SPEECH_REQUIRED'), `${relative}: 409 gate must stay removed`);
    assert.ok(!source.includes('WebSpeechRequiredError'), `${relative}: obsolete web speech error must stay removed`);
    if (relative.endsWith("/tts/route.ts")) assert.match(source, /acquireOperationLease/, `${relative}: concurrent synthesis must be reserved`);
  }
});

// 这两个路由是真正会花钱的端点：身份 → 会员权益 → 合成 的顺序不能乱，
// 否则任何人都能把它们当公开的付费 TTS 代理刷。
test('personal speech routes guard the owner and configured capability before synthesis',async()=>{
 for(const relative of ['../src/app/api/tts/route.ts','../src/app/api/tts-preview/route.ts']){
 const source=await readFile(new URL(relative,import.meta.url),'utf8');
 assert.match(source,/ownerRoute\(request/);
 const capability=source.indexOf('capabilities.speech.enabled');
 const synthesis=source.indexOf('await synthesizeToObjectStore(');
 assert.ok(capability>=0&&synthesis>capability);
 assert.doesNotMatch(source,/hasPaidFeature|MEMBERSHIP_REQUIRED|supabase-client/);
 }
});

test('the preview route cannot be used as an unbounded paid proxy', async () => {
  const source = await readFile(new URL('../src/app/api/tts-preview/route.ts', import.meta.url), 'utf8');
  const synthesize = source.indexOf('synthesizeToObjectStore(');
  const limit = source.indexOf('PREVIEW_TEXT_LIMIT');
  assert.ok(limit >= 0, 'preview must declare a text length limit');
  assert.ok(source.includes('PREVIEW_TEXT_LIMIT = 120'), 'preview text limit must stay small');
  assert.ok(limit < synthesize, 'length must be capped before synthesis');
  const voiceLookup = source.indexOf('VOICE_OPTIONS.find(');
  assert.ok(voiceLookup >= 0 && voiceLookup < synthesize, 'preview must reject unknown voice ids first');
});

test('the message route still resolves legacy voice ids through the shared resolver', async () => {
  const source = await readFile(new URL('../src/app/api/tts/route.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('resolveVoiceId('), 'legacy voice ids must keep flowing through resolveVoiceId');
  assert.ok(source.includes('getCharacter('), 'voice resolution must stay gender scoped');
});
