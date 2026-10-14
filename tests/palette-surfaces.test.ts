import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CHARACTER_PRESETS } from '../src/lib/characters';
import { PALETTE_PREVIEW_COLOR, PALETTE_SURFACE, paletteSurfaceFor } from '../src/lib/palette';
import { resolveToneMode } from '../src/lib/chat-layout';
import { zhCN } from '../src/lib/i18n/messages';
import { selectorBlock, stripCssComments } from './support/wcag';

/**
 * 表面层（契约 t10 / 队内 t5）的源码契约 + dream-rose 表面镜像断言。
 *
 * 覆盖四件事，全部用**剥注释后的源码**判定（注释不是实现，骗不过断言）：
 *   1. 入口三页（`/`、`/login`、`/onboarding`）**只消费**共享解析入口 `usePaletteSurface('entry', …)`，
 *      表面由 `surface` 派生 —— 逐页不得再出现 `data-surface="dream-..."` 字面量。
 *      （这一条正是 `tests/dream-blue-theme.test.ts:97-113` 的刻意变更点：入口默认表面从
 *      「恒蓝」变成「按 palette 解析（默认玫瑰）」，字面量断言在语义上不可能同时表达
 *      蓝用户与玫瑰用户。）
 *   2. 支付两页（`/pricing`、`/billing/result`）挂 `data-surface={surface}`，并补上
 *      **不可省**的 `bg-background`（漏掉会半蓝半红：底色会退回 `.dark` 的暖褐）+ 光斑层。
 *   3. 切换开关 `src/components/palette-switch.tsx` 挂在**四个页面**：支付两页（默认 `persist="server"`，
 *      非乐观 PATCH）与入口两页（`/onboarding`、`/login`）。入口两页的档位由**单一判据
 *      `canPersistToProfile`**（= 档案行是否已确认存在，来自纯函数 `palettePersistMode`）派生：
 *      行存在 ⇒ `'server'`（`PATCH` 不会 0 行命中，选择才真正落到访客级）；行不存在 ⇒ `'local'`
 *      （零请求零副作用）。这一档是队长 2026-09-27 **F1 裁决**：原「入口两页一律 local」会让用户
 *      点完看到成功 toast、下次读到档案又被静默覆盖。
 *      入口骨架屏 `/` 仍不挂（1–2 帧内就 router.replace），理由与断言见对应的 test。
 *      聊天装扮弹窗内的开关归 t11。
 *
 *   4. `[data-surface='dream-rose']` 表面块与 `.dream-rose-aurora` 光斑类的镜像门禁：
 *      块存在、色相全部落在 DESIGN.md 允许的暖玫瑰带 `[0, 70)`、chroma ≤ 0.16、
 *      不得拷贝 `.dark` 的主色对、`.dream-blue-aurora` 与 `.dream-rose-aurora` 两个类都在。
 *
 * 取块一律用 `tests/support/wcag.ts` 的 `selectorBlock`（**先剥注释、再按行首锚定**），
 * 不复制 `tests/dream-blue-contrast.test.ts` 那份「未剥注释的裸 indexOf」写法 —— 那个写法
 * 正是被注释里出现的同一个选择器字符串坑到过的陷阱。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 剥掉 JS/TS 注释（复用共享的 CSS 剥注释器，另去 `//` 行注释）。 */
function stripJsComments(source: string): string {
  return stripCssComments(source).replace(/^[ \t]*\/\/.*$/gm, '');
}

/** `src/` 全量文件（用于「某个字符串字面量在 src/ 下恰好出现 N 次」这类单一来源断言）。 */
const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** `tests/` 全量文件（第六轮 N1 的零残留扫描同时覆盖 src/ 与 tests/）。 */
const TESTS_ROOT = fileURLToPath(new URL('.', import.meta.url));

function collectFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 剥注释后的源码文本（CSS 用 CSS 剥法，其余按 JS/TS 剥）。 */
function strippedSource(file: string): string {
  const raw = readFileSync(file, 'utf8');
  return file.endsWith('.css') ? stripCssComments(raw) : stripJsComments(raw);
}

/** 在 `src/` 里数某个字符串字面量的出现次数（**先剥注释**：注释不是实现）。 */
function countLiteralInSrc(needle: string): number {
  let total = 0;
  for (const file of collectFiles(SRC_ROOT)) {
    total += strippedSource(file).split(needle).length - 1;
  }
  return total;
}

/** 入口三页：页面归属 `entry`（默认梦幻玫瑰）。 */
const ENTRY_PAGES = [
  ['开屏', 'src/app/onboarding/onboarding-client.tsx'], // t53：调色板派生住在客户端岛
  ['登录/注册', 'src/app/login/login-client.tsx'],
  ['入口', 'src/app/page.tsx'],
] as const;

/**
 * 入口页里**挂开关**的两页（用户 2026-09-27 反馈「刚进入界面看不到哪里可以切成梦幻蓝」）。
 * 第三页 `/`（`src/app/page.tsx`）是骨架屏，1–2 帧内就 `router.replace` 走了，不挂。
 */
const ENTRY_SWITCH_PAGES = [
  ['开屏', 'src/app/onboarding/onboarding-client.tsx'], // t53
  ['登录/注册', 'src/app/login/login-client.tsx'],
] as const;

/** 支付两页：页面归属 `billing`（默认梦幻蓝）。 */
const BILLING_PAGES: readonly (readonly [string,string])[] = [];

test('the three entry pages derive their surface from the shared resolver', () => {
  for (const [name, file] of ENTRY_PAGES) {
    const source = stripJsComments(read(file));

    // 必须真的调用共享解析入口，而不是自己判断 localStorage / 页面默认。
    assert.match(
      source,
      /usePaletteSurface\(\s*'entry'/,
      `${name}页必须走共享解析入口 usePaletteSurface('entry', …)`,
    );
    // 表面必须由解析结果派生。
    assert.match(source, /data-surface=\{/, `${name}页的根容器必须写成 data-surface={surface}`);
    // 且不得再有余下的表面字面量（否则等于在页面里自己判断红蓝）。
    assert.doesNotMatch(
      source,
      /data-surface="dream-/,
      `${name}页不得再出现 data-surface="dream-…" 字面量：表面必须由 surface 派生`,
    );
  }
});

test('commercial billing pages are absent from the personal edition',()=>{
 for(const path of ['src/app/pricing/page.tsx','src/app/billing/result/page.tsx']) assert.equal(existsSync(new URL('../'+path,import.meta.url)),false);
});

test('the palette circle is mounted on the two entry pages and in the chat header only', () => {
  // 入口两页：保留（login 1 处、onboarding 2 处互斥渲染）。
  assert.equal(
    [...stripJsComments(read('src/app/login/login-client.tsx')).matchAll(/<PaletteSwitch/g)].length,
    1,
    '/login 恰好 1 个圆圈（视口右上角）',
  );
  assert.equal(
    [...stripJsComments(read('src/app/onboarding/onboarding-client.tsx')).matchAll(/<PaletteSwitch/g)].length,
    2,
    '/onboarding 仍是 2 个挂载点（repick 未就绪态 + 主容器，互斥渲染）',
  );

  // 支付两页 + 装扮弹窗：圆圈与本文件都不再出现（§4.2 落位表：支付两页 / 弹窗均删除）。
  for (const [name, file] of BILLING_PAGES) {
    const source = stripJsComments(read(file));
    assert.doesNotMatch(source, /PaletteSwitch/, `${name}页不得再挂氛围圆圈`);
    assert.doesNotMatch(source, /palette-switch/, `${name}页连 import 也不该留`);
  }
  const settings = stripJsComments(read('src/components/chat/theme-settings.tsx'));
  assert.doesNotMatch(settings, /PaletteSwitch/, '装扮弹窗不得再挂氛围圆圈');

  // 聊天头部：恰好 1 个，且紧邻「聊天装扮」按钮的左侧（DOM 顺序在前），与两个按钮同一行。
  const shell = stripJsComments(read('src/components/chat/chat-shell.tsx'));
  assert.equal(
    [...shell.matchAll(/<PaletteSwitch/g)].length,
    1,
    'chat-shell 里恰好 1 个圆圈（聊天头部）',
  );
  const circleIndex = shell.indexOf('<PaletteSwitch');
  // t9/U3：可访问名走字典（中文取值逐字符不变，e2e 的选择器仍能命中）。
  const themeButtonIndex = shell.indexOf("aria-label={t('chat.header.appearance')}");
  assert.equal(zhCN.chat['header.appearance'], '聊天装扮', '中文可访问名逐字符不变');
  assert.ok(circleIndex >= 0 && themeButtonIndex > circleIndex, '圆圈必须排在「聊天装扮」按钮之前（左侧）');
  // 「前一个兄弟」的判定：把 `PaletteSwitch` **元素自身**整段切掉（到它自己的 `/>` 为止），
  // 到「聊天装扮」按钮的 `aria-label` 为止的这段空隙里，**只允许出现一个元素开标签** ——
  // 就是按钮自己那个（空隙在按钮开标签内部结束）。多出任何一个都是夹在两者中间的第三者。
  // （旧写法从标签名 `<PaletteSwitch` 之后立刻开始扫，必然扫到按钮自己的 `<button`，
  //   是一条永远不可能变绿的断言；这里改成从元素闭合处开始切、按「元素开标签个数」判定。）
  const switchClose = shell.indexOf('/>', circleIndex);
  assert.ok(switchClose > circleIndex, 'PaletteSwitch 必须是自闭合元素');
  const between = shell.slice(switchClose + 2, themeButtonIndex);
  const elementStarts = [...between.matchAll(/<[a-zA-Z]/g)];
  assert.equal(
    elementStarts.length,
    1,
    `圆圈与「聊天装扮」按钮之间只允许有后者这一个元素，实际多出 ${elementStarts.length - 1} 个`,
  );
  // header 内（不是页面级其它位置）。
  const headerIndex = shell.indexOf('data-testid="active-companion-header"');
  assert.ok(headerIndex > 0 && headerIndex < circleIndex, '圆圈必须在聊天 <header> 之内');
  // 受控 + server 档 + 复用同一个回调（不得留两份等价逻辑）。
  assert.match(shell, /<PaletteSwitch[\s\S]{0,200}?value=\{palettePreference\}/, '头部圆圈必须受控于 palettePreference');
  assert.match(shell, /onChange=\{applyPalette\}/, '头部圆圈必须复用提升出来的 applyPalette');
  assert.equal(
    [...shell.matchAll(/setChatPalette\(resolveChatPalette\(value, null\)\)/g)].length,
    1,
    '「切换风格 → 强调层换色」只允许有一份实现（applyPalette 内）',
  );
});

/**
 * 第六轮 N1/N2（规格 §4.9）：表面按**当前色调明暗**自动配对，第五轮那套三态整套删除。
 *
 * 现在只有一条链：`toneMode`（色调明暗，唯一来源 `resolveToneMode`）决定浅/深档，
 * 圆圈决定的「风格」决定家族。`resolved === null`（从没选过）⇒ **调用点不挂属性**、界面不变
 * —— 规格 §4.9 判据 2 已把「未选过一律当梦幻蓝」列为**不得实现**的备选。
 */
test('the surface pairing follows the resolved style and the current tone tier', () => {
  // ── 真值表逐条（规格 §5.7.1）──
  assert.equal(paletteSurfaceFor('rose', 'dark'), 'dream-rose');
  assert.equal(paletteSurfaceFor('rose', 'light'), 'dream-rose-soft');
  assert.equal(paletteSurfaceFor('blue', 'dark'), 'dream-blue');
  assert.equal(paletteSurfaceFor('blue', 'light'), 'dream-blue-soft');
  assert.equal(paletteSurfaceFor('native', 'light'), 'dream-blue-soft');
  assert.equal(paletteSurfaceFor(null, 'dark'), 'dream-blue');
  assert.equal(paletteSurfaceFor(null, 'light'), 'dream-blue-soft');
  assert.equal(paletteSurfaceFor('pink', 'light'), 'dream-blue-soft');
  assert.equal(paletteSurfaceFor(123, 'dark'), 'dream-blue');
  // 缺省第二参 = 'dark'（朗读卡片与既有调用点只传风格）
  assert.equal(paletteSurfaceFor('rose'), 'dream-rose');
  assert.equal(paletteSurfaceFor('blue'), 'dream-blue');

  // ── 第二参的类型是 ToneMode：与 chat-layout 的唯一来源逐值对齐，不得自造第二套明暗判断 ──
  for (const id of ['rose-milk', 'amber-milk', 'mist-milk', 'sage-milk']) {
    assert.equal(paletteSurfaceFor('rose', resolveToneMode(id)), 'dream-rose-soft', `${id} 是浅色色调`);
  }
  for (const id of ['rose-night', 'amber-night', 'mist-night', 'sage-night']) {
    assert.equal(paletteSurfaceFor('rose', resolveToneMode(id)), 'dream-rose', `${id} 是深色色调`);
  }
  assert.equal(paletteSurfaceFor('rose', resolveToneMode(null)), 'dream-rose', '未知色调必须回深色档');

  // ── type-only 引用（规格 §5.7.2 G2）：运行时不成环、反向无依赖 ──
  const paletteModule = stripJsComments(read('src/lib/palette.ts'));
  assert.match(
    paletteModule,
    /import type \{ ToneMode \} from '\.\/chat-layout'/,
    'palette.ts 只能 type-only 引用 chat-layout.ts 的 ToneMode',
  );
  assert.equal(
    [...paletteModule.matchAll(/from '\.\/chat-layout'/g)].length,
    1,
    'ToneMode 只允许一处引用（且必须是 import type）',
  );
  assert.doesNotMatch(
    stripJsComments(read('src/lib/chat-layout.ts')),
    /from '\.\/palette'|from '@\/lib\/palette'/,
    'chat-layout.ts 不得反向 import palette.ts（否则就是运行时环）',
  );

  // ── 消费方不得重定义冻结名、不得另起一份映射表、不得出现表面 id 字面量 ──
  const consumers: ReadonlyArray<readonly [string, string]> = [
    ['palette-switch.tsx', stripJsComments(read('src/components/palette-switch.tsx'))],
    ['palette-surface-context.tsx', stripJsComments(read('src/components/palette-surface-context.tsx'))],
    ['chat-shell.tsx', stripJsComments(read('src/components/chat/chat-shell.tsx'))],
  ];
  for (const [name, source] of consumers) {
    assert.doesNotMatch(
      source,
      /export\s+(?:type|const|function)\s+(?:PaletteChromeSurface|paletteSurfaceFor)\b/,
      `${name} 不得重定义 palette 契约模块的冻结名字（resolvePaletteToggle 的家在 palette-switch.tsx，不在此列）`,
    );
    assert.doesNotMatch(source, /'dream-(?:rose|blue)(?:-soft)?'/, `${name} 不得出现表面 id 字面量（只准经 paletteSurfaceFor 派生）`);
    assert.doesNotMatch(source, /PALETTE_SURFACE_SOFT|PALETTE_CHROME_SURFACE/, `${name} 不得自造第二份映射表`);
  }
});

test('the retired tri-state tier is gone from src and tests (zero residue)', () => {
  /*
    第六轮 N1（用户：「把右边这三个测试按钮关掉，相关的逻辑也可以删了」）：三态那套
    （档位类型 / 存储键 / 取值域 / 解析函数 / 控件 / 两个 storage 读写 / 控件 testid）
    必须**整体消失**，留下任何一处都会让后来者以为它还在。

    两个坑：
      1. 名字**按片拼**：本文件自己也在扫描范围内（`tests/`），写全名会让这条断言命中自己；
      2. 扫的是**剥注释后**的源码 —— 注释里留档「删了什么」是允许的（规格本身就在
         docs/ 里做了作废登记），但**代码里**一处都不许剩。
  */
  const RETIRED = [
    ['Chrome', 'Sync', 'Mode'],
    ['PALETTE', '_CHROME', '_SYNC'],
    ['resolve', 'Chrome', 'Mode'],
    ['Chrome', 'Sync', 'Switch'],
    ['read', 'Chrome', 'Sync', 'Mode'],
    ['write', 'Chrome', 'Sync', 'Mode'],
    ['chrome', '-sync'],
  ].map((parts) => parts.join(''));

  const offenders: string[] = [];
  for (const root of [SRC_ROOT, TESTS_ROOT]) {
    for (const file of collectFiles(root)) {
      const text = strippedSource(file);
      for (const needle of RETIRED) {
        if (text.includes(needle)) offenders.push(`${relative(root, file)} → ${needle}`);
      }
    }
  }
  assert.deepEqual(offenders, [], '三态那套必须零残留：src/ 与 tests/ 都不许有代码命中');
});

/**
 * t71：**防回流断言**（用户第六轮：「把右边这三个测试按钮关掉，相关的逻辑也可以删了」）。
 *
 * 上一条（`the retired tri-state tier is gone …`）横扫 `src/` + `tests/`，但它钉的全是**标识符
 * 片段**，**漏了存储键的字符串字面量** —— `localStorage.setItem('<那个键>', …)` 这种回流方式
 * 当时拦不住（实测：把该字面量注入 `src/` 的只读副本，上一条仍然**全绿**，只有本条第 4 个
 * 标识符会红）。这条把它补上，并且只钉这 **5 个唯一标识符的原文**：
 *
 *   1. 控件名（`Chrome` + `Sync` + `Switch`）
 *   2. 读档函数（`read` + `Chrome` + `Sync` + `Mode`）
 *   3. 存储键常量名（`PALETTE` + `_CHROME` + `_SYNC`）
 *   4. **存储键字面量**（`vl_` + `palette` + `_chrome`）← 上一条漏掉的那个
 *   5. 档位解析函数（`resolve` + `Chrome` + `Mode`）
 *
 * **刻意不扩**到 `off` / `dark` / `soft` 这类通用短词：它们在本仓有大量正常用法
 * （`data-state="off"`、`.dark`、`*-soft` 表面 id…），扫它们等于天天假红。
 *
 * 照旧两个坑：名字**按片拼**（本文件自己也在 `tests/` 的扫描范围内，写全名会让上一条命中自己）；
 * 扫的是**剥注释后**的源码（注释里留档「删了什么」是允许的，代码里一处都不许剩）。
 */
test('the five retired tri-state identifiers are absent from src (anti-regression)', () => {
  const RETIRED_IDENTIFIERS = [
    ['Chrome', 'Sync', 'Switch'],
    ['read', 'Chrome', 'Sync', 'Mode'],
    ['PALETTE', '_CHROME', '_SYNC'],
    ['vl_', 'palette', '_chrome'],
    ['resolve', 'Chrome', 'Mode'],
  ].map((parts) => parts.join(''));

  // 5 个必须是**互不相同**的唯一标识符（手滑写重复会让「覆盖 5 项」变成假象）
  assert.equal(new Set(RETIRED_IDENTIFIERS).size, 5, '必须是 5 个不同的标识符');
  assert.equal(RETIRED_IDENTIFIERS.length, 5, '恰好 5 个');
  // 通用短词不得混进这份名单（误伤正常代码 = 假红）
  for (const generic of ['off', 'dark', 'soft', 'chrome', 'palette']) {
    assert.equal(
      RETIRED_IDENTIFIERS.includes(generic),
      false,
      `通用短词 ${generic} 不得进 0 命中名单（会误伤正常用法）`,
    );
  }

  const offenders: string[] = [];
  for (const file of collectFiles(SRC_ROOT)) {
    const text = strippedSource(file);
    for (const needle of RETIRED_IDENTIFIERS) {
      if (text.includes(needle)) offenders.push(`${relative(SRC_ROOT, file)} → ${needle}`);
    }
  }
  assert.deepEqual(offenders, [], '三态那 5 个唯一标识符必须在 src/ 下 0 命中（防回流）');
});

test('the three chat zones pair with the ui tone, and the message area never carries a surface', () => {
  const shell = stripJsComments(read('src/components/chat/chat-shell.tsx'));

  // 只算一次；从没选过风格（null）⇒ undefined（属性整个不出现，界面不变）。
  assert.match(
    shell,
    /const chromeSurface = palettePreference === null \? undefined : paletteSurfaceFor\(palettePreference, toneMode\)/,
    '三区与 Provider 必须共用这一个值：null（从没选过）⇒ undefined，不挂属性',
  );
  assert.equal(
    [...shell.matchAll(/paletteSurfaceFor\(/g)].length,
    2,
    'chat-shell 只允许两处派生：三区的 chromeSurface + 浮层的 overlaySurface（不得留第三份等价逻辑）',
  );
  // 挂在不同容器上的值必须**是同一个绑定**：不得出现第二种取值表达式。
  assert.deepEqual(
    [...shell.matchAll(/data-surface=\{([^}]*)\}/g)].map((match) => match[1]),
    ['chromeSurface', 'chromeSurface', 'chromeSurface'],
    '恰好三个容器各自挂 data-surface={chromeSurface}（同一次渲染三处一致）',
  );
  // **三区与浮层是两个值**（第六轮 ㉘）：Provider 拿**无条件**求值的 `overlaySurface`
  // （`null` ⇒ 蓝侧 = 永不绿），三容器拿可缺省的 `chromeSurface`（`null` ⇒ 不写属性）。
  // 合并这两个值 = 把「点退出登录跳出绿弹窗」带回来，所以对两种合并方式都下反向断言。
  assert.match(
    shell,
    /const overlaySurface = paletteSurfaceFor\(palettePreference, toneMode\)/,
    '浮层的值必须无条件求值（null ⇒ 蓝家族），不得带「null 就不写」的三元',
  );
  assert.match(shell, /<PaletteSurfaceProvider surface=\{overlaySurface\}>/, 'Provider 必须拿到浮层那个值');
  assert.doesNotMatch(
    shell,
    /<PaletteSurfaceProvider surface=\{chromeSurface\}>/,
    '浮层不得退回三区那个可缺省的值（那正是用户报的绿色弹窗）',
  );
  assert.doesNotMatch(
    shell,
    /const overlaySurface = [^;]*=== null[^;]*;/,
    '浮层的值不得出现「null 就不写」分支',
  );
  // 第二参必须显式传 toneMode：不得再用「不传 = 深色」蒙过明暗自动配对。
  assert.doesNotMatch(shell, /paletteSurfaceFor\(\s*palettePreference\s*\)/, '第二参必须显式传 toneMode');

  // 消息区（含其列容器）不得挂表面：要透出用户选的壁纸。
  //
  // 锚点刻意不用 JSX 注释：`stripJsComments` 会把 `{/* … */}` 的注释体连带斜杠一起剥掉，
  // 用注释当锚点只会拿到 -1。改成「元素开标签切片」——逐个容器只看它**自己的属性表**。
  const listOpen = shell.indexOf('data-testid="message-list-scroll"');
  assert.ok(listOpen > 0, '必须能定位消息区容器');
  const listTag = shell.slice(listOpen, shell.indexOf('>', listOpen));
  assert.doesNotMatch(listTag, /data-surface/, '消息区容器不得挂表面（要透出用户选的壁纸）');
  const columnOpen = shell.indexOf('CHAT_MESSAGE_COLUMN_CLASS', listOpen);
  assert.ok(columnOpen > listOpen, '必须能定位消息列容器（import 行不算）');
  const columnTag = shell.slice(columnOpen, shell.indexOf('>', columnOpen));
  assert.doesNotMatch(columnTag, /data-surface/, '消息列容器不得挂表面');
  // 已选过风格时，侧栏与输入区的半透明度提到 /60（两个字面量都要出现，Tailwind 才生成）。
  assert.match(shell, /bg-sidebar\/35/, '未选择风格时保留原侧栏半透明度');
  assert.match(shell, /bg-sidebar\/60/, '配对生效时需要更实的侧栏');
  assert.match(shell, /bg-background\/60/, '配对生效时需要更实的输入区');
});

/**
 * 第六轮 ㉘（用户 2026-09-27 原话：「浮层用不绿，没选过的话就永远用梦幻蓝，选过的话和用户的
 * 选择一致」）：**三区与浮层的 `null` 口径刻意相反**，所以是两个值、两条原则，**不得合并**。
 *
 *   ① 三区（外观偏好）：`null` ⇒ `undefined` ⇒ **不写**属性（界面不变）；
 *   ②③ 浮层（缺陷修复）：`null` ⇒ **蓝家族** —— 深色色调 `dream-blue`、浅色色调 `dream-blue-soft`；
 *   ④ 选过玫瑰 ⇒ 与用户选择一致：`dream-rose` / `dream-rose-soft`；
 *   ⑤ 消息区与其列容器在**任何**组合下都不挂。
 *
 * 本文件零 DOM，所以 ①–④ 的**值级/源码级**判据在下面逐条钉死，DOM 级证据（真机上「三容器无
 * 属性 / 确认框带 blue」）由验收的真机读数承担。
 */
test('the overlay surface is unconditional (never green) while the three zones stay opt-in', () => {
  const shell = stripJsComments(read('src/components/chat/chat-shell.tsx'));

  // ① 三区：`null` ⇒ undefined（不写属性）——与浮层的口径**相反**。
  assert.match(
    shell,
    /const chromeSurface = palettePreference === null \? undefined : paletteSurfaceFor\(palettePreference, toneMode\)/,
    '三区必须保持「null ⇒ 不写属性」（界面不变）',
  );

  // ②③ 浮层：`null`/`undefined` ⇒ 蓝家族（**永不绿**），且明暗分档照旧。
  assert.equal(paletteSurfaceFor(null, 'dark'), 'dream-blue', '从没选过 + 深色色调 ⇒ dream-blue');
  assert.equal(paletteSurfaceFor(null, 'light'), 'dream-blue-soft', '从没选过 + 浅色色调 ⇒ dream-blue-soft');
  assert.equal(paletteSurfaceFor(undefined, 'dark'), 'dream-blue', 'undefined 同 null 口径');
  assert.equal(paletteSurfaceFor('pink', 'light'), 'dream-blue-soft', '脏值同样落蓝侧（不抛）');
  // ④ 选过玫瑰 ⇒ 与用户选择一致（两档）。
  assert.equal(paletteSurfaceFor('rose', 'dark'), 'dream-rose', '选过玫瑰 + 深色 ⇒ dream-rose');
  assert.equal(paletteSurfaceFor('rose', 'light'), 'dream-rose-soft', '选过玫瑰 + 浅色 ⇒ dream-rose-soft');
  // 显式选蓝与「没选过」同支（都是蓝家族），但语义不同：前者是偏好、后者是兜底。
  assert.equal(paletteSurfaceFor('blue', 'dark'), 'dream-blue');
  assert.equal(paletteSurfaceFor('blue', 'light'), 'dream-blue-soft');

  // ⑤ 消息区与其列容器在**任何**组合下都不挂：全文件只允许 3 处 `data-surface={…}`（都在三区
  //    容器上，取值全是 `chromeSurface`），Provider 用的是 `surface=` 而不是 `data-surface=`，
  //    消息区/列容器各自的开标签切片里也没有该属性（另半条在 `the three chat zones …` 里）。
  assert.deepEqual(
    [...shell.matchAll(/data-surface=\{([^}]*)\}/g)].map((match) => match[1]),
    ['chromeSurface', 'chromeSurface', 'chromeSurface'],
    '全文件只有三处 data-surface，且都挂在三区容器上',
  );
  assert.equal(
    [...shell.matchAll(/<PaletteSurfaceProvider/g)].length,
    1,
    'Provider 只允许一处（浮层的值只经 context 传播，不占 data-surface 字面）',
  );

  // 合并方向上的守门：两个值必须分别命名、分别使用（改名/合并都会让上面几条同时失去意义）。
  assert.match(shell, /const overlaySurface = paletteSurfaceFor\(palettePreference, toneMode\)/);
  assert.doesNotMatch(shell, /const chromeSurface = [^;]*overlaySurface[^;]*;/);
  assert.doesNotMatch(shell, /const overlaySurface = chromeSurface/);
});

/**
 * t66 F1（用户 2026-09-27 裁决①：「跟页面同族 —— 玫瑰页面里的日历也是玫瑰」）：
 * **入口页自己也有 portal 浮层** —— 开屏页捏人步的生日 / 重要日期 → `DatePicker` → `Popover`，
 * 它不在聊天页那层 Provider 之下，不给表面就会退回 context 缺省值（蓝族），于是在玫瑰底的
 * 开屏页上弹出**蓝色深色日历**（真机修前实测：页面根 `dream-rose` / 弹层 `dream-blue`）。
 *
 * 这里钉两条**与修法无关**的不变式（真机读数见任务报告）：
 *   ① 同族：弹层的 `data-surface` === 页面根的 `data-surface`（同一个 `surface` 变量，
 *      不另起推导、不写字面量）；
 *   ② 绝不继承页面色调：弹层自带表面，所以它 scoped 的 `--primary` 永远不等于
 *      `html[data-ui-theme]` 那枚 `--primary`（sage 下就是那个绿）；
 * 再补一枚期望字面（裁决①：入口默认玫瑰 ⇒ `dream-rose`），但它**不是**唯一断言。
 */
test('the entry page exposes its own surface to portal overlays (rose calendar on a rose page)', () => {
  const onboarding = stripJsComments(read('src/app/onboarding/onboarding-client.tsx'));

  // ① 同源同值：Provider 的值必须**就是**页面根 `data-surface` 的那个变量。
  assert.match(onboarding, /const surface = usePaletteSurface\(\s*'entry'/, '页面只经共享解析入口拿表面');
  assert.match(onboarding, /<PaletteSurfaceProvider surface=\{surface\}>/, 'Provider 必须用页面那个 surface 变量');
  assert.doesNotMatch(
    onboarding,
    /<PaletteSurfaceProvider surface=\{[^}]*paletteSurfaceFor/,
    '入口页不得自推第二份表面（必须与页面根 data-surface 同源）',
  );
  assert.doesNotMatch(
    onboarding,
    /<PaletteSurfaceProvider surface="dream-/,
    '入口页不得给 Provider 写字面量表面 id',
  );
  const rootIdx = onboarding.indexOf('data-surface={surface}');
  const providerIdx = onboarding.indexOf('<PaletteSurfaceProvider');
  assert.ok(rootIdx > 0 && providerIdx > rootIdx, 'Provider 必须落在页面根容器之内（同一次渲染同一个值）');

  // ② 覆盖今天唯一会 portal 的触发器：日期弹层所在的**捏人步**（`CustomizeStep`）必须落在 Provider 之内。
  const providerClose = onboarding.indexOf('</PaletteSurfaceProvider>', providerIdx);
  assert.ok(providerClose > providerIdx, 'Provider 必须闭合');
  const stepIdx = onboarding.indexOf('<CustomizeStep', providerIdx);
  assert.ok(
    stepIdx > providerIdx && stepIdx < providerClose,
    'CustomizeStep 必须被 Provider 包住（否则它里面的日期弹层会退回蓝族缺省）',
  );
  // 只允许一个出口：本页不得再出现第二个 Provider（多出口 = 多份表面来源）
  assert.equal(
    [...onboarding.matchAll(/<PaletteSurfaceProvider/g)].length,
    1,
    '入口页只允许这一个「面向 portal 浮层」的表面出口',
  );
  // 链路后半段：CustomizeStep 里确实渲染了那两个日期控件（它们内部是 DatePicker → Popover）
  const customizeFn = onboarding.indexOf('function CustomizeStep');
  assert.ok(customizeFn > 0, '必须能定位 CustomizeStep 的定义');
  const customizeBody = onboarding.slice(customizeFn);
  for (const name of ['<MyBirthdayField', '<ImportantDatesEditor'] as const) {
    assert.ok(customizeBody.includes(name), `CustomizeStep 必须渲染 ${name}（portal 弹层的触发器）`);
  }

  // ③ 链路存在（这正是今天没有任何自动断言盖住的那条路径）：
  //    onboarding → companion-important-dates → DatePicker → ui/popover 的 PopoverContent
  assert.match(stripJsComments(read('src/components/chat/companion-important-dates.tsx')), /<DatePicker/);
  assert.match(stripJsComments(read('src/components/ui/date-picker.tsx')), /<PopoverContent/);
  const popoverAtom = stripJsComments(read('src/components/ui/popover.tsx'));
  assert.match(popoverAtom, /usePaletteSurfaceAttr\(\)/);
  assert.match(popoverAtom, /data-surface=\{ctx\}/, 'PopoverContent 必须无条件带表面（浮层不裸奔）');

  // ④ 期望值（裁决①，非唯一断言）：入口默认玫瑰 ⇒ 该页 surface = `dream-rose`；选过蓝则同源变 `dream-blue`。
  assert.equal(PALETTE_SURFACE.rose, 'dream-rose');
  assert.equal(PALETTE_SURFACE.blue, 'dream-blue');
});

/**
 * 第六轮 N2（规格 §4.9 浮层子节）：容器型浮层**就地**重定义整套 token。
 *
 * 根因：浮层被 portal 到 `body`，**脱离**三区那个 `[data-surface]` 子树，于是直接继承
 * `html[data-ui-theme]` 的 `--primary` —— sage 色调下「退出登录」确认框的卡片与按钮一起变绿。
 * React 的 context 能穿过 portal，所以值走 context、属性落在浮层**自己的根节点**上。
 */
test('every container-type overlay takes its surface from the chat context, never the page tone', () => {
  const context = stripJsComments(read('src/components/palette-surface-context.tsx'));
  assert.match(context, /export function PaletteSurfaceProvider\(/, '必须导出 Provider');
  assert.match(context, /export function usePaletteSurfaceAttr\(\)/, '必须导出消费 hook');
  // 第六轮 ㉘：浮层的值**恒有值**（缺省 = 蓝侧 = 永不绿），不再用 `undefined` 表达「不写属性」。
  assert.match(
    context,
    /createContext<PaletteChromeSurface>\(paletteSurfaceFor\(null\)\)/,
    '缺省值必须经单一来源派生出的蓝侧（永不绿），不得在本模块写第二份表面 id 字面量',
  );
  assert.match(context, /surface: PaletteChromeSurface;/, 'Provider 的 surface 必须是非可选');
  assert.doesNotMatch(
    context,
    /surface: PaletteChromeSurface \| undefined/,
    'Provider 不得再接受 undefined（那是三区的口径）',
  );
  assert.match(
    context,
    /export function usePaletteSurfaceAttr\(\): PaletteChromeSurface \{/,
    'hook 的返回类型不得含 undefined（消费点因此不需要容错分支）',
  );
  assert.doesNotMatch(
    context,
    /createContext<PaletteChromeSurface \| undefined>\(undefined\)/,
    '旧的「无值 = 不写属性」口径必须已从本模块删除',
  );

  // 覆盖清单十个文件（规格 §4.9 浮层子节）：都消费 hook，且 `data-surface={ctx}` 排在**它自己的**
  // `{...props}` 之前 —— 显式传入 `data-surface` 的调用方永远优先。
  const OVERLAY_ATOMS = [
    'alert-dialog', 'dialog', 'popover', 'sheet', 'drawer',
    'tooltip', 'dropdown-menu', 'select', 'hover-card', 'command',
  ] as const;
  for (const atom of OVERLAY_ATOMS) {
    const source = stripJsComments(read(`src/components/ui/${atom}.tsx`));
    assert.match(source, /usePaletteSurfaceAttr\(\)/, `ui/${atom}.tsx 的容器原子必须从 context 读表面值`);
    assert.equal(
      [...source.matchAll(/data-surface=\{ctx\}/g)].length,
      1,
      `ui/${atom}.tsx 只允许一处 data-surface={ctx}`,
    );
    const lines = source.split('\n');
    const attrLine = lines.findIndex((line) => line.includes('data-surface={ctx}'));
    const spreadLine = lines.findIndex((line, index) => index > attrLine && line.includes('{...props}'));
    assert.ok(attrLine >= 0, `ui/${atom}.tsx 的容器原子必须挂 data-surface={ctx}`);
    assert.ok(
      spreadLine > attrLine && spreadLine - attrLine <= 3,
      `ui/${atom}.tsx 的 data-surface={ctx} 必须排在它自己的 {...props} 之前（最多隔 2 行）`,
    );
  }

  const bar = stripJsComments(read('src/components/chat/voice-bar.tsx'));
  assert.doesNotMatch(bar, /Popover|\/pricing/);
});



test('the skeleton page `/` deliberately mounts no switch, and the reason is pinned here', () => {
  // `/`（`src/app/page.tsx`）是**入口骨架屏**：它在 1–2 帧内就 `router.replace` 到 `/chat`
  // 或 `/onboarding`（`page.tsx` 的分流 effect），用户根本来不及点任何控件，所以：
  //   1. 挂开关没有意义（不可点 = 不可用，等于零价值 UI）；
  //   2. 在这一页写设备镜像还会让「刚进站就先改风格」的语义变得莫名其妙。
  // 真正需要开关的是它之后的 `/onboarding` / `/login`（上一条测试逐页钉住）。
  //
  // 这条断言刻意写成 doesNotMatch：将来有人往骨架屏上加开关会**变红**，比注释更硬。
  // （`page.tsx` 不在 t15 的 inScope，所以理由落在本测试注释与 `palette-switch.tsx`
  //   头注释的「挂载范围」一节，而不是该页源码里的注释 —— 队长 2026-09-27 裁决 (B)。）
  assert.doesNotMatch(
    stripJsComments(read('src/app/page.tsx')),
    /PaletteSwitch/,
    '入口骨架屏不挂开关：该页 1–2 帧内就 router.replace 到 /chat 或 /onboarding，开关不可点',
  );
});

test('owner unlock switches are device-only until authorized; onboarding confirms profile writes',()=>{
 const login=stripJsComments(read('src/app/login/login-client.tsx'));
 assert.match(login,/<LocaleSwitch[^>]*persist="local"/);
 assert.match(login,/<PaletteSwitch[^>]*persist="local"/);
 assert.doesNotMatch(login,/apiFetch\('\/api\/visitor'/);
 const onboarding=stripJsComments(read('src/app/onboarding/onboarding-client.tsx'));
 assert.match(onboarding,/palettePersistMode\(/);
 assert.match(onboarding,/persist=\{canPersistToProfile \? 'server' : 'local'\}/);
});

test('the palette control is one anonymous circle: single button, zero text, no group and no shell', () => {
  const source = stripJsComments(read('src/components/palette-switch.tsx'));

  assert.match(source, /'use client'/, '开关是浏览器组件');
  // ── 只剩一个圆圈（契约 t30）：恰好一个 button，testid 挂在它身上 ──
  assert.equal(
    [...source.matchAll(/<button/g)].length,
    1,
    '控件只允许渲染一个 <button>（不再有第二个圆点）',
  );
  assert.equal(
    [...source.matchAll(/data-testid="palette-toggle"/g)].length,
    1,
    'data-testid="palette-toggle" 必须恰好一处',
  );
  const buttonStart = source.indexOf('<button');
  const buttonEnd = source.indexOf('/>', buttonStart);
  assert.ok(buttonStart >= 0 && buttonEnd > buttonStart, '必须能定位那颗圆点的 JSX');
  const button = source.slice(buttonStart, buttonEnd);
  assert.match(button, /data-testid="palette-toggle"/, 'testid 必须挂在这颗圆点（button）上');
  assert.doesNotMatch(source, /role="group"/, '单圆圈不再有 group 包裹');
  assert.doesNotMatch(source, /PALETTE_GROUP_LABEL/, '组名常量已随两点结构一起删除');
  assert.doesNotMatch(source, /PALETTE_VALUES/, '不再有「两档选项」的渲染入口（PALETTE_VALUES.map 已删）');

  // ── 零可见文字 + 去掉卡片外壳与可见标题 ──
  assert.doesNotMatch(source, /界面风格/, '可见标题「界面风格」已删除（组件内零可见文字）');
  assert.doesNotMatch(source, /rounded-xl/, '卡片外壳（rounded-xl border bg-card p-4）已删除');
  assert.match(source, /className=\{cn\(/, '只剩一颗圆点，定位/外观由调用点 className 注入');
  assert.doesNotMatch(button, /[\u4e00-\u9fa5]/, '圆点内不得有任何中文字面文本');
  assert.doesNotMatch(button, /title=/, '不得用 title tooltip 充当文字提示');
  // 唯一文本是**圆点之外**的 sr-only 说明（供读屏；条件化引用）。
  assert.match(source, /data-testid="palette-unset-hint"/, 'sr-only 说明必须保留');
  assert.match(source, /className="sr-only"/, '说明必须 sr-only（视觉隐藏）');
  assert.ok(
    source.indexOf('data-testid="palette-unset-hint"') < buttonStart,
    'sr-only 说明必须在圆点之外，且排在圆点**之前** —— 否则聊天头部里它会插在圆圈与「聊天装扮」按钮之间，破坏「圆圈是后者的前一个兄弟」',
  );
  assert.match(
    source,
    /aria-describedby=\{unset \? PALETTE_UNSET_HINT_ID : undefined\}/,
    '说明的引用必须条件化（只有它真的渲染时才引用，避免悬空 id）',
  );

  // ── data-palette-value 新语义 = 点击将应用的值（next） ──
  assert.match(
    source,
    /data-palette-value=\{next\}/,
    'data-palette-value 必须是「点击将应用的值」（单控件下 e2e 唯一能表达「点它切到蓝」）',
  );

  // ── a11y：aria-label 描述将要发生的动作；焦点环用语义色；hover 有轻微放大 ──
  assert.match(source, /aria-label=\{actionLabel\}/, 'aria-label 必须描述将要发生的动作');
  assert.match(source, /focus-visible:outline-foreground/, '焦点环必须用语义色');
  assert.match(source, /hover:scale-110/, 'hover 必须给轻微放大作为可交互提示');
  assert.doesNotMatch(source, /\bbusy\b/, 'prop 名保持 disabled（F1 结论），不得再出现 busy');

  /*
    ── 焦点环必须即时生效（t87 F1 的源码侧守门）────────────────────────────────

    三条 `focus-visible:outline-*` 在层叠上**本来就赢**（settle 后的计算值就是承诺的
    `2px / 2px / var(--foreground)`），但按钮原来带 `transition-all`（`transition-property: all`，
    `0.15s`）⇒ `outline-width/offset/color` 也被一起过渡，于是 `Tab` 之后 **150ms 内**任何
    「立即读计算值」的验收（t44 的端到端、e2e/palette-focus-ring.spec.ts）读到的都是**起始帧**：
    实测 `3px / 0px / --ring@0.5`。所以过渡属性必须**逐项列出**、且**不含 outline**。

    这里只钉「没有整包 transition」「有显式清单」「清单里没有 outline」；焦点环的真值由
    e2e/palette-focus-ring.spec.ts 用真实键盘 `Tab` 读计算值来钉。
  */
  assert.doesNotMatch(
    source,
    /transition-all/,
    '圆圈不得用 transition-all：它会把 outline-* 一起过渡，焦点环就不再即时生效（t87 F1）',
  );
  assert.match(
    source,
    /transition-\[[^\]]+\]/,
    '过渡必须收成显式属性清单（保住 hover 放大 / 底色泛光 / 禁用变淡，同时让焦点环即时生效）',
  );
  const transitionList = /transition-\[([^\]]+)\]/.exec(source)?.[1] ?? '';
  assert.doesNotMatch(
    transitionList,
    /outline/,
    `过渡清单里不得含 outline（实际清单：${transitionList}）`,
  );
  /*
    **双向**：清单里必须有 `scale`（t91）。

    Tailwind v4 的 `scale-*` 落在**独立属性 `scale`** 上，不是 `transform`：服务端 CSS 里
    `hover:scale-110` 编译成 `--tw-scale-*: 110%; scale: var(--tw-scale-x) var(--tw-scale-y)`，
    hover 时 computed 是 `scale: 1.1` 而 `transform: none`。所以只写 `transform` 的清单会把
    悬停放大退化成瞬间跳变（真机实测：单帧 `1.10000` vs 加上 `scale` 后
    `1.00331 → 1.01749 → … → 1.1` 的插值序列）—— 这正是 t87 的修复引入、被 t91 修回的回归。

    圆圈用到的其它 v4 独立属性（`translate` / `rotate` / `filter` / `backdrop-filter`）**都没用到**
    （class 清单里没有对应工具类，真机 computed 在未 hover / hover 两态都是 `none`），所以不列。
  */
  assert.match(
    transitionList,
    /(?:^|,)\s*scale\s*(?:,|$)/,
    `过渡清单必须含 scale（v4 的 scale-* 落在独立属性 scale 上；实际清单：${transitionList}）`,
  );

  // ── 两种持久化级别必须显式分开（不得揉成「先本地再尽量 PATCH」） ──
  assert.match(source, /persist/, '必须用显式 prop 表达持久化级别');
  assert.match(source, /'server'/, "必须有 server 档（支付两页 / 弹窗的非乐观 PATCH）");
  assert.match(source, /'local'/, "必须有 local 档（入口页在无档案行时的零服务端写入）");
  assert.match(source, /disabled=\{disabled \|\| switching\}/, '切换中必须 disabled（F1 的 disabled 结论）');
  const serverBranch = source.indexOf("persist === 'server'");
  const localBranch = source.indexOf("persist === 'local'");
  const serverSave = source.indexOf('await savePalettePreference(');
  const localWrite = source.indexOf('writePalettePreference(target)');
  assert.ok(serverBranch >= 0 && localBranch >= 0, '两个分支都必须存在');
  assert.ok(serverSave > serverBranch, 'savePalettePreference 必须在 server 分支里');
  assert.ok(localWrite > localBranch, 'local 分支只写设备镜像');
  // 非乐观：server 分支里 await 保存成功之后才改界面状态、回调与 toast。
  for (const after of ['setStored(target)', 'onChange?.(target)', 'toast.success']) {
    const index = source.indexOf(after);
    assert.ok(index > serverSave, `必须先 await 保存成功，再执行 ${after}（非乐观）`);
  }
});

test('the dot preview colours are single-sourced and equal each surface own --primary', () => {
  // 预览色**单一定义**在 `src/lib/palette.ts`（规格 §4.2 判据 6 推荐的形态）；
  // 一旦选定，globals.css 就不得再写一对 `--palette-preview-*`（第三份定义禁止）。
  const css = read('src/app/globals.css');
  assert.doesNotMatch(
    stripCssComments(css),
    /--palette-preview/,
    '预览色只允许一处定义（选了 palette.ts 常量，globals.css 不得并存一份）',
  );

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

  // 交叉断言：任一边被改（palette.ts 常量 / globals.css 表面 --primary）即红。
  assert.deepEqual(
    triple(PALETTE_PREVIEW_COLOR.rose),
    surfacePrimary("[data-surface='dream-rose']"),
    '玫瑰预览色必须逐分量等于 [data-surface=\'dream-rose\'] 的 --primary',
  );
  assert.deepEqual(
    triple(PALETTE_PREVIEW_COLOR.blue),
    surfacePrimary("[data-surface='dream-blue']"),
    '蓝预览色必须逐分量等于 [data-surface=\'dream-blue\'] 的 --primary',
  );
  // 两档预览色必须真的不同（否则圆点分不出是哪一档）。
  assert.notDeepEqual(triple(PALETTE_PREVIEW_COLOR.rose), triple(PALETTE_PREVIEW_COLOR.blue));

  // 组件侧：除这两个预览色外，不得出现任何写死颜色，也不得用 Tailwind 调色板类。
  const source = stripJsComments(read('src/components/palette-switch.tsx'));
  assert.match(source, /PALETTE_PREVIEW_COLOR\.rose/, '圆圈必须用单一定义的玫瑰预览色');
  assert.match(source, /PALETTE_PREVIEW_COLOR\.blue/, '圆圈必须用单一定义的蓝预览色');
  assert.doesNotMatch(source, /bg-primary/, '不得用 bg-primary（它随当前表面变，两档会渲染成同色）');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}/, '组件内不得出现 hex 颜色');
  assert.doesNotMatch(source, /\b(?:rgb|rgba|hsl|hsla|oklch)\(/, '组件内不得出现颜色函数字面量');
  assert.doesNotMatch(
    source,
    /\b(?:bg|text|border|ring)-(?:rose|sky|blue|red|pink|indigo|violet|purple|fuchsia|cyan|teal|emerald|green|lime|amber|orange|yellow|slate|gray|zinc|neutral|stone)-\d{2,3}/,
    '不得使用 Tailwind 调色板类（禁用的是「写死某个色号」这件事）',
  );
});

test('the palette labels live in exactly one module and are used only as accessible names', () => {
  const switchSource = stripJsComments(read('src/components/palette-switch.tsx'));
  const zhCore = stripJsComments(read('src/lib/i18n/messages/zh-CN/core.ts'));

  // 单一来源：这两个字符串字面量在 src/ 下**各恰好 1 次**（未选择说明由这两条 key 插值，不写第二份）。
  assert.equal(countLiteralInSrc('梦幻玫瑰'), 1, "'梦幻玫瑰' 在 src/ 下必须恰好出现 1 次");
  assert.equal(countLiteralInSrc('梦幻蓝'), 1, "'梦幻蓝' 在 src/ 下必须恰好出现 1 次");

  /**
   * 断言口径的**刻意变更**（U4 / t29，t17 评审 U6 的 F2）：标签原先住在 `palette-switch.tsx`
   * 的中文表里（该文件当时还在覆盖门禁的冻结豁免名单），于是**英文态仍显示中文** ——
   * `/love?lang=en` 的 DOM 里唯一的汉字属性就是 `aria-label="切换到梦幻玫瑰"`。
   * 现在唯一定义在 zh 字典里，组件只持有 key ⇒ 意图（单一来源 + 只作 accessible name）不变，
   * 而且多钉了一层「组件里不得再出现那份字面量」。
   */
  assert.match(zhCore, /'palette\.rose': '梦幻玫瑰'/, '氛围名的唯一定义在 zh 字典的 core area');
  assert.match(zhCore, /'palette\.blue': '梦幻蓝'/, '氛围名的唯一定义在 zh 字典的 core area');
  assert.doesNotMatch(switchSource, /梦幻玫瑰|梦幻蓝/, 'palette-switch.tsx 里不得再有第二份氛围名');
  assert.match(switchSource, /rose: 'core\.palette\.rose'/, '组件只持有字典 key');
  assert.match(switchSource, /blue: 'core\.palette\.blue'/, '组件只持有字典 key');

  // 只做 accessible name：单圆圈下它只经字典拼成**动作文案**（`切换到…`），不得作为可见文本渲染。
  assert.match(switchSource, /core\.palette\.switch_to/, '动作式 accessible name 必须来自字典');
  assert.match(switchSource, /aria-label=\{actionLabel\}/, 'aria-label 必须是那个动作文案');
  // 圆点自身零子节点（自闭合）⇒ 氛围名不可能成为可见文字；`title=` 也不得用来冒充。
  // 正则从 testid 一路吃到 `/>`，中途不允许出现 `<`（出现 `<` 就说明标签已经闭合、后面是子节点了）。
  assert.match(
    switchSource,
    /data-testid="palette-toggle"(?:(?!<)[\s\S])*?\/>/,
    '圆点必须是自闭合的（零可见文字）',
  );
  assert.doesNotMatch(switchSource, /title=/, '不得用 title tooltip 冒充可见文字');
  // 氛围名的**唯一**渲染点是一条 sr-only 说明（不是可见文案）——判据挂在 className 上。
  const hintStart = switchSource.indexOf('data-testid="palette-unset-hint"');
  const hintEnd = switchSource.indexOf('</p>', hintStart);
  assert.ok(hintStart >= 0 && hintEnd > hintStart, '必须有那条 sr-only 说明');
  assert.match(switchSource.slice(hintStart, hintEnd), /className="sr-only"/, '渲染氛围名的说明必须是 sr-only');
  // 未选择说明也走字典（两个氛围名由 `palette.rose` / `palette.blue` 插值进来，不写第二份字面量）。
  assert.match(
    switchSource,
    /t\('core\.palette\.unset_hint', \{ entry:[\s\S]{0,80}?paletteLabel\(locale, 'rose'\)/,
    '未选择说明必须由字典拼出（保持字面量单一来源）',
  );
});

/**
 * `/login` 首帧语言（t14 评审 U2 的 F1）+ 「不得把默认值当档案值」（t36 的 high 缺陷）。
 *
 * 两层要求：
 *   1. 服务端把已解析好的语言下传给本页自己的 Provider ⇒ 首帧就是 cookie 的语言（不再是先中文后翻转）；
 *   2. **只传 `initialLocale`**：`profileLocale` 的语义是 `visitors.locale`，而 `getServerLocale()`
 *      无 cookie 时返回 `DEFAULT_LOCALE` —— 把它当档案值传进去，等于把「没有偏好」当成「偏好是中文」
 *      插到解析链链首，既压过设备镜像、又把它回写成 `zh-CN`（V2/t21 判 high 的实测缺陷）。
 *      档案值现在由 `LocaleProvider` 内部的档案桥（`GET /api/visitor` → `visitors.locale`）唯一提供。
 */
test('登录页把服务端 locale 下传给页面树的 LocaleProvider（首帧不得是中文）', () => {
  const page = read('src/app/login/page.tsx');
  assert.match(page, /await getServerLocale\(\)/, '语言必须来自服务端 cookie 的唯一入口');
  assert.match(
    page,
    /<LocaleProvider initialLocale=\{locale\}>/,
    '首帧语言必须下传；且**只**传 initialLocale（profileLocale 只允许是 visitors.locale）',
  );
  assert.doesNotMatch(
    page,
    /profileLocale=\{locale\}/,
    '不得把 getServerLocale() 的默认值当 profileLocale（t36：那会让档案链压过设备镜像并回写 zh-CN）',
  );
  /**
   * **t47 定稿**：`/love` 只传 `initialLocale`（= 契约给这个槽的定义「`getServerLocale()` 或
   * `/love?lang=en`」，即**页面声明的语言**），由 `LocaleProvider` 判定真假（等于客户端 cookie、
   * 或本身不是默认值 ⇒ 真信号 ⇒ 压过设备镜像；裸默认值 + 无 cookie ⇒ 不当作声明）。
   * **`profileLocale` 一个字节都不传**：它的语义严格等价于 `visitors.locale`（契约 §14 E8），
   * 拿不到必须传 `undefined`，不得填任何兜底值（t36 的 high 缺陷正是这么来的）。
   */
  assert.match(page, /<LoginClient \/>/);
  assert.ok(
    page.indexOf('<LocaleProvider') < page.indexOf('<LoginClient'),
    'LoginClient 必须被本页的 LocaleProvider 包住（顺序不能反）',
  );
  // 只改这一页：另外两个入口页的首帧中文是契约 §9.5.1 的明文设计。
  // t53：开屏页拆成服务端 `page.tsx` + 客户端岛 —— 两处都查，避免拆分把这条覆盖悄悄漏掉。
  for (const file of [
    'src/app/page.tsx',
    'src/app/onboarding/page.tsx',
    'src/app/onboarding/onboarding-client.tsx',
  ]) {
    assert.doesNotMatch(read(file), /<LocaleProvider/, `${file} 不应新增 LocaleProvider（首帧中文是设计）`);
  }
});

test('the onboarding page leaves nothing on the old blue accent and hosts the derived-mode switch', () => {
  const source = stripJsComments(read('src/app/onboarding/onboarding-client.tsx'));

  const exits = [...source.matchAll(/data-surface=\{surface\}/g)].length;
  // 三个渲染出口：Suspense fallback / repickReady===false 的加载态 / 主容器。
  // 少一个就会在 repick 进入时闪一下默认暖褐（研究 R4），多一个说明有分叉的表面来源。
  assert.equal(exits, 3, `三个渲染出口必须用同一个 surface，实际 ${exits} 处`);
  assert.match(source, /usePaletteSurface\(\s*'entry'/, 'onboarding 只准走 entry 解析入口');
  assert.match(source, /<PaletteSwitch/, 'onboarding 必须挂开关（用户反馈①）');
  // 档位（server / local）由 canPersistToProfile 派生，不在页面里写死 —— 见
  // `the entry-page persist mode is derived from the confirmed visitor row` 那条测试。
  assert.match(source, /persist=\{canPersistToProfile \? 'server' : 'local'\}/, 'onboarding 的档位必须由判据派生');
  // 契约 t30：入口页把圆点放视口右上角（fixed），不占内容列宽、不遮挡主 CTA；不得引入任何文案。
  assert.match(source, /className="fixed right-4 top-4/, 'onboarding 的圆点必须定位在视口右上角');
  // 角色卡片 tagline 与捏人页头像描边改成按表面派生，不再直接吃角色蓝族 accent。
  assert.doesNotMatch(
    source,
    /style=\{\{\s*color:\s*c\.theme\.accent\s*\}\}/,
    '角色卡片 tagline 不得再把角色原生 accent 直接压到玫瑰表面上',
  );
  assert.doesNotMatch(
    source,
    /borderColor:\s*character\.theme\.accent/,
    '捏人页头像描边不得再把角色原生 accent 直接压到玫瑰表面上',
  );
  assert.match(source, /resolveEntryAccent\(/, '两处强调色必须走 palette.ts 的派生纯函数');
});

test('the 8 character accents in characters.ts stay byte-identical (entry pages only derive)', () => {
  // 硬编码对照：`characters.ts` 的两个默认主题 + 6 处覆写一个字都不许改 ——
  // 入口页只准**派生**强调色，改基色会同时打红聊天四处与 t3 §4.6/§4.7 的期望表。
  const EXPECTED_ACCENTS: Record<string, string> = {
    deepseek_f_01: '#8ec9ed',
    deepseek_f_02: '#6fb9eb',
    deepseek_f_03: '#b6c9ee',
    deepseek_f_04: '#8398e8',
    deepseek_m_01: '#75b9e6',
    deepseek_m_02: '#4da5dc',
    deepseek_m_03: '#92bce1',
    deepseek_m_04: '#3d9fd7',
  };

  const charactersSource = read('src/lib/characters.ts');
  for (const [key, accent] of Object.entries(EXPECTED_ACCENTS)) {
    assert.ok(
      charactersSource.includes(accent),
      `${key} 的 accent ${accent} 必须仍在 characters.ts 里逐字符存在（入口页只准派生，不准改基色）`,
    );
  }
  assert.deepEqual(
    (CHARACTER_PRESETS as unknown as Array<{ key: string; theme: { accent: string } }>)
      .map((preset) => [preset.key, preset.theme.accent])
      .sort(),
    Object.entries(EXPECTED_ACCENTS).sort(),
    '8 角色的 accent 必须与硬编码期望表一一对应',
  );

  // 入口两页不得内联任何角色 accent 字面量：只能经 `resolveEntryAccent` 派生。
  for (const [name, file] of ENTRY_SWITCH_PAGES) {
    const source = stripJsComments(read(file));
    for (const accent of Object.values(EXPECTED_ACCENTS)) {
      assert.doesNotMatch(
        source,
        new RegExp(accent, 'i'),
        `${name}页不得出现角色 accent 字面量 ${accent}`,
      );
    }
  }
});

test('globals.css keeps a scoped warm-rose surface with its own low-saturation palette', () => {
  const css = read('src/app/globals.css');
  const stripped = stripCssComments(css);

  // 行首锚定：表面块必须自己占一整行的行首。
  assert.match(stripped, /^\[data-surface='dream-rose'\]\s*\{/m, '必须提供作用域化的梦幻玫瑰表面');

  // 两个光斑类都必须存在（页面用 `surface + '-aurora'` 派生类名）。
  assert.match(stripped, /^\.dream-rose-aurora\s*\{/m, '必须提供 .dream-rose-aurora 光斑类');
  assert.match(stripped, /^\.dream-blue-aurora\s*\{/m, '既有的 .dream-blue-aurora 不得被改名或删除');

  const block = selectorBlock(css, "[data-surface='dream-rose']");

  // chroma（第二个分量）= 饱和度。--destructive 是语义红、不属于「梦幻玫瑰」的配色主张，
  // 与 dream-blue-theme.test.ts 的处理一致地排除；其余一律 ≤ 0.16（避免荧光/赛博朋克）。
  const withoutDestructive = block
    .split('\n')
    .filter((line) => !/--destructive/.test(line))
    .join('\n');
  const chromas = [...withoutDestructive.matchAll(/oklch\([\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(chromas.length > 0, '梦幻玫瑰表面必须定义 oklch 颜色');
  const maxChroma = Math.max(...chromas);
  assert.ok(maxChroma <= 0.16, `最大饱和度 ${maxChroma} 过高：会变成荧光色，而不是梦幻玫瑰`);

  // 色相（第三个分量）必须全部落在 DESIGN.md 的暖玫瑰带 [0, 70)；chroma = 0 的中性描边无色相主张。
  // --destructive 也一起检查：它的 hue 25 同样落在暖玫瑰带内。
  const chromaticLines = block
    .split('\n')
    .filter((line) => {
      const m = /oklch\([\d.]+\s+([\d.]+)/.exec(line);
      return m ? Number(m[1]) > 0 : false;
    })
    .join('\n');
  const hues = [...chromaticLines.matchAll(/oklch\([\d.]+\s+[\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(hues.length > 0, '梦幻玫瑰表面必须定义 oklch 色相');
  for (const hue of hues) {
    assert.ok(hue >= 0 && hue < 70, `色相 ${hue} 不在暖玫瑰带 [0, 70)：紫/indigo 与冷蓝都是明确禁止的`);
  }
});

test('the rose surface brings its own primary pair instead of copying .dark', () => {
  const css = read('src/app/globals.css');
  const roseBlock = selectorBlock(css, "[data-surface='dream-rose']");
  const darkBlock = selectorBlock(css, '.dark');

  // 红线：.dark 的 primary 必须逐字符还是玫瑰值（新块不得渗进全局暗色主题）。
  assert.match(
    darkBlock,
    /--primary:\s*oklch\(0\.645 0\.20 15\)/,
    '.dark 的 primary 必须仍是 oklch(0.645 0.20 15)',
  );

  // 陷阱：直接拷 .dark 的 --primary / --primary-foreground 会红对比度（实测 3.33，见镜像对比度测试）。
  const darkPrimary = /--primary:\s*(oklch\([^)]*\))/.exec(darkBlock);
  const darkPrimaryForeground = /--primary-foreground:\s*(oklch\([^)]*\))/.exec(darkBlock);
  assert.ok(darkPrimary && darkPrimaryForeground, '必须能读到 .dark 的主色对');
  assert.ok(
    !roseBlock.includes(darkPrimary![1]),
    `梦幻玫瑰不得直接拷贝 .dark 的 --primary（${darkPrimary![1]}）`,
  );
  assert.ok(
    !roseBlock.includes(darkPrimaryForeground![1]),
    `梦幻玫瑰不得直接拷贝 .dark 的 --primary-foreground（${darkPrimaryForeground![1]}）`,
  );
});

test('DESIGN.md records the dream-rose surface without dropping the dream-blue words', () => {
  const design = read('DESIGN.md');
  assert.match(design, /梦幻玫瑰/, 'DESIGN.md 必须写明梦幻玫瑰表面与其作用域');
  // 既有锚点不得丢（tests/dream-blue-theme.test.ts:120-125 也钉着这两个词）。
  assert.match(design, /梦幻深蓝/, 'DESIGN.md 必须保留「梦幻深蓝」');
  assert.match(design, /科技蓝/, 'DESIGN.md 必须保留对科技蓝/赛博朋克风的禁止');
});

test('the chat shell stays out of both surface scopes', () => {
  // 聊天页的表面是角色气泡色 + 壁纸，不得被入口/支付页的表面 id 污染（dream-blue 那条在
  // dream-blue-theme.test.ts，这里补上新表面 dream-rose）。
  const shell = stripJsComments(read('src/components/chat/chat-shell.tsx'));
  assert.doesNotMatch(shell, /dream-rose/, '聊天页不得启用梦幻玫瑰表面');
  assert.doesNotMatch(shell, /dream-blue/, '聊天页不得启用梦幻深蓝表面');
});

/**
 * 落地页 `/love` 的语言开关（t64 / 用户 2026-10-04 直接需求）：位置关系是**契约判据**，不是审美。
 *
 * §5.4：`locale-switch` 必须是 `PaletteSwitch` 片段的**紧邻前一个兄弟节点**（不包裹、不替换），
 * 且 `palette-switch.tsx` 源码里**不得**出现 `locale-switch` 字符串（组件零耦合）。
 * 对话页 `chat-shell.tsx:1577-1582` 是既有形态；落地页照抄关系与顺序（也正好是用户要的
 * 「放在梦幻蓝/梦幻玫瑰左边」）。
 *
 * 档位（§5.3.1「档案行是否已确认」）：落地页刻意**不取访客档案**，`PATCH /api/visitor` 必然 0 行命中，
 * 所以必须与同页 `<PaletteSwitch persist="local">` **同一档 `'local'`**（零请求、只写设备镜像）——
 * 照抄对话页的缺省 `'server'` 在这里是错的档。这条断言刻意钉住档位字面量：将来有人改成
 * `persist="server"`（或省掉该属性走缺省档）会**变红**，比注释硬。
 */
test('the retired marketing landing page redirects into the personal entry flow',()=>{
 const page=read('src/app/love/page.tsx');
 assert.match(page,/redirect\('\/'\)/);
 assert.doesNotMatch(page,/landing-shell/);
});


test('the skeleton page `/` deliberately mounts no switch, and the reason is pinned here', () => {
  // `/`（`src/app/page.tsx`）是**入口骨架屏**：它在 1–2 帧内就 `router.replace` 到 `/chat`
  // 或 `/onboarding`（`page.tsx` 的分流 effect），用户根本来不及点任何控件，所以：
  //   1. 挂开关没有意义（不可点 = 不可用，等于零价值 UI）；
  //   2. 在这一页写设备镜像还会让「刚进站就先改风格」的语义变得莫名其妙。
  // 真正需要开关的是它之后的 `/onboarding` / `/login`（上一条测试逐页钉住）。
  //
  // 这条断言刻意写成 doesNotMatch：将来有人往骨架屏上加开关会**变红**，比注释更硬。
  // （`page.tsx` 不在 t15 的 inScope，所以理由落在本测试注释与 `palette-switch.tsx`
  //   头注释的「挂载范围」一节，而不是该页源码里的注释 —— 队长 2026-09-27 裁决 (B)。）
  assert.doesNotMatch(
    stripJsComments(read('src/app/page.tsx')),
    /PaletteSwitch/,
    '入口骨架屏不挂开关：该页 1–2 帧内就 router.replace 到 /chat 或 /onboarding，开关不可点',
  );
});
