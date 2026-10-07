/**
 * 聊天页 E 版排版的单一来源：两个列宽 + AI 正文的明暗两套呈现
 * （契约 t37 / 队内 t23 的第五轮加法；判据见规格 §4.1.1 / §4.1.2）。
 *
 * 宽度有两个消费面，都指向同一个数值常量，避免手抄漂移：
 *   1. 运行时用 inline `maxWidth`（Tailwind 不参与，不可能被 JIT 丢掉）；
 *   2. 类名常量里保留**字面量**类名 —— Tailwind 只生成「源码里出现过的字面量类名」，
 *      动态拼类名会静默不生成；`tests/chat-layout.test.ts` 断言字面量逐字符等于由数值常量
 *      派生的形式，所以两者不会分叉。
 */

import { UI_THEMES } from '@/lib/chat-themes';

/** 消息列的宽度上限（px）：第五轮 U2 加宽，让消息跨度比输入框多出更多（用户：「间隔可以再超出一点」）。 */
export const CHAT_MESSAGE_COLUMN_MAX_WIDTH_PX = 960;

/** 消息列的类名（`chat-shell.tsx` 的消息列容器用；那一侧的接线归 t38）。 */
export const CHAT_MESSAGE_COLUMN_CLASS = 'mx-auto w-full max-w-[960px]';

/** 输入区（含 textarea 所在列）的宽度上限（px）：第五轮保持不动。 */
export const CHAT_COMPOSER_MAX_WIDTH_PX = 860;

/** 输入区的类名（`message-input.tsx` 用）。 */
export const CHAT_COMPOSER_CLASS = 'mx-auto w-full max-w-[860px]';

/** AI 正文底膜的不透明度（`theirBubble` 的 alpha 比例）。只服务**深色调** —— 浅色调已无底膜。 */
export const AI_MEMBRANE_ALPHA = 0.1;

/** AI 正文的文字阴影（深色调下正文铺满整列、压在壁纸上时的可读性兜底）。 */
export const AI_TEXT_SHADOW = '0 1px 2px rgb(0 0 0 / 45%)';

/**
 * 浅色调正文**梦幻色光晕**的两层参数（第七轮候选四）。
 *
 * 用户第四轮反馈（判据来源，原话照抄）：
 *   ① 「如果用户在'梦幻蓝'和'梦幻玫瑰'之间切换，不会感觉到**有梦幻色的光晕铺在这个 AI 的黑字上**，
 *      这个感觉不是很完美。如果用户选择深色的色调，再切换到梦幻色，他会感觉到有梦幻色的色调或光晕
 *      铺在 AI 生成的白字上，这个感觉就挺好。」
 *   ② 「如果用户选择了**默认的背景**（也就是不含任何壁纸的背景），那这个字就会**完全看不清**。」
 *   ③ 「在浅色模式下，给 AI 生成的字上面加上梦幻色光晕之后，**不能让 AI 的字显得比较淡**。」
 *
 * 根因（实测）：字色由**色调**决定（深/浅），可读性却取决于**背板**（有壁纸 / 无壁纸默认背景），
 * 两者彼此独立。深色档之所以一直成立，是「浅字 + 暗膜 + 暗投影」**自带承托**；浅色档去掉膜后
 * 失去了这层承托 —— 而且**无壁纸分支的背板当时是暗的**（`chat-shell.tsx` 里 `chatTheme` 为空的
 * `else` 支、也就是 `backgroundColor: theme.chatBg` 那一处：只读角色皮肤色、不读 `uiTheme` ⇒ 不
 * tone-aware；浅色调下 `--foreground` 又是深色 ⇒ 实测对比 1.01–1.13:1，用户说的「完全看不清」正是
 * 这一格。该格已由 t83 从背景侧修掉：见下面的 `noWallpaperBackdrop`）。
 *
 * 两层的配方**都不含白色**（这是用户③那条硬约束的机械保证）：光晕 = 风格色 `color-mix` 到
 * `transparent`，也就是「风格色与背板之间的插值」⇒ 在浅背板上它**只可能把周围压深（更实）**、
 * 不可能提亮（漂白就是「淡」的来源）；在暗背板上它才把周围提亮（承托）。
 *   - **近贴**（`0 0 1px`，宽度取最小必要值）：`color-mix(风格色 ${NEAR}%, transparent)` ——
 *     贴在笔画边缘的一圈**有色**描边（不是候选二/三那种把笔画漂白的白色层）。
 *   - **远柔**（`0 0 9px`）：同色、更低 alpha —— 承托与「梦幻色铺在黑字上」的主要观感来源。
 *
 * 为什么风格色取 **`theme.accent`** 而不是 `var(--primary)`：`--primary` 在消息列里**不会随
 * 梦幻玫瑰 ↔ 梦幻蓝 变化** —— 聊天页只有**三处 `data-surface={chromeSurface}`**（侧栏 / 头部 /
 * 输入区），而消息列是它们**各自**的兄弟节点（`chat-shell.tsx` 里 `CHAT_MESSAGE_COLUMN_CLASS`
 * 的使用点），不继承那套 token，于是 `var(--primary)` 只跟着 `html[data-ui-theme]`（UI 色调）。
 * 而 `theme.accent` 恰好是**风格化的强调色**（玫瑰模式 = `ROSE_CHAT_THEME.accent`，梦幻蓝 = 角色
 * 原生蓝族 accent —— 色值只在 `src/lib/palette.ts` / `src/lib/characters.ts` 里，本文件一个字都不抄，
 * `tests/palette-resolver.test.ts` 钉住这条单一来源）⇒ 用户切换风格时光晕真的换色，这才是用户①要的。
 *
 * 两个 alpha 是**像素实测选出来的**（Playwright headless 在 :5100 上截 AI 文本块，分类核心/边缘/环带）：
 * 本组取值在浅背板上把抗锯齿边缘 −0.038、1–2px 环带 −0.049 压深（候选三是 **+0.018 / +0.014** 的漂白），
 * 而完全覆盖的核心像素亮度不变（Δ −0.0001，噪声量级）。
 */
export const AI_TEXT_HALO_NEAR_ALPHA = 0.85;

/** 远柔层的 alpha（见上一条注释）：半径更大、alpha 更低，负责承托与梦幻色观感。 */
export const AI_TEXT_HALO_FAR_ALPHA = 0.55;

/**
 * 浅色调正文的 `text-shadow`：把**风格色**展开成「近贴 + 远柔」两层（见上面两条常量的注释）。
 *
 * 两层都是**零偏移**（`0 0 <blur>`）⇒ 四周等距，是「一圈晕影」；深色调那层 `0 1px …` 带方向性，
 * 压在浅色调的深色字上只会把字压脏（深色档的呈现因此逐字节不变）。
 */
export function aiTextHalo(styleColor: string): string {
  const near = Math.round(AI_TEXT_HALO_NEAR_ALPHA * 100);
  const far = Math.round(AI_TEXT_HALO_FAR_ALPHA * 100);
  return `0 0 1px color-mix(in srgb, ${styleColor} ${near}%, transparent), `
    + `0 0 9px color-mix(in srgb, ${styleColor} ${far}%, transparent)`;
}

/** 色调明暗：由 `UI_THEMES[].mode` 决定（四个 `*-milk` 是 light）。 */
export type ToneMode = 'dark' | 'light';

/**
 * 无壁纸分支的浅色调底色里，该色调 `uiTheme.scrim` 的占比（第七轮 t83；用户当场裁决「甲」）。
 *
 * 用户裁决原话：「无壁纸时底色跟着色调走」—— 浅色调 ⇒ 浅底（仍带角色色相），深色调**完全不变**。
 *
 * 修的是 t80 查出来的硬伤：浅色调 + 无壁纸时 AI 正文对底色只有 **1.01–1.13:1**（等于看不见），
 * 因为无壁纸分支原先只读角色 `theme.chatBg`（`#101b28` / `#0d1925`，来自 `src/lib/characters.ts`
 * 的皮肤），**完全不看色调**；而有壁纸分支一直用 `uiTheme.scrim`（`chat-shell.tsx` 里那条
 * `linear-gradient(… scrim cc/8c/cc …)`）⇒ tone-aware。文字阴影永远改不了「字 vs 底」的整体比值，
 * 所以这一格只能从背景侧收。
 *
 * 有壁纸分支的 scrim 不透明度（`cc`/`8c` = 80%/55%）是为**照片**留透出率调的；无壁纸时底下只是一块
 * 纯色，可以放心把 scrim 开到下面这个档位（同一个来源、同一个机制，只是没有照片要保）⇒ 浅色调得到一块**浅底**，
 * 同时仍留 **6% 的角色 `chatBg` 色相**（配合原样保留的角色 accent 径向 ⇒ 不是换一块纯色底）。
 *
 * 实测（四个 `*-milk` × 两种角色 chatBg × 8 个角色 accent 的 accent 径向叠加，取最差）：
 * 正文对底色 **10.10–10.83:1**（AA 4.5 的 2.2 倍以上）。灵敏度（同一个函数只改这个常量）：
 * 0.96 ⇒ 10.49–11.25；**1.00 ⇒ 11.29–12.11**（但那时角色 chatBg 色相为 0）；0.90 ⇒ 9.36–10.03。
 */
export const NO_WALLPAPER_SCRIM_MIX = 0.94;

/**
 * 无壁纸分支的底色：把该色调的 `scrim` 按 `NO_WALLPAPER_SCRIM_MIX` 混到角色 `chatBg` 上
 * （与有壁纸分支同一个色调来源；`in srgb` 的合成模型与 `tests/support/wcag.ts` 的 `composite()` 一致）。
 *
 * 调用点只在**浅色调**下用它（`toneMode === 'light'`）：深色调必须逐像素保持 `theme.chatBg` 原样。
 * 比例由常量派生（改常量即改输出），不写死字面量。
 */
export function noWallpaperBackdrop(chatBg: string, scrim: string): string {
  return `color-mix(in srgb, ${scrim} ${Math.round(NO_WALLPAPER_SCRIM_MIX * 100)}%, ${chatBg})`;
}


/** AI 正文的呈现：三个字段直接展开进 React 的 `style`。 */
export interface AiTextPresentation {
  background: string;
  color: string;
  textShadow: string;
}

/**
 * AI 正文底膜：把 `theirBubble` 按 `AI_MEMBRANE_ALPHA` 合成到 transparent 上的背景值。
 *
 * 必须是 `in srgb` 的纯 alpha 合成，而不是 oklab 插值：规格 §4.1.2 的可读性门禁用
 * `tests/support/wcag.ts` 的 `composite()` 建模，只有 sRGB 纯 alpha 与它一致。
 * 比例由 `AI_MEMBRANE_ALPHA` 派生（改常量即改输出），不写死字面量。
 */
export function aiMembraneBackground(theirBubble: string): string {
  return `color-mix(in srgb, ${theirBubble} ${AI_MEMBRANE_ALPHA * 100}%, transparent)`;
}

/** toneMode 的唯一解析入口：从 UI 色调 id 取 `mode`，未知 / 空 → `'dark'`（fail closed 到既有观感）。 */
export function resolveToneMode(uiThemeId: string | null | undefined): ToneMode {
  return UI_THEMES.find((theme) => theme.id === uiThemeId)?.mode ?? 'dark';
}

/**
 * AI 正文的明暗两套呈现（第五轮 U3；两个消费点必须共用这一个函数）。
 *
 * - `dark`（8 个 `*-night` 色调）：`AI_MEMBRANE_ALPHA` 比例的 `theirBubble` 底膜
 *   + **调用点传入的**皮肤文字色 + `AI_TEXT_SHADOW` —— 与第五轮之前逐字符一致（回归红线，不得借
 *   后续轮次顺手改观感）。
 * - `light`（4 个 `*-milk` 色调）：第七轮候选二/三/四 —— **完全没有背景**（`transparent`，正文直接
 *   压在壁纸上，与深色调结构一致）+ `var(--foreground)` + `aiTextHalo(风格色)`（候选四：两层的
 *   **梦幻色**光晕，不含白）。第五轮那层薄纱底膜与它的 chrome（背景模糊 / 1px 描边 / 圆角 /
 *   内边距 / 轻投影）已整段删除，几何回到第五轮之前。
 *
 * 为什么**字重不在这里**：候选三给浅色档加的那一档 `font-medium`（500）是两个消费点的**条件类**
 * （`toneMode === 'light' && 'font-medium'`），不是 `style` 展开的一部分 —— 放类里才能保证流式段与
 * 落库气泡用的是同一个条件（`tests/chat-layout.test.ts` 把两处条件与「只出现一次」都钉住了）。
 *
 * 用户原话（第七轮裁决，判据来源）：「浅色模式下 AI 的文字效果是不错的，但是我觉得**不需要在 AI 的
 * 消息后面放白色的底部白膜**，因为 (a) 这样会不太好看；(b) **需要和深色色调下保持一致** —— 因为在
 * 深色色调下，AI 生成的是**略带用户所选梦幻色的白字，后面直接就是壁纸**，这个效果其实挺好的。
 * 我想看看浅色模式下也采用类似模式。」
 *
 * 为什么 `theirText` / `theirAccent` 是**入参**：函数只拿到 `theirBubble` 时无法得知皮肤的文字色
 * 与风格强调色，而 dark 分支又必须逐字符等于今天的 `theme.theirText`（规格 §4.1.2 判据 2）。
 * 两个都排在规格 §5.1 列出的两个入参之后，末尾追加、不改变前两个位置的含义。
 *
 * **可读性口径按事实拆成两段（第七轮；上一轮的教训是假绿比红更危险）**：
 *   1. 能静态证明的部分：该色调的 `--foreground` 对 `--background` 的对比度 ≥ WCAG AA 4.5 ——
 *      四个 `*-milk` 实测 rose-milk 13.70 / amber-milk 12.64 / mist-milk 13.28 / sage-milk 12.86
 *      （`tests/chat-layout.test.ts` 用 `tests/support/wcag.ts` 复算并钉住这组数）。这是**有壁纸**
 *      （浅 scrim）那一格的读数。
 *   2. **不可静态建模 / 不达标的部分（不许写成达标）**：正文直接压在 40 张照片壁纸上，壁纸局部的
 *      明暗与纹理和文字落在哪里无关，静态无法建模；
 *   3. 「浅色调 + 无壁纸默认背景」那一格（t80 查出的硬伤：深色 `--foreground` 压在角色
 *      `theme.chatBg` 上只有 1.01–1.13:1）**已由 t83 从背景侧修掉**：用户当场裁决「甲」，
 *      无壁纸底色改成跟着色调走（`noWallpaperBackdrop`，浅色调 ⇒ 浅底，10.10–10.83:1 ≥ AA）。
 *      光晕仍是**壁纸纹理**上的局部承托（像素实测：无晕影时 1–2px 环带亮度 0.0112 → 0.0375，
 *      约 3.3×；核心/环带对比 1.16 → 1.23）—— 它从来改不了「字 vs 背板」的整体比值，所以那一格
 *      只能从背景侧收。
 * 这里**不留**任何「按底膜自算」的门禁：底膜已经不存在，按它自算出来的绿是假绿。
 */
export function aiTextPresentation(
  theirBubble: string,
  toneMode: ToneMode,
  theirText: string,
  theirAccent: string,
): AiTextPresentation {
  if (toneMode === 'light') {
    return {
      // 显式 `transparent`（而不是省略字段）：既表达「没有背景」，也挡掉任何继承 / 类名背景，
      // 让这一列的观感 100% 来自壁纸 + 字 + 晕影（与深色调「白字 + 直接壁纸」结构一致）。
      background: 'transparent',
      color: 'var(--foreground)',
      textShadow: aiTextHalo(theirAccent),
    };
  }
  return {
    background: aiMembraneBackground(theirBubble),
    color: theirText,
    textShadow: AI_TEXT_SHADOW,
  };
}
