import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CHARACTER_PRESETS } from '../src/lib/characters';
import { ROSE_CHAT_THEME, applyChatPalette, resolveChatPalette } from '../src/lib/palette';
import { AI_MEMBRANE_ALPHA } from '../src/lib/chat-layout';
import { composite, contrastRatio, hexToRgb, selectorBlock, token } from './support/wcag';

/**
 * 聊天强调层（契约 t11 / 队内 t6）：四处「蓝」组件的玫瑰化 + 单一注入点 + 装扮弹窗开关。
 *
 * 判据来源：t3 规格 §3.3（蓝的真实落点）、§4.7（行为⑥ 判据 1–7）、§4.8（行为⑦ 开关契约）。
 *
 * 队长裁决 **R1** 收窄了契约①：玫瑰取值**只有一份全局表** `ROSE_CHAT_THEME`（5 键，
 * 不含 `chatBg`），不做 per-character 玫瑰变体、不做 chatBg 玫瑰化、`characters.ts`
 * 不得新增第二份玫瑰表 —— 但契约① 的可判定内核保留在这里：**四对真实 WCAG 计算门禁**。
 *
 * 零 mock、零 DOM：源码文本断言 + 纯函数计算。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 扫源码前先剥注释（照 tests/dream-blue-theme.test.ts / tests/palette-resolver.test.ts）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const AA = 4.5;
const ROSE_HEXES = Object.values(ROSE_CHAT_THEME);
const ROSE_HEX_PATTERN = new RegExp(ROSE_HEXES.join('|'), 'i');

/**
 * 「恢复色」的硬编码期望值 = 改动前 `message-bubble.tsx` 内联兜底的 6 个 token
 * （也是 `chat-shell.tsx` 的 `RECOVERY_THEME`，两者逐项相同）。
 *
 * 这是「未选择用户逐像素不变」在退化态（角色模板不可用）的基线：t14 会用真浏览器
 * 对 `fe6994e` 的基线值逐字符复算；这里先把它钉在源码层。
 */
const EXPECTED_RECOVERY_TOKENS: Record<string, string> = {
  chatBg: '#111827',
  theirBubble: '#273244',
  theirText: '#f3f4f6',
  myBubble: '#475569',
  myText: '#f8fafc',
  accent: '#94a3b8',
};

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

function collectFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const CHAT_SHELL = 'src/components/chat/chat-shell.tsx';
const MESSAGE_BUBBLE = 'src/components/chat/message-bubble.tsx';
const MESSAGE_INPUT = 'src/components/chat/message-input.tsx';
const CONVERSATION_LIST = 'src/components/chat/conversation-list.tsx';
const THEME_SETTINGS = 'src/components/chat/theme-settings.tsx';

/**
 * 判据 B 的硬编码期望表：`characters.ts:86-102` 的两套默认 + 6 处角色覆写，逐字符。
 *
 * 刻意手抄一遍而不是从 `CHARACTER_PRESETS` 反推 —— 从实现反推会让断言恒真。
 * 这也是「未选择用户逐像素不变」的证据：这些值一个都不许被玫瑰表改写。
 */
const EXPECTED_NATIVE_TOKENS: Record<
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

// ── 判据 5：四对真实 WCAG（契约① 的可判定内核） ──

test('the four rose pairs clear WCAG AA by real computation', () => {
  // 「在线」那一对的底色从 globals.css 的 .dark 真值动态取（不写死 hex）。
  const darkBackground = token(selectorBlock(read('src/app/globals.css'), '.dark'), 'background');

  // 发送键前景是 message-input.tsx 里写死的 #1a1210（本轮不改），底色取玫瑰 accent。
  const sendButtonForeground = '#1a1210';

  const pairs: Array<{ name: string; fg: ReturnType<typeof hexToRgb>; bg: ReturnType<typeof hexToRgb> }> = [
    { name: '用户气泡 myText on myBubble', fg: hexToRgb(ROSE_CHAT_THEME.myText), bg: hexToRgb(ROSE_CHAT_THEME.myBubble) },
    // AI 正文去胶囊后不再是实心 theirBubble，而是 10% 底膜 + 文字阴影（规格 §4.1.2）：
    // 底色必须用 composite(theirBubble, AI_MEMBRANE_ALPHA, …) 建模，否则这条门禁会替
    // 一个已经不存在的底色背书（假绿）。退化态（无壁纸）取 .dark --background。
    {
      name: 'AI 正文 theirText on composite(theirBubble 10%, .dark --background)',
      fg: hexToRgb(ROSE_CHAT_THEME.theirText),
      bg: composite(hexToRgb(ROSE_CHAT_THEME.theirBubble), AI_MEMBRANE_ALPHA, darkBackground),
    },
    { name: '发送键 #1a1210 on accent', fg: hexToRgb(sendButtonForeground), bg: hexToRgb(ROSE_CHAT_THEME.accent) },
    { name: '「在线」accent on .dark --background', fg: hexToRgb(ROSE_CHAT_THEME.accent), bg: darkBackground },
  ];

  for (const pair of pairs) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    assert.ok(ratio >= AA, `${pair.name} 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${AA}:1`);
  }

  // 转换器自证：不做这一步，上面四条可能因为转换器恒返回同一个数而假绿。
  assert.equal(contrastRatio(hexToRgb('#000000'), hexToRgb('#ffffff')), 21);
  assert.equal(contrastRatio(composite(hexToRgb(ROSE_CHAT_THEME.accent), 1, hexToRgb('#000000')), hexToRgb(ROSE_CHAT_THEME.accent)), 1);
});

// ── 判据 1：玫瑰表只有一份（R1），且与规格 §4.7 判据 1 逐字符相等 ──

test('the rose table is the single global source of truth and carries no chatBg', () => {
  assert.deepEqual(ROSE_CHAT_THEME, {
    myBubble: '#e7b6bd',
    myText: '#2a1a1e',
    theirBubble: '#3a2229',
    theirText: '#fdeff2',
    accent: '#e0a1ab',
  });
  assert.equal('chatBg' in ROSE_CHAT_THEME, false, 'chatBg 不参与玫瑰化（用户本轮原话：壁纸与聊天背景设定不动）');

  // R1：characters.ts 不得新增第二份玫瑰表 / 玫瑰 hex。
  const characters = stripComments(read('src/lib/characters.ts'));
  assert.doesNotMatch(characters, ROSE_HEX_PATTERN, 'characters.ts 不得出现任何玫瑰 hex');
});

// ── 判据 A / B：native 分支引用相等 + 8 角色原生 token 逐字符 ──

test('native palette returns the very same theme object (reference-equal) for all 8 characters', () => {
  assert.equal(CHARACTER_PRESETS.length, 8);
  for (const preset of CHARACTER_PRESETS) {
    assert.equal(
      applyChatPalette(preset.theme, 'native'),
      preset.theme,
      `${preset.key}: native 必须原样返回入参引用（不 spread、不 deep-equal 新对象）`,
    );
  }
});

test('all 8 characters keep their native bubbles, texts and accents verbatim', () => {
  for (const preset of CHARACTER_PRESETS) {
    const expected = EXPECTED_NATIVE_TOKENS[preset.key];
    assert.ok(expected, `${preset.key} 必须有硬编码期望值`);
    assert.deepEqual(
      {
        myBubble: preset.theme.myBubble,
        myText: preset.theme.myText,
        theirBubble: preset.theme.theirBubble,
        theirText: preset.theme.theirText,
        accent: preset.theme.accent,
      },
      expected,
      `${preset.key} 的原生取值漂移了`,
    );
  }
});

// ── 判据 B 的另一半：玫瑰值与任何角色 token 都不同源 ──

test('no rose value equals any character token (otherwise native users would shift pixels)', () => {
  const nativeValues = new Set(
    Object.values(EXPECTED_NATIVE_TOKENS).flatMap((tokens) => Object.values(tokens)),
  );
  for (const [key, value] of Object.entries(ROSE_CHAT_THEME)) {
    assert.equal(nativeValues.has(value), false, `${key}=${value} 与角色原生 token 撞值`);
  }
});

// ── 判据 3：'rose' 才切；null / 'blue' 一律 native ──

test("only 'rose' switches the chat palette; null and 'blue' stay native", () => {
  assert.equal(resolveChatPalette('rose', null), 'rose');
  assert.equal(resolveChatPalette(null, 'rose'), 'rose');
  assert.equal(resolveChatPalette('blue', null), 'native');
  assert.equal(resolveChatPalette(null, 'blue'), 'native');
  assert.equal(resolveChatPalette(null, null), 'native');
  assert.equal(resolveChatPalette(undefined, undefined), 'native');
  // 非法档案值不短路 localStorage（照 §4.6 判据 2）。
  assert.equal(resolveChatPalette('pink', 'rose'), 'rose');
});

test('rose mode applies exactly the 5 rose tokens and keeps the native chatBg', () => {
  const native = CHARACTER_PRESETS[0].theme;
  const rose = applyChatPalette(native, 'rose');
  assert.notEqual(rose, native, 'rose 必须换对象（否则界面拿不到新值）');
  assert.equal(rose.chatBg, native.chatBg, 'chatBg 继承角色原生值');
  assert.deepEqual(
    { myBubble: rose.myBubble, myText: rose.myText, theirBubble: rose.theirBubble, theirText: rose.theirText, accent: rose.accent },
    ROSE_CHAT_THEME,
  );
});

// ── 判据 3/4（接线层）：单一注入点 + 四处取值来源 ──

test('the bubble requires the injected theme: no colour literal of its own, caller must pass it', () => {
  const bubble = stripComments(read(MESSAGE_BUBBLE));

  // ④′-1：组件文件内**零颜色字面量** —— 6 个恢复色与 5 个玫瑰色一个都不许出现。
  for (const hex of [...Object.values(EXPECTED_RECOVERY_TOKENS), ...ROSE_HEXES]) {
    assert.equal(bubble.includes(hex), false, `message-bubble.tsx 内不得出现颜色字面量 ${hex}`);
  }
  assert.doesNotMatch(bubble, /#[0-9a-fA-F]{3,8}/, 'message-bubble.tsx 内不得再出现任何 hex');

  // ④′-2（本 finding 的根因防线）：`theme` 必须是**必传** prop，且组件确实用它渲染。
  assert.match(bubble, /\btheme: CharacterTheme;/);
  assert.doesNotMatch(bubble, /theme\?: CharacterTheme/, 'theme 一旦变回可选，F1 就会复发');
  assert.match(bubble, /export function MessageBubble\(\{ message, theme, character,/);
  assert.match(bubble, /style=\{\{ backgroundColor: theme\.myBubble, color: theme\.myText \}\}/);
  // AI 正文去胶囊（E 版排版）：不再有实心 theirBubble 底色，改成「10% 底膜 + 文字阴影 + 原文字色」
  // ——仍然要求底色/文字色都来自必传的注入 theme，组件自己不得写任何颜色字面量。
  // AI 正文呈现（第五轮 U3）：由共享的 aiTextPresentation 决定，底色/文字色仍来自必传的注入 theme。
  assert.match(
    bubble,
    /aiTextPresentation\(theme\.theirBubble, /,
    'AI 正文呈现必须走共享的 aiTextPresentation（两套呈现的唯一来源）',
  );
  assert.match(bubble, /color: theme\.theirText/, 'AI 正文文字色仍来自注入的 theme（作为第三参传入）');
  // 收紧：两套呈现的零件（底膜函数 / 阴影常量）只允许存在于 chat-layout.ts，组件不得自己拼。
  assert.doesNotMatch(
    bubble,
    /AI_TEXT_SHADOW|aiMembraneBackground\(/,
    '两套呈现的零件只允许存在于 chat-layout.ts（组件只准调 aiTextPresentation）',
  );
  // 也不得再从 character 自取主题（那同样是绕过注入的本地兜底形态）。
  assert.doesNotMatch(bubble, /character\?\.theme/);

  // ④′-3：唯一消费点（chat-shell.tsx:1342）确实把注入后的那个 `theme` 传进来，且全仓只有这一处。
  const shell = stripComments(read(CHAT_SHELL));
  assert.equal(shell.split('<MessageBubble').length - 1, 1, 'MessageBubble 在 chat-shell 只应有一个消费点');
  assert.match(shell, /<MessageBubble[\s\S]{0,400}?theme=\{theme\}/);
  // 传进去的 `theme` 就是注入链的结果（与头部「在线」/ 流式光标 / 无壁纸氛围同一个绑定）。
  assert.match(shell, /const theme = activeCharacter\?\.theme \?\? injectedTheme;/);
  assert.match(shell, /style=\{\{ color: theme\.accent \}\}/);
  assert.match(shell, /style=\{\{ backgroundColor: theme\.accent \}\}/);
  assert.match(shell, /backgroundImage: `radial-gradient\([^`]*\$\{theme\.accent\}/);
});

test('the recovery colours live in exactly one place under src/: chat-shell’s RECOVERY_THEME', () => {
  const srcRoot = SRC_ROOT;
  const offenders: Array<{ file: string; hex: string }> = [];

  for (const file of collectFiles(srcRoot)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const hex of Object.values(EXPECTED_RECOVERY_TOKENS)) {
      if (source.includes(hex)) offenders.push({ file: relative(srcRoot, file), hex });
    }
  }

  assert.deepEqual(
    [...new Set(offenders.map((entry) => entry.file))],
    ['components/chat/chat-shell.tsx'],
    '6 个恢复色只允许出现在 chat-shell 的 RECOVERY_THEME（B 路：不是两处相等，而是只有一处）',
  );

  // 顺带锁死这 6 个值本身：`RECOVERY_THEME` 未导出，按本项目 spec-test 传统扫源码解析
  // （先剥注释，再按行首锚定）。它一改，`character === null` 的退化态渲染就会变 —— 必须红。
  const shell = stripComments(read(CHAT_SHELL));
  const block = /(?:^|\n)const RECOVERY_THEME: CharacterTheme = \{([\s\S]*?)\n\};/.exec(shell);
  assert.ok(block, 'chat-shell.tsx 必须仍然有模块私有的 RECOVERY_THEME 字面量');
  const parsed = Object.fromEntries(
    [...block[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)].map((match) => [match[1], match[2]]),
  );
  assert.deepEqual(parsed, { ...EXPECTED_RECOVERY_TOKENS }, 'RECOVERY_THEME 是「未选择逐像素不变」的基线，改它必须红');
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(EXPECTED_RECOVERY_TOKENS).sort());
});

test('the chat shell has exactly one applyChatPalette injection point feeding all four surfaces', () => {
  const shell = stripComments(read(CHAT_SHELL));
  // 「只出现一次」按**调用点**计：import 语句里必然有一个标识符，那不是注入点。
  const callSites = shell.match(/applyChatPalette\(/g) ?? [];
  assert.equal(callSites.length, 1, '注入点唯一：全文件只准调用一次 applyChatPalette');
  assert.match(shell, /import \{[\s\S]{0,200}applyChatPalette[\s\S]{0,200}\} from '@\/lib\/palette';/);

  // 一次调用同时覆盖「角色原生 theme」与 RECOVERY_THEME 兜底（t3 §4.7 判据 3 的两条链）。
  assert.match(shell, /const paletteSourceTheme: CharacterTheme = activePreset\?\.theme \?\? RECOVERY_THEME;/);
  assert.match(shell, /const injectedTheme = applyChatPalette\(paletteSourceTheme, chatPalette\);/);
  assert.match(shell, /theme: injectedTheme/, 'activeCharacter 用的是注入后的 theme');
  assert.match(shell, /const theme = activeCharacter\?\.theme \?\? injectedTheme;/, '四处组件的 theme 也来自同一次注入');

  // 四处消费点都读同一个 theme / character.theme 对象，不各自算。
  assert.match(shell, /style=\{\{ color: theme\.accent \}\}/, '头部「在线」读 theme.accent');
  assert.match(shell, /accent=\{theme\.accent\}/, '发送键 accent 由同一个 theme 传入');
  assert.match(shell, /character=\{activeCharacter\}/, '气泡与侧栏拿的是同一个 character 对象');
});

test('chat palette state is resolved in the boot effect only, never during render', () => {
  const shell = stripComments(read(CHAT_SHELL));
  assert.match(shell, /useState<ChatPalette>/, 'chatPalette 必须是 chat-shell 的 state');
  assert.match(
    shell,
    /setChatPalette\(resolveChatPalette\(visitorData\.visitor\.palette, readPalettePreference\(\)\)\)/,
    'boot 的 useEffect 里按「档案 > localStorage」解析',
  );
  // mirror 同步：把「档案 > 设备镜像」解析出的存储值镜像回设备（§4.6 判据 6）。
  assert.match(
    shell,
    /const mirrorPalette = resolvePalettePreference\(visitorData\.visitor\.palette, readPalettePreference\(\)\);/,
  );
  assert.match(shell, /setPalettePreference\(mirrorPalette\);/);
  assert.match(shell, /writePalettePreference\(mirrorPalette\);/);
  // 渲染期不得读 localStorage：唯一一次 readPalettePreference() 必须在 boot 的异步块里。
  const bootIndex = shell.indexOf('const visitorData = await withTimeout(');
  assert.ok(bootIndex > 0, 'boot 异步块必须存在');
  const readIndex = shell.indexOf('readPalettePreference()');
  assert.ok(readIndex > bootIndex, 'readPalettePreference 只能出现在 boot 之后（effect / 事件回调）');
});

// ── 判据 4：四个落点的取值来源 ──

test('the four surfaces read the shared tokens (bubbles, send key, online)', () => {
  const bubble = stripComments(read(MESSAGE_BUBBLE));
  assert.match(bubble, /style=\{\{ backgroundColor: theme\.myBubble, color: theme\.myText \}\}/);
  // 第四个落点（AI 侧）已由「实心气泡」改成「10% 底膜 + 文字阴影」，取值来源不变（同一个注入 theme）
  assert.match(bubble, /aiTextPresentation\(theme\.theirBubble, /);
  assert.match(bubble, /color: theme\.theirText/);
  assert.doesNotMatch(bubble, /AI_TEXT_SHADOW|aiMembraneBackground\(/);

  const input = stripComments(read(MESSAGE_INPUT));
  assert.match(input, /style=\{\{ backgroundColor: accent, color: '#1a1210' \}\}/, '发送键前景仍是写死的 #1a1210');

  const list = stripComments(read(CONVERSATION_LIST));
  assert.match(list, /character\?\.theme\.accent/, '侧栏在线圆点读同一个 character.theme.accent');
});

// ── 判据 3：三个组件不得各写一份映射 / 各读一次 localStorage ──

test('leaf chat components never re-derive the palette themselves', () => {
  for (const file of [MESSAGE_BUBBLE, MESSAGE_INPUT, CONVERSATION_LIST]) {
    const source = stripComments(read(file));
    assert.doesNotMatch(source, /applyChatPalette/, `${file} 不得自算玫瑰映射`);
    assert.doesNotMatch(source, /palette-client/, `${file} 不得读设备镜像`);
    assert.doesNotMatch(source, /localStorage/, `${file} 不得碰 localStorage`);
    assert.doesNotMatch(source, ROSE_HEX_PATTERN, `${file} 不得出现玫瑰 hex（单一来源是 src/lib/palette.ts）`);
  }
});

// ── 判据 7：两条表面红线 ──

test('neither the chat shell nor the theme dialog knows about the page surfaces', () => {
  for (const file of [CHAT_SHELL, THEME_SETTINGS]) {
    const source = stripComments(read(file));
    assert.doesNotMatch(source, /dream-blue/, `${file} 不得出现深蓝表面 id`);
    assert.doesNotMatch(source, /dream-rose/, `${file} 不得出现玫瑰表面 id`);
  }
});

// ── 判据（圆圈落位表 §4.2 / F7）：装扮弹窗**不再**托管氛围圆圈 ──

test('the theme dialog no longer hosts the palette circle (it moved to the chat header)', () => {
  const settings = read(THEME_SETTINGS);
  const source = stripComments(settings);

  // 圆圈已移到聊天头部（§4.2 落位表）：弹窗内连 import 都不该留。
  assert.doesNotMatch(source, /PaletteSwitch/, '弹窗内不得再挂氛围圆圈');
  assert.doesNotMatch(source, /palette-switch/, '连 import 也不该留');
  assert.doesNotMatch(source, /data-testid="palette-toggle"/, '弹窗内不得再有 palette-toggle');
  // 两个只为圆圈而存在的 prop 一并删除（chat-shell 侧也同步删了传参）。
  assert.doesNotMatch(source, /\bpalette\b\s*:/, 'palette prop 必须删除');
  assert.doesNotMatch(source, /onApplyPalette/, 'onApplyPalette prop 必须删除');
  assert.doesNotMatch(source, /PALETTE_LABEL|PALETTE_VALUES/, '不得自带标签表或选项渲染');

  // 既有 DOM 锚点与两段（UI 色调 / 背景皮肤）顺序不动。
  assert.match(settings, /data-testid="theme-settings"/);
  assert.match(settings, /data-companion-id=\{companionId\}/);
  assert.match(settings, /data-conversation-id=\{conversationId\}/);
  assert.match(settings, /onApplyUi/);
  assert.match(settings, /DEFAULT_CHAT_THEME_ID/);
});
