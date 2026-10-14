import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  composite,
  contrastRatio,
  oklchToRgb,
  relativeLuminance,
  selectorBlock,
  token,
  type Rgb,
} from './support/wcag';

/**
 * 梦幻玫瑰表面（`[data-surface='dream-rose']`）的文字对比度门禁（契约 t10 / 队内 t5）。
 *
 * 与 `tests/dream-blue-contrast.test.ts` 是**镜像**关系：同样是「真值从 globals.css 取、
 * 真算 WCAG 对比度、按该表面实际合成出的底色逐一断言」，但有两处刻意不同：
 *
 *   1. **取块方式**：dream-blue-contrast 的 `selectorBlock` 在模块加载时对**未剥注释**的
 *      CSS 做裸 `css.indexOf(selector)`，而 `globals.css` 的注释里就写着同一个选择器字符串
 *      （`:425` 的梦蓝说明注释）。它今天还能取到正确的块，纯属注释里没有 `{` 的巧合
 *      —— 一旦有人在注释里写示例 CSS，那块门禁会静默变绿。本文件改用共享的
 *      `tests/support/wcag.ts` 的 `selectorBlock`：**先剥注释、再按行首锚定**
 *      （内部正则 `^<selector>\s*\{` + `m`），并且下面显式断言一次「行首锚定能直接命中」。
 *   2. **算法复用**：oklch→sRGB→线性化→相对亮度、alpha 合成、取值 token 全部从共享模块 import，
 *      不在这里复制第二份实现（t5 的 `tests/palette-resolver.test.ts` 自证了那些转换器）。
 *
 * 为什么这个表面必须有门禁：梦幻玫瑰是全新表面，`.dark` 今天没有任何 AA 门禁；
 * 而 `--destructive` 本身就是红色系，红字压红底最容易掉到 AA 以下。同时这里钉死
 * 一条陷阱判据：**不得直接把 `.dark` 的变量拷进来** —— `.dark` 的
 * `--primary` / `--primary-foreground` 实测只有 3.33:1，必须自带一对主色。
 */

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

const ROSE_SELECTOR = "[data-surface='dream-rose']";

// 行首锚定：块必须自己占一整行的行首（不是注释里的提及，也不是别处的同名子串）。
assert.match(
  css,
  /^\[data-surface='dream-rose'\]\s*\{/m,
  `globals.css 必须按行首出现 ${ROSE_SELECTOR} { 的完整表面块`,
);

const surface = selectorBlock(css, ROSE_SELECTOR);

const background = token(surface, 'background');
const card = token(surface, 'card');
const muted = token(surface, 'muted');
const foreground = token(surface, 'foreground');
const mutedForeground = token(surface, 'muted-foreground');
const destructive = token(surface, 'destructive');
const primary = token(surface, 'primary');
const primaryForeground = token(surface, 'primary-foreground');

/**
 * 该表面实际合成出来的底色（与 dream-blue 同款清单，逐项标注产生它的类名）。
 * 支付两页与入口三页用到的类名没有超出这份清单；值变了或有新组合时回来更新这里。
 */
const backgrounds: Array<{ name: string; color: Rgb }> = [
  { name: 'bg-background', color: background },
  { name: 'bg-card/60（面板）', color: composite(card, 0.6, background) },
  { name: 'bg-muted', color: muted },
  { name: 'bg-muted/40 叠在 bg-card/60 上（列表行）', color: composite(muted, 0.4, composite(card, 0.6, background)) },
  { name: 'bg-muted/40 叠在 bg-background 上', color: composite(muted, 0.4, background) },
];

const AA_NORMAL_TEXT = 4.5;

test('the shared colour converter matches the WCAG reference points', () => {
  // 转换器先自证，否则后面的断言只是在验自己的 bug（共享实现的自证也在 palette-resolver 里）
  assert.deepEqual(oklchToRgb(1, 0, 0).srgb.map((c) => Math.round(c * 255)), [255, 255, 255]);
  assert.deepEqual(oklchToRgb(0, 0, 0).srgb.map((c) => Math.round(c * 255)), [0, 0, 0]);
  assert.equal(Number(contrastRatio(oklchToRgb(1, 0, 0), oklchToRgb(0, 0, 0)).toFixed(2)), 21);
});

test('every body-text colour clears WCAG AA on every background the surface renders', () => {
  const textColors: Array<{ name: string; color: Rgb }> = [
    { name: '--foreground', color: foreground },
    { name: '--muted-foreground', color: mutedForeground },
    // 错误文案：这个表面里 --destructive 只当文字色用，没有任何 bg-destructive
    { name: '--destructive', color: destructive },
  ];

  for (const text of textColors) {
    for (const bg of backgrounds) {
      const ratio = contrastRatio(text.color, bg.color);
      // 断言写「≥ 4.5」而不是写死比值：浮点实现差异会落在小数点后第二位。
      assert.ok(
        ratio >= AA_NORMAL_TEXT,
        `${text.name} on ${bg.name} 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${AA_NORMAL_TEXT}:1`,
      );
    }
  }
});

test('the primary button pair clears WCAG AA', () => {
  // 这是「不得拷贝 .dark 变量」那条提醒的判据：.dark 的同一对只有 3.33:1。
  const ratio = contrastRatio(primaryForeground, primary);
  assert.ok(
    ratio >= AA_NORMAL_TEXT,
    `--primary-foreground on --primary 只有 ${ratio.toFixed(2)}:1（.dark 那一对是 3.33，拷贝进来必红）`,
  );
});

test('the rose surface keeps its own destructive colour bright enough for muted text', () => {
  const darkBlock = selectorBlock(css, '.dark');
  const darkDestructive = token(darkBlock, 'destructive');
  assert.ok(
    relativeLuminance(destructive) >= relativeLuminance(darkDestructive) * 0.98,
    '表面自己的 destructive 不该比 .dark 的更暗，否则 muted 底上会掉到 AA 以下',
  );
});

// ── 第五轮 U5（契约 t38）：两块浅色表面（soft）──────────────────────────────

/** 判据 §4.9 判据 6 要求「全套 token 一个都不能少」，这里逐名点名。 */
const SOFT_SURFACE_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
] as const;

/** 判据 §4.9 判据 6 点名的五对（两块各跑一遍）。 */
const SOFT_SURFACE_PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['primary-foreground', 'primary'],
  ['sidebar-foreground', 'sidebar'],
  ['muted-foreground', 'background'],
] as const;

test('the two soft surfaces are light scopes with a full token set and AA text pairs', () => {
  const surfaces: ReadonlyArray<readonly [string, string]> = [
    ["[data-surface='dream-rose-soft']", '梦幻玫瑰浅色'],
    ["[data-surface='dream-blue-soft']", '梦幻蓝浅色'],
  ];

  for (const [selector, name] of surfaces) {
    const block = selectorBlock(css, selector);
    assert.match(block, /color-scheme:\s*light/, `${name} 必须声明 color-scheme: light`);
    for (const tokenName of SOFT_SURFACE_TOKENS) {
      assert.match(
        block,
        new RegExp(`--${tokenName}:`),
        `${name} 缺 token --${tokenName}（浅色变体必须是一整套，缺一个就会在三区里串色）`,
      );
    }
    for (const [fg, bg] of SOFT_SURFACE_PAIRS) {
      const ratio = contrastRatio(token(block, fg), token(block, bg));
      assert.ok(
        ratio >= AA_NORMAL_TEXT,
        `${name} 的 --${fg} on --${bg} 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${AA_NORMAL_TEXT}:1`,
      );
    }
  }
});

test('the soft surfaces are additive: the dark pair and .dark keep their own values', () => {
  // 只新增两块：既有 dream-rose / dream-blue / .dark 的取值一字不改（红线）。
  const rose = selectorBlock(css, "[data-surface='dream-rose']");
  const blue = selectorBlock(css, "[data-surface='dream-blue']");
  assert.match(rose, /--background:\s*oklch\(0\.19 0\.045 15\)/, 'dream-rose 的 --background 不得被顺手改掉');
  assert.match(blue, /--background:\s*oklch\(0\.19 0\.045 245\)/, 'dream-blue 的 --background 不得被顺手改掉');
  assert.match(selectorBlock(css, '.dark'), /--primary:\s*oklch\(0\.645 0\.20 15\)/, '.dark 的 primary 红线不变');
});
