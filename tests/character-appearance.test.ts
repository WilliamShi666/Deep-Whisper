import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPEARANCE_STYLES,
  buildPhotoPromptFromSnapshot,
  createPhotoIdentitySnapshot,
  resolveCharacterAppearance,
} from '../src/lib/character-appearance';
import { buildSystemPrompt } from '../src/lib/prompts';
import {
  CHARACTER_PRESETS,
  LEGACY_CHARACTER_KEY_MAP,
  getCharacter,
  resolveCanonicalCharacterKey,
} from '../src/lib/characters';

test('registers exactly eight selectable DeepSeek identities with two appearances each', () => {
  assert.equal(CHARACTER_PRESETS.length, 8);
  assert.deepEqual(
    CHARACTER_PRESETS.reduce(
      (counts, character) => ({
        ...counts,
        [character.gender]: counts[character.gender] + 1,
      }),
      { female: 0, male: 0 },
    ),
    { female: 4, male: 4 },
  );

  for (const character of CHARACTER_PRESETS) {
    assert.equal(character.providerKey, 'deepseek');
    for (const style of APPEARANCE_STYLES) {
      const appearance = resolveCharacterAppearance(character.key, style);
      assert.equal(appearance.characterKey, character.key);
      assert.equal(appearance.style, style);
      assert.match(appearance.avatar, /^\/characters\/deepseek\//);
      assert.equal(appearance.referenceImage, appearance.avatar);
      assert.ok(appearance.identityAnchors.length >= 3);
    }
  }
});

test('photo fallback reuses one immutable identity and reference-byte snapshot', () => {
  const appearance = resolveCharacterAppearance('deepseek_m_03', 'normal');
  const source = new Uint8Array([1, 2, 3]);
  const snapshot = createPhotoIdentitySnapshot(appearance, source, 'image/png');
  source[0] = 9;

  const first = buildPhotoPromptFromSnapshot(snapshot, '月夜书房');
  const fallback = buildPhotoPromptFromSnapshot(snapshot, '海边晨光');
  assert.deepEqual([...snapshot.referenceBytes], [1, 2, 3]);
  assert.match(first, /deepseek_m_03/);
  assert.match(first, /正常人体比例/);
  assert.match(first, /月夜书房/);
  assert.match(fallback, /deepseek_m_03/);
  assert.match(fallback, /正常人体比例/);
  assert.match(fallback, /海边晨光/);
});

test('rejects invalid appearances instead of silently changing identity', () => {
  assert.throws(
    () => resolveCharacterAppearance('deepseek_f_01', 'photoreal' as never),
    /Unsupported appearance style/,
  );
  assert.throws(
    () => resolveCharacterAppearance('unknown', 'chibi'),
    /Unknown character/,
  );
});

test('legacy keys resolve deterministically without merging companion records', () => {
  assert.equal(Object.keys(LEGACY_CHARACTER_KEY_MAP).length, 10);
  assert.equal(resolveCanonicalCharacterKey('lin_wanxing'), 'deepseek_f_01');
  assert.equal(resolveCanonicalCharacterKey('wen_li'), 'deepseek_f_01');
  assert.equal(getCharacter('lin_wanxing')?.key, 'deepseek_f_01');
  assert.equal(resolveCanonicalCharacterKey('unknown'), undefined);
});

test('photo scale follows the appearance style without the fixed negative final sentence', () => {
  const normal = createPhotoIdentitySnapshot(
    resolveCharacterAppearance('deepseek_f_01', 'normal'),
    new Uint8Array([1]),
    'image/png',
  );
  const chibi = createPhotoIdentitySnapshot(
    resolveCharacterAppearance('deepseek_f_01', 'chibi'),
    new Uint8Array([1]),
    'image/png',
  );

  // 两种比例都以参考图服装为准，且都不再携带换装清单（那会破坏角色形象连贯性）
  for (const prompt of [normal.identityPrompt, chibi.identityPrompt]) {
    assert.match(prompt, /服装与参考图保持一致/);
  }
  // 固定末句已移除，用于排查普通自拍的审核误判；Q 版服装约束保留。
  assert.doesNotMatch(normal.identityPrompt, /不得出现全裸、露点、性器官或性行为/);
  assert.match(chibi.identityPrompt, /完整日常服装/);
  // 已移除的按性别分流的换装清单：两种比例都不得再出现
  assert.doesNotMatch(normal.identityPrompt, /比基尼|内衣|半裸|泳装/);
  assert.doesNotMatch(normal.identityPrompt, /完整服装/);
  assert.doesNotMatch(chibi.identityPrompt, /半裸|内衣|泳装/);
});

// 2026-09-19 反馈：同一角色两次出图的衣服与场景都不一致，因为这条指令过去无条件
// 授予「允许改变服装」。现在服装必须以参考图为准。
test('photo identity prompt keeps the reference outfit unless the scene asks to change it', () => {
  const snapshot = createPhotoIdentitySnapshot(
    resolveCharacterAppearance('deepseek_f_03', 'normal'),
    new Uint8Array([1]),
    'image/png',
  );
  const sameOutfit = buildPhotoPromptFromSnapshot(snapshot, '月夜书房暖灯旁，手边放着书');
  const changedOutfit = buildPhotoPromptFromSnapshot(snapshot, '换了一件浅色睡衣，坐在床边');

  assert.match(sameOutfit, /服装与参考图保持一致/);
  assert.match(sameOutfit, /仅当场景明确要求换装时才改变服装/);
  assert.match(changedOutfit, /服装与参考图保持一致/);
  // 性别仍需显式声明，不让上游去猜
  assert.match(sameOutfit, /角色性别为女性/);
});

test('the chat prompt relaxes the photo scale only for the realistic proportion', () => {
  const fixture = { name: '小蓝', persona: null, occupation: null, user_title: '你' };
  const normal = buildSystemPrompt(
    CHARACTER_PRESETS[0]!,
    { ...fixture, appearance_style: 'normal' },
    { gender: 'male' },
  );
  const chibi = buildSystemPrompt(
    CHARACTER_PRESETS[0]!,
    { ...fixture, appearance_style: 'chibi' },
    { gender: 'male' },
  );

  for (const prompt of [normal, chibi]) {
    assert.match(prompt, /全裸、露点、性器官和性行为绝对不出现/);
    assert.match(prompt, /脸红心跳但留白/);
    // 两种比例都要求默认不写穿着，让服装跟随参考图
    assert.match(prompt, /穿着写法：默认不写穿着/);
  }
  assert.match(normal, /成年女性插画形象/);
  assert.match(normal, /不算越界/);
  assert.match(normal, /内衣、比基尼、泳装/);
  // 服装只在对方明确要求时才换
  assert.match(normal, /对方明确要求换装时/);
  assert.doesNotMatch(normal, /半裸上身/);
  // Q 版不得继承这些放宽
  assert.match(chibi, /只生成完整日常穿着和非性感构图/);
  assert.doesNotMatch(chibi, /不算越界/);
  assert.doesNotMatch(chibi, /对方明确要求换装时/);
});

test('the chat prompt keeps the bare-torso allowance for a male companion only', () => {
  const fixture = { name: '小蓝', persona: null, occupation: null, user_title: '你' };
  const maleCharacter = CHARACTER_PRESETS.find((character) => character.gender === 'male')!;
  const male = buildSystemPrompt(
    maleCharacter,
    { ...fixture, appearance_style: 'normal' },
    { gender: 'female' },
  );

  assert.match(male, /成年男性插画形象/);
  assert.match(male, /半裸上身（胸肌、腹肌、背肌）/);
  assert.match(male, /全裸、露点、性器官和性行为绝对不出现/);
});

// 2026-09-19 实测：Gemini 拦掉的是「场景文字」，而非服装列表或底线句
// （同一模板下，仅替换场景行即可出图）。而 LLM 会逐字照抄 system prompt 里的示例，
// 所以那条「蕾丝内衣＋卧室暖灯＋暧昧」的示例本身就是毒源，必须换成日常取景。
test('the chat prompt stops seeding suggestive photo scenes', () => {
  const fixture = { name: '小蓝', persona: null, occupation: null, user_title: '你' };
  const normal = buildSystemPrompt(
    CHARACTER_PRESETS[0]!,
    { ...fixture, appearance_style: 'normal' },
    { gender: 'male' },
  );

  // 不得再鼓励暧昧布景，也不得示范被上游拦掉的那种写真式场景
  assert.doesNotMatch(normal, /氛围可暧昧唯美/);
  assert.doesNotMatch(normal, /蕾丝内衣/);
  assert.doesNotMatch(normal, /卧室暖灯/);
  // 必须给出正面的日常取景指引，并保留换装示例
  assert.match(normal, /取景日常自然/);
  assert.match(normal, /换了一件浅色睡衣/);
});
