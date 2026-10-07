import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QWEN_TTS_MODEL,
  QWEN_VOICES,
  QWEN_VOICE_SECTIONS,
  getQwenVoicesForGender,
  isQwenVoiceId,
} from '../src/lib/ai/qwen-voices';

/**
 * 音色目录是这一轮试听的地基：它是适配器白名单、试听页与产品下拉的共同事实来源。
 * 这里的数字来自阿里云百炼官方《Qwen-Audio-TTS音色列表》中 qwen-audio-3.1-tts-flash
 * 小节的逐行程序化抽取（见 docs/plans/2026-09-29-qwen-audio-3-1-tts-trial.md），
 * 不允许手抄成第二份清单。
 */

const SECTION_COUNTS: Record<string, number> = {
  '多语种与方言音色': 4,
  '精品中文音色': 22,
  '精品英文音色': 15,
  '其他系统音色': 27,
};

test('the 3.1 catalog pins the official model id and section totals', () => {
  assert.equal(QWEN_TTS_MODEL, 'qwen-audio-3.1-tts-flash');
  assert.equal(QWEN_VOICES.length, 68);
  assert.deepEqual(
    QWEN_VOICE_SECTIONS.map((section) => section.id),
    Object.keys(SECTION_COUNTS),
  );
  for (const [section, expected] of Object.entries(SECTION_COUNTS)) {
    assert.equal(
      QWEN_VOICES.filter((voice) => voice.section === section).length,
      expected,
      section + ' must keep its official row count',
    );
  }
});

test('the catalog splits 47 female and 21 male voices with unique ids', () => {
  assert.equal(getQwenVoicesForGender('female').length, 47);
  assert.equal(getQwenVoicesForGender('male').length, 21);
  assert.equal(new Set(QWEN_VOICES.map((voice) => voice.id)).size, QWEN_VOICES.length);
  for (const voice of QWEN_VOICES) {
    assert.ok(voice.id.length > 0);
    assert.ok(voice.nameZh.length > 0, voice.id + ' needs a Chinese display name');
  }
});

// 千问AI平台那份音色文档只列了 3.0 的音色；3.1 必须带 _v3.1 后缀。
// 不带后缀的 longanhuan / longanyang / longanlingxin 都属 3.0，写错会拿到 400 InvalidParameter。
test('the catalog keeps the 3.1 suffix convention and rejects 3.0-only ids', () => {
  assert.ok(isQwenVoiceId('longanhuan_v3.1'));
  assert.equal(isQwenVoiceId('longanhuan'), false);
  assert.equal(isQwenVoiceId('longanyang'), false);
  assert.equal(isQwenVoiceId('longanlingxin'), false);
  assert.equal(isQwenVoiceId('Cherry'), false);
  assert.equal(isQwenVoiceId('Sakura'), false);
  assert.equal(isQwenVoiceId(''), false);
  assert.equal(isQwenVoiceId('Zephyr'), false);
});

// 英文音色的官方参数是大写开头 + _v3.1，voice 参数区分大小写，不能被规范化掉。
test('voice ids stay case sensitive exactly as the provider expects', () => {
  assert.ok(isQwenVoiceId('Emily_v3.1'));
  assert.ok(QWEN_VOICES.some((voice) => voice.id === 'Emily_v3.1'));
  assert.equal(isQwenVoiceId('emily_v3.1'), false);
  assert.equal(isQwenVoiceId('EMILY_V3.1'), false);
});

test('the flagship and benchmark companion voices are present and gender-correct', () => {
  const flagship = QWEN_VOICES.find((voice) => voice.id === 'longanlingxin_v3.1');
  assert.equal(flagship?.gender, 'female');
  assert.equal(flagship?.nameZh, '龙安灵心');
  const benchmark = QWEN_VOICES.find((voice) => voice.id === 'longanyang_v3.1');
  assert.equal(benchmark?.gender, 'male');
  assert.equal(benchmark?.nameZh, '龙安洋');
});

test('every catalog entry carries the metadata the listening page renders', () => {
  for (const voice of QWEN_VOICES) {
    assert.ok(voice.nameZh.length > 0, voice.id);
    assert.ok(['female', 'male'].includes(voice.gender), voice.id);
    assert.ok(voice.section.length > 0, voice.id);
    if (voice.accent === undefined) {
      assert.ok(voice.trait.length > 0, voice.id + ' needs a trait label');
    } else {
      // 产品要求不显示英音/美音：英文音色的 trait 被清空，官方说法只留在 accent 里。
      assert.equal(voice.trait, '', voice.id + ' must not render an accent as its trait');
      assert.ok(voice.accent.length > 0, voice.id + ' keeps the official accent record');
    }
  }
  const companionFriendly = QWEN_VOICES.filter((voice) => voice.scenes.includes('社交陪伴'));
  assert.ok(companionFriendly.length >= 8, 'need at least 8 companion-oriented voices');
  assert.ok(companionFriendly.some((voice) => voice.gender === 'female'));
  assert.ok(companionFriendly.some((voice) => voice.gender === 'male'));
});
