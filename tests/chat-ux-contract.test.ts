import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { en, zhCN } from '../src/lib/i18n/messages';
import { VOICE_OPTIONS } from '../src/lib/characters';
import { DATE_TYPES } from '../src/lib/profile/important-dates';
import { scanSource } from './support/i18n-cjk';
import { IMAGE_PLACEHOLDER, imagePlaceholderLabel, isImagePlaceholder } from '../src/lib/chat/image-placeholder';

/**
 * 接线层：聊天 UX 改造的源码文本契约（沿用本项目 spec-test 作风）。
 *
 * 对应规格 `docs/specs/2026-09-27-chat-ux-sidebar-and-composer.md` §5.3 的 8 条，
 * 并额外钉住「两处 toggle 是互斥渲染而不是 CSS 隐藏」这条 §4.2 判据 1。
 *
 * t9（U3）追加：聊天面的**文案全部走字典**（`src/lib/i18n/messages/chat.ts` 对），
 * 语言开关的挂载点，以及三条与既有数据源逐字符对齐的断言（中文态零变化）。
 *
 * 这里只读源码文本、不实例化 DOM：真正的运行时行为由纯函数单测
 * （tests/chat-composer.test.ts）与 e2e 覆盖。
 */

/** 扫源码前剥注释（与覆盖门禁同口径）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

/** src/components/chat/ 下的全部组件 + 聊天页（文案覆盖断言的扫描面）。 */
function chatSurfaceFiles(): string[] {
  const dir = new URL('../src/components/chat/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
    .map((name) => `src/components/chat/${name}`);
  files.push('src/app/chat/page.tsx');
  return files.sort();
}

/** Han 字符集（与覆盖门禁 `tests/support/i18n-cjk.ts` 同口径）。 */
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

const CONVERSATION_LIST = 'src/components/chat/conversation-list.tsx';
const CHAT_SHELL = 'src/components/chat/chat-shell.tsx';
const MESSAGE_INPUT = 'src/components/chat/message-input.tsx';
const SPEECH_VOICE_SETTINGS = 'src/components/chat/speech-voice-settings.tsx';
// F1（无文字配图占位）涉及的四个端点（U7 / t8）。
const MESSAGE_BUBBLE = 'src/components/chat/message-bubble.tsx';
const CHAT_ROUTE = 'src/app/api/chat/route.ts';
const IMAGE_PLACEHOLDER_MODULE = 'src/lib/chat/image-placeholder.ts';

/** textarea 元素的 JSX 片段：`max-h-*` 禁令只该落在这个元素上，但也顺带覆盖全文件。 */
function textareaElement(): string {
  const source = read(MESSAGE_INPUT);
  const start = source.indexOf('<textarea');
  assert.ok(start >= 0, '输入框必须仍是 <textarea>（getByPlaceholder 只认原生 placeholder 属性）');
  const end = source.indexOf('/>', start);
  assert.ok(end > start, 'textarea 必须是自闭合元素');
  return source.slice(start, end);
}

test('sidebar toggle has exactly one render site per file', () => {
  for (const file of [CONVERSATION_LIST, CHAT_SHELL]) {
    const source = read(file);
    const occurrences = source.split('data-testid="sidebar-toggle"').length - 1;
    assert.equal(occurrences, 1, `${file} 必须恰好有一个 sidebar-toggle 渲染点（互斥渲染的两端各一个）`);
  }
});

test('collapsed storage contract is unchanged', () => {
  const shell = read(CHAT_SHELL);
  // key、取值编码、读回时机都不能变，否则既有 e2e 的 localStorage 断言会红
  assert.match(shell, /const SIDEBAR_COLLAPSED_STORAGE_KEY = 'vl_sidebar_collapsed';/);
  assert.match(shell, /window\.localStorage\.getItem\(SIDEBAR_COLLAPSED_STORAGE_KEY\) === '1'/);
  assert.match(shell, /window\.localStorage\.setItem\(SIDEBAR_COLLAPSED_STORAGE_KEY, next \? '1' : '0'\);/);
  // 不得引入第二个 key（例如 vl_sidebar_collapsed_mobile）分叉状态
  assert.doesNotMatch(shell, /vl_sidebar_collapsed_[a-z0-9]+/);
});

test('conversation list header exposes a placement anchor', () => {
  const list = read(CONVERSATION_LIST);
  const header = list.indexOf('data-testid="conversation-list-header"');
  assert.ok(header >= 0, '头部容器必须带落位锚点 data-testid="conversation-list-header"');

  const status = list.indexOf("t('chat.status.online')", header);
  const toggle = list.indexOf('data-testid="sidebar-toggle"', header);
  assert.ok(status >= 0 && toggle > status, 'toggle 必须落在头部名字块之后（头部最后一个 flex 子元素）');

  // 非绝对定位：与头像同一套 flex 基线，不能用 absolute 砸到右上角
  const buttonStart = list.lastIndexOf('<button', toggle);
  const buttonEnd = list.indexOf('</button>', toggle);
  assert.ok(buttonStart >= 0 && buttonEnd > toggle, 'toggle 必须是普通 button 元素');
  const button = list.slice(buttonStart, buttonEnd);
  assert.doesNotMatch(button, /absolute|inset-|right-|top-/, 'toggle 不得用绝对定位落位');
  // <768px 不显示（既有 e2e：390px 下该 testid 必须 toBeHidden，但元素仍在 DOM 里）
  assert.match(button, /hidden/, 'toggle 必须自带 hidden 前缀类');
  assert.match(button, /md:inline-flex/, 'toggle 只在 md 及以上显示');
  assert.match(button, /aria-label=\{t\('chat\.header\.collapse'\)\}/, '可访问名走字典');
  assert.equal(zhCN.chat['header.collapse'], '收起对话列表', '中文可访问名逐字符不变');
  assert.match(button, /aria-expanded=\{true\}/);
  assert.match(button, /aria-controls="chat-sidebar"/);
});

test('conversation row structure is not reparented', () => {
  // 行号会因头部改动而漂移，所以断言写成「相对行区间」：从会话行 testid 所在行到
  // 紧随其后的「删除会话」所在行之间，不得出现 </div>（两个 button 必须仍是同层兄弟）。
  const lines = read(CONVERSATION_LIST).split('\n');
  const testIdLine = lines.findIndex((line) => line.includes('conversation-${c.id}'));
  assert.ok(testIdLine >= 0, '会话行 testid 模板串必须仍在');

  // 会话行按钮的开标签在 testid 之前几行，回退找到它，让区间覆盖「两个 button」的完整范围
  let rowStart = testIdLine;
  while (rowStart > 0 && !lines[rowStart].includes('<button')) rowStart -= 1;
  assert.ok(lines[rowStart].includes('<button'), '会话行必须仍是 <button>');

  const deleteIndex = lines.findIndex((line, index) => index > testIdLine && line.includes('chat.conversation.delete_aria'));
  assert.ok(deleteIndex > testIdLine, '删除会话按钮必须仍在同一行容器内');

  const between = lines.slice(rowStart, deleteIndex).join('\n');
  assert.doesNotMatch(between, /<\/div>/, '不得在会话行按钮与删除按钮之间插入新的包裹元素');
  assert.equal(
    (between.match(/<button/g) ?? []).length,
    2,
    '行容器内必须仍是「会话按钮 + 删除按钮」两个子元素（不得新增或删除）',
  );
});

test('textarea keeps the placeholder contract', () => {
  const source = read(MESSAGE_INPUT);
  // 两个分支都走字典（t9 起文案在 zh-CN/chat.ts），**中文值逐字符不变**
  // —— e2e 里 9 处 `getByPlaceholder('说点什么…')` 与 1 处跨行 getByText 靠的就是它。
  assert.equal(zhCN.chat['input.placeholder'], '说点什么…', 'zh 分支必须仍是「说点什么…」（省略号 U+2026）');
  assert.equal(zhCN.chat['input.placeholder_pending'], '说点什么…（可不发文字）', '待发图分支必须仍是全串');
  assert.ok(
    source.includes("placeholder={pendingImage ? t('chat.input.placeholder_pending') : t('chat.input.placeholder')}"),
    'placeholder 双分支必须仍是原生属性、且只从这两个字典 key 取词',
  );
  const placeholderAssignments = source.split('placeholder=').length - 1;
  assert.equal(placeholderAssignments, 1, '文件内 placeholder= 必须只出现 1 次，避免严格模式解析到 2 个元素');
  assert.match(textareaElement(), /placeholder=/, 'placeholder 必须挂在 textarea 上');
});

test('ime guard is wired with composition handlers', () => {
  const source = read(MESSAGE_INPUT);
  // 三条信号：nativeEvent.isComposing、keyCode 229、composition 期间的 ref 兜底
  assert.match(source, /onCompositionStart=/);
  assert.match(source, /onCompositionEnd=/);
  assert.match(source, /shouldSendOnEnter\(/);
  // 判定必须在纯函数里，组件只传原始信号
  const handlerStart = source.indexOf('onKeyDown=');
  const handlerEnd = source.indexOf('placeholder=', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /key: e\.key/);
  assert.match(handler, /shiftKey: e\.shiftKey/);
  assert.match(handler, /isComposing: e\.nativeEvent\.isComposing === true/);
  assert.match(handler, /keyCode: e\.keyCode/);
  assert.match(handler, /composing: composingRef\.current/);
  // 禁止防抖 / 时间窗
  assert.doesNotMatch(handler, /setTimeout|debounce|Date\.now\(\)/);
});

test('textarea height cap has a single source', () => {
  const source = read(MESSAGE_INPUT);
  const textarea = textareaElement();
  // ① className 行不得残留 CSS 侧的第二上限（旧 max-h-28 会让「写了 10 行、4 行就滚」静默回归）
  assert.match(textarea, /min-h-10/, '底限类名必须保留（首帧 JS 未跑时的兜底）');
  assert.doesNotMatch(textarea, /max-h-/, 'textarea 的 className 不得出现 max-h-*');
  assert.doesNotMatch(source, /max-h-/, '整个文件不得出现 max-h-*（上限只由 chat-composer.ts 定义）');
  // ② 不得用 45vh 之类的 CSS 字面量接管上限
  assert.doesNotMatch(source, /45vh/);
  // ③ 必须从唯一的算术入口导入，并且只在高度 effect 里写 inline style（§5.1.1「谁读谁」）
  assert.match(source, /from '@\/lib\/chat-composer'/);
  assert.match(source, /composerMaxHeight\(/);
  assert.match(source, /resolveComposerHeight\(/);
  assert.match(source, /el\.style\.maxHeight = `\$\{maxHeightPx\}px`;/, '上限必须写成 inline style.maxHeight');
  assert.match(source, /el\.style\.height = `\$\{height\}px`;/, '高度必须写成 inline style.height');
});

test('grow callback is wired to the scroll container', () => {
  const input = read(MESSAGE_INPUT);
  assert.match(input, /onGrow\?: \(\) => void;/, 'MessageInputProps 必须声明 onGrow');
  // 高度真的变化时才回调（否则会把用户向上翻阅历史的位置强行拽回底部）
  assert.match(input, /if \(previous === height\) return;/);

  const shell = read(CHAT_SHELL);
  const callStart = shell.indexOf('<MessageInput');
  assert.ok(callStart >= 0, '聊天页必须仍调用 MessageInput');
  const callEnd = shell.indexOf('/>', callStart);
  assert.ok(callEnd > callStart, 'MessageInput 调用处必须是自闭合元素');
  const call = shell.slice(callStart, callEnd);
  assert.match(call, /onGrow=/, '调用处必须传入 onGrow');
  assert.match(call, /scrollToBottom\(false\)/, '长高后必须复用既有的 scrollToBottom（smooth=false）');
  assert.doesNotMatch(call, /scrollToBottom\(true\)/, '不得用平滑滚动：连续输入会排队动画');
});

test('sidebar footer carries no brand logo link', () => {
  // 用户 2026-10-03 直接指令：侧栏最下方的产品 logo「位置怪异，需要去掉」。
  // 整块 <Link href="/love"> 连同它的两个 import 一起删除；三者缺一即回归
  // （只删 JSX 会让 lint:build 因未使用的 import 变红）。
  const list = read(CONVERSATION_LIST);
  assert.doesNotMatch(list, /BrandLogo/, '侧栏不得再引用 BrandLogo');
  assert.doesNotMatch(list, /next\/link/, '删除 Link 后不得残留 next/link import');
  assert.doesNotMatch(list, /href="\/love"/, '侧栏不得再有通往 /love 落地页的入口');
  // 锚点与「查看更早的话题」仍在（这次改动不得顺手删掉相邻 UI）
  assert.match(list, /data-testid="conversation-list-header"/);
  assert.ok(list.includes("t('chat.conversation.earlier')"), '「查看更早的话题」必须仍在（t9 起走字典）');
  assert.equal(zhCN.chat['conversation.earlier'], '查看更早的话题');
});

test('the two sidebar toggle render sites are mutually exclusive', () => {
  // 展开态：只有侧栏头部渲染；收起态：只有聊天头部渲染。禁止「两处都渲染再靠 CSS 隐藏」
  // —— CSS 隐藏仍会让 Playwright 严格模式解析到 2 个元素（既有 e2e 用例 1 会红）。
  const list = read(CONVERSATION_LIST);
  const listToggle = list.indexOf('data-testid="sidebar-toggle"');
  assert.ok(list.includes('!sidebarCollapsed && ('), '侧栏 toggle 必须由 !sidebarCollapsed 守卫');
  assert.ok(list.indexOf('!sidebarCollapsed && (') < listToggle);

  const shell = read(CHAT_SHELL);
  const shellToggle = shell.indexOf('data-testid="sidebar-toggle"');
  assert.ok(shell.includes('sidebarCollapsed && ('), '聊天头部 toggle 必须由 sidebarCollapsed 守卫');
  assert.ok(shell.indexOf('sidebarCollapsed && (') < shellToggle);
});

/* ────────────────────────────────────────────────────────────────────────────
   t9（U3）：聊天面的文案全部走字典 + 语言开关落位 + 与既有数据源逐字符对齐
   ──────────────────────────────────────────────────────────────────────────── */

test('聊天面的用户可见文案不再有中文字面量（含 13 个子组件与聊天页）', () => {
  /*
    口径与覆盖门禁 `tests/i18n-coverage.test.ts` 一致（四类 AST 节点 + Han，注释不计），
    但**只看聊天面**、并额外要求这些文件不在冻结快照里 —— 即 t9 真的把文案搬进了字典，
    而不是靠 t5 的 `FROZEN_ZH_LITERALS` 放行。

    唯一的例外是**内部日志位置**（`throw new Error(...)` / `console.*(...)` 的实参）：
    契约 §6.1 明确「客户端自抛走字典、内部日志保持中文」。聊天面里剩的这类节点只有
    **没有例外**：F1 修好之后（U7 / t8），无文字配图的占位也走共享常量 + 字典，
    这里不再为任何节点开洞。
  */
  const violations: string[] = [];
  for (const file of chatSurfaceFiles()) {
    const nodes = scanSource(file, read(file));
    for (const node of nodes) {
      if (node.internalLog) continue;
      violations.push(`${node.file}:${node.line} [${node.kind}] ${JSON.stringify(node.text)}`);
    }
  }
  assert.deepEqual(violations, [], '聊天面的上屏文案必须全部来自字典');
});

test('无文字配图的占位：哨兵收敛到一个共享常量，显示按语言（F1 关闭）', () => {
  /*
    原先是「唯一未翻上屏中文」的例外断言 —— 那等于把缺陷钉成契约，F1 修好后必须删掉
    并改成**正向**判据：
      1. 落库哨兵只有一个共享常量（服务端落库 / 客户端乐观占位 / 渲染判定都不得再写字面量）；
      2. 显示按语言走 `imagePlaceholderLabel`，英文态不回显中文哨兵；
      3. 存量行里的同值仍被 `isImagePlaceholder` 认出（零迁移）。
  */
  const shell = read(CHAT_SHELL);
  const bubble = read(MESSAGE_BUBBLE);
  const route = read(CHAT_ROUTE);
  const placeholder = read(IMAGE_PLACEHOLDER_MODULE);

  for (const [name, source] of [['chat-shell', shell], ['message-bubble', bubble], ['chat/route', route]] as const) {
    assert.equal(
      /'\[图片\]'/.test(stripComments(source)),
      false,
      `${name} 不得再写字面量 [图片]（必须用共享常量）`,
    );
  }
  assert.match(shell, /IMAGE_PLACEHOLDER/);
  assert.match(route, /IMAGE_PLACEHOLDER/);
  assert.match(route, /isImagePlaceholder\(message\.content\)/, '模型标注必须用同一判定，不得比对字面量');
  // 渲染判定与本地化取值都在 message-bubble 里，且取值来自共享模块。
  assert.match(bubble, /isImagePlaceholder\(message\.content\)/);
  assert.match(bubble, /imagePlaceholderLabel\(locale\)/);
  // 常量本身只在共享模块里定义（哨兵值来自字典的 zh 侧，逐字符等于既有落库值）。
  assert.match(placeholder, /chat\.message\.image_placeholder/);

  // 存量兼容 + 中英两态：直接对共享模块断言（纯函数，不需要 DOM）。
  assert.equal(IMAGE_PLACEHOLDER, '[图片]', '落库哨兵必须逐字符等于既有值（零迁移）');
  assert.equal(isImagePlaceholder('[图片]'), true, '存量行必须仍被识别');
  assert.equal(isImagePlaceholder(' [图片] '), true, '两侧空白不影响识别');
  assert.equal(isImagePlaceholder('[Image]'), false, '别的语言形态不是落库哨兵');
  assert.equal(isImagePlaceholder(''), false);
  assert.equal(isImagePlaceholder(null), false);
  assert.equal(imagePlaceholderLabel('zh-CN'), '[图片]', '中文态渲染逐字符不变');
  assert.equal(imagePlaceholderLabel('en'), '[Image]', '英文态不得回显中文');
});

test('音色的展示代号只从 formatVoiceLabel 取（两种语言都不回显选项自带的中文 label）', () => {
  const source = read(SPEECH_VOICE_SETTINGS);
  // 英文代号由 id 算式推导（t3），组件不得再读 `option.label` 做展示
  assert.doesNotMatch(source, /voice\.label|current\.label/, '不得再拿 option.label 当展示文本');
  assert.match(source, /formatVoiceLabel\(/, '展示代号必须走 formatVoiceLabel(option, locale)');
  // 顺序仍是「中文在前」：分组顺序不得随界面语言变化
  assert.match(source, /\['zh', 'en'\] as const/, '分组顺序必须恒为 zh → en（不随语言重排）');
  assert.match(source, /useMemo\(\(\) => getVoicesForGender\(gender\), \[gender\]\)/, '音色池仍按性别过滤');
});

test('英文音色的试听句：en 侧是英文，zh 侧与服务端默认句逐字符相同（中文态零变化）', () => {
  const source = read(SPEECH_VOICE_SETTINGS);
  assert.match(source, /language === 'en' \? t\('chat\.voice\.preview_sample'\) : undefined/, '只有英文音色显式传试听文本');
  // 中文音色不传 text：服务端仍用 voice.preview，逐字符不变
  assert.doesNotMatch(source, /'voice-[a-z]+-[fm]-/, '组件不得按音色 id 硬编码试听句');
  const englishVoice = VOICE_OPTIONS.find((option) => option.language === 'en');
  assert.ok(englishVoice, '必须有英文音色');
  assert.equal(
    zhCN.chat['voice.preview_sample'],
    englishVoice.preview,
    'zh 值必须与 characters.ts 的默认试听句逐字符相同（中文态传它 = 传默认值）',
  );
  assert.equal(HAN.test(en.chat['voice.preview_sample']), false, 'en 试听句不得含汉字');
});

test('日期类型标签：界面字典与 @/lib/profile/important-dates 的既有标签逐字符相同', () => {
  /*
    `BIRTHDAY_DESCRIPTION`（`我的生日`）是要写进库的存量数据哨兵，不能为了翻界面去动那个文件，
    所以界面为这 6 个标签单独持有一份本地化副本 —— 这里钉住中文侧**逐字符相等**，
    避免两处悄悄漂移（漂移的后果是中文态界面文案变了）。
  */
  for (const entry of DATE_TYPES) {
    assert.equal(
      zhCN.chat[`dates.type_${entry.value}` as keyof typeof zhCN.chat],
      entry.label,
      `dates.type_${entry.value} 必须与 DATE_TYPES 的既有中文标签逐字符相同`,
    );
  }
  // 历史类型（只读回显、不再是选项）也必须有标签，且不回显原始 key
  assert.equal(zhCN.chat['dates.type_medical'], '复诊（历史）');
  assert.equal(zhCN.chat['dates.type_birthday'], '生日');
  assert.equal(HAN.test(en.chat['dates.type_medical']), false);
});

test('语言开关挂在聊天头部、且在氛围圆圈左侧（不改 palette-toggle 的任何约定）', () => {
  const shell = read(CHAT_SHELL);
  assert.equal((shell.match(/<LocaleSwitch/g) ?? []).length, 1, '聊天头部恰好一个语言开关');
  const localeIndex = shell.indexOf('<LocaleSwitch');
  const circleIndex = shell.indexOf('<PaletteSwitch');
  const themeButtonIndex = shell.indexOf('aria-label={t(\'chat.header.appearance\')}');
  assert.ok(circleIndex > localeIndex, '语言开关必须排在氛围圆圈**左侧**（DOM 顺序在前）');
  assert.ok(circleIndex > 0 && themeButtonIndex > circleIndex, '圆圈仍紧邻「聊天装扮」按钮且在其左侧');
  // 语言开关不得吃掉圆圈与「聊天装扮」之间的「前一个兄弟」关系
  const between = shell.slice(shell.indexOf('/>', circleIndex) + 2, themeButtonIndex);
  assert.equal((between.match(/<[a-zA-Z]/g) ?? []).length, 1, '圆圈与聊天装扮按钮之间仍只允许后者这一个元素');
  // 头部仍然只有一处 palette-toggle 的宿主组件
  assert.equal((shell.match(/<PaletteSwitch/g) ?? []).length, 1);
});

test('聊天面字典中英成对齐全、en 侧无汉字、占位符集合一致', () => {
  const zhKeys = Object.keys(zhCN.chat).sort();
  const enKeys = Object.keys(en.chat).sort();
  assert.deepEqual(enKeys, zhKeys, 'en / zh 的 key 集合必须一致（类型约束之外再加一条运行时断言）');
  assert.ok(zhKeys.length > 100, `聊天面 key 数量应当可观（实际 ${zhKeys.length}）`);
  for (const key of zhKeys) {
    const zhValue = zhCN.chat[key as keyof typeof zhCN.chat];
    const enValue = en.chat[key as keyof typeof en.chat];
    assert.ok(zhValue.trim().length > 0, `zh ${key} 不得为空`);
    assert.ok(enValue.trim().length > 0, `en ${key} 不得为空`);
    assert.equal(HAN.test(enValue), false, `en ${key} 不得含汉字：${enValue}`);
    assert.equal(enValue, enValue.trim(), `en ${key} 不得带首尾空白`);
    const zhVars = [...zhValue.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]).sort();
    const enVars = [...enValue.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(enVars, zhVars, `${key} 的中英占位符集合必须相同`);
  }
});

test('英文态不渲染英音 / 美音特质描述（硬约束②）', () => {
  for (const [key, value] of Object.entries(en.chat)) {
    assert.doesNotMatch(value, /\bBritish\b|\bAmerican\b|accent/i, `en ${key} 不得描述口音：${value}`);
  }
  const source = read(SPEECH_VOICE_SETTINGS);
  assert.match(source, /voice\.descEn/, '英文描述词必须读 option.descEn');
  assert.doesNotMatch(source, /voice\.trait|option\.accent/, '不得渲染 trait / accent 字段');
});
