import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 深蓝表面（`[data-surface='dream-blue']`）的文字对比度门禁。
 *
 * 为什么要有这个文件：审查 L3 判定该表面的 `--destructive` 与 `--muted-foreground`
 * 达不到 WCAG AA，并按「4.90 → 3.52」给出了具体数值。复核发现那些数值是把
 * gamma 编码后的 sRGB 值**当成线性亮度**代入对比度公式得到的（常见误算）——
 * 同一组取值用 WCAG 2.1 规定的相对亮度（先线性化再按 0.2126/0.7152/0.0722 加权）
 * 算，被点名的 `--destructive` on `bg-card/60` 实际是 5.08，本来就达标。
 *
 * 但复核也发现一个**真实**的不达标组合：`--destructive` on `--muted` = 3.99。
 * 所以这件事不能靠嘴仗收尾，得有一条会红的门禁：真值从 globals.css 里取，
 * 真算 WCAG 对比度，按该表面实际合成出的底色逐一断言。
 */

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

// ── OKLCH → sRGB（含线性化）→ WCAG 对比度 ──

interface Rgb {
  /** WCAG 相对亮度用的线性分量 */
  lin: [number, number, number];
  /** 显示用的 gamma 编码分量，alpha 合成在這一侧进行 */
  srgb: [number, number, number];
}

function oklchToRgb(L: number, C: number, hueDeg: number): Rgb {
  const h = (hueDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin: [number, number, number] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return { lin, srgb: lin.map((c) => Math.min(1, Math.max(0, encode(c)))) as [number, number, number] };
}

/** WCAG 2.1 相对亮度：必须用线性分量，不能直接拿 gamma 编码值代入。 */
function relativeLuminance(color: Rgb): number {
  return 0.2126 * color.lin[0] + 0.7152 * color.lin[1] + 0.0722 * color.lin[2];
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** 半透明前景压在底色上（浏览器合成发生在 gamma 编码空间）。 */
function composite(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  const srgb = foreground.srgb.map(
    (c, i) => alpha * c + (1 - alpha) * background.srgb[i],
  ) as [number, number, number];
  const lin = srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return { lin, srgb };
}

// ── 从 CSS 里取真值 ──

/** 取某个选择器块（截到下一个顶层 `}`）。 */
function selectorBlock(selector: string): string {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `必须能在 globals.css 里定位 ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  assert.ok(open >= 0 && close > open, `${selector} 必须是一个完整的块`);
  return css.slice(open + 1, close);
}

/** 从块里读一个 oklch(L C H) 令牌。 */
function token(block: string, name: string): Rgb {
  const match = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(block);
  assert.ok(match, `块里必须有 --${name} 的 oklch 定义`);
  return oklchToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

const surface = selectorBlock("[data-surface='dream-blue']");

const background = token(surface, 'background');
const card = token(surface, 'card');
const muted = token(surface, 'muted');
const foreground = token(surface, 'foreground');
const mutedForeground = token(surface, 'muted-foreground');
const destructive = token(surface, 'destructive');
const primary = token(surface, 'primary');
const primaryForeground = token(surface, 'primary-foreground');

/**
 * 该表面实际合成出来的底色。
 * 每一项都标注了产生它的类名，值变了或有新组合时应当回来更新这里。
 */
const backgrounds: Array<{ name: string; color: Rgb }> = [
  { name: 'bg-background', color: background },
  { name: 'bg-card/60（面板）', color: composite(card, 0.6, background) },
  { name: 'bg-muted', color: muted },
  { name: 'bg-muted/40 叠在 bg-card/60 上（列表行）', color: composite(muted, 0.4, composite(card, 0.6, background)) },
  { name: 'bg-muted/40 叠在 bg-background 上', color: composite(muted, 0.4, background) },
];

const AA_NORMAL_TEXT = 4.5;

test('the colour converter matches the WCAG reference points', () => {
  // 转换器先自证，否则后面的断言只是在验自己的 bug
  assert.deepEqual(oklchToRgb(1, 0, 0).srgb.map((c) => Math.round(c * 255)), [255, 255, 255]);
  assert.deepEqual(oklchToRgb(0, 0, 0).srgb.map((c) => Math.round(c * 255)), [0, 0, 0]);
  assert.equal(Number(contrastRatio(oklchToRgb(1, 0, 0), oklchToRgb(0, 0, 0)).toFixed(2)), 21);
  // 线性化的反面教材：#767676 对白按 WCAG 是 4.54，把编码值当线性亮度会算成 5.59
  const grey = { lin: [0, 0, 0], srgb: [0, 0, 0] } as Rgb;
  const encoded = 118 / 255;
  const gamma = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  grey.srgb = [encoded, encoded, encoded];
  grey.lin = [gamma(encoded), gamma(encoded), gamma(encoded)];
  assert.equal(Number(contrastRatio(grey, oklchToRgb(1, 0, 0)).toFixed(2)), 4.54);
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
      assert.ok(
        ratio >= AA_NORMAL_TEXT,
        `${text.name} on ${bg.name} 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${AA_NORMAL_TEXT}:1`,
      );
    }
  }
});

test('the primary button pair clears WCAG AA', () => {
  const ratio = contrastRatio(primaryForeground, primary);
  assert.ok(ratio >= AA_NORMAL_TEXT, `--primary-foreground on --primary 只有 ${ratio.toFixed(2)}:1`);
});

test('the surface keeps its own destructive colour instead of drifting back to .dark', () => {
  // 深蓝表面刻意不沿用 .dark 的红（hue 22.216），但它必须比 .dark 的值更亮才够对比。
  const darkBlock = selectorBlock('.dark');
  const darkDestructive = token(darkBlock, 'destructive');
  assert.ok(
    relativeLuminance(destructive) >= relativeLuminance(darkDestructive) * 0.98,
    '表面自己的 destructive 不该比 .dark 的更暗，否则 muted 底上会掉到 AA 以下',
  );
});
