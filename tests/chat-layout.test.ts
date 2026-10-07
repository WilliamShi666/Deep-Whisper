import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CHARACTER_PRESETS } from '../src/lib/characters';
import { UI_THEMES } from '../src/lib/chat-themes';
import { ROSE_CHAT_THEME, applyChatPalette } from '../src/lib/palette';
import {
  AI_MEMBRANE_ALPHA,
  AI_TEXT_HALO_FAR_ALPHA,
  AI_TEXT_HALO_NEAR_ALPHA,
  AI_TEXT_SHADOW,
  CHAT_COMPOSER_CLASS,
  CHAT_COMPOSER_MAX_WIDTH_PX,
  CHAT_MESSAGE_COLUMN_CLASS,
  CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX,
  NO_WALLPAPER_SCRIM_MIX,
  aiMembraneBackground,
  aiTextHalo,
  aiTextPresentation,
  noWallpaperBackdrop,
  resolveToneMode,
} from '../src/lib/chat-layout';
import { composite, contrastRatio, hexToRgb, selectorBlock, token } from './support/wcag';

/**
 * E 版对话排版（契约 t37 / 队内 t23 的第五轮加法）：双宽度常量 + AI 正文明暗两套呈现。
 *
 * 判据来源：`docs/specs/2026-09-27-chat-layout-dots-and-voice-upsell.md`
 * §4.1.1（第五轮 U2：消息列 960 > 输入区 860）、§4.1.2（第五轮 U3：`aiTextPresentation`）、
 * §5.6.1（纯函数断言）。
 * 零 mock、零 DOM：源码文本断言 + 真实 WCAG 纯计算。**只断言 message-bubble 这一侧**
 * —— 流式段的接线归 t38（规格 §4.1.3），本文件不得为了让流式段变绿而要求改 chat-shell。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** 去掉注释后的源码（「不得再出现某零件」这类断言必须只看代码，不看注释里的历史说明）。 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 命中 `pattern` 的源码文件（相对 `src/` 的 POSIX 路径 + 命中次数）。 */
function hits(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    const count = source.match(pattern)?.length ?? 0;
    if (count > 0) found.push(`${relative(SRC_ROOT, file).split('\\').join('/')} ×${count}`);
  }
  return found.sort();
}

const AA = 4.5;
/** 第五轮 U3 冻结的四个浅色（milk）色调 —— 与 UI_THEMES 的 mode 字段交叉校验。 */
const LIGHT_UI_THEME_IDS = ['rose-milk', 'amber-milk', 'mist-milk', 'sage-milk'];

test('the message column is wider than the composer, each with a single numeric source', () => {
  assert.equal(CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX, 960);
  assert.equal(CHAT_COMPOSER_MAX_WIDTH_PX, 860);

  // 类名常量必须逐字符等于「由数值常量派生的形式」——字面量类名是 Tailwind 能扫到的前提，
  // 这条等式保证它不会与数值常量分叉（改常量就必须改这里，反之亦然）。
  assert.equal(CHAT_MESSAGE_COLUMN_CLASS, `mx-auto w-full max-w-[${CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX}px]`);
  assert.equal(CHAT_COMPOSER_CLASS, `mx-auto w-full max-w-[${CHAT_COMPOSER_MAX_WIDTH_PX}px]`);
  assert.ok(CHAT_MESSAGE_COLUMN_CLASS.includes('max-w-[960px]'), 'Tailwind 只生成字面量类名');
  assert.ok(CHAT_COMPOSER_CLASS.includes('max-w-[860px]'), 'Tailwind 只生成字面量类名');

  // 用户诉求（「间隔可以再超出一点」）写成不变式，而不是写死 960 > 860 的字面比较
  assert.ok(
    CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX > CHAT_COMPOSER_MAX_WIDTH_PX,
    '消息列必须比输入区宽，否则用户的诉求回退',
  );
  assert.ok(
    CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX / CHAT_COMPOSER_MAX_WIDTH_PX >= 1.1,
    '比值退化（差距不够肉眼可见）必须立刻红',
  );

  // 词边界扫描：`ISO-8601` 这类子串不算命中（裸子串扫描会误伤 time-source.ts / prompts.ts）。
  assert.deepEqual(hits(/\b960\b/g), ['lib/chat-layout.ts ×1'], '960 只允许在 chat-layout.ts 定义一次');
  assert.deepEqual(hits(/\b860\b/g), ['lib/chat-layout.ts ×1'], '860 只允许在 chat-layout.ts 定义一次');
  // 字面量类名里的 `960px`/`860px` 因「数字后紧跟 p」没有词边界，天然不计入上面那两次扫描
  assert.deepEqual(hits(/max-w-\[960px\]/g), ['lib/chat-layout.ts ×1'], '960 的类名字面量只定义一次');
  assert.deepEqual(hits(/max-w-\[860px\]/g), ['lib/chat-layout.ts ×1'], '860 的类名字面量只定义一次');

  // 输入区（本任务唯一能改的消费点）：引用 CHAT_COMPOSER_*，且不再有第二份宽度字面量
  const input = read('src/components/chat/message-input.tsx');
  assert.match(input, /CHAT_COMPOSER_MAX_WIDTH_PX/, '输入区必须引用输入区宽度来源');
  assert.match(input, /CHAT_COMPOSER_CLASS/, '输入区的类名必须来自同一定义');
  assert.match(input, /style=\{\{ maxWidth: CHAT_COMPOSER_MAX_WIDTH_PX \}\}/, '输入区用 inline style 写 maxWidth');
  assert.doesNotMatch(input, /max-w-2xl/, '输入区不得有第二份宽度字面量');
  assert.doesNotMatch(input, /max-w-\[860px\]/, '输入区不得手抄宽度字面量类名');
  assert.doesNotMatch(input, /max-w-\[\$\{/, '不得用模板串拼类名（Tailwind 会静默不生成）');
  assert.doesNotMatch(input, /CHAT_MESSAGE_COLUMN/, '输入区不得误用消息列宽度');

  // 消息列那一侧由 t38 接线（规格 §4.1.3）；本文件不要求 chat-shell 现在就改完
});

test('the ai membrane is a ten percent mix of theirBubble', () => {
  assert.equal(AI_MEMBRANE_ALPHA, 0.1);
  assert.equal(aiMembraneBackground('#3a2229'), 'color-mix(in srgb, #3a2229 10%, transparent)');

  const layout = stripComments(read('src/lib/chat-layout.ts'));
  // 输出必须由常量派生（改常量即改文案），不是写死的 10
  assert.match(layout, /AI_MEMBRANE_ALPHA \* 100/);
  assert.doesNotMatch(layout, /10%/, '不透明度不得以字面量出现');
  // 必须是 sRGB 纯 alpha 合成：`in oklab` 与单测的 composite() 模型不一致（voice-bar 的 oklab 不受影响）
  assert.doesNotMatch(layout, /in oklab/);
  // 四处 `color-mix(in srgb, …` 全在单一模块里：① 深色调底膜；②③ 浅色档光晕的近贴/远柔层；
  // ④ 无壁纸分支的浅色调底色（t83）。不得散落到组件里，也不得多出第五处。
  assert.deepEqual(hits(/color-mix\(in srgb,/g), ['lib/chat-layout.ts ×4'], '合成色只允许存在于 chat-layout.ts');

  // 底膜要比实心底更淡（去胶囊的意义），上限由规格给出
  assert.ok(AI_MEMBRANE_ALPHA > 0 && AI_MEMBRANE_ALPHA <= 0.16);
});

test('the membrane keeps the ai text readable on every real backdrop', () => {
  const backdrops = CHARACTER_PRESETS.flatMap((preset) => (
    ([['native', preset.theme], ['rose', applyChatPalette(preset.theme, 'rose')]] as const).map(([mode, theme]) => ({
      name: `${preset.key} / ${mode}`,
      fg: hexToRgb(theme.theirText),
      bg: composite(hexToRgb(theme.theirBubble), AI_MEMBRANE_ALPHA, hexToRgb(theme.chatBg)),
    }))
  ));
  assert.ok(backdrops.length >= 9, '覆盖 8 个预设 + 玫瑰模式');

  for (const group of backdrops) {
    const ratio = contrastRatio(group.fg, group.bg);
    // 只写「≥ 4.5」，不写死比值
    assert.ok(ratio >= AA, `${group.name} 的 AI 正文只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${AA}:1`);
  }

  // 没有壁纸的退化态：压 .dark --background（真值从 globals.css 取，不抄 hex）
  const darkBackground = token(selectorBlock(read('src/app/globals.css'), '.dark'), 'background');
  const onDark = contrastRatio(
    hexToRgb(ROSE_CHAT_THEME.theirText),
    composite(hexToRgb(ROSE_CHAT_THEME.theirBubble), AI_MEMBRANE_ALPHA, darkBackground),
  );
  assert.ok(onDark >= AA, `.dark --background 上只有 ${onDark.toFixed(2)}:1`);
  // 反证：底膜确实与实心 theirBubble 不是同一个底色（否则这条门禁等于没测新形态）
  const solid = contrastRatio(hexToRgb(ROSE_CHAT_THEME.theirText), hexToRgb(ROSE_CHAT_THEME.theirBubble));
  assert.notEqual(onDark.toFixed(4), solid.toFixed(4));
  // 转换器自证：不做这一步，上面可能因为转换器恒返回同一个数而假绿
  assert.equal(contrastRatio(hexToRgb('#000000'), hexToRgb('#ffffff')), 21);
});

test('the dark presentation stays byte-identical to the pre-U3 behaviour', () => {
  // dark = 10% theirBubble 膜 + 皮肤文字色（调用点传入）+ AI_TEXT_SHADOW，三者一字不改
  assert.deepEqual(aiTextPresentation('#3a2229', 'dark', '#eef7ff', '#e0a1ab'), {
    background: 'color-mix(in srgb, #3a2229 10%, transparent)',
    color: '#eef7ff',
    textShadow: '0 1px 2px rgb(0 0 0 / 45%)',
  });
  // 与既有两个零件的输出完全一致（回归红线：dark 分支不得借 U3 顺手改观感）
  assert.equal(aiTextPresentation('#1d3042', 'dark', '#eef7ff', '#e0a1ab').background, aiMembraneBackground('#1d3042'));
  assert.equal(aiTextPresentation('#1d3042', 'dark', '#eef7ff', '#e0a1ab').textShadow, AI_TEXT_SHADOW);
  assert.equal(aiTextPresentation('#1d3042', 'dark', '#eef7ff', '#e0a1ab').color, '#eef7ff');
  // dark 分支**完全不看** `theirAccent`（浅色档才用它）：换一个强调色，输出逐字节不变
  assert.deepEqual(
    aiTextPresentation('#3a2229', 'dark', '#eef7ff', '#e0a1ab'),
    aiTextPresentation('#3a2229', 'dark', '#eef7ff', '#00ff00'),
  );
});

// 第七轮候选四（用户第四轮反馈，原话照抄）：
//   ①「如果用户在'梦幻蓝'和'梦幻玫瑰'之间切换，不会感觉到**有梦幻色的光晕铺在这个 AI 的黑字上**，
//      这个感觉不是很完美。如果用户选择深色的色调，再切换到梦幻色，他会感觉到有梦幻色的色调或光晕
//      铺在 AI 生成的白字上，这个感觉就挺好。」
//   ②「如果用户选择了**默认的背景**（也就是不含任何壁纸的背景），那这个字就会**完全看不清**。」
//   ③「在浅色模式下，给 AI 生成的字上面加上梦幻色光晕之后，**不能让 AI 的字显得比较淡**。」
//
// ⇒ 浅色档 = 无背景（`transparent`）+ `var(--foreground)`（**字色一字不改**：用户禁止用亮化字色换可读性）
//   + 两层的**梦幻色**光晕（近贴 1px / 远柔 9px，两层**都不含白色**）。光晕取 `theme.accent`
//   （风格强调色：玫瑰模式 #e0a1ab / 梦幻蓝 = 角色原生蓝族 accent）⇒ 切换风格时光晕真的换色。
//   这组取值是**候选四**：等用户在 :5100 上再看一眼，用户若再调，期望值跟着走。
test('the light halo is two style-coloured layers with no white in it', () => {
  const accent = ROSE_CHAT_THEME.accent; // '#e0a1ab'：玫瑰模式的风格强调色
  const light = aiTextPresentation('#3a2229', 'light', '#eef7ff', accent);
  assert.deepEqual(light, {
    // `transparent` 是**显式**写的（不是省略字段）：既表达「没有背景」，也挡掉任何继承 / 类名背景。
    background: 'transparent',
    color: 'var(--foreground)',
    textShadow: aiTextHalo(accent),
  });

  // 用户③那条硬约束的**机械判据**：光晕 = 风格色混到 `transparent`，**配方里一个 white 都没有**
  // ⇒ 光晕只能落在「风格色 ↔ 背板」之间做插值：浅背板上它**只可能压深（更实）**，不可能提亮
  //（漂白笔画就是「淡」的来源，候选二/三那两层纯白正是这么把字弄淡的）。
  assert.equal(
    aiTextHalo(accent),
    '0 0 1px color-mix(in srgb, #e0a1ab 85%, transparent), 0 0 9px color-mix(in srgb, #e0a1ab 55%, transparent)',
  );
  // 切层不能按裸逗号 —— `color-mix(in srgb, X 85%, transparent)` 自己就带一个逗号
  const stops = aiTextHalo(accent).split(/,\s*(?=0\s+0\s)/).map((stop) => stop.trim());
  assert.equal(stops.length, 2, '近贴 + 远柔两层');
  for (const [i, stop] of stops.entries()) {
    assert.match(stop, /^0 0 \d+px color-mix\(in srgb, #e0a1ab \d+%, transparent\)$/, `第 ${i + 1} 层必须零偏移且是风格色：${stop}`);
  }
  assert.doesNotMatch(aiTextHalo(accent), /white|255 255 255/, '光晕里不得有任何白色（漂白 = 「淡」）');
  // 近贴层取**最小必要**宽度（1px）；远柔层半径更大（6–10px）承担承托与「梦幻色铺在黑字上」
  assert.match(stops[0], /^0 0 1px /, '近贴层必须是最小必要的 1px');
  assert.match(stops[1], /^0 0 (?:[6-9]|10)px /, '远柔层半径必须落在 6–10px');
  assert.ok(AI_TEXT_HALO_NEAR_ALPHA > AI_TEXT_HALO_FAR_ALPHA, '近贴层更实、远柔层更透');

  // ① 的判据：光晕取的是**风格色**，换风格必须换色（`var(--primary)` 在消息列里不随风格变）
  assert.notEqual(aiTextHalo(ROSE_CHAT_THEME.accent), aiTextHalo(CHARACTER_PRESETS[0].theme.accent));
  assert.match(aiTextHalo('#8ec9ed'), /#8ec9ed 85%, transparent/);

  // 字色不得被提亮：仍是 `--foreground`（也绝不是皮肤色）
  assert.equal(light.color, 'var(--foreground)');
  assert.notEqual(light.color, '#eef7ff');

  // 浅色档不得再有任何底膜零件（第五轮的薄纱变量 / 白度常量 / 提亮下投影都必须随底膜一起消失）
  assert.doesNotMatch(
    stripComments(read('src/lib/chat-layout.ts')),
    /ai-veil-tint|AI_VEIL_ALPHA|AI_TEXT_HIGHLIGHT/,
    '浅色档已无底膜：底膜零件不得留下',
  );
});

// 第七轮候选二 ④：chrome 与它的选路钩子必须整段删干净，不留死样式 / 孤立类名 / 孤立属性。
test('the veil chrome and its tone hook are gone, and the geometry is back to pre-round-5', () => {
  const css = read('src/app/globals.css');
  assert.doesNotMatch(css, /\.ai-text-veil/, 'CSS 里不得再留薄纱规则（死样式）');
  assert.doesNotMatch(css, /--ai-veil-tint/, '底膜用的 CSS 变量已无消费方，必须一起删');
  assert.doesNotMatch(css, /backdrop-filter:\s*blur\(14px\)/, '薄纱的背景模糊必须随底膜一起删');

  const TOKENS = ['text-[15px]', 'leading-relaxed', 'break-words', 'whitespace-pre-wrap'];
  const bubble = stripComments(read('src/components/chat/message-bubble.tsx'));
  const shell = stripComments(read('src/components/chat/chat-shell.tsx'));
  for (const [name, source] of [['message-bubble.tsx', bubble], ['chat-shell.tsx', shell]] as const) {
    assert.doesNotMatch(source, /ai-text-veil/, `${name} 不得再挂已删除的类名`);
    // `data-tone` 唯一的消费者就是那条被删的 CSS 规则 ⇒ 两个消费点一并删，不留孤立标记
    assert.doesNotMatch(source, /data-tone/, `${name} 不得再留 data-tone`);
  }

  // 正文容器的几何回到第五轮之前：助手文本分支只有这四个排版类（胶囊类只作用于图片分支；
  // 用户气泡那行以 `max-w-[78%]` 打头，这里用「行首就是 text-[15px]」把它排除掉）
  const bubbleLiteral = bubble.match(/^\s*'(text-\[15px\][^']*)',$/m);
  assert.ok(bubbleLiteral, 'message-bubble 的助手文本分支必须保留基础排版类字面量');
  assert.deepEqual(bubbleLiteral[1].split(/\s+/), TOKENS, '文本分支不得再有任何背景 / 内边距 / 描边 / 圆角类');

  // 流式段与落库气泡的运行期 classList：基础四类逐字符相同，浅色档的字重条件两边都要挂
  // （第七轮候选三把字重加进这一类清单；只改一个消费点会让流式中/流式后粗细不同）
  const shellLiteral = shell.match(/'(text-\[15px\][^']*)'/);
  assert.ok(shellLiteral, 'chat-shell 的流式段必须用同一组排版类');
  assert.deepEqual(shellLiteral[1].split(/\s+/), TOKENS, '流式段与落库气泡的基础类必须逐字符相同');
  for (const [name, source] of [['message-bubble.tsx', bubble], ['chat-shell.tsx', shell]] as const) {
    assert.match(source, /toneMode === 'light' && 'font-medium'/, `${name} 必须挂同一个浅色档字重条件`);
  }
});

// 第七轮候选三（用户第三轮反馈，原话照抄）：「…现在 AI 消息背后的白膜已经去掉了，不过 AI 生成消息的
// 这些字感觉**有点淡**，如果是浅色模式的话，**对于一些视力不太好的人可能会看不清楚**；而且如图所示，
// **用户消息会感觉比 AI 消息稍微粗一点点**，您看看这类的可以怎么处理？要不要也稍微加粗一点 AI 的消息？」
//
// **先量事实再改**：`message-bubble.tsx` 里用户气泡与 AI 正文**都没有字重类（= 400）**，两边类里都有
// `text-[15px] leading-relaxed`。用户看到的「粗细差」是**载体差**而不是字体差：
//   - 用户气泡有**实底**（`theme.myBubble`），笔画边缘不被身后的图案冲淡；
//   - AI 正文**直接压壁纸**，壁纸纹理 +（候选二那圈大范围）白晕会在边缘「漂白」笔画 ⇒ 显淡。
// 处置（只动浅色档）：给 AI 正文加一档 `font-medium`（500），并把晕影收成紧贴的一层；深色档与用户
// 气泡一个字都不改。这是**候选三**，等用户再看一眼；用户若再调，期望值跟着走。
test('only the light tone gets the extra text weight, and the user bubble stays weightless', () => {
  const bubble = stripComments(read('src/components/chat/message-bubble.tsx'));
  const shell = stripComments(read('src/components/chat/chat-shell.tsx'));

  // ① 条件类：浅色档（且不是图片分支）才加 `font-medium`；图片分支有自己的胶囊几何，不掺字重
  assert.match(
    bubble,
    /message\.content_type !== 'image' && toneMode === 'light' && 'font-medium'/,
    'AI 正文（文本分支）必须在浅色档下加 font-medium',
  );
  assert.match(shell, /toneMode === 'light' && 'font-medium'/, '流式段必须跟到同一个字重条件');

  // ② 反漂移：两个文件里各只允许一处字重类，且必须挂在 `toneMode === 'light'` 条件下
  //    ⇒ 深色档（`resolveToneMode` 只产出 'dark' | 'light'）**永远拿不到**这个类，字重仍是 400。
  for (const [name, source] of [['message-bubble.tsx', bubble], ['chat-shell.tsx', shell]] as const) {
    const weightLines = source.split('\n').filter((line) => line.includes("'font-medium'"));
    assert.equal(weightLines.length, 1, `${name} 只允许一处在字重类`);
    assert.match(weightLines[0], /toneMode === 'light'/, `${name} 的字重类必须只在浅色档生效`);
    assert.doesNotMatch(source, /'font-(?:semibold|bold|extrabold|black)'/, `${name} 不得加重到别的档位`);
  }
  // 深色档侧证：`toneMode` 只有 'dark' | 'light' 两个取值（唯一解析入口），dark ⇒ 条件为 false
  assert.deepEqual(
    UI_THEMES.filter((theme) => theme.mode === 'dark').map((theme) => resolveToneMode(theme.id)),
    UI_THEMES.filter((theme) => theme.mode === 'dark').map(() => 'dark'),
    '深色色调必须全部解析为 dark ⇒ 拿不到浅色档的字重类',
  );

  // ③ 用户气泡一个字不改：字重类不得出现在用户气泡那一行，用户气泡那行仍以 `max-w-[78%]` 打头
  const userLine = bubble.split('\n').find((line) => line.includes('max-w-[78%]'));
  assert.ok(userLine, '用户气泡的类名行必须还在');
  assert.doesNotMatch(userLine, /font-medium/, '用户气泡不得被加字重（用户没要求改它）');
  assert.match(userLine, /text-\[15px\] leading-relaxed/, '用户气泡仍保持 400 的基础排版类');
});



// 第七轮 t83（用户当场裁决「甲」）：无壁纸分支原先**只读角色 `theme.chatBg`**（`#101b28` / `#0d1925`，
// 来自 `src/lib/characters.ts` 的皮肤）⇒ **不 tone-aware**，浅色调下 AI 正文对底色只有 1.01–1.13:1
// （看不见）。改成与**有壁纸分支同一条口径**（套用该色调的 `uiTheme.scrim`），深色调一个像素不动。
test('the no-wallpaper backdrop follows the tone, and the dark path stays untouched', () => {
  // ① 纯函数：scrim 按常量比例混到角色 chatBg 上（比例**由常量派生**，模块里不写死字面量）
  assert.equal(NO_WALLPAPER_SCRIM_MIX, 0.94);
  assert.equal(noWallpaperBackdrop('#101b28', '#f6f0f0'), 'color-mix(in srgb, #f6f0f0 94%, #101b28)');
  assert.equal(noWallpaperBackdrop('#0d1925', '#f3f6ee'), 'color-mix(in srgb, #f3f6ee 94%, #0d1925)');
  assert.doesNotMatch(read('src/lib/chat-layout.ts'), /94%/, '比例必须由常量派生，不得写死字面量');

  // ② 浅色调 + 无壁纸：正文（该色调的 `--foreground`）对该底色的对比度 ≥ AA ——
  //    底色 = scrim 按常量比例混上角色 chatBg，再把角色 accent 径向（顶部 9.4%）叠上去取**最坏值**。
  const css = read('src/app/globals.css');
  const measured: string[] = [];
  for (const id of LIGHT_UI_THEME_IDS) {
    const block = selectorBlock(css, `html[data-ui-theme='${id}']`);
    const fg = token(block, 'foreground');
    const scrim = UI_THEMES.find((theme) => theme.id === id)!.scrim; // 与有壁纸分支同一个 scrim 来源
    let worst = Number.POSITIVE_INFINITY;
    let worstAt = '';
    for (const preset of CHARACTER_PRESETS) {
      const base = composite(hexToRgb(scrim), NO_WALLPAPER_SCRIM_MIX, hexToRgb(preset.theme.chatBg));
      const withRadial = composite(hexToRgb(preset.theme.accent), 0x18 / 255, base);
      const ratio = contrastRatio(fg, withRadial);
      if (ratio < worst) { worst = ratio; worstAt = preset.key; }
    }
    measured.push(`${id}=${worst.toFixed(2)}`);
    assert.ok(worst >= AA, `${id} 的无壁纸底色上正文只有 ${worst.toFixed(2)}:1（${worstAt}），低于 AA ${AA}:1`);
  }
  assert.deepEqual(measured, ['rose-milk=10.78', 'amber-milk=10.10', 'mist-milk=10.83', 'sage-milk=10.51']);
  assert.equal(contrastRatio(hexToRgb('#000000'), hexToRgb('#ffffff')), 21, '转换器自证');

  // ③ 深色调 + 无壁纸：三元表达式在 dark 下**原样返回** `theme.chatBg`（逐像素不变）
  const shell = stripComments(read('src/components/chat/chat-shell.tsx'));
  assert.match(
    shell,
    /backgroundColor: toneMode === 'light'\s*\n\s*\? noWallpaperBackdrop\(theme\.chatBg, uiTheme\.scrim\)\s*\n\s*: theme\.chatBg,/,
    '浅色调才换底色，深色调必须原样',
  );
  // 复用的就是组件里已经解析过一次的那一份色调值（不新增第二份解析）
  assert.match(shell, /const toneMode = uiTheme\.mode;/, 'toneMode 必须来自既有的 uiTheme.mode');
  assert.doesNotMatch(shell, /resolveToneMode/, 'chat-shell 里不得再解析一次色调');
  // ④ 有壁纸分支一行未动：img + 同一条 scrim 渐变；角色 accent 径向也仍在
  assert.match(shell, /src=\{chatTheme\.image\}/, '有壁纸分支的图像层不得改动');
  assert.match(
    shell,
    /linear-gradient\(to bottom, \$\{uiTheme\.scrim\}cc 0%, \$\{uiTheme\.scrim\}8c 45%, \$\{uiTheme\.scrim\}cc 100%\)/,
    '有壁纸分支的 scrim 渐变必须逐字符不变',
  );
  assert.match(shell, /radial-gradient\(ellipse 80% 40% at 50% -10%, \$\{theme\.accent\}18, transparent\)/, '角色 accent 径向必须保留');
});

test('the tone mode is resolved from the ui theme table only', () => {
  for (const id of LIGHT_UI_THEME_IDS) {
    assert.equal(resolveToneMode(id), 'light', `${id} 必须是 light（UI_THEMES 的 mode 字段）`);
  }
  // 交叉校验：浅色集合必须与 UI_THEMES 的 mode 字段完全一致（新增色调时同步）
  assert.deepEqual(
    UI_THEMES.filter((theme) => theme.mode === 'light').map((theme) => theme.id).sort(),
    [...LIGHT_UI_THEME_IDS].sort(),
    'light 色调清单必须以 UI_THEMES.mode 为唯一来源',
  );
  for (const theme of UI_THEMES.filter((item) => item.mode === 'dark')) {
    assert.equal(resolveToneMode(theme.id), 'dark', `${theme.id} 必须解析为 dark`);
  }
  // 未知 / 空 → dark（fail closed 到既有观感）
  for (const raw of [null, undefined, '', 'nope', 'rose-night-x']) {
    assert.equal(resolveToneMode(raw), 'dark', `${String(raw)} 必须回退 dark`);
  }
});

// 可读性口径（t80 建立、**t83 修订**）：两种背板 × 两种色调都要给读数。t83 之前「浅色调 + 无壁纸
// 默认背景」那一格是硬伤（1.01–1.13:1，看不见）—— 用户当场裁决「甲」后，那一格的底色已跟着色调走
// （见上一个测试），**现在四格都 ≥ AA**，所以这里不再有任何「钉住不达标」的断言（那是 t80 的过渡记录）。
//   ① 浅色调 + 浅背板（有壁纸时的 scrim / t83 后的无壁纸浅底）：`--foreground` vs 该色调 `--background`；
//   ② 深色调 + 无壁纸（底色仍是深色 chatBg + accent 径向）：皮肤浅字 + 10% 膜 vs 底色。
//   ③ 40 张照片壁纸的**局部**明暗静态无法建模：由 t80 的梦幻色光晕承担，由用户当场裁决接受。
test('the readability rubric covers both backdrops and both tones', () => {
  const css = read('src/app/globals.css');
  const measured: string[] = [];
  for (const id of LIGHT_UI_THEME_IDS) {
    const block = selectorBlock(css, `html[data-ui-theme='${id}']`);
    const ratio = contrastRatio(token(block, 'foreground'), token(block, 'background'));
    measured.push(`${id}=${ratio.toFixed(2)}`);
    assert.ok(ratio >= AA, `${id} 的 --foreground 对 --background 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA ${AA}:1`);
  }
  assert.deepEqual(measured, ['rose-milk=13.70', 'amber-milk=12.64', 'mist-milk=13.28', 'sage-milk=12.86']);

  // ② 深色调 + 无壁纸：底色 = 深色 `theme.chatBg`（t83 未动这一支）再叠 accent 径向；文字 = 皮肤浅字，
  //    压着 10% 的皮肤膜（与 `aiTextPresentation` 的 dark 分支同一套零件）。
  const darkMeasured: string[] = [];
  for (const preset of CHARACTER_PRESETS) {
    const backdrop = composite(hexToRgb(preset.theme.accent), 0x18 / 255, hexToRgb(preset.theme.chatBg));
    const membrane = composite(hexToRgb(preset.theme.theirBubble), AI_MEMBRANE_ALPHA, backdrop);
    const ratio = contrastRatio(hexToRgb(preset.theme.theirText), membrane);
    darkMeasured.push(`${preset.key}=${ratio.toFixed(2)}`);
    assert.ok(ratio >= AA, `${preset.key} 深色调无壁纸底色上只有 ${ratio.toFixed(2)}:1，低于 AA ${AA}:1`);
  }
  assert.equal(darkMeasured.length, CHARACTER_PRESETS.length, '八个预设逐一量过');

  // 反「假绿」自证：浅色档已无底膜，任何底膜零件都不得存在（出现即有人把假门禁加了回来）
  assert.deepEqual(
    hits(/ai-veil-tint|AI_VEIL_ALPHA|AI_TEXT_HIGHLIGHT/g),
    [],
    '浅色档不得再有任何可按底膜自算的零件',
  );
});

test('the text shadow is a single constant feeding the shared presentation', () => {
  assert.equal(AI_TEXT_SHADOW, '0 1px 2px rgb(0 0 0 / 45%)');
  assert.deepEqual(hits(/0 1px 2px rgb\(0 0 0 \/ 45%\)/g), ['lib/chat-layout.ts ×1'], '阴影值只允许定义一次');
  const layoutModule = read('src/lib/chat-layout.ts');
  assert.match(layoutModule, /textShadow: AI_TEXT_SHADOW/, 'dark 分支必须引用同一个阴影常量');
});

test('both ai text consumers call the same presentation function (F4, t38 wiring)', () => {
  const bubble = stripComments(read('src/components/chat/message-bubble.tsx'));
  const shell = stripComments(read('src/components/chat/chat-shell.tsx'));

  // ① 两处消费点的调用表达式**逐字符相同**（这是 t37 因文件归属无法自测的那条）。
  const CALL = 'aiTextPresentation(theme.theirBubble, toneMode, theme.theirText, theme.accent)';
  for (const [name, source] of [['message-bubble.tsx', bubble], ['chat-shell.tsx', shell]] as const) {
    assert.ok(source.includes(CALL), `${name} 必须逐字符调用 ${CALL}`);
    assert.doesNotMatch(
      source,
      /AI_TEXT_SHADOW|aiMembraneBackground\(/,
      `${name} 不得再出现两套呈现的裸零件（只准调 aiTextPresentation）`,
    );
  }

  // ② chat-shell 的接线：toneMode 取自当前 UI 色调，并原样下发给 MessageBubble 与其流式段。
  assert.match(shell, /const toneMode = uiTheme\.mode/, 'chat-shell 的 toneMode 必须取自当前 UI 色调');
  assert.match(shell, /toneMode=\{toneMode\}/, 'chat-shell 必须把同一个 toneMode 下发给 MessageBubble');

  // ③ MessageBubble 的另一个 prop：已解析的**风格**（不是 surface id），VoiceBar 侧叫 palette。
  assert.match(shell, /paletteSurface=\{palettePreference\}/, 'MessageBubble 收到的必须是已解析的风格值');
  assert.doesNotMatch(shell, /paletteSurface=\{[^}]*paletteSurfaceFor/, '不得把 surface id 当风格值传下去');
  assert.match(bubble, /palette=\{paletteSurface\}/, 'MessageBubble 透传给 VoiceBar（prop 名 palette）');

  // ④ 消息列 960：chat-shell 改用正名常量，t37 的过渡别名必须已删（无一命中）。
  assert.match(shell, /CHAT_MESSAGE_COLUMN_CLASS/, '消息列必须引用 960 的类名来源');
  assert.match(
    shell,
    /style=\{\{ maxWidth: CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX \}\}/,
    '消息列用 inline style 写 maxWidth（Tailwind 之外的双保险）',
  );
  assert.deepEqual(hits(/CHAT_COLUMN_/g), [], '旧别名 CHAT_COLUMN_* 已删除（正名是 CHAT_MESSAGE_COLUMN_* / CHAT_COMPOSER_*）');
});
