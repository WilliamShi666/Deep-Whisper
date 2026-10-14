/**
 * 共享取色 / WCAG 对比度工具（t5 契约，t10 的 dream-rose 门禁复用）。
 *
 * 为什么抽成共享模块：`tests/dream-blue-contrast.test.ts` 里有一份 oklch→sRGB→
 * 相对亮度的实现，但它把 `selectorBlock` 写成「模块加载时对**未剥注释**的 CSS 做裸
 * `indexOf`」，一旦注释里出现同一个选择器字符串就会定位到错误位置（既有陷阱）。
 * 新表面（dream-rose）与新断言都从这里取算法，避免把陷阱复制一遍。
 *
 * 关键约定：
 *   1. `relativeLuminance` 必须用**线性化**后的分量，不能把 gamma 编码值直接代入
 *      —— 后者是常见误算（`#767676` 对白会算成 5.59，真值是 4.54）。
 *   2. `alpha` 合成发生在 gamma 编码空间（浏览器行为），合成后再线性化。
 *   3. `selectorBlock` **先剥注释再定位**，并且只认行首锚定的选择器块。
 */

export interface Rgb {
  /** WCAG 相对亮度用的线性分量 */
  lin: [number, number, number];
  /** 显示用的 gamma 编码分量，alpha 合成在這一侧进行 */
  srgb: [number, number, number];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const encodeSrgb = (linear: number) => (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);

const decodeSrgb = (encoded: number) => (encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4);

/** OKLCH → sRGB（含线性化分量）。 */
export function oklchToRgb(L: number, C: number, hueDeg: number): Rgb {
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
  return {
    lin,
    srgb: [clamp01(encodeSrgb(lin[0])), clamp01(encodeSrgb(lin[1])), clamp01(encodeSrgb(lin[2]))],
  };
}

/** `#rgb` / `#rrggbb` → Rgb（玫瑰取值表是 hex，需要与 oklch 令牌同一个对比度入口）。 */
export function hexToRgb(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`不是合法的 hex 颜色：${hex}`);
  const srgb = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  return { srgb, lin: srgb.map(decodeSrgb) as [number, number, number] };
}

/** WCAG 2.1 相对亮度：必须用线性分量，不能直接拿 gamma 编码值代入。 */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * color.lin[0] + 0.7152 * color.lin[1] + 0.0722 * color.lin[2];
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** 半透明前景压在底色上（浏览器合成发生在 gamma 编码空间）。 */
export function composite(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  const srgb = foreground.srgb.map((c, i) => alpha * c + (1 - alpha) * background.srgb[i]) as [number, number, number];
  return { srgb, lin: srgb.map(decodeSrgb) as [number, number, number] };
}

/**
 * 去掉 CSS 注释，但**保留注释占据的换行**。
 *
 * 保留换行是为了让「行首锚定」在选择器定位时仍然有效：如果把多行注释整段删成空串，
 * 注释前后的两行会被拼成一行，`^selector\s*\{` 就再也匹配不到。
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => '\n'.repeat((comment.match(/\n/g) ?? []).length));
}

/**
 * 取某个选择器块（行首锚定，截到下一个顶层 `}`）。
 *
 * 必须先剥注释：`[data-surface='dream-blue']` 这个字符串在 `globals.css` 的注释里
 * 就出现过，裸 `indexOf` 会定位到注释里，从而把后面的注释内容当成块体。
 */
export function selectorBlock(css: string, selector: string): string {
  const stripped = stripCssComments(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}\\s*\\{`, 'm').exec(stripped);
  if (!match) throw new Error(`必须能在 CSS 里按行首定位到 ${selector}`);
  const open = stripped.indexOf('{', match.index);
  const close = stripped.indexOf('\n}', open);
  if (open < 0 || close <= open) throw new Error(`${selector} 必须是一个完整的块`);
  return stripped.slice(open + 1, close);
}

/** 从块里读一个 `oklch(L C H)` 令牌，真值来自 CSS 而不是测试里抄的常量。 */
export function token(block: string, name: string): Rgb {
  const match = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(block);
  if (!match) throw new Error(`块里必须有 --${name} 的 oklch 定义`);
  return oklchToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}
