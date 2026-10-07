import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHARACTER_PRESETS, type DisplayLocale } from '../src/lib/characters';
import { characterDisplayName, formatVoiceLabel } from '../src/lib/character-display';

/**
 * 角色显示名纯函数（契约 t3）。
 *
 * 判据三条：
 *   1. zh-CN 逐字符返回既有 `defaultName`（中文态行为不变）；
 *   2. en 返回 `${nameRoman} · ${en.name}`，分隔符是**中点 U+00B7 且前后各一个空格**，
 *      且整串**不含汉字**（用户硬约束「英文版角色名只出拉丁字母」）；
 *   3. 该模块**零 React / 零 DOM / 零 IO** —— 客户端组件、服务端 route 与测试都能直接引用。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const CJK = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** §2.1 定稿表（手抄）。 */
const NAME_TABLE: ReadonlyArray<readonly [string, string, string]> = [
  ['deepseek_f_01', 'Lanxi', 'Marina'],
  ['deepseek_f_02', 'Zhimo', 'Poppy'],
  ['deepseek_f_03', 'Yucheng', 'Clara'],
  ['deepseek_f_04', 'Xingxun', 'Lyra'],
  ['deepseek_m_01', 'Yanshen', 'Simon'],
  ['deepseek_m_02', 'Cangyue', 'Caleb'],
  ['deepseek_m_03', 'Zhilan', 'Theo'],
  ['deepseek_m_04', 'Lingchao', 'Leo'],
];

test('zh-CN returns the existing Chinese name, character for character', () => {
  for (const [index, [key]] of NAME_TABLE.entries()) {
    const preset = CHARACTER_PRESETS[index];
    assert.ok(preset, key);
    assert.equal(characterDisplayName(preset, 'zh-CN'), preset.defaultName, key);
  }
  assert.equal(characterDisplayName(CHARACTER_PRESETS[0]!, 'zh-CN'), '澜汐');
});

test('en returns `pinyin · English` with U+00B7 and single spaces around it', () => {
  for (const [index, [key, roman, english]] of NAME_TABLE.entries()) {
    const preset = CHARACTER_PRESETS[index];
    assert.ok(preset, key);
    const name = characterDisplayName(preset, 'en');
    assert.equal(name, roman + ' \u00B7 ' + english, key);
    // 显式钉住分隔符字符与空格：中点 U+00B7（不是间隔号 U+30FB、不是句点）。
    assert.equal(name, `${preset.nameRoman} \u00B7 ${preset.en.name}`);
    assert.equal(name.includes('\u00B7'), true, key + ' must use U+00B7');
    assert.equal(name.includes('\u30FB'), false, key + ' must not use the CJK katakana middle dot');
    assert.equal(name.match(/ /g)?.length, 2, key + ' must have exactly two spaces');
  }
  assert.equal(characterDisplayName(CHARACTER_PRESETS[0]!, 'en'), 'Lanxi \u00B7 Marina');
});

test('the English display name never contains a Han character', () => {
  for (const preset of CHARACTER_PRESETS) {
    const name = characterDisplayName(preset, 'en');
    assert.equal(CJK.test(name), false, preset.key + ' leaks CJK: ' + name);
    assert.match(name, /^[A-Za-z]+ \u00B7 [A-Za-z]+$/, preset.key + ' must be Latin letters + separator');
  }
});

test('an unknown locale falls back to the Chinese name (default zh-CN, no invented translations)', () => {
  const preset = CHARACTER_PRESETS[0]!;
  for (const locale of ['fr', 'en-US', '', 'ZH-CN'] as unknown as DisplayLocale[]) {
    assert.equal(characterDisplayName(preset, locale), preset.defaultName, String(locale));
  }
});

test('character-display is a pure module: no React, DOM, IO or app imports', () => {
  const source = read('src/lib/character-display.ts');
  for (const forbidden of [
    /from\s+['"]react['"]/,
    /from\s+['"]react-dom/,
    /from\s+['"]next\//,
    /from\s+['"]node:/,
    /from\s+['"]fs['"]/,
    /from\s+['"]@\//,
    /from\s+['"]\.\.\//,
    /\bdocument\./,
    /\bwindow\./,
    /\bglobalThis\b/,
    /\bfetch\(/,
    /\bprocess\./,
  ]) {
    assert.doesNotMatch(source, forbidden, 'character-display.ts must stay pure: ' + forbidden);
  }
  // 显示的唯二入口都从这一个模块出去，UI 不必知道实现住在哪。
  assert.match(source, /export\s*\{[^}]*formatVoiceLabel[^}]*\}/);
  assert.match(source, /export function characterDisplayName/);
  assert.equal(typeof formatVoiceLabel, 'function');
});
