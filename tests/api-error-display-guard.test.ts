import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

/**
 * **真空转门禁**：产品面不得把服务端下发的 `error` 字段直接上屏（t34 / 契约 §6.6）。
 *
 * 为什么需要它：服务端按设计**只回中文 `error` + 语言无关 `code`**（H4 口径），
 * 英文文案由前端按 `code` 从字典取。于是「把服务端 `error` 直接塞进 toast / setState /
 * `throw new Error(...)` / JSX」就是一条**静默的中文泄漏**——它不会让任何既有测试变红，
 * 只会让英文界面在失败路径上冒出中文。t34 之前全仓有 33 处这种写法、0 处消费 `useApiError()`。
 *
 * 判据（机械、可变异验证）：在**产品面**源码里，凡是「显示汇」（display sink）——
 *   - `toast.error|warning|info(...)`，
 *   - `setXxxError(...)` / `showError(...)` / `setBanner(...)` / `setNotice(...)`，
 *   - `new Error(...)`（throw new / Object.assign(new Error(...)) 都算），
 *   - JSX 表达式容器与 JSX 属性值，
 * 的**实参子树里**出现 `.error` / `?.error` 成员访问，一律违规。
 *
 * 修正方式唯一：把载荷整个交给本地化入口 —— `apiError(data, { fallback: t('…') })`
 * （`useApiError()` 来自 `src/lib/i18n-client.tsx`，规则在纯层 `src/lib/i18n/errors.ts`：
 * 已知 code → 字典；未知 code → 服务端原文；都没有 → fallback / `errors.UNKNOWN`）。
 *
 * 作用域**刻意覆盖整个产品面**（`src/components/**` + `src/app/**`，只排除
 * `src/app/api/**` 服务端路由与 `src/app/admin/**` 管理端），不得为绕过某个文件而缩小。
 *
 * 已知边界（诚实声明，不假装它是定理）：门禁是**一层深**的源码规则 —— 它抓的是
 * 「`error` 字段就在显示汇的实参里」这一形态（包括嵌在 `photoFailureUserCopy(data.error)`
 * 这类包装里）。把服务端串先存进变量、再在别处显示（`const m = data.error; … toast.error(m)`）
 * 抓不到；这种间接写法要靠评审 + `tests/i18n-error-codes.test.ts` 的语义测试。
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** 产品面扫描面：`src/components/**` + `src/app/**`，排除服务端路由与管理端。 */
const EXCLUDED_DIRS = ['src/app/api', 'src/app/admin'];

/** 显示汇的调用：`toast.error|warning|info(...)` 与 `setXxxError(...)` 家族。 */
function isDisplaySinkCall(callee: string): boolean {
  if (/^toast\.(error|warning|info)$/.test(callee)) return true;
  if (/^(show|set)[A-Za-z0-9_]*[Ee]rror[A-Za-z0-9_]*$/.test(callee)) return true;
  return /^(showError|setBanner|setNotice|setInlineError|setFieldError)$/.test(callee);
}

/** 该成员访问是不是「服务端载荷的 error 字段」（`.error` / `?.error`）。 */
function isErrorPropertyAccess(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  return node.name.text === 'error';
}

/**
 * 这次访问是否把 `error` **当值用**（而不是当协议标记比较）。
 *
 * `pricing/page.tsx` 用 `data.error` 承载**机器标记**（`refund_review` / `market_changed` …）
 * 并直接与字面量比较、或用 `switch` 分派 —— 那是协议、不是上屏文本，不该被判违规。
 * 于是：直接作为（不）等号操作数、或 `switch` 判别式的 `.error` 访问一律放行。
 */
function isValueUse(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    const comparison = op === ts.SyntaxKind.EqualsEqualsEqualsToken
      || op === ts.SyntaxKind.ExclamationEqualsEqualsToken
      || op === ts.SyntaxKind.EqualsEqualsToken
      || op === ts.SyntaxKind.ExclamationEqualsToken;
    if (comparison && (parent.left === node || parent.right === node)) return false;
  }
  if (ts.isSwitchStatement(parent) && parent.expression === node) return false;
  return true;
}

export interface Violation {
  file: string;
  line: number;
  sink: string;
  text: string;
}

/** 收集一个文件里的违规点。 */
export function findViolations(file: string, source: string): Violation[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  const out: Violation[] = [];

  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const report = (sink: string, container: ts.Node) => {
    const errorAccesses: ts.Node[] = [];
    const walk = (node: ts.Node) => {
      if (isErrorPropertyAccess(node) && isValueUse(node)) errorAccesses.push(node);
      node.forEachChild(walk);
    };
    walk(container);
    for (const access of errorAccesses) {
      out.push({
        file,
        line: lineOf(access),
        sink,
        text: access.getText(sf).replace(/\s+/g, ' '),
      });
    }
  };

  const visit = (node: ts.Node) => {
    // ① 显示汇调用：实参里不得出现 `.error`。
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (isDisplaySinkCall(callee)) {
        for (const arg of node.arguments) report(`${callee}(…)`, arg);
      }
    }
    // ② `new Error(...)`：抛出的 message 会经 catch → toast 上屏。
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'Error') {
      for (const arg of node.arguments ?? []) report('new Error(…)', arg);
    }
    // ③ JSX 表达式容器就是上屏位置：子节点 `{x.error}` 与属性值 `title={x.error}`
    //    在语法上都是 `JsxExpression`，一处只记一次（属性值不会重复计数）。
    if (ts.isJsxExpression(node) && node.expression) report('JSX {…}', node.expression);
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

function collectProductFiles(root: string): string[] {
  // 作用域**只**是产品面：`src/components/**` 与 `src/app/**`。
  // `src/lib/**` / `src/storage/**` 是库层（例如 Supabase 查询里的 `xxx.error`、信件调度器
  // 的内部日志），不属于「上屏面」，也刻意不在本门禁的判据里。
  const roots = [join(root, 'components'), join(root, 'app')];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(SRC, full).split(/[\\/]/).join('/');
      if (entry.isDirectory()) {
        if (rel === 'app/api' || rel === 'app/admin') continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(rel);
    }
  };
  for (const dir of roots) walk(dir);
  return out;
}

// ── 真实工作树：产品面零违规 ──────────────────────────────────────────────

test('产品面不得把服务端 error 直接上屏（真实工作树）', () => {
  const files = collectProductFiles(SRC).sort();
  assert.ok(files.length > 50, `扫描面应当覆盖整个产品面（实际 ${files.length} 个文件）`);

  const violations: Violation[] = [];
  for (const file of files) {
    const source = readFileSync(join(SRC, file), 'utf8');
    violations.push(...findViolations(file, source));
  }

  assert.deepEqual(
    violations.map((v) => `src/${v.file}:${v.line} [${v.sink}] ${v.text}`),
    [],
    [
      '产品面上屏处不得直接使用服务端下发的 `error`（英文态会漏中文）。',
      '改用本地化入口：`const apiError = useApiError()` 后',
      "  toast.error(apiError(data, { fallback: t('…') }))",
      '（三级回退：已知 code → 字典；未知 code → 服务端原文；都没有 → fallback / errors.UNKNOWN）',
    ].join('\n'),
  );
});

test('作用域覆盖整个产品面：只排除 src/app/api/** 与 src/app/admin/**', () => {
  const files = collectProductFiles(SRC);
  // 服务端路由与管理端必须在面外（它们是 wire 的生产者 / 用户硬约束的不翻面）。
  assert.equal(files.some((f) => f.startsWith('app/api/')), false, 'src/app/api/** 必须在扫描面之外');
  assert.equal(files.some((f) => f.startsWith('app/admin/')), false, 'src/app/admin/** 必须在扫描面之外');
  // 曾经出过 33 处违规的那几个面必须在面内 —— 防止有人靠「把文件挪出扫描面」绕过门禁。
  for (const must of [
    'components/chat/chat-shell.tsx',
    'components/chat/message-input.tsx',
    'components/chat/theme-settings.tsx',
    'components/chat/companion-important-dates.tsx',
    'components/ui/field.tsx',
    'app/onboarding/page.tsx',
    'app/login/login-client.tsx',
  ]) {
    assert.ok(files.includes(must), `${must} 必须在扫描面内（不得缩小门禁范围）`);
  }
});

// ── 变异自证：检测器不是空转 ────────────────────────────────────────────────

test('变异自证：旧的「直接上屏」写法必须被判违规（五种形态）', () => {
  const offenders = [
    "toast.error(data.error ?? t('x'));",
    "setError(data.error ?? t('x'));",
    "throw new Error(data.error ?? t('x'));",
    "throw Object.assign(new Error(error?.error ?? t('x')), { code: 1 });",
    "toast.error(photoFailureUserCopy(payload.error));",
  ];
  for (const source of offenders) {
    const found = findViolations('src/components/__mutation__.tsx', `export function X({ data, error, payload }: any) { ${source} }`);
    assert.ok(found.length >= 1, `必须判违规：${source}`);
  }
  // JSX 与属性值同样是上屏位置
  const jsx = findViolations(
    'src/components/__mutation__.tsx',
    'export function X({ data }: any) { return <p title={data.error}>{data.error}</p>; }',
  );
  assert.equal(jsx.length, 2, 'JSX 表达式容器与属性值各算一处');
});

test('变异自证：走本地化入口的写法一律放行（含三级回退的三种形态）', () => {
  const safe = [
    "toast.error(apiError(data, { fallback: t('x') }));",
    "setError(apiError(data, { fallback: t('x') }));",
    "throw new Error(apiError(data, { fallback: t('x') }));",
    "throw Object.assign(new Error(apiError(data, { fallback: t('x') })), { code: data.code });",
    "toast.error(apiError({ code: photoFailureCode(data?.error) }));".replace('data?.error', 'm.content'),
  ];
  for (const source of safe) {
    const found = findViolations('src/components/__safe__.tsx', `export function X({ data, t, apiError, m }: any) { ${source} }`);
    assert.deepEqual(found, [], `必须放行：${source}`);
  }
});

test('变异自证：只有真实载荷字段才判违规（协议标记比较 / 状态变量不算）', () => {
  // pricing 用 `data.error` 当**机器标记**（值域是 refund_review / market_changed …），
  // 那不是上屏文本；门禁只看显示汇实参，不看比较式。
  const marker = findViolations(
    'src/app/pricing/__probe__.tsx',
    "export function X({ data, setError }: any) { if (data.error === 'market_changed') { setError({ key: 'billing.k' }); } }",
  );
  assert.deepEqual(marker, [], '协议标记比较不得被判违规');
  // 状态变量名叫 error 也不违规（它不是 `.error` 成员访问）。
  const state = findViolations(
    'src/components/__probe__.tsx',
    'export function X({ error }: any) { return <p>{error}</p>; }',
  );
  assert.deepEqual(state, [], '状态变量 error 不是服务端载荷字段');
});
