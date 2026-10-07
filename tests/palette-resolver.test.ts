import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  PALETTE_PREVIEW_COLOR,
  PALETTE_STORAGE_KEY,
  PALETTE_SURFACE,
  PALETTE_VALUES,
  PAGE_PALETTE_DEFAULT,
  ROSE_CHAT_THEME,
  applyChatPalette,
  palettePersistMode,
  parsePalettePreference,
  resolveChatPalette,
  resolveEntryAccent,
  resolvePalettePreference,
  resolveSurface,
} from '../src/lib/palette';
import { resolvePaletteToggle } from '../src/components/palette-switch';
import { CHARACTER_PRESETS } from '../src/lib/characters';
import { AI_MEMBRANE_ALPHA } from '../src/lib/chat-layout';
import { contrastRatio, hexToRgb, oklchToRgb, selectorBlock, token, composite } from './support/wcag';

/**
 * t5 共享契约（palette 纯函数层）的判据。
 *
 * 这个文件是「未选择用户逐像素不变」的可复核证据，也是玫瑰取值单一来源的护栏：
 *   - 值域 / 优先级 / 页面默认 / 聊天判定：纯函数全分支
 *   - 判据 A：`applyChatPalette(theme, 'native') === theme`（引用相等，8 角色逐一）
 *   - 判据 B：8 角色的 5 个 token 与硬编码期望表逐字符相等（漂移即红）
 *   - 玫瑰表：深等于规格 §4.7 判据 1 的 5 个值，且不含 `chatBg`
 *   - 对比度：4 对全部 ≥ WCAG AA 4.5（「在线」那对从 globals.css 的真值动态取）
 *   - 单一来源：玫瑰 5 个 hex 只允许出现在 `src/lib/palette.ts`
 *
 * 零 mock：这里没有 `mock.module` / `vi.fn`，全部断言都跑真实源码。
 */

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function read(rel: string): string {
  return readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
}

/** 扫源码前先剥注释：注释里解释约定时会出现与实现相同的字符串（照 dream-blue-theme 的做法）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function collectFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// ── 判据 B 的硬编码期望表（characters.ts:86-102 + 6 处角色覆写，逐字符） ──
const EXPECTED_CHARACTER_THEMES: Record<
  string,
  { myBubble: string; myText: string; theirBubble: string; theirText: string; accent: string }
> = {
  deepseek_f_01: { myBubble: '#9dcce8', myText: '#102334', theirBubble: '#1d3042', theirText: '#eef7ff', accent: '#8ec9ed' },
  deepseek_f_02: { myBubble: '#8cc5e9', myText: '#102334', theirBubble: '#1d3042', theirText: '#eef7ff', accent: '#6fb9eb' },
  deepseek_f_03: { myBubble: '#b9cbea', myText: '#102334', theirBubble: '#1d3042', theirText: '#eef7ff', accent: '#b6c9ee' },
  deepseek_f_04: { myBubble: '#9baeea', myText: '#102334', theirBubble: '#1d3042', theirText: '#eef7ff', accent: '#8398e8' },
  deepseek_m_01: { myBubble: '#82b7da', myText: '#0c2232', theirBubble: '#1b2c3e', theirText: '#eef7ff', accent: '#75b9e6' },
  deepseek_m_02: { myBubble: '#70b2dc', myText: '#0c2232', theirBubble: '#1b2c3e', theirText: '#eef7ff', accent: '#4da5dc' },
  deepseek_m_03: { myBubble: '#a3c7e5', myText: '#0c2232', theirBubble: '#1b2c3e', theirText: '#eef7ff', accent: '#92bce1' },
  deepseek_m_04: { myBubble: '#68b0d8', myText: '#0c2232', theirBubble: '#1b2c3e', theirText: '#eef7ff', accent: '#3d9fd7' },
};

const TOKEN_KEYS = ['myBubble', 'myText', 'theirBubble', 'theirText', 'accent'] as const;

const AA_NORMAL_TEXT = 4.5;

// ── 共享取色工具的转换器自证 ──

test('the shared colour converter matches the WCAG reference points', () => {
  // 转换器先自证，否则后面的断言只是在验自己的 bug。
  assert.deepEqual(oklchToRgb(1, 0, 0).srgb.map((c) => Math.round(c * 255)), [255, 255, 255]);
  assert.deepEqual(oklchToRgb(0, 0, 0).srgb.map((c) => Math.round(c * 255)), [0, 0, 0]);
  assert.equal(Number(contrastRatio(oklchToRgb(1, 0, 0), oklchToRgb(0, 0, 0)).toFixed(2)), 21);

  // 线性化的反面教材：#767676 对白按 WCAG 是 4.54，把编码值当线性亮度会算成 5.59。
  assert.equal(Number(contrastRatio(hexToRgb('#767676'), oklchToRgb(1, 0, 0)).toFixed(2)), 4.54);
  assert.deepEqual(hexToRgb('#ffffff').srgb.map((c) => Math.round(c * 255)), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#000').srgb.map((c) => Math.round(c * 255)), [0, 0, 0]);

  // 半透明合成走 gamma 编码空间：不透明合成必须等于前景本身。
  assert.equal(contrastRatio(composite(hexToRgb('#e0a1ab'), 1, hexToRgb('#000000')), hexToRgb('#e0a1ab')), 1);
});

test('selectorBlock strips comments before locating, so the block it returns is really the selector body', () => {
  const css = read('src/app/globals.css');
  const dark = selectorBlock(css, '.dark');
  // 定位正确性的自证：.dark 的 --primary 是这条红线（tests/dream-blue-theme.test.ts 同样钉住）。
  assert.match(dark, /--primary:\s*oklch\(0\.645 0\.20 15\)/, 'selectorBlock 必须真的取到 .dark 块体');
  // 注释出现在选择器之前时不得把注释内容当成块体。
  assert.doesNotMatch(dark, /梦幻深蓝表面/, '块体里不能出现注释文字');
});

// ── 值域 ──

test('parsePalettePreference 值域：只有 rose / blue 合法，其余一切（含空串与大写）回落 null', () => {
  assert.equal(parsePalettePreference('rose'), 'rose');
  assert.equal(parsePalettePreference('blue'), 'blue');
  assert.equal(parsePalettePreference(null), null);
  assert.equal(parsePalettePreference(undefined), null);

  for (const invalid of ['ROSE', 'Blue', 'pink', '', ' rose', 'rose ', 0, 1, true, false, {}, [], ['rose'], { value: 'rose' }]) {
    assert.equal(parsePalettePreference(invalid), null, `非法值必须回落 null：${JSON.stringify(invalid)}`);
  }
});

test('PALETTE_VALUES / PAGE_PALETTE_DEFAULT / PALETTE_SURFACE / PALETTE_STORAGE_KEY 逐字符钉住', () => {
  assert.deepEqual(PALETTE_VALUES, ['rose', 'blue']);
  assert.deepEqual(PAGE_PALETTE_DEFAULT, { entry: 'rose', billing: 'blue', landing: 'blue' });
  assert.deepEqual(PALETTE_SURFACE, { rose: 'dream-rose', blue: 'dream-blue' });
  assert.equal(PALETTE_STORAGE_KEY, 'vl_palette');
});

// ── 优先级 ──

test('resolvePalettePreference 优先级：访客档案 > localStorage，非法档案值不得短路 localStorage', () => {
  assert.equal(resolvePalettePreference('blue', 'rose'), 'blue');
  assert.equal(resolvePalettePreference('rose', 'blue'), 'rose');
  assert.equal(resolvePalettePreference(null, 'rose'), 'rose');
  assert.equal(resolvePalettePreference(undefined, 'blue'), 'blue');
  assert.equal(resolvePalettePreference(null, null), null);
  assert.equal(resolvePalettePreference(undefined, undefined), null);
  // 非法档案值（含 ''、'ROSE'）不是有效偏好，必须继续看 localStorage。
  assert.equal(resolvePalettePreference('pink', 'rose'), 'rose');
  assert.equal(resolvePalettePreference('', 'blue'), 'blue');
  assert.equal(resolvePalettePreference('ROSE', 'rose'), 'rose');
  assert.equal(resolvePalettePreference('pink', 'pink'), null);
});

// ── 页面默认 ──

test('resolveSurface：未选择时入口玫瑰 / 支付蓝，已选择时两页都用选择值', () => {
  assert.equal(resolveSurface('entry', null, null), 'dream-rose');
  assert.equal(resolveSurface('billing', null, null), 'dream-blue');
  assert.equal(resolveSurface('entry', undefined, undefined), 'dream-rose');
  assert.equal(resolveSurface('entry', 'blue', null), 'dream-blue');
  assert.equal(resolveSurface('billing', 'rose', 'blue'), 'dream-rose');
  assert.equal(resolveSurface('entry', null, 'blue'), 'dream-blue');
  assert.equal(resolveSurface('billing', 'ROSE', 'rose'), 'dream-rose');
  // 页面默认值自身也在这条链的末端，两者不得互换。
  assert.notEqual(resolveSurface('entry', null, null), resolveSurface('billing', null, null));
});

test('resolveSurface：落地页未选择时默认梦幻蓝，选过玫瑰就跟着玫瑰', () => {
  assert.equal(resolveSurface('landing', null, null), 'dream-blue');
  assert.equal(resolveSurface('landing', undefined, 'rose'), 'dream-rose');
  assert.equal(resolveSurface('landing', null, 'blue'), 'dream-blue');
  // 与入口页共用同一份设备镜像：同一个值在两页解析成同一表面。
  assert.equal(resolveSurface('landing', null, 'rose'), resolveSurface('entry', null, 'rose'));
});

// ── 聊天判定 ──

test('resolveChatPalette：只有 rose 才切玫瑰，blue 与 null 都是角色原生色', () => {
  assert.equal(resolveChatPalette('rose', null), 'rose');
  assert.equal(resolveChatPalette(null, 'rose'), 'rose');
  assert.equal(resolveChatPalette('rose', 'blue'), 'rose');
  assert.equal(resolveChatPalette('blue', null), 'native');
  assert.equal(resolveChatPalette(null, 'blue'), 'native');
  assert.equal(resolveChatPalette('blue', 'blue'), 'native');
  assert.equal(resolveChatPalette(null, null), 'native');
  assert.equal(resolveChatPalette(undefined, undefined), 'native');
  assert.equal(resolveChatPalette('pink', 'pink'), 'native');
});

// ── 入口页强调色（用户 2026-09-27 反馈：玫瑰屏幕上不能出现蓝名字） ──

test('resolveEntryAccent：玫瑰表面用玫瑰强调色，梦幻蓝表面逐字符保留角色原值（8 角色逐一）', () => {
  assert.equal(CHARACTER_PRESETS.length, 8, '角色数变了就要重新核对下面的硬编码期望表');

  for (const preset of CHARACTER_PRESETS) {
    // 玫瑰表面：角色姓名（tagline）与头像描边都取玫瑰 accent，而不是角色蓝族 accent。
    assert.equal(
      resolveEntryAccent(preset.theme, 'rose'),
      ROSE_CHAT_THEME.accent,
      `${preset.key} 在玫瑰表面上必须用玫瑰 accent`,
    );
    assert.equal(
      resolveEntryAccent(preset.theme, 'rose'),
      '#e0a1ab',
      `${preset.key} 的玫瑰 accent 必须逐字符是 #e0a1ab`,
    );

    // 梦幻蓝表面：逐字符等于角色原值（等于「不改」），并与硬编码期望表对齐。
    assert.equal(
      resolveEntryAccent(preset.theme, 'blue'),
      preset.theme.accent,
      `${preset.key} 在梦幻蓝表面上必须原样返回 theme.accent`,
    );
    assert.equal(
      resolveEntryAccent(preset.theme, 'blue'),
      EXPECTED_CHARACTER_THEMES[preset.key].accent,
      `${preset.key} 在梦幻蓝表面上必须等于硬编码期望表里的原值`,
    );
    assert.notEqual(resolveEntryAccent(preset.theme, 'rose'), preset.theme.accent);
  }
});

test('resolveEntryAccent：未选择 / 非法输入按入口页默认（梦幻玫瑰）走，而不是角色原生色', () => {
  // 这一条是**用户 2026-09-27 反馈的默认场景**：从未选过风格的访客进开屏页时，表面是梦幻玫瑰，
  // 所以角色强调色也必须是玫瑰 —— 若这里回落成角色原生蓝，用户会继续看到「蓝字压玫瑰底」，
  // 等于没修。（契约里「blue/null 表面 → 逐字符等于角色 accent」那句按字面读会与这条冲突；
  // 以「非法/未选择按页面默认 entry → rose 走」为准，理由就是这个默认场景。）
  for (const preset of CHARACTER_PRESETS) {
    for (const unselected of [null, undefined, 'pink', '', 'ROSE', 0, false, {}] as const) {
      assert.equal(
        resolveEntryAccent(preset.theme, unselected),
        ROSE_CHAT_THEME.accent,
        `${preset.key} 在「未选择/非法（${JSON.stringify(unselected)}）」时必须走入口页默认玫瑰`,
      );
    }
  }

  // 与 parsePalettePreference / resolveSurface 同一条链，不得各写一份判断：
  // 脏值先过 parsePalettePreference（→ null），再落到入口页默认（rose）。
  assert.equal(resolveEntryAccent(CHARACTER_PRESETS[0]!.theme, null), '#e0a1ab');
  assert.equal(resolveEntryAccent(CHARACTER_PRESETS[0]!.theme, parsePalettePreference('pink')), '#e0a1ab');
  assert.equal(
    resolveEntryAccent(CHARACTER_PRESETS[0]!.theme, resolvePalettePreference(null, null)),
    '#e0a1ab',
  );
});

test('resolveEntryAccent：星寻这类 periwinkle 覆写角色，在玫瑰表面上也只显示玫瑰值', () => {
  // 入口页原先把蓝族 accent 直接压在新表面上（研究 §2.4 点名的 8 个 hex），
  // 其中 `#8398e8`（星寻）最接近 indigo。派生之后必须只出现玫瑰值。
  const xingxun = CHARACTER_PRESETS.find((preset) => preset.key === 'deepseek_f_04');
  assert.ok(xingxun, '必须找得到星寻（deepseek_f_04）');
  assert.equal(xingxun!.theme.accent, '#8398e8', '角色原值必须先与预期一致（这条是防漂移对照）');
  assert.equal(resolveEntryAccent(xingxun!.theme, null), '#e0a1ab');
  assert.equal(resolveEntryAccent(xingxun!.theme, 'rose'), '#e0a1ab');
  assert.equal(resolveEntryAccent(xingxun!.theme, 'blue'), '#8398e8');
});

// ── 入口页开关的档位判据（队长 2026-09-27 F1） ──

test('palettePersistMode：档位判据 = 档案行存在（不是 palette 是否非 null，也不是 ?repick=1）', () => {
  // ① 行存在（回包里的 visitor 行带非空 id）→ 'server'：PATCH 不会 0 行命中，写库才让
  //    入口页的选择真正落到访客级，不会被下次读到档案时静默覆盖。
  assert.equal(palettePersistMode({ id: 'v-1', palette: 'blue' }), 'server');
  assert.equal(palettePersistMode({ id: 'v-1', palette: 'rose' }), 'server');
  // ② 关键第三档：**行存在但 palette 为 null**（做完开屏、还没在聊天/支付页选过风格）也必须
  //    server —— 判据是「行存在」，不是「palette 非 null」；否则将来别处一旦产生档案级 palette，
  //    他们在入口页的选择同样会被静默覆盖。
  assert.equal(palettePersistMode({ id: 'v-1', palette: null }), 'server');
  assert.equal(palettePersistMode({ id: 'v-1' }), 'server');

  // ③ 行不存在（GET 对不存在的访客返回 visitor: null；新访客只铸 id 不插库）→ 'local'：零写入。
  for (const absent of [null, undefined, '', 0, false, true, [], 'v-1', {}, { id: '' }, { id: null }, { id: 0 }, { id: undefined }]) {
    assert.equal(
      palettePersistMode(absent),
      'local',
      `没有档案行时必须落 local（零副作用）：${JSON.stringify(absent)}`,
    );
  }

  // 判据与「不会 0 行命中」严格等价：唯一分界线就是 visitor 行的 id 是否非空。
  assert.notEqual(palettePersistMode({ id: 'x' }), palettePersistMode({ id: '' }));
});

test('palettePersistMode：函数零 IO（不碰 window/DOM/fetch，页面只准用它判定档位）', () => {
  const source = stripComments(read('src/lib/palette.ts'));
  assert.match(source, /export function palettePersistMode\(/, '必须导出 palettePersistMode');
  // 函数体里不得出现浏览器/网络原语（整份 palette.ts 的零 IO 断言在同名测试里另有一条）。
  const body = /export function palettePersistMode\([\s\S]*?\n\}/.exec(source);
  assert.ok(body, '必须能定位 palettePersistMode 的函数体');
  assert.doesNotMatch(body![0], /\bwindow\b|\bdocument\b|\blocalStorage\b|\bfetch\(|apiFetch/);
});

// ── 单圆圈开关的解析（契约 t30：一条规则走三处上下文） ──

test('resolvePaletteToggle：圆圈颜色 = 当前氛围的预览色，点击应用 next = 切到另一边', () => {
  // rose（入口页默认）→ 点一下变蓝
  assert.equal(resolvePaletteToggle('rose').next, 'blue');
  assert.equal(resolvePaletteToggle('rose').actionLabel, '切换到梦幻蓝'); // 规格字面量
  assert.equal(resolvePaletteToggle('rose').color, PALETTE_PREVIEW_COLOR.rose);

  // blue（支付页默认）→ 点一下变玫瑰
  assert.equal(resolvePaletteToggle('blue').next, 'rose');
  assert.equal(resolvePaletteToggle('blue').actionLabel, '切换到梦幻玫瑰');
  assert.equal(resolvePaletteToggle('blue').color, PALETTE_PREVIEW_COLOR.blue);

  // native / null（聊天页未选择、入口页从未选择）→ 点一下变玫瑰（"切到 blue" 在 native 下无视觉变化）
  for (const nonRose of ['native', null, undefined, 'pink', '', 0, false, {}] as const) {
    const resolution = resolvePaletteToggle(nonRose);
    assert.equal(
      resolution.next,
      'rose',
      `非 rose（${JSON.stringify(nonRose)}）点击后必须切到 rose`,
    );
    assert.equal(resolution.actionLabel, '切换到梦幻玫瑰');
    assert.equal(resolution.color, PALETTE_PREVIEW_COLOR.blue);
  }

  // 切换是不动点：rose ↔ blue 互切两次回到原值。
  assert.equal(resolvePaletteToggle(resolvePaletteToggle('rose').next).next, 'rose');
  assert.equal(resolvePaletteToggle(resolvePaletteToggle('blue').next).next, 'blue');

  // unset（「从没选过」）只由 null / undefined 表达 —— 它决定 sr-only 说明的条件化引用。
  assert.equal(resolvePaletteToggle(null).unset, true);
  assert.equal(resolvePaletteToggle(undefined).unset, true);
  assert.equal(resolvePaletteToggle('rose').unset, false);
  assert.equal(resolvePaletteToggle('blue').unset, false);
  assert.equal(resolvePaletteToggle('native').unset, false);
});

test('resolvePaletteToggle 的颜色与 globals.css 两套表面 --primary 交叉核对（任一边改即红）', () => {
  const css = read('src/app/globals.css');
  const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/;
  const triple = (text: string): number[] => {
    const match = OKLCH.exec(text);
    assert.ok(match, `必须是 oklch(L C H) 取值：${text}`);
    return match.slice(1).map(Number);
  };
  const surfacePrimary = (selector: string): number[] => {
    const declaration = /--primary:\s*(oklch\([^)]*\))/.exec(selectorBlock(css, selector));
    assert.ok(declaration, `${selector} 必须有 --primary 声明`);
    return triple(declaration[1]);
  };

  // 圆点里的预览色（由解析函数给出）必须逐分量等于对应表面的 --primary 真值。
  assert.deepEqual(triple(resolvePaletteToggle('rose').color), surfacePrimary("[data-surface='dream-rose']"));
  assert.deepEqual(triple(resolvePaletteToggle('blue').color), surfacePrimary("[data-surface='dream-blue']"));
  assert.deepEqual(
    triple(resolvePaletteToggle(null).color),
    surfacePrimary("[data-surface='dream-blue']"),
    '未选择时圆圈显示蓝（非 rose）预览色',
  );
});

// ── 判据 A：引用相等 ──

test('判据 A：applyChatPalette(theme, native) 原样返回入参引用（8 角色逐一）', () => {
  assert.equal(CHARACTER_PRESETS.length, 8, '角色数变了就要重新核对下面的硬编码期望表');

  for (const preset of CHARACTER_PRESETS) {
    assert.equal(
      applyChatPalette(preset.theme, 'native'),
      preset.theme,
      `${preset.key} 在 native 模式下必须拿到同一个 theme 引用（不是 deep-equal）`,
    );
  }
});

// ── 判据 B：值级 ──

test('判据 B：8 角色的 5 个 token 与硬编码期望表逐字符相等（未选择用户逐像素不变的证据）', () => {
  assert.deepEqual(
    CHARACTER_PRESETS.map((preset) => preset.key).sort(),
    Object.keys(EXPECTED_CHARACTER_THEMES).sort(),
    '角色集合与期望表必须一一对应',
  );

  for (const preset of CHARACTER_PRESETS) {
    const expected = EXPECTED_CHARACTER_THEMES[preset.key];
    for (const key of TOKEN_KEYS) {
      assert.equal(preset.theme[key], expected[key], `${preset.key}.${key} 漂移了`);
    }
    // native 模式下取值表达式的输入就是这只 theme 对象本身，此处再确认它没被玫瑰值污染。
    for (const key of TOKEN_KEYS) {
      assert.notEqual(preset.theme[key], ROSE_CHAT_THEME[key], `${preset.key}.${key} 落到了玫瑰值上`);
    }
  }
});

// ── 玫瑰表 ──

test('玫瑰表：恰好 5 键、不含 chatBg、深等于规格 §4.7 判据 1 的取值', () => {
  assert.deepEqual(
    Object.keys(ROSE_CHAT_THEME).sort(),
    ['accent', 'myBubble', 'myText', 'theirBubble', 'theirText'],
    '玫瑰表必须恰好这 5 个键（chatBg 不在内）',
  );
  assert.deepEqual(ROSE_CHAT_THEME, {
    myBubble: '#e7b6bd',
    myText: '#2a1a1e',
    theirBubble: '#3a2229',
    theirText: '#fdeff2',
    accent: '#e0a1ab',
  });
  assert.equal('chatBg' in ROSE_CHAT_THEME, false, 'chatBg 不参与玫瑰化');

  // 玫瑰表的值不得等于任何角色的任何 token（否则「切换」在视觉上无变化）。
  for (const preset of CHARACTER_PRESETS) {
    for (const key of TOKEN_KEYS) {
      assert.notEqual(
        ROSE_CHAT_THEME[key],
        preset.theme[key],
        `玫瑰值 ${key} 与 ${preset.key} 的原生值撞了`,
      );
    }
  }
});

test('applyChatPalette(theme, rose) 返回新对象，只覆写那 5 个 token，chatBg 继承角色原生值', () => {
  for (const preset of CHARACTER_PRESETS) {
    const rose = applyChatPalette(preset.theme, 'rose');
    assert.notEqual(rose, preset.theme, 'rose 模式必须返回新对象，不能就地改写');
    assert.equal(rose.chatBg, preset.theme.chatBg, 'chatBg 必须继承角色原生值（壁纸与聊天背景不动）');
    for (const key of TOKEN_KEYS) {
      assert.equal(rose[key], ROSE_CHAT_THEME[key], `${preset.key}.${key} 必须取玫瑰值`);
    }
  }
});

// ── 对比度门禁：4 对全部 ≥ AA ──

test('玫瑰取值的 4 对文字对比度全部 ≥ WCAG AA 4.5:1', () => {
  const css = read('src/app/globals.css');
  // 「在线」那一对的底色是 .dark 的 --background —— 从 globals.css 真值动态取，不写死 hex。
  const darkBackground = token(selectorBlock(css, '.dark'), 'background');

  const pairs: Array<{ name: string; fg: string | ReturnType<typeof hexToRgb>; bg: string | ReturnType<typeof hexToRgb> }> = [
    { name: '用户气泡 myText on myBubble', fg: ROSE_CHAT_THEME.myText, bg: ROSE_CHAT_THEME.myBubble },
    // AI 正文去胶囊后不再是实心 theirBubble，而是 AI_MEMBRANE_ALPHA 底膜（规格 §4.1.2）：
    // 与 tests/character-palette.test.ts 的第二份拷贝共用同一个常量与同一个合成模型，
    // 否则两份门禁会替两个不同的底色背书（一份真、一份给不存在的底色）。退化态取 .dark --background。
    {
      name: 'AI 正文 theirText on composite(theirBubble 10%, .dark --background)',
      fg: ROSE_CHAT_THEME.theirText,
      bg: composite(hexToRgb(ROSE_CHAT_THEME.theirBubble), AI_MEMBRANE_ALPHA, darkBackground),
    },
    // 发送键前景是 message-input.tsx:106 里写死的 #1a1210（本轮不改），底色取玫瑰 accent。
    { name: '发送键 #1a1210 on accent', fg: '#1a1210', bg: ROSE_CHAT_THEME.accent },
    { name: '「在线」accent on .dark --background', fg: ROSE_CHAT_THEME.accent, bg: darkBackground },
  ];

  for (const pair of pairs) {
    const fg = typeof pair.fg === 'string' ? hexToRgb(pair.fg) : pair.fg;
    const bg = typeof pair.bg === 'string' ? hexToRgb(pair.bg) : pair.bg;
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= AA_NORMAL_TEXT, `${pair.name} 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${AA_NORMAL_TEXT}:1`);
  }
});

// ── 单一来源 / 层次 ──

test('玫瑰 5 个 hex 只允许出现在 src/lib/palette.ts', () => {
  const roseHexes = Object.values(ROSE_CHAT_THEME).map((value) => value.toLowerCase());
  const palettePath = 'src/lib/palette.ts';
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const hits: string[] = [];
  const foundInsidePalette: string[] = [];

  for (const file of collectFiles(srcRoot)) {
    const rel = relative(repoRoot, file);
    const source = readFileSync(file, 'utf8').toLowerCase();
    for (const hex of roseHexes) {
      if (!source.includes(hex)) continue;
      if (rel === palettePath) foundInsidePalette.push(hex);
      else hits.push(`${rel}: ${hex}`);
    }
  }

  assert.deepEqual(hits, [], '玫瑰取值必须只有一个来源（src/lib/palette.ts），其余文件只准引用常量');
  assert.deepEqual(
    [...new Set(foundInsidePalette)].sort(),
    [...roseHexes].sort(),
    '5 个玫瑰 hex 必须都躺在 src/lib/palette.ts 里',
  );
});

test('palette.ts 零 React 零 IO，且不 import 浏览器边界（服务端路由只准 import 它）', () => {
  // 注释里会解释这些约定（例如「palette-client 只有 'use client' 边界」），
  // 因此断言必须扫**剥掉注释**后的代码，否则会把说明文字当成实现。
  const source = stripComments(read('src/lib/palette.ts'));

  assert.doesNotMatch(source, /from 'react'|from "react"|require\('react'\)/, 'palette.ts 不得依赖 React');
  assert.doesNotMatch(source, /\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b/, 'palette.ts 不得触碰 DOM/存储');
  assert.doesNotMatch(source, /\bfetch\(|apiFetch/, 'palette.ts 不得发起请求');
  assert.doesNotMatch(source, /palette-client/, 'palette.ts 不得 import palette-client（会把 apiFetch/hook 带进 route）');
  assert.doesNotMatch(source, /'use client'/, 'palette.ts 是纯函数模块，不是客户端模块');

  const client = read('src/lib/palette-client.ts');
  assert.match(client, /^'use client';/m, 'palette-client.ts 必须显式声明客户端边界');
  assert.match(client, /from '\.\/palette'/, 'palette-client.ts 必须复用 palette.ts 的纯函数，不得自算一遍');
});
