import type { CharacterTheme } from './characters';
import type { ToneMode } from './chat-layout';

/**
 * 「梦幻玫瑰 ↔ 梦幻蓝」全局风格开关的**唯一纯函数契约**（t5）。
 *
 * 分层（不要让实现者各自造约定）：
 *   - 本文件：零 React、零 DOM、零 IO —— 服务端路由、页面、聊天组件都只准从这里取值。
 *     解析优先级的唯一一条链写在 `resolvePalettePreference`：访客档案 > localStorage > 页面默认。
 *   - `palette-client.ts`：`'use client'` 边界（localStorage 读写 + `usePaletteSurface`）。
 *     **服务端路由不得 import 它**（会把 apiFetch/hook 带进 route）。
 *   - `globals.css`：表面取值（`[data-surface='dream-rose']` / `dream-blue`），本文件只给 id。
 *
 * 语义要点：
 *   - `null` 是真实的「未选择」状态，不是 `'rose'` 的别名；未选择的用户看到的是页面默认，
 *     聊天页则是角色原生色（**逐像素不变**）。
 *   - 聊天里只有 `'rose'` 才换色：`'blue'` 在聊天里等同 `'native'`，所以 `applyChatPalette`
 *     必须原样返回入参引用，禁止 spread 出一份相等的新对象（引用级判据见单测判据 A）。
 *   - 玫瑰取值只有这一份全局表，不按角色做变体；`chatBg` 不参与玫瑰化（用户本轮原话：
 *     「壁纸与聊天背景设定不动」）。
 */

export type PaletteValue = 'rose' | 'blue';
export type PalettePreference = PaletteValue | null;
export type PaletteSurface = 'dream-rose' | 'dream-blue';
export type PalettePage = 'entry' | 'billing' | 'landing';
export type ChatPalette = 'rose' | 'native';

export const PALETTE_VALUES: readonly PaletteValue[] = ['rose', 'blue'];

/**
 * 未选择（`null`）时各页面的默认风格：入口页梦幻玫瑰、支付页梦幻蓝、落地页（/love）梦幻蓝。
 *
 * 落地页单独一档（用户 2026-10-01：「新增梦幻蓝配色，并将其设为默认配色」只针对落地页）；
 * 三处共用同一个设备镜像 `vl_palette`，所以访客在落地页点过一次，开屏 / 登录也跟着走。
 */
export const PAGE_PALETTE_DEFAULT: Readonly<Record<PalettePage, PaletteValue>> = {
  entry: 'rose',
  billing: 'blue',
  landing: 'blue',
};

/** 风格值 → `data-surface` 取值（`dream-blue` 的既有 CSS 块不改名、不删除）。 */
export const PALETTE_SURFACE: Readonly<Record<PaletteValue, PaletteSurface>> = {
  rose: 'dream-rose',
  blue: 'dream-blue',
};

/**
 * 设备级样式镜像的 localStorage 键。
 *
 * 刻意与 `vl_visitor_id`（身份）分开：登出只清身份、不清它，因为它不携带身份信息，
 * 下一次 chat boot 会用访客档案里的真值把它覆盖掉。
 */
export const PALETTE_STORAGE_KEY = 'vl_palette';

/**
 * 玫瑰模式下聊天四处组件的取值（**全局唯一一份**，不按角色变体）。
 *
 * 恰好 5 个键：`myBubble` / `myText` / `theirBubble` / `theirText` / `accent`。
 * **不含 `chatBg`** —— 聊天背景与壁纸在本轮里一律不动。
 * 这 5 个 hex 只允许出现在本文件（单测会扫 `src/` 断言单一来源）。
 */
export const ROSE_CHAT_THEME: Omit<CharacterTheme, 'chatBg'> = {
  myBubble: '#e7b6bd',
  myText: '#2a1a1e',
  theirBubble: '#3a2229',
  theirText: '#fdeff2',
  accent: '#e0a1ab',
};

/**
 * 解析任意输入为风格偏好。`'rose'` / `'blue'` 之外的**一切**（大小写不同、空串、
 * 数字、布尔、对象、数组）都回落 `null`，不抛异常。
 */
export function parsePalettePreference(value: unknown): PalettePreference {
  return value === 'rose' || value === 'blue' ? value : null;
}

/**
 * 解析优先级的唯一一条链：**访客档案 > localStorage**。
 *
 * 非法档案值（如 `'pink'`、`''`）不是有效偏好，必须继续看 localStorage，
 * 不得短路（否则一个脏档案值会让本地选择整体失效）。
 */
export function resolvePalettePreference(profileValue: unknown, storageValue: unknown): PalettePreference {
  return parsePalettePreference(profileValue) ?? parsePalettePreference(storageValue);
}

/**
 * 页面表面取值：上一行的结果 ?? 该页面的默认风格。
 *
 * 入口三页与支付两页各自只调用这一个函数（不得在页面里自行判断或写 `data-surface` 字面量）。
 */
export function resolveSurface(page: PalettePage, profileValue: unknown, storageValue: unknown): PaletteSurface {
  const preference = resolvePalettePreference(profileValue, storageValue) ?? PAGE_PALETTE_DEFAULT[page];
  return PALETTE_SURFACE[preference];
}

/**
 * 聊天强调层的判定：**只有 `'rose'` 才切玫瑰**，`'blue'` 与 `null` 都是角色原生色
 * —— 这正是「未选择的用户逐像素不变」的取值层保证。
 */
export function resolveChatPalette(profileValue: unknown, storageValue: unknown): ChatPalette {
  return resolvePalettePreference(profileValue, storageValue) === 'rose' ? 'rose' : 'native';
}

/**
 * 把风格套到角色主题上。
 *
 * - `'native'`：`return theme`（**同一引用**，不是 deep-equal 的新对象）。
 * - `'rose'`：`{ ...theme, ...ROSE_CHAT_THEME }`，`chatBg` 继承角色原生值。
 *
 * 注入点唯一（聊天侧只在这里换色），四处组件与全部同源派生点因此必然同帧一致。
 */
export function applyChatPalette(theme: CharacterTheme, palette: ChatPalette): CharacterTheme {
  if (palette !== 'rose') return theme;
  return { ...theme, ...ROSE_CHAT_THEME };
}

/**
 * 入口页（开屏 / 登录）的**角色强调色**：跟随该页当前表面派生，避免「玫瑰表面上出现蓝名字」。
 *
 * 用户 2026-09-27 直接反馈：「刚进来是玫瑰色的话角色姓名这里的颜色不能出现蓝色」。
 * 入口页的角色卡片 tagline 与捏人页头像描边原先直接吃 `character.theme.accent`（8 个蓝族
 * hex，其中星寻 `#8398e8` 最接近 indigo），压在 `dream-rose` 表面上就是蓝配红。
 * **不改 `characters.ts` 的任何取值**（聊天四处与 t3 §4.6/§4.7 的期望表都逐字锁着它），
 * 只在这里**派生**。
 *
 * 三档语义（队长 2026-09-27 裁决确认）：
 *   - `'rose'`（显式选择）→ `applyChatPalette(theme, 'rose').accent` → 逐字符 `#e0a1ab`；
 *   - `'blue'`（显式选择）→ `theme.accent` 原值（逐字符不改，梦幻蓝表面上仍是身份色）；
 *   - `null` **或任何非法值** → 按该页默认（`entry` → `'rose'`）→ `#e0a1ab`。
 *
 * 为什么要第三档：从未选过风格的访客进开屏页时表面就是梦幻玫瑰，此时若回落成角色原生蓝，
 * 用户会继续看到「蓝字压玫瑰底」—— 正是本条反馈要修的默认场景，等于没修。
 *
 * 入参类型刻意写成 `unknown`（而不是 `PalettePreference`）：契约要求「非法值也按页面默认走」，
 * 而非法值只可能以未类型化的形态进来；与 `resolveSurface` 的宽容口径一致，解析仍走同一条链
 * （`parsePalettePreference`），不在这里另写一份判断。零 React、零 DOM、零 IO。
 */
export function resolveEntryAccent(theme: CharacterTheme, preference: unknown): string {
  const surface = resolveSurface('entry', preference, null);
  return surface === PALETTE_SURFACE.rose ? applyChatPalette(theme, 'rose').accent : theme.accent;
}

/** 入口页开关的持久化档位（`PaletteSwitch` 的 `persist` prop 取值）。 */
export type PalettePersistMode = 'server' | 'local';

/**
 * 两档圆点的**预览色 = 各自表面的真实强调色**（契约 t21 §4.2 判据 6）。
 *
 * 值必须**逐分量等于** `globals.css` 里 `[data-surface='dream-rose']` / `[data-surface='dream-blue']`
 * 的 `--primary`；`tests/palette-surfaces.test.ts` 解析那份真值做交叉断言 —— **任何一边被改都会红**
 * （这就是「两份事实互相证明」，不是「两份事实」）。
 *
 * 为什么不能直接用 `bg-primary`：圆点要表达的是「切过去会得到的那两个颜色」，而 `--primary` 会随
 * **当前**表面变化 —— 在 dream-blue 表面上两档都会渲染成蓝。也不得用 Tailwind 调色板类
 * （`bg-rose-400` / `bg-sky-400`）或任何写死色号（尤其玫瑰聊天 token 的 5 个 hex）。
 *
 * 这是预览色的**唯一**定义处（规格 §4.2 判据 6 二选一里的推荐形态）；因此 `globals.css` 不得
 * 再写一对 `--palette-preview-*` —— 同一测试会断言那份「第三份定义」不存在。
 */
export const PALETTE_PREVIEW_COLOR: Readonly<Record<PaletteValue, string>> = {
  rose: 'oklch(0.72 0.13 12)', // = [data-surface='dream-rose'] 的 --primary
  blue: 'oklch(0.72 0.11 238)', // = [data-surface='dream-blue'] 的 --primary
};

/**
 * 入口页开关该走哪一档持久化 —— **唯一判据：档案行是否已确认存在**。
 *
 * 判据必须与「`PATCH /api/visitor` 会不会 0 行命中」**严格等价**，不多不少：
 *   - `PATCH` 是 `.update(update).eq('id', visitorId).select(…).single()`（`src/app/api/visitor/route.ts`）。
 *     访客行存在 ⇒ 命中 1 行 ⇒ 安全；行不存在 ⇒ 命中 0 行 ⇒ `.single()` 报错 ⇒ 500。
 *   - 于是：**回包里带非空 `id` 的 visitor 行 ⇒ `'server'`**（写库，选择才真正落到访客级，
 *     不会被下次读到档案时静默覆盖）；**行不存在（`null`/`undefined`/畸形回包）⇒ `'local'`**
 *     （只写设备镜像，零请求零副作用）。
 *
 * 刻意的两处收窄（队长 2026-09-27 F1 裁决）：
 *   1. **不是**「`palette` 是否非 null」：行存在但 `palette` 为 `null` 的访客（做完开屏、还没在
 *      聊天/支付页选过风格）写库同样安全；把他们降级成设备级后，将来别处一旦产生档案级 palette，
 *      他们在入口页的选择就会被静默覆盖 —— 同一类 bug，只是触发面小一点。
 *   2. **不是**「URL 是否带 `?repick=1`」：手动粘 URL 也能带该参数，但未必有档案行。
 *
 * `GET /api/visitor`（`maybeSingle()`）对不存在的访客返回 `visitor: null`，对新访客只铸一个
 * `crypto.randomUUID()` 的 id、**不插库**（`src/lib/visitor.ts`）—— 所以「回包带非空 id」正是
 * 「行存在」的证据，两页都只需把回包的 `visitor` 原样传进来。零 React、零 DOM、零 IO。
 *
 * @param visitorPayload `GET /api/visitor` 回包里的 `visitor` 行（不存在就传 `null`/`undefined`）
 */
export function palettePersistMode(visitorPayload: unknown): PalettePersistMode {
  if (typeof visitorPayload !== 'object' || visitorPayload === null || Array.isArray(visitorPayload)) {
    return 'local';
  }
  // id 非空 ⇔ 行存在（`visitors.id` 是主键，行回包必有）。空串 / null / 缺失都按「没有行」处理，
  // 落到更安全的一档：零写入总好过一次必然 500 的 PATCH。
  const id = (visitorPayload as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? 'server' : 'local';
}

/* ==================== 风格 × 色调明暗 → 表面（第五轮落地；第六轮 N1/N2 收口） ==================== */

/**
 * 风格 × 色调明暗 → `data-surface` 的取值域（四个 id）。
 *
 * 第五轮它是「三态档位」（off / dark / soft）的产物，第六轮收敛成 `ToneMode`（规格 §4.9）：
 * 档位不再由任何控件决定，而是**跟着当前 UI 色调的明暗走**（`*-night` = `'dark'`、
 * `*-milk` = `'light'`）。三态那套（档位类型 / 存储键 / 解析函数 / 控件）已按用户指令整体删除。
 */
export type PaletteChromeSurface = 'dream-rose' | 'dream-blue' | 'dream-rose-soft' | 'dream-blue-soft';

/**
 * 风格 × 色调明暗 → `data-surface` 取值（规格 §4.9 冻结接口；第六轮 N2）。
 *
 * `toneMode`：来自 `resolveToneMode(uiTheme.id)`（唯一来源 `chat-layout.ts`）。
 * `'light'` → 浅色表面 `*-soft`；`'dark'`（缺省）→ 两块深色表面。
 *
 * `resolved` 刻意收成 `unknown` 而不是 `PaletteValue`：调用点会传 `'rose' | 'blue' | 'native' | null`
 * —— **`'native'` 是聊天页的合法态**（未选风格时 `resolveChatPalette` 返回它），窄化成
 * `PaletteValue` 会让调用点被迫加类型断言。判定与 `resolvePaletteToggle` 同口径：
 * **只有 `'rose'` 走玫瑰侧**，其余一切（`'blue'` / `'native'` / `null` / 脏值）都走蓝色侧。
 *
 * **`resolved === null`（从没选过风格）不在这里处理**：调用点必须先判 `null` 再决定挂不挂属性
 * （规格 §4.9 判据 2：不挂、界面不变）。本函数对 `null` 仍返回蓝家族，纯函数口径不变。
 *
 * 第二参是 `ToneMode`，且只做 **type-only 引用**（运行时不成环）：palette.ts → chat-layout.ts
 * 只有类型，chat-layout.ts 反向不 import 本文件。
 *
 * 朗读付费卡片（§4.3.5）与三区自动配对（§4.9）共用这一份定义，**不得**出现第二份。
 */
export function paletteSurfaceFor(resolved: unknown, toneMode: ToneMode = 'dark'): PaletteChromeSurface {
  const side = resolved === 'rose' ? 'rose' : 'blue';
  return toneMode === 'light' ? `dream-${side}-soft` : `dream-${side}`;
}
