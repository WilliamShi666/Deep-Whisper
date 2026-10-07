import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HAN, scanSource, scanTree, type CjkNode } from './support/i18n-cjk';
import {
  FROZEN_ZH_LITERALS,
  NODE_ALLOWLIST,
  WHOLE_FILE_ALLOWLIST,
  allowReason,
} from './support/i18n-whitelist';

/**
 * **覆盖门禁**：英文态不许出现中文（U1 / t5，契约 §7）。
 *
 * 这是本轮唯一的防漏翻回归网，因此它必须满足三条：
 *
 *   1. **自算基线**：内部自行扫描**工作树**得出结论。测试里**不得**写任何历史盘点数字
 *      （111 / 114 / 115 / 1219 / 1887 / 2234 / 25161 / 26407 / 475 / 930 / 1678）当阈值或期望值 ——
 *      并发任务持续改工作树（盘点期间含中文字面量的文件数就从 115 漂到 114），写死数字等于埋一个
 *      会随机变红的门禁。本文件对所有字面量数字零引用（只看白名单之外的命中集合是否为空）。
 *   2. **自包含**：不 import / 不 spawn `.local/`（那是 gitignored 的工作区，脚本不进仓库）；
 *      AST 扫描实现住在 `tests/support/i18n-cjk.ts`。
 *   3. **不空转**：下面的变异自证用例证明「新的中文字面量一定会被判违规」——
 *      包括加在**快照里已有文件的**新字面量（评审会往 `src/components` 里塞中文做同样验证）。
 *
 * 口径：四类节点（StringLiteral / NoSubstitutionTemplateLiteral / TemplateExpression / JsxText）
 * 里的 Han；**注释不计**。
 */

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

function describeViolation(node: CjkNode): string {
  return `${node.file}:${node.line} [${node.kind}] ${JSON.stringify(node.text)}`;
}

/** 工作树扫描一次，多个用例共用（扫描本身是纯读）。 */
const scanned = scanTree(SRC_DIR);

test('src/ 中不存在白名单之外的中文字面量', () => {
  const violations = scanned.filter((node) => allowReason(node) === null);

  assert.deepEqual(
    violations.map(describeViolation),
    [],
    [
      '覆盖门禁失败：下列中文字面量不在任何白名单里。',
      '处理方式二选一（不要放宽白名单来绕）：',
      '  a) 把它搬进字典（src/lib/i18n/messages/{zh-CN,en}/<area>.ts）并用 t() 渲染；',
      '  b) 若它确实该保留中文（服务端响应兜底 / 内部日志 / zh 数据源），在 tests/support/i18n-whitelist.ts 里',
      '     按类（① 整文件豁免 / ② 内容谓词豁免）加条目并写明理由 —— 只有「文件目的本身就是中文」才允许 ①。',
      '',
      ...violations.map((node) => `  - ${describeViolation(node)}`),
    ].join('\n'),
  );
});

test('扫描器不是空转：真实工作树 + 合成样本都能命中', () => {
  // 真实树：此刻 src/ 里必然存在中文字面量（翻译是后续任务的事）。
  assert.ok(scanned.length > 0, '真实工作树应当至少命中一个中文字面量');
  assert.ok(scanned.every((node) => HAN.test(node.text)), '命中项必须真的含 Han');

  // 合成样本：四类节点各自都要被抓到（防止某天重构把某类节点的判定删掉）。
  const synthetic = scanSource(
    'src/components/__synthetic__.tsx',
    [
      "const a = '中文一';",
      'const b = `中文二`;',
      'const c = `前缀${a}中文三`;',
      'export function X() { return <p>中文四</p>; }',
      '// 中文注释必须**不**计入',
      '/* 中文块注释同样不计入 */',
    ].join('\n'),
  );

  assert.deepEqual(
    synthetic.map((node) => node.kind).sort(),
    ['JsxText', 'NoSubstitutionTemplateLiteral', 'StringLiteral', 'TemplateExpression'],
  );
  assert.equal(synthetic.length, 4, '注释不得计入文案节点');
});

test('变异自证：新加的中文字面量必须被判违规（含加在已有文件的场景）', () => {
  // 1) 全新文件（评审的典型手法）：非白名单路径 + 新字面量 ⇒ 必须违规。
  const freshFile = scanSource('src/components/__mutation__.tsx', "export const x = '这是一句新中文';");
  assert.equal(freshFile.length, 1);
  assert.equal(allowReason(freshFile[0]), null, '新文件里的新中文必须违规');

  // 2) 快照里**已有**中文的文件：新增一条快照里没有的字面量 ⇒ 同样必须违规。
  const frozenFile = Object.keys(FROZEN_ZH_LITERALS)[0];
  assert.ok(frozenFile, '快照不为空');
  const mutated = scanSource(frozenFile, "export const injected = '这句中文不在快照里';");
  assert.equal(mutated.length, 1);
  assert.equal(allowReason(mutated[0]), null, '快照文件里的**新**中文必须违规');

  // 3) 快照里已冻结的字面量 ⇒ 放行（否则门禁现在就红）。
  const frozenText = FROZEN_ZH_LITERALS[frozenFile][0];
  const known = scanSource(frozenFile, `export const known = ${JSON.stringify(frozenText)};`);
  assert.equal(known.length, 1);
  assert.match(allowReason(known[0]) ?? '', /^③快照冻结/);
});

test('白名单条目都必须写明理由（防止白名单被静默放宽）', () => {
  for (const entry of WHOLE_FILE_ALLOWLIST) {
    assert.ok(entry.reason.trim().length > 0, `① 条目缺理由：${entry.pattern}`);
  }
  for (const entry of NODE_ALLOWLIST) {
    assert.ok(entry.reason.trim().length > 0, `② 条目缺理由：${entry.pattern}`);
    assert.equal(typeof entry.allows, 'function', `② 条目必须是谓词：${entry.pattern}`);
  }
});

test('② 内容条件豁免只放行设计内的位置', () => {
  // locale.ts：只放行语言自称字面量，别的中文一律违规。
  const localeSelf = scanSource('src/lib/i18n/locale.ts', "export const n = '中文';");
  assert.equal(localeSelf.length, 1);
  assert.match(allowReason(localeSelf[0]) ?? '', /^②内容条件豁免/);

  const localeLeak = scanSource('src/lib/i18n/locale.ts', "export const leak = '这句话不该出现在纯层';");
  assert.equal(allowReason(localeLeak[0]), null, '纯层里的非自称中文必须违规');

  // internal-log：throw/console 实参放行，返回给客户端的 error 文案违规。
  const internal = scanSource('src/lib/visitor.ts', "throw new Error('查询访客失败: x');");
  assert.equal(internal.length, 1);
  assert.match(allowReason(internal[0]) ?? '', /^②内容条件豁免/);

  const leaked = scanSource('src/lib/visitor.ts', "export const response = { error: '访客不存在' };");
  assert.equal(allowReason(leaked[0]), null, '内部日志文件里新增的上屏文案必须违规');
});

test('快照条目结构合法：文件路径 + 逐字面量文本', () => {
  for (const [file, literals] of Object.entries(FROZEN_ZH_LITERALS)) {
    assert.match(file, /^src\/.+\.tsx?$/, `快照键必须是工作区相对的 src 路径：${file}`);
    assert.ok(literals.length > 0, `快照条目不得为空：${file}`);
    for (const text of literals) {
      assert.ok(HAN.test(text), `快照文本必须含 Han：${file} ${JSON.stringify(text)}`);
      assert.equal(text, text.replace(/\s+/g, ' ').trim(), `快照文本必须归一化空白：${JSON.stringify(text)}`);
    }
  }
});
