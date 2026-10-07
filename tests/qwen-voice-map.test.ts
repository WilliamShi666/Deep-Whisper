import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isQwenVoiceId } from '../src/lib/ai/qwen-voices';
import {
  UPSTREAM_VOICE_BY_PUBLIC_ID,
  publicIdForUpstreamVoice,
  toPublicVoiceId,
  upstreamVoiceIdFor,
} from '../src/lib/ai/qwen-voice-map';
import { VOICE_OPTIONS } from '../src/lib/characters';

/**
 * 两层映射是「界面不出现上游原名」的实现基础：代号进数据库/客户端，上游参数只在
 * 服务端调 provider 的那一瞬间出现。这层错了会静默发错音色，所以钉得细一点。
 */

test('every public id maps to a real catalog voice, and the mapping is bijective', () => {
  const entries = Object.entries(UPSTREAM_VOICE_BY_PUBLIC_ID);
  assert.equal(entries.length, 25);
  assert.equal(new Set(entries.map(([publicId]) => publicId)).size, 25);
  assert.equal(new Set(entries.map(([, upstream]) => upstream)).size, 25);
  for (const [publicId, upstream] of entries) {
    assert.match(publicId, /^voice-(zh|en)-[fm]-\d{2}$/, publicId);
    assert.ok(isQwenVoiceId(upstream), upstream + ' is not in the Qwen catalog');
  }
});

// 代号集合必须与产品可选集合**完全一致** —— 少一个会在合成时抛，多一个说明表脏了。
test('the public ids are exactly the selectable voice ids', () => {
  assert.deepEqual(
    Object.keys(UPSTREAM_VOICE_BY_PUBLIC_ID),
    VOICE_OPTIONS.map((voice) => voice.id),
  );
});

test('upstreamVoiceIdFor resolves the provider parameter and fails closed on unknown ids', () => {
  assert.equal(upstreamVoiceIdFor('voice-zh-f-01'), 'anyuqing_v3.1');
  assert.equal(upstreamVoiceIdFor('voice-zh-m-07'), 'longanchong_v3.1');
  assert.equal(upstreamVoiceIdFor('voice-en-f-06'), 'Beth_v3.1');
  assert.equal(upstreamVoiceIdFor('voice-en-m-05'), 'Luca_v3.1');
  // 上游参数本身不是合法入参（那说明调用方漏了转换），必须抛而不是猜。
  assert.throws(() => upstreamVoiceIdFor('anyuqing_v3.1'), /No upstream voice mapped/);
  assert.throws(() => upstreamVoiceIdFor('Sulafat'), /No upstream voice mapped/);
  assert.throws(() => upstreamVoiceIdFor(''), /No upstream voice mapped/);
  assert.throws(() => upstreamVoiceIdFor(null), /No upstream voice mapped/);
  assert.throws(() => upstreamVoiceIdFor('not-a-voice'), /No upstream voice mapped/);
});

// 兼容读：数据库里既有公开代号（新写入），也有上游参数与 19 个历史别名（旧数据）。
test('toPublicVoiceId normalizes public ids, upstream params and legacy aliases', () => {
  assert.equal(toPublicVoiceId('voice-zh-f-01'), 'voice-zh-f-01');
  assert.equal(toPublicVoiceId('anyuqing_v3.1'), 'voice-zh-f-01');
  assert.equal(toPublicVoiceId('longanchong_v3.1'), 'voice-zh-m-07');
  assert.equal(toPublicVoiceId('Beth_v3.1'), 'voice-en-f-06');
  assert.equal(toPublicVoiceId('Luca_v3.1'), 'voice-en-m-05');
  // 19 个历史别名走 resolveVoiceId
  assert.equal(toPublicVoiceId('Sulafat'), 'voice-zh-f-01');
  assert.equal(toPublicVoiceId('Chinese (Mandarin)_Gentleman'), 'voice-zh-m-01');
  assert.equal(toPublicVoiceId('chunzhen_xuedi'), 'voice-zh-m-06');
  // 未知值：返回 null 让调用方决定（读旧数据不能抛）
  for (const junk of ['not-a-voice', 'longanhuan', '', null, undefined, 'Emily_v3.1']) {
    assert.equal(toPublicVoiceId(junk), null, String(junk));
  }
});

test('publicIdForUpstreamVoice is the read-only reverse lookup', () => {
  assert.equal(publicIdForUpstreamVoice('anyuqing_v3.1'), 'voice-zh-f-01');
  assert.equal(publicIdForUpstreamVoice('voice-zh-f-01'), null, 'public ids are not upstream params');
  assert.equal(publicIdForUpstreamVoice('Sulafat'), null, 'aliases are handled by toPublicVoiceId');
  assert.equal(publicIdForUpstreamVoice(null), null);
});

// 这一条是「界面不出现上游原名」的守卫：客户端引用的模块里不许出现任何上游参数。
test('the client-shared module never carries an upstream voice parameter', async () => {
  const source = await readFile(new URL('../src/lib/characters.ts', import.meta.url), 'utf8');
  for (const upstream of Object.values(UPSTREAM_VOICE_BY_PUBLIC_ID)) {
    assert.equal(source.includes(upstream), false, 'characters.ts leaks ' + upstream);
  }
  assert.equal(
    /from '@\/lib\/ai\/qwen-voices'/.test(source),
    false,
    'characters.ts must not import the upstream catalog (comments may mention it)',
  );
});

// 反向守卫：只有服务端模块持有上游参数。
test('the mapping module does not leak into client components', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../src/components/', import.meta.url);
  const offenders: string[] = [];
  const walk = async (dir: URL, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) { await walk(next, relative + '/'); continue; }
      if (!/\.(tsx|ts)$/.test(entry.name)) continue;
      const source = await readFile(next, 'utf8');
      if (source.includes('qwen-voice-map')) offenders.push(relative);
    }
  };
  await walk(root, '');
  assert.deepEqual(offenders, [], 'client components must not import the upstream mapping');
});
