import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BRAND_ICONS, BRAND_NAME, BRAND_SHORT_NAME } from '../src/lib/brand-assets';
import { BRAND_SHARE_IMAGE } from '../src/lib/brand-metadata';

/**
 * 品牌资产门禁。
 *
 * **t55：本文件不再静态 import `src/app/manifest.ts`**。原因不是「测试不好写」，而是
 * manifest 现在要按访客语言取文案（`getServerLocale()` → `next/headers` → `server-only`），
 * 单测里静态 import 它会在 import 期直接抛
 * `This module cannot be imported from a Client Component module`（t51 实测过这堵墙并因此回退）。
 * 图标常量因此抽到客户端安全的 `src/lib/brand-assets.ts`，**断言一条都没有放宽**：
 * 仍然逐张核真实 PNG 的宽高、核图标集合、核分享卡尺寸与体积上限。
 */

const file = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url));
/** 读源码前先剥注释：注释里解释约定时会出现同样的字符串（照 dream-blue-theme / palette-resolver 的做法）。 */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const source = (relative: string) => stripComments(readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'));
function pngSize(relative: string) {
  const bytes = file(relative);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

test('the share card is a real public PNG matching its declared dimensions and X size limit', () => {
  assert.deepEqual(pngSize(`public${BRAND_SHARE_IMAGE.url}`), {
    width: BRAND_SHARE_IMAGE.width, height: BRAND_SHARE_IMAGE.height,
  });
  assert.ok(file(`public${BRAND_SHARE_IMAGE.url}`).byteLength < 5 * 1024 * 1024);
  assert.ok(BRAND_SHARE_IMAGE.alt.includes('Deep Whisper'));
});

test('all install icons and Apple touch icon have the actual declared dimensions', () => {
  assert.ok(BRAND_ICONS.length >= 3, '安装图标集合不得缩水（any/maskable 都要在）');
  const seen = new Set<string>();
  for (const icon of BRAND_ICONS) {
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(`public${icon.src}`), { width, height }, `${icon.src} 的真实尺寸必须等于声明`);
    assert.equal(seen.has(icon.src), false, `${icon.src} 不得重复声明`);
    seen.add(icon.src);
  }
  assert.equal(new Set(BRAND_ICONS.map((icon) => icon.purpose)).size, 2, 'any 与 maskable 两种用途都要有');
  assert.deepEqual(pngSize('src/app/apple-icon.png'), { width: 180, height: 180 });
  assert.deepEqual(pngSize('src/app/icon.png'), { width: 512, height: 512 });
  assert.equal(file('src/app/favicon.ico').readUInt16LE(2), 1);
});

test('图标常量模块是客户端安全的（不得把 server-only 链拉进客户端可达模块）', () => {
  const assets = source('src/lib/brand-assets.ts');
  for (const forbidden of ["'server-only'", "from 'next/headers'", '@/lib/i18n-server']) {
    assert.equal(assets.includes(forbidden), false, `src/lib/brand-assets.ts 不得出现 ${forbidden}`);
  }
  // 反向：本测试也不得再 import manifest（否则又回到 t51 那堵墙）。
  const self = source('tests/brand-assets.test.ts');
  assert.equal(/from '\.\.\/src\/app\/manifest'/.test(self), false, '本测试不得静态 import src/app/manifest.ts');
});

test('manifest 改为按访客语言取文案，并使用共享图标常量（接线，不靠人眼）', () => {
  const manifestSource = source('src/app/manifest.ts');
  assert.match(manifestSource, /export default async function manifest\(\): Promise<MetadataRoute\.Manifest>/);
  assert.match(manifestSource, /await getServerLocale\(\)/);
  assert.match(manifestSource, /from '@\/lib\/i18n-server'/);
  assert.match(manifestSource, /BRAND_ICONS/);
  assert.match(manifestSource, /from '@\/lib\/brand-assets'/);
  assert.equal(BRAND_NAME, 'Deep Whisper');
  assert.equal(BRAND_SHORT_NAME, 'Deep Whisper');

  // 两种语言的 description：en 零 CJK；zh 逐字符等于改造前那串（H4）。
  const zh = /'zh-CN':\s*'([^']*)'/.exec(manifestSource)?.[1];
  const en = /\ben:\s*'([^']*)'/.exec(manifestSource)?.[1];
  assert.equal(zh, '你的 AI 恋人与深夜陪伴', 'zh 描述必须逐字符不变');
  assert.ok(en && en.trim().length > 0, 'en 描述不得为空');
  assert.doesNotMatch(en!, HAN, 'en 描述不得含汉字');
  assert.notEqual(en, zh, 'en 必须是英文重写');
});
