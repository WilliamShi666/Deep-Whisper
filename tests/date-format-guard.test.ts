import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { localeChangedToast } from '../src/components/locale-switch';

/**
 * 契约 §11.2 **判据 11.2.1** 的可执行门禁：`src/**` 内不得再出现**
 * 无参 / `[]` / `"default"` 形态**的 `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`。
 *
 * 为什么需要这个文件（U4 / t29 的核心交付）：这条判据在契约里写了很久，但**没有任何测试在执行它**，
 * 于是 4 处站点从已经交付的任务里漏了过去（pricing 7 处 + chat-shell 1 处由 t7/t8 收口；
 * `ui/calendar.tsx` ×2 与 `ui/chart.tsx` ×1 由本任务收口）。判据只有落成测试才有约束力 ——
 * 本文件就是它第一次真正被执行的地方。
 *
 * 口径（三个必要条件，缺一不可）：
 *   1. **AST 口径**，不是 grep：`ts.createSourceFile` + 遍历 `CallExpression`。这样
 *      「注释里提到 `toLocaleString()`」「字符串里出现 `//`」都不会造成假阳/假阴
 *      （本仓的覆盖门禁同样是 AST 口径）。
 *   2. **豁免只有一处**：`src/lib/i18n/format.ts` —— 它**就是**「显式传 locale」的那一层
 *      （`toLocaleString(toIntlLocale(locale))` 是正确形态）。豁免不是放行：下面有一条断言
 *      证明那个文件里的每个 `toLocale*` 调用**都带了参数**，所以豁免没有变成漏洞。
 *   3. **非空转**：变异自证 —— 合成样本里插入违规形态必须被命中，注释与显式传 locale 不得误报。
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** 唯一豁免的模块（相对工作区的 POSIX 路径）：格式化层自己。 */
const EXEMPT = new Set(['src/lib/i18n/format.ts']);

/** 契约点名的三个方法。`toLocaleLowerCase` 之类不在判据范围内。 */
const LOCALE_METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);

/** src/ 下全部 `.ts` / `.tsx`（相对工作区的 POSIX 路径）。 */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(relative(fileURLToPath(new URL('..', import.meta.url)), full).split(sep).join('/'));
  }
  return out.sort();
}

/** 这个 `toLocale*` 调用是不是「无参 / `[]` / `'default'`」三种违规形态之一？ */
function isOffendingCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!LOCALE_METHODS.has(callee.name.text)) return false;

  if (node.arguments.length === 0) return true; // 无参：跟**运行时**语言走
  const [first] = node.arguments;
  if (ts.isArrayLiteralExpression(first) && first.elements.length === 0) return true; // `[]`
  if (ts.isStringLiteralLike(first) && first.text === 'default') return true; // `'default'`
  return false;
}

/** 扫描一段源码，返回违规调用（`file:line 代码片段`）。 */
export function scanSourceForLocaleCalls(file: string, source: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  const out: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isOffendingCall(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      out.push(`${file}:${line + 1} ${node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return out;
}

test('src/ 内除 format.ts 外，无参 / [] / "default" 形态的 toLocale* 命中 0 次（契约 §11.2 判据 11.2.1）', () => {
  const violations: string[] = [];
  let scanned = 0;
  for (const file of sourceFiles(SRC)) {
    scanned += 1;
    if (EXEMPT.has(file)) continue;
    violations.push(...scanSourceForLocaleCalls(file, readFileSync(file, 'utf8')));
  }

  assert.ok(scanned > 100, `必须真的扫到 src/ 下的源码（实际 ${scanned} 个文件）`);
  assert.deepEqual(violations, [], [
    '判据 11.2.1 失败：src/ 内出现了跟「运行时语言」走的日期/数字格式化。',
    '处理方式：改走 src/lib/i18n/format.ts 的按 locale 显式格式化（formatDate / formatDateTime /',
    'formatTime / formatMonthShort / formatNumber），locale 从 useLocale()（客户端）或',
    'MESSAGES[await getServerLocale()]（服务端）取 —— **不得**在调用点临时拼 locale。',
    '',
    ...violations.map((v) => `  - ${v}`),
  ].join('\n'));
});

test('扫描器不是空转：三种违规形态都命中，注释与显式传 locale 不误报', () => {
  const mutated = scanSourceForLocaleCalls(
    'src/components/__mutation__.tsx',
    [
      'const a = new Date().toLocaleString();',
      'const b = new Date().toLocaleDateString();',
      'const c = new Date().toLocaleTimeString();',
      'const d = date.toLocaleString("default", { month: "short" });',
      'const e = value.toLocaleString([]);',
      'const f = day.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });',
    ].join('\n'),
  );
  assert.equal(mutated.length, 6, `六种违规形态必须全部命中，实际命中 ${mutated.length} 处：\n${mutated.join('\n')}`);

  // 正确的形态（显式传 locale / 传给 Intl）不得误报
  assert.deepEqual(
    scanSourceForLocaleCalls(
      'src/lib/i18n/format.ts',
      [
        'export const a = (locale) => date.toLocaleDateString(toIntlLocale(locale));',
        'export const b = (locale) => date.toLocaleTimeString(toIntlLocale(locale), { hour: "2-digit" });',
        'export const c = (locale) => value.toLocaleString(toIntlLocale(locale));',
      ].join('\n'),
    ),
    [],
    '显式传 locale 的调用不得被判违规（否则门禁会逼人绕开格式化层）',
  );

  // 注释与字符串不是代码：注释里出现违规写法不得误报，真代码里的同一行必须命中
  const commentAndCode = scanSourceForLocaleCalls(
    'src/components/__comment__.tsx',
    [
      '// 这里原来是 new Date().toLocaleString()，已改走 format.ts',
      '/* date.toLocaleString("default", { month: "short" }) */',
      'const real = `${day.toLocaleDateString()}`;',
    ].join('\n'),
  );
  assert.equal(commentAndCode.length, 1, `注释不得计入（AST 口径），真代码必须命中：${JSON.stringify(commentAndCode)}`);
  assert.match(commentAndCode[0], /:3 /, '命中的应当是第 3 行那条真代码');
});

test('豁免不是漏洞：format.ts 里的每个 toLocale* 调用都显式带了参数', () => {
  const file = 'src/lib/i18n/format.ts';
  const source = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), file), 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LOCALE_METHODS.has(node.expression.name.text)
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(calls.length >= 5, `format.ts 是格式化层，应当有多个显式调用（实际 ${calls.length}）`);
  for (const call of calls) {
    assert.ok(
      call.arguments.length >= 1,
      `format.ts 内的 toLocale* 必须显式传 locale：${call.getText(sourceFile).slice(0, 90)}`,
    );
  }
});

test('locale-switch 的成功 toast 按「切换后」的语言渲染（不再用点击那一帧的 t）', () => {
  // 实际输出（中英两态）—— 这是 acceptance 要求的证据，直接断言纯函数：
  assert.equal(localeChangedToast('zh-CN'), '已切换到「中文」');
  assert.equal(localeChangedToast('en'), 'Switched to English');

  // 反回归：成功 toast 必须走上面那个按 target 取词的函数，不得再用这一帧的 `t(...)`
  // （那就是「中文界面点 EN → 弹出『已切换到「English」』」的中英混排来源）。
  const source = readFileSync(
    join(fileURLToPath(new URL('..', import.meta.url)), 'src/components/locale-switch.tsx'),
    'utf8',
  );
  const successToasts = [...source.matchAll(/toast\.success\(([^)]*)/g)].map((m) => m[1]);
  assert.ok(successToasts.length >= 2, `成功 toast 应有两处（server / local 两档），实际 ${successToasts.length}`);
  for (const call of successToasts) {
    assert.match(call, /localeChangedToast\(/, `成功 toast 必须按 target 语言取词，实际写法：${call}`);
    assert.doesNotMatch(call, /\bt\(/, `成功 toast 不得使用当前帧的 t()：${call}`);
  }
});
