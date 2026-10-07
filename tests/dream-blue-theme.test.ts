import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * 梦幻深蓝：开屏 / 登录 / 注册三页的表面主题。
 *
 * 设计约束（DESIGN.md「设计禁忌」）：
 *   - 禁止紫 / indigo / 蓝紫 AI 味渐变（这是当初加这条的真实目的）
 *   - 禁止科技蓝、赛博朋克风（冷硬高饱和、荧光、霓虹描边、网格线）
 *   - 允许梦幻深蓝：低饱和、带雾感夜感的恋爱蓝，与 DeepSeek 蓝白形象同族
 *
 * 作用域约束（本测试的核心）：聊天页的 8 套 UI 色调与角色气泡色都挂在
 * .dark / html[data-ui-theme=...] 上。深蓝若改全局变量，会连带改掉聊天页，
 * 因此必须作用域化到这三页自己的容器。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/**
 * 扫源码前先去掉注释（M5）。
 *
 * 之前这几条断言只做 `assert.match(source, /dream-blue/)`，而入口页的头注释里
 * 就写着 `[data-surface='dream-blue']` —— 即使把 JSX 上的属性整个删掉，
 * 断言仍然会通过。注释不是实现，必须先剥掉再扫。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 去掉 CSS 注释：注释里的数字不该被色板断言当成真值。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the deep-blue surface is scoped, never applied to the global dark theme', () => {
  const css = stripCssComments(read('src/app/globals.css'));

  // 必须有作用域化的深蓝主题块。
  assert.match(css, /\[data-surface='dream-blue'\]\s*\{/, '必须提供作用域化的深蓝表面主题');

  // 关键回归：不得在 .dark 块里写入蓝色 primary。
  // 聊天页的默认色调就是 .dark，改了它等于改了聊天页。
  // 从 ".dark {" 行首锚定，避开注释里出现的同一串字符。
  const darkBlock = /^\.dark\s*\{([\s\S]*?)^\}/m.exec(css);
  assert.ok(darkBlock, '必须能定位 .dark 变量块');
  assert.match(
    darkBlock![1],
    /--primary:\s*oklch\(0\.645 0\.20 15\)/,
    '.dark 的 primary 必须仍是原来的玫瑰色，深蓝不得渗进全局暗色主题',
  );
});

test('the deep-blue palette is a low-saturation blue, not purple or neon', () => {
  const css = stripCssComments(read('src/app/globals.css'));
  const block = /^\[data-surface='dream-blue'\]\s*\{([\s\S]*?)^\}/m.exec(css);
  assert.ok(block, '必须能定位深蓝主题块');

  const body = block![1];

  // oklch 的第二个分量是 chroma（饱和度）。梦幻蓝要低饱和，避免变成荧光/科技蓝。
  // destructive 是语义红，不属于"梦幻深蓝"的配色主张，单独排除。
  const surfaceColors = body
    .split('\n')
    .filter((line) => !/--destructive/.test(line))
    .join('\n');
  const chromas = [...surfaceColors.matchAll(/oklch\([\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(chromas.length > 0, '深蓝主题必须定义 oklch 颜色');
  const maxChroma = Math.max(...chromas);
  assert.ok(
    maxChroma <= 0.16,
    `最大饱和度 ${maxChroma} 过高：会变成科技蓝/荧光色，而不是梦幻深蓝`,
  );

  // oklch 的第三个分量是色相。蓝在 220-280，紫/indigo 在 280+。
  // 无彩色（chroma = 0，例如 oklch(1 0 0 / 11%) 的描边与输入底色）没有色相主张，
  // 它们在任何主题里都是中性灰，不构成"紫"的风险。
  const chromatic = surfaceColors
    .split('\n')
    .filter((line) => {
      const m = /oklch\([\d.]+\s+([\d.]+)/.exec(line);
      return m ? Number(m[1]) > 0 : false;
    })
    .join('\n');
  const hues = [...chromatic.matchAll(/oklch\([\d.]+\s+[\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(hues.length > 0, '深蓝主题必须定义 oklch 色相');
  for (const hue of hues) {
    assert.ok(
      hue >= 200 && hue < 280,
      `色相 ${hue} 不在蓝色区间 [200, 280)：紫色/indigo 是明确禁止的`,
    );
  }
});

test('the three entry surfaces resolve their palette through the shared entry point', () => {
  const surfaces = [
    ['开屏', 'src/app/onboarding/onboarding-client.tsx'], // t53：调色板派生住在客户端岛
    ['登录/注册', 'src/app/login/login-client.tsx'],
    ['入口', 'src/app/page.tsx'],
  ] as const;

  for (const [name, file] of surfaces) {
    const source = stripComments(read(file));
    /**
     * 刻意变更（t3 §5.3 第一行 / 契约 t10）——原断言是逐页必须含**字面量**
     * `data-surface="dream-blue"`。
     *
     * 为什么必须改：入口三页的默认表面从「恒蓝」变成了「按访客 palette 解析」
     * （未选择 → 梦幻玫瑰，选过蓝 → 梦幻蓝）。一个写死的字面量在语义上**不可能**同时
     * 表达「蓝用户」与「玫瑰用户」—— 保留它就只能靠把属性写成动态值再补一个假字面量，
     * 那是骗门禁。契约因此从「写了这个字面量」改成「**没有自行判断红蓝**，一律走共享
     * 解析入口，且表面由解析结果派生」。（表面块本身仍由本文件第 1 个 test 与
     * `tests/palette-surfaces.test.ts` 钉住，覆盖没有减少。）
     */
    assert.match(
      source,
      /usePaletteSurface\(\s*'entry'/,
      `${name}页必须走共享解析入口 usePaletteSurface('entry', …)`,
    );
    // 必须是真的挂在元素上的属性，不是注释里提到这个名字（stripComments 已经剥过注释）
    assert.match(source, /data-surface=\{/, `${name}页的表面必须由解析结果派生`);
    assert.doesNotMatch(
      source,
      /data-surface="dream-/,
      `${name}页不得再硬编码表面字面量：红蓝必须由 palette 解析决定`,
    );
  }
});

test('the chat surface is untouched by the deep-blue scope', () => {
  const shell = stripComments(read('src/components/chat/chat-shell.tsx'));
  assert.doesNotMatch(shell, /dream-blue/, '聊天页不得启用深蓝表面，否则会盖掉用户选定的色调与皮肤');
});

test('DESIGN.md records the revised colour rule', () => {
  const design = read('DESIGN.md');
  // 旧规则禁的是「蓝紫」，新规则要把「紫」与「梦幻蓝」分开说清楚。
  assert.match(design, /梦幻深蓝/, 'DESIGN.md 必须写明允许梦幻深蓝');
  assert.match(design, /科技蓝/, 'DESIGN.md 必须保留对科技蓝/赛博朋克风的禁止');
});
