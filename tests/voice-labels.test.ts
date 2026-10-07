import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { VOICE_OPTIONS, formatVoiceLabel, getVoicesForGender } from '../src/lib/characters';

/**
 * 音色代号算式（契约 t3，依据计划 §2 第 5–6 行）。
 *
 * 核心口径：**英文形由 `option.id` 推导，不手工维护第二份英文字符串**。
 * 所以这一条测试的重点不是「字符串对不对」，而是：
 *   - 把 `label` 篡改掉，英文输出**照样**由 id 得出（证明是算式不是查表）；
 *   - 编号 = 组内序号（id 尾段去掉前导 0），与数组顺序、与中文 `label` 的编号三方一致；
 *   - 两种语言的输出都不含任何上游音色原名（`Sulafat` / `Leda` / `Zephyr` / `Laomedeia` /
 *     `Charon` … —— 上游名只允许存在于服务端的 `qwen-voice-map` / `qwen-voices`）。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 扫源码前先剥注释（照 tests/character-palette.test.ts / tests/palette-resolver.test.ts）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CJK = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** 由 id 独立推出期望代号（与实现同口径，但写在测试里 —— 实现改成查表就会红）。 */
function expectedFromId(id: string): string {
  const match = /^voice-(zh|en)-([fm])-(\d+)$/.exec(id);
  assert.ok(match, 'id must be a codename: ' + id);
  const side = match[2] === 'f' ? 'female' : 'male';
  return `chubby fish voice ${Number(match[3])} (${side})`;
}

test('zh-CN returns the existing Chinese label untouched', () => {
  for (const option of VOICE_OPTIONS) {
    assert.equal(formatVoiceLabel(option, 'zh-CN'), option.label, option.id);
  }
  assert.equal(formatVoiceLabel(VOICE_OPTIONS[0]!, 'zh-CN'), '肥鱼音色 1（女）');
});

test('en derives `chubby fish voice N (female|male)` from the id alone', () => {
  for (const option of VOICE_OPTIONS) {
    assert.equal(formatVoiceLabel(option, 'en'), expectedFromId(option.id), option.id);
  }
  // 计划里点名的示例口径。
  const byId = new Map(VOICE_OPTIONS.map((option) => [option.id, option]));
  assert.equal(formatVoiceLabel(byId.get('voice-zh-f-01')!, 'en'), 'chubby fish voice 1 (female)');
  assert.equal(formatVoiceLabel(byId.get('voice-zh-m-07')!, 'en'), 'chubby fish voice 7 (male)');
  assert.equal(formatVoiceLabel(byId.get('voice-en-f-06')!, 'en'), 'chubby fish voice 6 (female)');
  assert.equal(formatVoiceLabel(byId.get('voice-en-m-05')!, 'en'), 'chubby fish voice 5 (male)');
});

test('the English form is computed, not stored: a tampered label cannot change it', () => {
  for (const option of VOICE_OPTIONS) {
    const tampered = { ...option, label: 'TAMPERED-EN-LABEL' };
    assert.equal(formatVoiceLabel(tampered, 'en'), expectedFromId(option.id), option.id);
    // 反过来：zh-CN 仍然只认 label（中文代号是既有字符串，不许被算式改写）。
    assert.equal(formatVoiceLabel(tampered, 'zh-CN'), 'TAMPERED-EN-LABEL', option.id);
  }
});

test('nothing in the module keeps a second English label copy', () => {
  const source = stripComments(read('src/lib/characters.ts'));
  for (const forbidden of ['labelEn', 'labelEnUs', 'label_en', 'labelEnglish', 'englishLabel', 'labelByLocale']) {
    assert.equal(source.includes(forbidden), false, 'characters.ts must not carry ' + forbidden);
  }

  // 英文代号字面量只允许有两处来源：11 个英文音色的既有 label，以及算式里那一个模板。
  const literals = source.match(/chubby fish voice/g) ?? [];
  assert.equal(literals.length, 12, 'only the 11 English labels + the one template may spell the codename');

  // 算式本体：必须按 id 推导（模板含 Number(digits)），不得出现任何写死的编号或 id 分支。
  const start = source.indexOf('export function formatVoiceLabel');
  assert.ok(start > 0, 'formatVoiceLabel must exist in characters.ts');
  const fn = source.slice(start, source.indexOf('\n}', start));
  assert.match(fn, /chubby fish voice \$\{Number\(digits\)\}/);
  assert.doesNotMatch(fn, /chubby fish voice \d/, 'the English form must not hardcode a number');
  assert.doesNotMatch(fn, /===\s*'voice-|switch\s*\(|\.find\(|Record</, 'no per-id lookup table is allowed');
});

test('numbering is the within-group ordinal: id tail, array order and zh label all agree', () => {
  for (const language of ['zh', 'en'] as const) {
    for (const gender of ['female', 'male'] as const) {
      const group = VOICE_OPTIONS.filter((o) => o.language === language && o.gender === gender);
      group.forEach((option, index) => {
        const tail = option.id.split('-').pop()!;
        assert.equal(Number(tail), index + 1, option.id + ' must be group ordinal ' + (index + 1));
        assert.equal(formatVoiceLabel(option, 'en'), `chubby fish voice ${index + 1} (${option.gender === 'female' ? 'female' : 'male'})`);
      });
    }
  }
  assert.equal(getVoicesForGender('female').filter((o) => o.language === 'zh').length, 7);
  assert.equal(getVoicesForGender('male').filter((o) => o.language === 'zh').length, 7);
  assert.equal(getVoicesForGender('female').filter((o) => o.language === 'en').length, 6);
  assert.equal(getVoicesForGender('male').filter((o) => o.language === 'en').length, 5);
});

test('neither locale ever shows an upstream voice name', () => {
  // 上游原名（含 19 个旧别名里的厂商音色名）一个都不许出现。
  const upstreamNames = [
    'Sulafat', 'Leda', 'Zephyr', 'Laomedeia', 'Charon', 'Puck', 'Enceladus',
    'Zubenelgenubi', 'Aoede', 'Callirrhoe', 'Autonoe', 'Achernar', 'Gacrux', 'Vindemiatrix',
  ];
  for (const option of VOICE_OPTIONS) {
    for (const locale of ['zh-CN', 'en'] as const) {
      const label = formatVoiceLabel(option, locale);
      assert.notEqual(label.trim(), '', option.id + ' ' + locale);
      if (locale === 'en') {
        // 英文形必须是纯 ASCII 代号（中文 `label` 是既有中文数据，不在本次范围内）。
        assert.equal(CJK.test(label), false, option.id + ' en must not contain CJK: ' + label);
        assert.match(label, /^chubby fish voice \d+ \((female|male)\)$/, option.id);
      }
      for (const name of upstreamNames) {
        assert.equal(label.toLowerCase().includes(name.toLowerCase()), false, label + ' leaks ' + name);
      }
      for (const legacy of option.legacyIds ?? []) {
        assert.equal(label.toLowerCase().includes(legacy.toLowerCase()), false, label + ' leaks legacy id ' + legacy);
      }
    }
  }
});

test('descEn lands on the 14 Chinese voices only; English voices stay empty in both fields', () => {
  const zh = VOICE_OPTIONS.filter((option) => option.language === 'zh');
  const en = VOICE_OPTIONS.filter((option) => option.language === 'en');
  assert.equal(zh.length, 14);
  assert.equal(en.length, 11);

  for (const option of zh) {
    assert.ok(option.desc.trim().length > 0, option.id + ' keeps its Chinese desc');
    assert.ok(option.descEn.trim().length > 0, option.id + '.descEn must not be empty');
    assert.equal(CJK.test(option.descEn), false, option.id + '.descEn must be English: ' + option.descEn);
    assert.match(option.descEn, /^[A-Za-z][A-Za-z ,'-]*$/, option.id + '.descEn must be an adjective phrase');
    // 英文描述词不得引入口音口径（用户要求不显示英音/美音）。
    assert.equal(/British|American|accent/i.test(option.descEn), false, option.id + '.descEn must not describe an accent');
  }

  for (const option of en) {
    assert.equal(option.desc, '', option.id + '.desc must stay empty');
    assert.equal(option.descEn, '', option.id + '.descEn must stay empty');
  }
});
