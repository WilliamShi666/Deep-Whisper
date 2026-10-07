import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QWEN_AUDIO_TTS_MODEL,
  QwenAudioSpeechProvider,
} from '../src/lib/ai/providers/qwen-audio-speech-provider';

const ENDPOINT = 'https://maas.example.test/api/v1';
const AUDIO_HOST = 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com';
const AUDIO_URL = AUDIO_HOST + '/prod/qwen-audio-3.1-tts-flash/out/abc.wav';

const BASE_ENV = {
  AI_TTS_PROVIDER: 'qwen-audio',
  DASHSCOPE_API_KEY: 'test-key-not-real',
  DASHSCOPE_TTS_BASE_URL: ENDPOINT,
} as const;

interface Call { url: string; init?: RequestInit }

function asFetch(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch {
  return impl as typeof fetch;
}

/** Two-hop transport: the synthesis POST then the temporary-URL GET download. */
function transport(options: {
  synth?: Response | (() => Response | Promise<Response>);
  audio?: Response | (() => Response | Promise<Response>);
  calls?: Call[];
}): typeof fetch {
  return asFetch(async (input, init) => {
    const url = String(input);
    options.calls?.push({ url, init });
    const isDownload = (init?.method ?? 'GET') === 'GET';
    const source = isDownload ? options.audio : options.synth;
    if (!source) throw new Error('unexpected transport hop: ' + url);
    return typeof source === 'function' ? await source() : source;
  });
}

function synthOk(url = AUDIO_URL): Response {
  return Response.json({
    request_id: 'req-test-1',
    output: { finish_reason: 'stop', audio: { data: '', id: 'audio_1', url } },
    usage: { characters: 12 },
  });
}

function audioOk(bytes = [1, 2, 3, 4], type = 'audio/mpeg'): Response {
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': type } });
}

test('Qwen TTS posts the official request shape then persists real audio bytes', async () => {
  const calls: Call[] = [];
  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    transport({ synth: synthOk(), audio: audioOk([9, 8, 7]), calls }),
  );

  const result = await provider.synthesize({ text: '  晚上好呀。  ', voice: 'longanlingxin_v3.1' });

  assert.equal(calls.length, 2, 'exactly one synthesis call and one download');
  assert.equal(calls[0]?.url, ENDPOINT + '/services/audio/tts/SpeechSynthesizer');
  assert.equal(calls[0]?.init?.method, 'POST');
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-key-not-real');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: QWEN_AUDIO_TTS_MODEL,
    input: {
      text: '晚上好呀。',
      voice: 'longanlingxin_v3.1',
      format: 'mp3',
      sample_rate: 24000,
    },
  });

  assert.equal(calls[1]?.url, AUDIO_URL);
  assert.deepEqual([...result.bytes], [9, 8, 7]);
  assert.equal(result.mediaType, 'audio/mpeg');
  assert.equal(result.model, QWEN_AUDIO_TTS_MODEL);
  assert.equal(result.providerRequestId, 'req-test-1');
});

// 契约要求「不得返回临时 URL 给 route」——上游链接 24h 过期且是 http 明文。
test('Qwen TTS never leaks the temporary upstream URL to callers', async () => {
  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    transport({ synth: synthOk(), audio: audioOk() }),
  );
  const result = await provider.synthesize({ text: '晚安', voice: 'longanyang_v3.1' });
  assert.equal(JSON.stringify(result).includes(AUDIO_HOST), false);
  assert.equal(JSON.stringify(result).includes('Signature'), false);
});

test('Qwen TTS rejects unmapped voices without touching the network', async () => {
  let calls = 0;
  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    transport({ synth: synthOk(), audio: audioOk(), calls: undefined }),
  );
  const guarded = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    asFetch(async () => { calls += 1; return synthOk(); }),
  );
  for (const voice of ['unknown-upstream-voice', '', 'not-a-voice']) {
    await assert.rejects(guarded.synthesize({ text: '你好', voice }), /voice/i);
  }
  assert.equal(calls, 0, 'unmapped voices must fail before any paid request');
  assert.ok(provider);
});

test('Qwen TTS fails closed on a missing or empty audio url', async () => {
  for (const payload of [
    { request_id: 'r', output: { finish_reason: 'stop', audio: { data: '', url: '' } } },
    { request_id: 'r', output: { finish_reason: 'stop', audio: { data: '' } } },
    { request_id: 'r', output: { finish_reason: 'stop' } },
    { request_id: 'r' },
  ]) {
    const provider = new QwenAudioSpeechProvider(
      { ...BASE_ENV },
      asFetch(async (input) => String(input).startsWith(AUDIO_HOST)
        ? audioOk()
        : Response.json(payload)),
    );
    await assert.rejects(
      provider.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
      /audio url/i,
      JSON.stringify(payload),
    );
  }
});

// 临时链接来自上游响应，是攻击面：只允许白名单 host，且必须 http(s)。
test('Qwen TTS refuses a temporary url outside the reviewed host allowlist', async () => {
  for (const url of [
    'https://evil.example.com/a.mp3',
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.test/a.mp3',
  ]) {
    let downloads = 0;
    const provider = new QwenAudioSpeechProvider(
      { ...BASE_ENV },
      asFetch(async (_input, init) => {
        if ((init?.method ?? 'GET') === 'GET') { downloads += 1; return audioOk(); }
        return synthOk(url);
      }),
    );
    await assert.rejects(
      provider.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
      /host|scheme|allowlist|HTTPS/i,
      url,
    );
    assert.equal(downloads, 0, 'must not fetch an untrusted url: ' + url);
  }
});

// 允许运营商在内网/镜像场景改 audio host，但必须显式声明，不能靠通配放开。
test('an explicitly configured audio host suffix widens the allowlist narrowly', async () => {
  const host = 'https://audio.example.test';
  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV, DASHSCOPE_AUDIO_HOST_SUFFIX: 'audio.example.test' },
    transport({ synth: synthOk(host + '/a.mp3'), audio: audioOk([5]) }),
  );
  const result = await provider.synthesize({ text: '你好', voice: 'longhan_v3.1' });
  assert.deepEqual([...result.bytes], [5]);

  const stillBlocked = new QwenAudioSpeechProvider(
    { ...BASE_ENV, DASHSCOPE_AUDIO_HOST_SUFFIX: 'audio.example.test' },
    asFetch(async (_input, init) => (init?.method ?? 'GET') === 'GET'
      ? audioOk()
      : synthOk('https://other.example.test/a.mp3')),
  );
  await assert.rejects(
    stillBlocked.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
    /host|allowlist/i,
  );
});

test('Qwen TTS rejects non-audio and oversized downloads', async () => {
  const wrongType = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    transport({ synth: synthOk(), audio: new Response('nope', { headers: { 'content-type': 'text/html' } }) }),
  );
  await assert.rejects(
    wrongType.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
    /audio/i,
  );

  const declaredHuge = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    transport({
      synth: synthOk(),
      audio: new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'audio/mpeg', 'content-length': String(21 * 1024 * 1024) },
      }),
    }),
  );
  await assert.rejects(
    declaredHuge.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
    /oversized|size/i,
  );

  const empty = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    transport({ synth: synthOk(), audio: new Response(new Uint8Array([]), { headers: { 'content-type': 'audio/mpeg' } }) }),
  );
  await assert.rejects(
    empty.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
    /audio/i,
  );
});

// 错误信息不得泄漏 key / Authorization / Base64 / 上游 message 正文。
test('Qwen TTS surfaces only a safe upstream error code', async () => {
  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    asFetch(async () => Response.json(
      { request_id: 'r', code: 'InvalidParameter', message: '[cosyvoice:]Engine error [411]: secret-ish detail' },
      { status: 400 },
    )),
  );
  await assert.rejects(
    provider.synthesize({ text: '你好', voice: 'longhan_v3.1' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /InvalidParameter/);
      assert.match(error.message, /400/);
      assert.equal(error.message.includes('secret-ish'), false);
      assert.equal(error.message.includes('test-key-not-real'), false);
      assert.equal(error.message.includes('Bearer'), false);
      return true;
    },
  );
});

test('Qwen TTS rejects model drift, empty text and oversized text before any request', async () => {
  const drift = new QwenAudioSpeechProvider(
    { ...BASE_ENV, AI_TTS_MODEL: 'qwen-audio-3.0-tts-flash' },
    asFetch(async () => { throw new Error('must not be called'); }),
  );
  await assert.rejects(drift.synthesize({ text: '你好', voice: 'longhan_v3.1' }), /qwen-audio-3\.1-tts-flash/);

  const noKey = new QwenAudioSpeechProvider(
    { AI_TTS_PROVIDER: 'qwen-audio', DASHSCOPE_TTS_BASE_URL: ENDPOINT },
    asFetch(async () => { throw new Error('must not be called'); }),
  );
  await assert.rejects(noKey.synthesize({ text: '你好', voice: 'longhan_v3.1' }), /DASHSCOPE_API_KEY/);

  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    asFetch(async () => { throw new Error('must not be called'); }),
  );
  await assert.rejects(provider.synthesize({ text: '   ', voice: 'longhan_v3.1' }), /empty/i);
  await assert.rejects(provider.synthesize({ text: 'x'.repeat(10_001), voice: 'longhan_v3.1' }), /too long/i);
});

// 调用方取消不得产生第二次付费请求。
test('caller cancellation never starts a download or a retry', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const provider = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    asFetch(async () => { calls += 1; throw new DOMException('cancelled', 'AbortError'); }),
  );
  await assert.rejects(
    provider.synthesize({ text: '你好', voice: 'longhan_v3.1', signal: controller.signal }),
  );
  assert.equal(calls, 1);
});

// 产品定稿后注册表把千问包进「千问 → Gemini」的回退链（见 tests/speech-fallback.test.ts），
// 所以这里断言的是：**千问仍是主链路**，且它自己的失败是 fail closed 的
// （未知音色不会被静默换声），而不是断言外层包装类型。
test('the Qwen provider stays the primary link and fails closed on unknown voices', async () => {
  const { getSpeechProvider } = await import('../src/lib/ai/speech-provider');
  const provider = getSpeechProvider({
    AI_TTS_PROVIDER: 'qwen-audio',
    DASHSCOPE_API_KEY: 'test-key-not-real',
    DASHSCOPE_TTS_BASE_URL: ENDPOINT,
  });
  assert.equal(provider.constructor.name, 'QwenAudioSpeechProvider');

  const direct = new QwenAudioSpeechProvider(
    { ...BASE_ENV },
    asFetch(async () => { throw new Error('must not be called'); }),
  );
  await assert.rejects(direct.synthesize({ text: '你好', voice: 'not-a-voice' }), /voice/i);
});
