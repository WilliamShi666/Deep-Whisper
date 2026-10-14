import assert from 'node:assert/strict';
import test from 'node:test';
import { DEEPSEEK_WALLPAPER_PLAN } from './support/deepseek-wallpaper-plan';

test('locks the final 40-wallpaper coverage matrix', () => {
  assert.equal(DEEPSEEK_WALLPAPER_PLAN.length, 40);
  assert.equal(new Set(DEEPSEEK_WALLPAPER_PLAN.map((entry) => entry.id)).size, 40);

  for (const gender of ['female', 'male'] as const) {
    const entries = DEEPSEEK_WALLPAPER_PLAN.filter((entry) => entry.gender === gender);
    assert.equal(entries.length, 20, gender);
    assert.equal(entries.filter((entry) => entry.style === 'chibi').length, 8, gender + ' chibi');
    assert.equal(entries.filter((entry) => entry.style === 'normal').length, 12, gender + ' normal');
    assert.equal(entries.filter((entry) => entry.composition === 'env').length, 10, gender + ' env');
    assert.equal(entries.filter((entry) => entry.composition === 'close').length, 10, gender + ' close');
  }

  for (const characterKey of [
    'deepseek_f_01',
    'deepseek_f_02',
    'deepseek_f_03',
    'deepseek_f_04',
    'deepseek_m_01',
    'deepseek_m_02',
    'deepseek_m_03',
    'deepseek_m_04',
  ] as const) {
    const entries = DEEPSEEK_WALLPAPER_PLAN.filter((entry) => entry.characterKey === characterKey);
    assert.equal(entries.length, 5, characterKey);
    assert.equal(entries.filter((entry) => entry.style === 'chibi').length, 2, characterKey + ' chibi');
    assert.equal(entries.filter((entry) => entry.style === 'normal').length, 3, characterKey + ' normal');
  }
});
