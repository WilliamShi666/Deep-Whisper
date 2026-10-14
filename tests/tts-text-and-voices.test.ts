import assert from 'node:assert/strict';
import test from 'node:test';

import { TTS_TEXT_LIMIT, prepareTtsText } from '../src/lib/ai/tts-text';
import {
  DEFAULT_MALE_VOICE,
  DEFAULT_VOICE,
  VOICE_OPTIONS,
  getVoicesForGender,
  isSelectableVoiceId,
  resolveVoiceId,
} from '../src/lib/characters';

const LEGACY_ALIASES = VOICE_OPTIONS.flatMap((voice) =>
  (voice.legacyIds ?? []).map((id) => ({ id, voice })));

test('tts text never leaks hidden photo markers into the audio', () => {
  const text = prepareTtsText('今晚的月亮很好看。[PHOTO:窗边自拍，暖光]');
  assert.equal(text, '今晚的月亮很好看。');
  assert.doesNotMatch(text, /PHOTO|自拍/);
});

test('tts text drops emoji and markdown so nothing is read out literally', () => {
  assert.equal(prepareTtsText('**晚安** 呀 \n\n 我~在~呢 🌙'), '晚安 呀 我在呢');
});

test('tts text is capped so a long reply cannot bill the whole transcript', () => {
  const long = '好。'.repeat(400);
  const text = prepareTtsText(long);
  assert.equal(text.length, TTS_TEXT_LIMIT);
  assert.equal(text, long.slice(0, TTS_TEXT_LIMIT));
});

test('tts text is empty when nothing is speakable', () => {
  for (const useless of ['', '   \n  ', '😀😀', '###', '[PHOTO:窗边自拍]']) {
    assert.equal(prepareTtsText(useless), '', JSON.stringify(useless));
  }
});

/**
 * 产品可选音色（2026-09-29 定稿）：用户点名的 25 个。
 * 中文女 7 / 中文男 7 / 英文女 6 / 英文男 5。
 * 顺序即下拉里的编号顺序 —— 改顺序等于改用户看到的代号，必须是显式决定。
 */
const KEPT = {
  femaleZh: ['voice-zh-f-01', 'voice-zh-f-02', 'voice-zh-f-03', 'voice-zh-f-04', 'voice-zh-f-05', 'voice-zh-f-06', 'voice-zh-f-07'],
  maleZh: ['voice-zh-m-01', 'voice-zh-m-02', 'voice-zh-m-03', 'voice-zh-m-04', 'voice-zh-m-05', 'voice-zh-m-06', 'voice-zh-m-07'],
  femaleEn: ['voice-en-f-01', 'voice-en-f-02', 'voice-en-f-03', 'voice-en-f-04', 'voice-en-f-05', 'voice-en-f-06'],
  maleEn: ['voice-en-m-01', 'voice-en-m-02', 'voice-en-m-03', 'voice-en-m-04', 'voice-en-m-05'],
} as const;

const CN_FEMALE_LABELS = KEPT.femaleZh.map((_, i) => '肥鱼音色 ' + (i + 1) + '（女）');
const CN_MALE_LABELS = KEPT.maleZh.map((_, i) => '肥鱼音色 ' + (i + 1) + '（男）');
const EN_FEMALE_LABELS = KEPT.femaleEn.map((_, i) => 'chubby fish voice ' + (i + 1) + ' (female)');
const EN_MALE_LABELS = KEPT.maleEn.map((_, i) => 'chubby fish voice ' + (i + 1) + ' (male)');

test('the selectable set is exactly the 25 voices the user chose', () => {
  assert.equal(VOICE_OPTIONS.length, 25);
  assert.deepEqual(
    VOICE_OPTIONS.map((voice) => voice.id),
    [...KEPT.femaleZh, ...KEPT.maleZh, ...KEPT.femaleEn, ...KEPT.maleEn],
  );
  assert.equal(new Set(VOICE_OPTIONS.map((v) => v.id)).size, 25);
  assert.equal(getVoicesForGender('female').length, 13);
  assert.equal(getVoicesForGender('male').length, 12);
});

// 用户要求：界面只用代号，**不得出现上游原名**。
test('labels are codenames only and never leak an upstream voice name', () => {
  const labels = VOICE_OPTIONS.map((voice) => voice.label);
  assert.deepEqual(labels, [...CN_FEMALE_LABELS, ...CN_MALE_LABELS, ...EN_FEMALE_LABELS, ...EN_MALE_LABELS]);
  const forbidden = ['安语晴', '龙华', '白清岚', '云欢欢', '许言初', '谢舒柔', '顾云舒',
    '龙寒', '许南川', '龙安洋', '安明远', '霍拙石', '龙安朗', '龙安冲',
    'Cally', 'Cindy', 'Luna', 'Abby', 'Ava', 'Beth', 'Eric', 'Brian', 'Andy', 'David', 'Luca',
    '龙安灵心', '龙安风悦'];
  for (const voice of VOICE_OPTIONS) {
    assert.match(voice.label, /^(肥鱼音色 \d+（[女男]）|chubby fish voice \d+ \((female|male)\))$/, voice.id);
    for (const name of forbidden) {
      assert.equal(voice.label.includes(name), false, voice.label + ' leaks ' + name);
      assert.equal(voice.desc.includes(name), false, voice.id + ' desc leaks ' + name);
    }
  }
});

// 用户要求：英文音色后面**不显示**它是英音还是美音（下拉与试听页都不显示）。
test('English voices carry no accent descriptor anywhere user visible', async () => {
  const ACCENT = /英式|美式|英音|美音|British|American/i;
  for (const voice of VOICE_OPTIONS) {
    assert.equal(ACCENT.test(voice.label), false, voice.id + ' label');
    assert.equal(ACCENT.test(voice.desc), false, voice.id + ' desc');
    if (voice.language === 'en') {
      assert.equal(voice.desc, '', voice.id + ' must have no descriptor at all');
    }
  }
  // 试听页面对官方那份「口音」特质也做同样过滤，不能只改产品下拉。
  const { readFile } = await import('node:fs/promises');
  // 清洗只允许发生在服务端。客户端组件 import display-trait 会把口音正则整本打进浏览器
  // chunk —— 生产构建实测能在 .next/static/chunks 里翻到「英式」「美式」，
  // 也就是「用来抹掉口音的东西自己泄漏了口音词」。
  const list = await readFile(new URL('../src/app/qwen-voices/audition-list.tsx', import.meta.url), 'utf8');
  assert.equal(list.includes('display-trait'), false, 'the client component must not import the accent filter');
  assert.equal(list.includes('displayTrait('), false, 'the client component must not call the accent filter');
  const page = await readFile(new URL('../src/app/qwen-voices/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('displayTrait'), 'the server page must sanitise traits at the data source');
  // 过滤本身仍然必须针对「只有口音」的特质值。
  const filter = await readFile(new URL('../src/app/qwen-voices/display-trait.ts', import.meta.url), 'utf8');
  assert.ok(
    filter.includes('ACCENT_ONLY_TRAIT = /^(英式|美式)(女声|男声)$/'),
    'the filter must target accent-only traits',
  );
  const catalog = await readFile(new URL('../src/lib/ai/qwen-voices.ts', import.meta.url), 'utf8');
  assert.equal(
    /trait: '(英式|美式)[^']*'/.test(catalog),
    false,
    'the catalog itself must not carry an accent as a renderable trait',
  );
});

// 用户要求：女角色只看中文女+英文女（中文在前）；男角色只看中文男+英文男（中文在前）。
test('the dropdown is gender scoped with Chinese voices first', () => {
  const female = getVoicesForGender('female');
  assert.deepEqual(female.slice(0, 7).map((v) => v.id), [...KEPT.femaleZh]);
  assert.deepEqual(female.slice(7).map((v) => v.id), [...KEPT.femaleEn]);
  assert.equal(female.every((v) => v.gender === 'female'), true);
  const male = getVoicesForGender('male');
  assert.deepEqual(male.slice(0, 7).map((v) => v.id), [...KEPT.maleZh]);
  assert.deepEqual(male.slice(7).map((v) => v.id), [...KEPT.maleEn]);
  assert.equal(male.every((v) => v.gender === 'male'), true);
  // 语言分组：中文那一段必须全部是 zh，英文那一段必须全部是 en。
  for (const list of [female, male]) {
    assert.deepEqual(list.map((v) => v.language).slice(0, 7), Array(7).fill('zh'));
  }
  assert.deepEqual(female.map((v) => v.language).slice(7), Array(6).fill('en'));
  assert.deepEqual(male.map((v) => v.language).slice(7), Array(5).fill('en'));
});

test('legacy voice ids keep resolving to a same-gender kept voice', () => {
  assert.equal(LEGACY_ALIASES.length, 19, 'legacy aliases must not shrink or grow');
  assert.equal(new Set(LEGACY_ALIASES.map((a) => a.id)).size, 19);
  for (const alias of LEGACY_ALIASES) {
    const resolved = resolveVoiceId(alias.id, alias.voice.gender);
    const target = VOICE_OPTIONS.find((v) => v.id === resolved);
    assert.ok(target, alias.id + ' did not resolve to a selectable voice');
    assert.equal(target.gender, alias.voice.gender, alias.id);
  }
});

test('every previously selectable and legacy id still resolves under the new table', () => {
  // Gemini 时代的 8 个可选音色 + 11 个历史平台 id，老 companion.voice_id 不能失声。
  const legacy = ['Zephyr', 'Leda', 'Laomedeia', 'Sulafat', 'Puck', 'Charon', 'Enceladus', 'Zubenelgenubi',
    'Chinese (Mandarin)_Gentle_Senior', 'qiaopi_mengmei', 'female-tianmei', 'danya_xuejie',
    'tianxin_xiaoling', 'female-yujie', 'Chinese (Mandarin)_Unrestrained_Young_Man',
    'lengdan_xiongzhang', 'Chinese (Mandarin)_Gentleman', 'Chinese (Mandarin)_Lyrical_Voice', 'chunzhen_xuedi'];
  for (const id of legacy) {
    assert.ok(isSelectableVoiceId(id), id);
    assert.ok(VOICE_OPTIONS.some((v) => v.id === resolveVoiceId(id)), id + ' has no target');
  }
  // 上一轮试验期的 68 目录里被裁掉的那些 id 也必须能落到一个同性别的保留音色上。
  for (const trimmed of ['longanlingxin_v3.1', 'longanfengyue_v3.1', 'longyuan_v3.1', 'longsanshu_v3.1']) {
    assert.ok(VOICE_OPTIONS.some((v) => v.id === resolveVoiceId(trimmed, 'female')), trimmed);
  }
});

test('unknown or missing voice ids fall back to the gender default', () => {
  assert.equal(DEFAULT_VOICE, 'voice-zh-f-01');
  assert.equal(DEFAULT_MALE_VOICE, 'voice-zh-m-01');
  assert.equal(resolveVoiceId(null, 'female'), DEFAULT_VOICE);
  assert.equal(resolveVoiceId(undefined, 'male'), DEFAULT_MALE_VOICE);
  assert.equal(resolveVoiceId('not-a-voice', 'female'), DEFAULT_VOICE);
  assert.equal(resolveVoiceId('not-a-voice', 'male'), DEFAULT_MALE_VOICE);
  assert.equal(resolveVoiceId('longanhuan', 'male'), DEFAULT_MALE_VOICE, '3.0-only id');
});

// 性别限制回来了：女角色不能选男声（用户明确要求下拉只显示同性别的音色）。
test('a voice from the other gender group is never accepted', () => {
  for (const male of [...KEPT.maleZh, ...KEPT.maleEn]) {
    assert.equal(isSelectableVoiceId(male, 'female'), false, male);
    assert.equal(resolveVoiceId(male, 'female'), DEFAULT_VOICE, male);
  }
  for (const female of [...KEPT.femaleZh, ...KEPT.femaleEn]) {
    assert.equal(isSelectableVoiceId(female, 'male'), false, female);
    assert.equal(resolveVoiceId(female, 'male'), DEFAULT_MALE_VOICE, female);
  }
});

test('the selectable guard accepts own-gender ids and aliases but nothing else', () => {
  assert.equal(isSelectableVoiceId('voice-zh-f-01', 'female'), true);
  assert.equal(isSelectableVoiceId('voice-en-f-01', 'female'), true);
  assert.equal(isSelectableVoiceId('voice-zh-m-01', 'male'), true);
  assert.equal(isSelectableVoiceId('Sulafat', 'female'), true);
  assert.equal(isSelectableVoiceId('Chunzhen_xuedi', 'male'), false, 'aliases are case sensitive');
  assert.equal(isSelectableVoiceId('chunzhen_xuedi', 'male'), true);
  // 上游参数不是产品层 id：服务端必须先经 toPublicVoiceId 转换。
  assert.equal(isSelectableVoiceId('anyuqing_v3.1', 'female'), false);
  assert.equal(isSelectableVoiceId('longanhuan', 'male'), false);
  assert.equal(isSelectableVoiceId('not-a-voice', 'female'), false);
  assert.equal(isSelectableVoiceId('', 'female'), false);
  assert.equal(isSelectableVoiceId(null, 'female'), false);
  assert.equal(isSelectableVoiceId(undefined, 'male'), false);
  // 不给 gender 时只看「是不是一个真实存在的音色」（供非伴侣语境使用）。
  assert.equal(isSelectableVoiceId('voice-zh-m-01'), true);
  assert.equal(isSelectableVoiceId('not-a-voice'), false);
});

// 产品层只见代号；代号到上游参数的映射由服务端对照表负责，两边必须严丝合缝，
// 否则会在合成那一刻才抛「No upstream voice mapped」。
test('every selectable voice maps to a real Qwen catalog voice', async () => {
  const { isQwenVoiceId } = await import('../src/lib/ai/qwen-voices');
  const { upstreamVoiceIdFor } = await import('../src/lib/ai/qwen-voice-map');
  for (const voice of VOICE_OPTIONS) {
    assert.ok(isQwenVoiceId(upstreamVoiceIdFor(voice.id)), 'no catalog voice for ' + voice.id);
  }
  for (const alias of LEGACY_ALIASES) {
    const resolved = resolveVoiceId(alias.id, alias.voice.gender);
    assert.ok(isQwenVoiceId(upstreamVoiceIdFor(resolved)), alias.id);
  }
});
