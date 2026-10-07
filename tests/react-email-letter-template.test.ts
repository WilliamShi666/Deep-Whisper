import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { scanSource } from './support/i18n-cjk';

const componentPath = new URL('../src/lib/email/companion-letter-email.tsx', import.meta.url);
const COMPONENT_FILE = 'src/lib/email/companion-letter-email.tsx';

test('the companion letter uses a reusable React Email component with a dreamy blue-and-romantic palette', () => {
  assert.equal(existsSync(componentPath), true, 'the React Email component must exist');
  const source = readFileSync(componentPath, 'utf8');

  assert.match(source, /@react-email\/components/);
  assert.match(source, /#F1F8FF/i, 'use a very light dream-blue background');
  assert.match(source, /#DDEEFF/i, 'use a light-blue gradient fallback');
  assert.match(source, /#C7E4FF/i, 'use a clear ice-blue panel instead of a grey or violet header');
  assert.match(source, /radial-gradient/i, 'use a progressive-enhancement aura rather than a heavy banner');
  assert.match(source, /color-scheme/i, 'request light rendering from clients that honor the standard');
  assert.match(source, /Georgia/i, 'use a graceful serif title and signature fallback');
  assert.match(source, /Preview/);
  assert.match(source, /unsubscribeUrl/);
  assert.doesNotMatch(source, /#C6B8F2|#9A78C7|#FFC0CB/i, 'do not retain the rejected violet or pink accents');
  assert.doesNotMatch(source, /#000000/i, 'do not use pure black in the letter');
  assert.doesNotMatch(source, /<Button\b/, 'letters remain letters, not marketing CTAs');
});

/**
 * 模板按 `locale` 参数化（U6 / t10）：9 条文案住 `messages/{zh-CN,en}/email.ts`。
 *
 * 这条断言取代了原来直接扫 tsx 源码找「星光来信」的写法 —— 判据的**意图不变**
 * （中文信的抬头仍然是「星光来信」），但位置从模板源码挪到了**中文词典**
 * （模板里再出现中文字面量就会在英文态漏出来，正是要防的事）。
 */
test('the letter copy lives in the dictionaries, and the template itself carries no CJK literal', () => {
  const zh = readFileSync(new URL('../src/lib/i18n/messages/zh-CN/email.ts', import.meta.url), 'utf8');
  const en = readFileSync(new URL('../src/lib/i18n/messages/en/email.ts', import.meta.url), 'utf8');
  assert.match(zh, /星光来信/, '中文抬头仍要说「星光来信」');
  assert.match(en, /Starlight Letter/, '英文抬头要有一份对应文案');

  const source = readFileSync(componentPath, 'utf8');
  assert.deepEqual(scanSource(COMPONENT_FILE, source), [], 'tsx 里不得残留中文字面量（注释不计，门禁口径）');
  for (const key of ['email.letter.kicker', 'email.letter.title', 'email.letter.unsubscribe_action']) {
    assert.ok(source.includes(key), `模板必须从字典取 ${key}`);
  }
});
