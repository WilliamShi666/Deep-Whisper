import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CHARACTER_PRESETS,
  VOICE_OPTIONS,
  isSelectableVoiceId,
  resolveVoiceId,
} from '../src/lib/characters';

async function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

// 角色预设里的 defaultVoice 必须与音色表同源；开屏创建伴侣不带 voice_id，于是它会经
// resolveVoiceId 落到 companions.voice_id，之后用户在「设置 → 保存」时又要通过
// PATCH /api/companions/[id] 的合法性校验。三者不一致就会出现 400「音色无效」，
// 整个保存（名字/性格/形象）一起失败。这里把入口、出口和别名不变式都钉死。
//
// 2026-09-29 试验期：音色表由 Gemini 换成 qwen-audio-3.1-tts-flash 的 8 个音色，
// 每个角色的气质对应到新的同性音色（见 docs/plans/2026-09-29-qwen-audio-3-1-tts-trial.md）。
//
// 注意：只断言「defaultVoice 能解析成某个同性别音色」是无效护栏——resolveVoiceId 对任何
// 未知 id 都会回落到性别默认值，别名表被删空也照样绿。所以这里钉死落到哪一位音色。
const EXPECTED_DEFAULT_VOICES: Record<string, string> = {
  deepseek_f_01: 'voice-zh-f-01',
  deepseek_f_02: 'voice-zh-f-02',
  deepseek_f_03: 'voice-zh-f-03',
  deepseek_f_04: 'voice-zh-f-04',
  deepseek_m_01: 'voice-zh-m-01',
  deepseek_m_02: 'voice-zh-m-02',
  deepseek_m_03: 'voice-zh-m-03',
  deepseek_m_04: 'voice-zh-m-04',
};

test('every character default voice keeps its intended kept voice', () => {
  const seen: string[] = [];
  for (const character of CHARACTER_PRESETS) {
    const expected = EXPECTED_DEFAULT_VOICES[character.key];
    assert.ok(expected, 'no expected voice recorded for ' + character.key);
    assert.equal(
      resolveVoiceId(character.defaultVoice, character.gender),
      expected,
      character.key + ': ' + character.defaultVoice + ' must keep its timbre',
    );
    seen.push(character.key);
  }
  assert.deepEqual(
    seen.slice().sort(),
    Object.keys(EXPECTED_DEFAULT_VOICES).sort(),
    'the character list changed; record the new default voice mapping',
  );
});

// 性别分组不能错：女角色拿到男声（或反之）会在 PATCH 时被 400 掉，
// 而 resolveVoiceId 的性别作用域会让这个错误表现为「悄悄回落到默认值」。
test('each preset default voice belongs to that character gender group', () => {
  for (const character of CHARACTER_PRESETS) {
    const voice = VOICE_OPTIONS.find((option) => option.id === character.defaultVoice);
    assert.ok(voice, character.key + ' defaultVoice ' + character.defaultVoice + ' is not selectable');
    assert.equal(voice.gender, character.gender, character.key + ' default voice gender mismatch');
  }
});

// 「PATCH 继续拒绝异性音色」的前提：别名本身不能是当前可选 id，否则别名命中就可能
// 把另一个性别的 id 悄悄放进来。
test('no legacy alias collides with a current selectable voice id', () => {
  const currentIds = new Set(VOICE_OPTIONS.map((voice) => voice.id));
  for (const voice of VOICE_OPTIONS) {
    for (const legacyId of voice.legacyIds ?? []) {
      assert.ok(!currentIds.has(legacyId), legacyId + ' is both a legacy alias and a selectable id');
    }
  }
});

test('creating a companion normalizes both the request voice and the character default', async () => {
  const source = await readSource('../src/app/api/companions/route.ts');
  assert.ok(
    source.includes('toPublicVoiceId(body.voice_id ?? character.defaultVoice)')
      && source.includes('resolveVoiceId('),
    'create must normalize the request value and the character default before writing voice_id',
  );
  assert.ok(
    !source.includes(': character.defaultVoice;'),
    'create must never write the raw character default voice id',
  );
});

// 产品定稿（2026-09-29）：可选集合收敛为 25 个，且**性别作用域必须在服务端也生效** ——
// 下拉只显示同性别音色是产品口径，服务端不校验的话跨性别 id 仍能写进库，过滤就只是装饰。
test('updating a companion enforces the gender-scoped selectable set', async () => {
  const source = await readSource('../src/app/api/companions/[id]/route.ts');
  assert.ok(
    source.includes('isSelectableVoiceId(publicVoiceId, character.gender)'),
    'update must validate the voice against the companion gender group',
  );
  assert.ok(source.includes('toPublicVoiceId('), 'update must normalize legacy/upstream values');
  // U7 / t8：失败响应统一成 `{ error: <中文兜底>, code }`，所以这里改钉**统一构造器的完整调用**
  // （状态码 + 稳定 code + 中文兜底三者一起）—— 比原先只钉一个 error 字面量更严，不是放宽。
  assert.ok(
    source.includes("apiError(400, 'INVALID_VOICE', '音色无效')"),
    'unknown voice ids must still be rejected with 400 / INVALID_VOICE',
  );
});

test('the guard rejects cross-gender picks and accepts aliases within the gender group', () => {
  assert.equal(isSelectableVoiceId('voice-zh-f-01', 'female'), true);
  assert.equal(isSelectableVoiceId('voice-en-f-01', 'female'), true);
  assert.equal(isSelectableVoiceId('voice-zh-m-01', 'male'), true);
  assert.equal(isSelectableVoiceId('Sulafat', 'female'), true);
  assert.equal(isSelectableVoiceId('Chinese (Mandarin)_Gentleman', 'male'), true);
  // 跨性别一律拒绝 —— 女角色不能挂男声，反之亦然。
  assert.equal(isSelectableVoiceId('voice-zh-m-01', 'female'), false);
  assert.equal(isSelectableVoiceId('voice-zh-f-01', 'male'), false);
  assert.equal(isSelectableVoiceId('Sulafat', 'male'), false);
  // 上游参数不是产品层 id：必须先经 toPublicVoiceId 转换（服务端会做）。
  assert.equal(isSelectableVoiceId('anyuqing_v3.1', 'female'), false);
  // 非法值（3.0-only / 大小写错 / 未知）。
  assert.equal(isSelectableVoiceId('longanhuan', 'male'), false);
  assert.equal(isSelectableVoiceId('not-a-voice', 'female'), false);
  assert.equal(isSelectableVoiceId('', 'female'), false);
  assert.equal(isSelectableVoiceId(null, 'female'), false);
});


test('the settings dialog seeds and submits a normalized voice id', async () => {
  const source = await readSource('../src/components/chat/companion-settings.tsx');
  const seed = 'resolveVoiceId(companion.voice_id, character.gender)';
  const seeds = source.split(seed).length - 1;
  const rawUses = source.split('companion.voice_id').length - 1;
  assert.ok(seeds >= 3, 'settings must resolve the stored voice in the initializer, the reset helper and the open effect (found ' + seeds + ')');
  assert.equal(rawUses, seeds, 'every read of the stored voice id must go through resolveVoiceId');
});
