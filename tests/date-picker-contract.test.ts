import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { stripCssComments } from './support/wcag';
import { translate, zhCN } from '../src/lib/i18n/messages';

/**
 * 日期选择器接线层源码契约（契约 t55 / t62；规格 §4.11 判据 1–5 与 §5.7 G5–G8）。
 *
 * **正向断言一律扫剥注释后的源码**：实现里的注释同样会写出 `addYears`、`«`、`aria-label="上一年"`
 * 这类 token，若拿原文做「必须含 X」，删掉代码只留注释也能绿 —— 变异测试抓不到（t62 的 finding）。
 * 因此：
 *   - 正向断言 → `stripped(file)`（`stripJsComments`，与 `tests/palette-surfaces.test.ts` 同一套口径）；
 *   - 否定断言（不得含 X）→ 原文，更严；
 *   - 规格 N-5 的「全仓连注释也不得有原生日期输入」→ 原文裸扫描（唯一刻意不剥的例外）。
 * 零 mock、零 DOM：只读源码文本。真值表在 `tests/date-value.test.ts`。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/**
 * 剥掉 JS/TS 注释（复用共享的 CSS 剥注释器处理块注释，另去 `//` 行注释；换行保留）。
 *
 * 与 `tests/palette-surfaces.test.ts:44` 的本地实现逐字符相同 —— 该文件不在本任务 inScope，
 * 且平台不允许在 `tests/support/` 下新建未声明文件，所以这里保留一份自包含实现（4 行）；
 * 若日后把两处合并成共享模块，两边的调用点只需改 import。
 */
function stripJsComments(source: string): string {
  return stripCssComments(source).replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 剥注释后的实现文本：正向断言的唯一输入。 */
const stripped = (rel: string) => stripJsComments(read(rel));

/**
 * 把字符串字面量的**内容**清空（保留定界符），用于「这个调用/用法是否真的写在**代码**里」的判定。
 *
 * 为什么必须连字符串一起剥（t81「断根」）：只剥注释还不够 —— 失败文案本身就是字符串字面量，
 * 里面完全可能写着 `document.elementFromPoint(`。若把「含这个 token」当成「真的做了命中测试」，
 * 那么「只把调用删掉、把调用文本留在某句文案里」依旧会绿（t78 版守卫的实际变异结论）。
 * 收紧正则只能挡当前这一种文案，换个说法又会假绿；所以这里按**语义**切一刀：
 *   - 查**调用/用法**（`document.elementFromPoint(`、`self: hit === target`、`clickCenter(page, PREV_YEAR)` …）
 *     → 一律用本函数处理后的 `specCode`（注释与字符串内容都已剥离）；
 *   - 查**字面量内容**（`[aria-label="上一年"]`、`'1990'`）→ 用只剥注释的 `spec`。
 * 本函数**组合**在既有的 `stripJsComments` 之上（调用点先剥注释再调它），不重复实现剥注释。
 */
function stripStringLiterals(source: string): string {
  return source.replace(
    /'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g,
    (literal) => literal[0] + literal[literal.length - 1],
  );
}

/** 月份标题（`CalendarMonthCaption`）那一段的源码：年份控件的样式只在它里面判。 */
function captionSource(source: string): string {
  const start = source.indexOf('function CalendarMonthCaption');
  assert.ok(start >= 0, '必须有 CalendarMonthCaption');
  const end = source.indexOf('\nfunction ', start + 10);
  return end > start ? source.slice(start, end) : source.slice(start);
}

const CALENDAR = 'src/components/ui/calendar.tsx';
const DATE_PICKER = 'src/components/ui/date-picker.tsx';
const IMPORTANT_DATES = 'src/components/chat/companion-important-dates.tsx';
const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** src/ 下所有 `.ts` / `.tsx` 源码（**含注释** —— 规格 N-5 的证据就是一条全仓 grep）。 */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('the calendar gains year-level navigation and a year dropdown', () => {
  const source = stripped(CALENDAR);

  // 自定义 MonthCaption：年份级 «/» 与年份下拉都在这里（不依赖包的内部组合）
  assert.match(source, /MonthCaption/, '必须有自定义 MonthCaption');
  assert.match(source, /useDayPicker\(\)/, '跳转必须走 useDayPicker() 暴露的 API');
  assert.match(source, /goToMonth\(/, '跳转必须走 goToMonth');
  assert.match(source, /addYears\(/, '年份级左右按钮用 addYears，而不是 addMonths');

  // 年份级按钮：锚在**代码独有**的标记上（注释会被剥掉，删按钮即红）
  // t51（F-B）：accessible name 已进字典（原为中文字面量、被覆盖门禁的冻结快照豁免 ⇒ 英文态会出中文）。
  // 断言强度不降：既钉**接线**（走字典键），又钉**中文态取值逐字符**（与改动前的 accessible name 相同）。
  assert.match(source, /aria-label=\{t\('core\.calendar\.prev_year'\)\}/, '必须有「上一年」按钮（经字典键）');
  assert.match(source, /aria-label=\{t\('core\.calendar\.next_year'\)\}/, '必须有「下一年」按钮（经字典键）');
  assert.equal(translate(zhCN, 'core.calendar.prev_year'), '上一年', 'zh 侧 accessible name 逐字符不变');
  assert.equal(translate(zhCN, 'core.calendar.next_year'), '下一年', 'zh 侧 accessible name 逐字符不变');
  assert.match(source, /disabled=\{currentYear <= fromYear\}/, '到 fromYear 边界时上一年按钮必须 disabled');
  assert.match(source, /disabled=\{currentYear >= toYear\}/, '到 toYear 边界时下一年按钮必须 disabled');
  assert.match(source, /«/, '上一年按钮的可读标记');
  assert.match(source, /»/, '下一年按钮的可读标记');

  // 年份下拉：选项区间来自 DayPicker 的 startMonth/endMonth
  assert.match(source, /<select[\s\S]{0,300}?aria-label=\{t\('core\.calendar\.year'\)\}/, '年份下拉必须带可访问名（t51：经字典键）');
  assert.match(source, /dayPickerProps/, '下拉项区间来自 DayPicker 的 startMonth/endMonth');
  assert.match(source, /startMonth/);
  assert.match(source, /endMonth/);

  // 既有封装行为不得回归
  assert.match(source, /formatMonthDropdown/);
  assert.match(source, /button_previous/);
  assert.match(source, /button_next/);
  assert.match(source, /DayButton: CalendarDayButton/);
  assert.match(source, /Chevron: /);
  assert.match(source, /getDefaultClassNames\(\)/);
  assert.match(source, /components=\{\{/, '自定义组件仍通过 components 注册');
  // 导出面不得改动（规格 §5.7 G8：复活死代码，不加新导出）
  assert.match(source, /export \{ Calendar, CalendarDayButton \}/);
  assert.doesNotMatch(source, /export \{[^}]*MonthCaption/, 'MonthCaption 只做内部默认组件，不进导出面');
});

test('the date picker is a non-blocking popover around the revived calendar', () => {
  const source = stripped(DATE_PICKER);

  // 复活死代码：这条断言防止 calendar.tsx 再次变成零 import
  assert.match(source, /import \{ Calendar \} from '@\/components\/ui\/calendar'/, '必须 import Calendar');

  assert.match(source, /Popover\b/);
  assert.match(source, /PopoverContent/);
  assert.match(source, /align="start"/);
  // 非阻塞弹层：不传 Radix 的阻塞开关（不写 modal 属性）—— 否定断言扫原文，更严
  assert.doesNotMatch(read(DATE_PICKER), /modal/, '必须是 Radix 默认的非阻塞弹层');

  // 值解析/序列化只走纯函数
  assert.match(source, /parseDateValue\(/);
  assert.match(source, /formatDateValue\(/);
  assert.match(source, /formatDateLabel\(/);
  assert.doesNotMatch(read(DATE_PICKER), /toISOString/, '不得自行序列化日期');
  assert.doesNotMatch(read(DATE_PICKER), /new Date\(\s*(?:value|raw|str)\b/, '值解析必须走 parseDateValue');

  // 可访问名 / 占位符 / 清除出口
  assert.match(source, /aria-label=\{ariaLabel\}/);
  /**
   * U4 / t36 的**刻意变更**：占位符（未选择时那句「选择日期」）进字典后，组件源码里不再有中文，
   * 原来的「源码里匹配『选择日期』」必然假红。改成**双重钉住**：组件必须引用那条 key，
   * 且 zh 字典里必须逐字符保留原句 —— 意图（空值有占位符）不变，覆盖反而多一层（字典也被钉住）。
   */
  assert.match(source, /t\('core\.date_picker\.placeholder'\)/, '空值占位符必须走字典');
  assert.match(
    read('src/lib/i18n/messages/zh-CN/core.ts'),
    /'date_picker\.placeholder': '选择日期'/,
    'zh 字典必须逐字保留原占位符',
  );
  assert.match(source, /t\('core\.date_picker\.clear'\)/, '清除出口必须走字典');
  assert.match(
    read('src/lib/i18n/messages/zh-CN/core.ts'),
    /'date_picker\.clear': '清除'/,
    'zh 字典必须逐字保留原清除文案',
  );

  // 范围夹住：默认 1900 / 当前年 + 10
  assert.match(source, /fromYear = 1900/);
  assert.match(source, /toYear = new Date\(\)\.getFullYear\(\) \+ 10/);
  assert.match(source, /startMonth=\{new Date\(fromYear, 0, 1\)\}/);
  assert.match(source, /endMonth=\{new Date\(toYear, 11, 31\)\}/);

  // 选中即写并关闭
  assert.match(source, /onChange\(formatDateValue\(/, '选中某天即写回 YYYY-MM-DD');
  assert.match(source, /setOpen\(false\)/, '选中后关闭弹层');

  // 触发器与既有输入框同高 / 同边框 / 同圆角（剥注释后判定：注释里也写过这三个类名）
  assert.match(source, /h-9/);
  assert.match(source, /rounded-md/);
  assert.match(source, /border-input/);
});

test('both native date inputs are replaced, with the accessible names kept', () => {
  const source = stripped(IMPORTANT_DATES);

  assert.doesNotMatch(read(IMPORTANT_DATES), /type="date"/, '不得再留原生日期输入');
  assert.match(source, /import \{ DatePicker \} from '@\/components\/ui\/date-picker'/);
  assert.equal((source.match(/<DatePicker/g) ?? []).length, 2, '两处都要换成 DatePicker');
  // 可访问名走字典（t9/U3），**中文取值逐字符不变** —— e2e 的
  // `getByRole('button', { name: '我的生日' })` 靠的就是它。
  assert.match(source, /ariaLabel=\{t\('chat\.dates\.title'\)\}/, '既有 e2e 依赖这个可访问名');
  assert.match(source, /ariaLabel=\{t\('chat\.dates\.birthday_title'\)\}/, '既有 e2e 依赖这个可访问名');
  assert.equal(zhCN.chat['dates.title'], '重要日期');
  assert.equal(zhCN.chat['dates.birthday_title'], '我的生日');
  // 两处都仍是受控用法（value + onChange）
  assert.equal((source.match(/value=\{/g) ?? []).length >= 2, true);
  assert.equal((source.match(/onChange=\{/g) ?? []).length >= 2, true);

  // 规格 §6.1.2 N-5 的证据：全仓**连注释一起**不再出现原生日期输入（唯一刻意不剥注释的断言）
  const offenders = sourceFiles(SRC_ROOT)
    .filter((file) => readFileSync(file, 'utf8').includes('type="date"'))
    .map((file) => file.slice(SRC_ROOT.length + 1));
  assert.deepEqual(offenders, [], '全仓不得再有原生日期输入（规格 N-5：grep 零命中）');
});

test('the nav overlay no longer swallows the year controls, and the year select is self-drawn', () => {
  const source = stripped(CALENDAR);

  // ① 真缺陷的修复（用户实测：`«`/`»`/年份控件点了完全没反应）：
  // DayPicker 的 nav 是绝对定位、横跨整行的浮层，压在标题行上 ⇒ 让它自身不吃事件，
  // 只把事件收回到它自己的两个月份翻页按钮上（那两个必须继续可点）。
  assert.match(source, /nav: cn\([\s\S]{0,200}?pointer-events-none/, 'nav 必须 pointer-events-none');
  assert.match(
    source,
    /button_previous: cn\([\s\S]{0,240}?pointer-events-auto/,
    '「上个月」按钮必须 pointer-events-auto（否则月份翻页会一起坏掉）',
  );
  assert.match(
    source,
    /button_next: cn\([\s\S]{0,240}?pointer-events-auto/,
    '「下个月」按钮必须 pointer-events-auto',
  );

  // ② 年份控件不得再有系统绘制的上下箭头：appearance-none + 自绘**单一** chevron。
  //    用原生 <select> 是为了保住「一次交互跳到 1990」的能力。
  const caption = captionSource(source);
  assert.match(caption, /appearance-none/, '年份 <select> 必须 appearance-none（去掉浏览器那套上下箭头）');
  assert.equal(
    (caption.match(/ChevronDownIcon/g) ?? []).length,
    1,
    '标题行只允许一枚自绘 chevron（多一枚就等于把系统外观又画回来了）',
  );
  assert.doesNotMatch(caption, /ChevronUp/, '不得出现朝上的箭头 / 第二枚 chevron');
  assert.match(
    caption,
    /className="pointer-events-none absolute[^"]*"/,
    '自绘 chevron 必须 pointer-events-none（不能挡住年份控件的点击）',
  );
  assert.match(caption, /<select[\s\S]{0,300}?aria-label=\{t\('core\.calendar\.year'\)\}/, '年份控件仍是可选的 <select>（accessible name 经字典键）');
  assert.equal(translate(zhCN, 'core.calendar.year'), '年份', 'zh 侧「年份」accessible name 逐字符不变');

  // Browser interaction and hit-testing will be exercised by the independent personal E2E suite.

});

test('the value domain and the data layer are untouched', () => {
  const source = stripped(IMPORTANT_DATES);

  // 仍是 'YYYY-MM-DD' 字符串直通：草稿、条目、生日、PUT 负载的形状逐字符未变
  assert.match(source, /const \[draftDate, setDraftDate\] = useState\(''\)/);
  assert.match(source, /date: draftDate,/, 'important_dates 的 date 仍是字符串');
  assert.match(source, /setDraftDate\(/);
  assert.match(source, /birthday: nextBirthday,/);
  assert.match(source, /important_dates: buildImportantDatesPayload\(nextBirthday, nextDates\)/);
  assert.match(source, /apiFetch\('\/api\/profile'/);
  assert.match(source, /method: 'PUT'/);
});
