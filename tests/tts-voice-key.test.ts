import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildTtsObjectKey,
  extractVoiceKeySlug,
  toVoiceKeySlug,
} from '../src/lib/ai/tts-voice-key';

// 换音色后的旧音频提示：靠「对象存储 key 里带音色」这件事来判断，
// 所以 key 的构造与解析是这个功能的地基，先钉死它们。

test('voice key slug is lowercase, URL safe and stable for Gemini voice ids', () => {
  assert.equal(toVoiceKeySlug('Zephyr'), 'zephyr');
  assert.equal(toVoiceKeySlug('  Zubenelgenubi '), 'zubenelgenubi');
  assert.equal(toVoiceKeySlug('Sulafat'), 'sulafat');
  // 历史平台音色 id 带空格与括号，也必须得到一个可放进 URL 路径的 slug
  assert.equal(toVoiceKeySlug('Chinese (Mandarin)_Gentleman'), 'chinese_mandarin_gentleman');
  assert.equal(toVoiceKeySlug(null), 'default');
  assert.equal(toVoiceKeySlug(''), 'default');
  assert.equal(/^[a-z0-9._-]+$/.test(toVoiceKeySlug('Chinese (Mandarin)_Gentleman')), true);
});

test('stored keys carry the voice so audio_url is self describing', () => {
  const key = buildTtsObjectKey({ subdir: 'tts', voiceId: 'Leda', id: 'abc-123', extension: 'wav' });
  assert.equal(key, 'tts/leda/abc-123.wav');
  assert.equal(extractVoiceKeySlug('/tts/leda/abc-123.wav'), 'leda');
  assert.equal(extractVoiceKeySlug('https://cdn.example.com/bucket/tts/Leda/abc-123.mp3'), 'leda');
  assert.equal(extractVoiceKeySlug('/tts/Leda/abc-123.mp3?version=2'), 'leda');
});

test('legacy and foreign urls report an unknown voice instead of a false mismatch', () => {
  // 老格式（没有音色段）与别的目录都不能被当成音色，否则换音色提示会误报
  assert.equal(extractVoiceKeySlug('/tts/abc-123.mp3'), null);
  assert.equal(extractVoiceKeySlug('/uploads/tts/abc-123.mp3'), null);
  assert.equal(extractVoiceKeySlug('/tts/leda/nested/abc-123.mp3'), null);
  assert.equal(extractVoiceKeySlug(null), null);
  assert.equal(extractVoiceKeySlug(''), null);
  assert.equal(extractVoiceKeySlug('/tts-preview/leda/abc-123.mp3'), null);
  assert.equal(extractVoiceKeySlug('/tts-preview/leda/abc-123.mp3', 'tts-preview'), 'leda');
});

test('the speech service derives the storage key from the voice, never a bare uuid key', async () => {
  const source = await readFile(new URL('../src/lib/ai/speech-service.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('buildTtsObjectKey('), 'speech service must build the key through the shared helper');
  assert.ok(!source.includes('${subdir}/${crypto.randomUUID()}'), 'the voice segment must not be dropped from the key');
});

// 「界面不出现上游原名」在旧音色提示这条路径上同样成立：URL 里的 slug 可能是
// Gemini 时代的别名，也可能是本轮之前缓存的上游参数 —— 查不到就回中性占位，绝不回显 slug。
test('TTS cache and regenerate remain owner-scoped and capability-gated',async()=>{
 const source=await readFile(new URL('../src/app/api/tts/route.ts',import.meta.url),'utf8');
 assert.match(source,/getOwnedMessage\(owner/);
 assert.match(source,/body\.regenerate/);
 assert.match(source,/message\.audio_url && !body\.regenerate/);
 assert.match(source,/capabilities\.speech\.enabled/);
 assert.doesNotMatch(source,/hasPaidFeature|lib\/billing/);
 assert.match(source,/audio_url: audioUrl/);
 assert.doesNotMatch(source,/audio_voice_id/);
});



test('the chat shell only flags a mismatch when the stored voice differs from the current one', async () => {
  const source = await readFile(new URL('../src/components/chat/chat-shell.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('extractVoiceKeySlug(message.audio_url)'), 'mismatch must come from the cached audio url');
  assert.ok(
    source.includes('if (!audioSlug || audioSlug === currentVoiceSlug) return null;'),
    'matching audio (or an unknown legacy voice) must not raise the notice',
  );
  assert.ok(source.includes('regenerate: true'), 'the regenerate entry point must ask the server to re-synthesize');
  assert.ok(
    source.includes('playVoice(m.id, { force: true })'),
    'regenerate must bypass the client url cache, otherwise the old voice replays',
  );
  assert.ok(
    source.includes('audioVoiceSlugRef.current[messageId] = extractVoiceKeySlug(audioUrl);'),
    'a fresh synthesis must record which voice the new audio uses',
  );
});

test('the voice bar renders the stale notice next to the play button only when it is stale', async () => {
  const source = await readFile(new URL('../src/components/chat/voice-bar.tsx', import.meta.url), 'utf8');
  const play = source.indexOf('data-testid="voice-bar"');
  const notice = source.indexOf('data-testid="voice-stale-notice"');
  const regenerate = source.indexOf('data-testid="voice-regenerate"');
  assert.ok(play >= 0, 'play button must stay addressable');
  assert.ok(notice > play, 'the notice must sit next to the play button');
  assert.ok(regenerate > notice, 'the regenerate entry point lives inside the notice');
  assert.ok(source.includes('{staleNotice && ('), 'the notice must be conditional on a stale voice');
  assert.ok(source.includes('disabled={loading || !onRegenerate}'), 'regenerating while synthesizing must stay disabled');
});

test('the stale-voice hint never echoes a raw slug to the user', async () => {
  const source = await readFile(new URL('../src/components/chat/chat-shell.tsx', import.meta.url), 'utf8');
  assert.ok(
    source.includes('UNKNOWN_VOICE_LABEL'),
    'the stale-voice hint must have a neutral fallback label',
  );
  assert.ok(
    !/voiceLabelForKeySlug\([^)]*\) \?\? slug/.test(source),
    'the hint must not fall back to the raw slug',
  );
  assert.ok(
    !/voiceLabelForKeySlug\([^)]*\) \?\? currentVoiceId/.test(source),
    'the current-voice label must not fall back to a raw id',
  );
});
