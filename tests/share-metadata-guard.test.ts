import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import * as brand from '../src/lib/brand-metadata';

/**
 * 门禁：**分享卡字段不得直接引用品牌层的中文卡片常量**（t59，来自 t57 暴露的缺陷形状）。
 *
 * ## 为什么现有覆盖门禁看不见这一类（这条理由不写，后人会以为已经覆盖了）
 *
 * `tests/i18n-coverage.test.ts` 查的是**中文字面量**（AST 里的 `StringLiteral` / `JsxText` / 模板串）。
 * 而这类缺陷的载体是一个**标识符**：`images: [BRAND_SHARE_IMAGE]` —— 页面源码里一个汉字都没有，
 * 中文却经这个常量的 `url`/`alt` **间接上屏**（`og:image`、`og:image:alt`、`twitter:image:alt`）。
 * 对「查字面量」的门禁来说，这种间接引用是**完全不可见**的：它不是「门禁没跑」，而是
 * **这一类形状不在任何判据的扫描面内**。
 *
 * 后果就是 `/love` 一路漏到 `t56` 才被验证层独立取数抓到：它从 t10 起就自带 `openGraph`，
 * 于是按页面分区的元数据工作（t50 / t53 / t54）都把它当「自带块 ⇒ 应该没问题」掠过 ——
 * **「有 `openGraph`」不等于「字段按 locale 取值」**，而它恰恰是唯一写死中文卡片的那页，
 * 且 `/love?lang=en` 是**可分享的英文入口**（英文用户分享出去，卡片上是中文图 + 中文 alt）。
 *
 * ## 本门禁的口径（覆盖式，不枚举页面）
 *
 *   - 候选文件 = `src/app/**` 下**所有**含 metadata 的 `.ts`/`.tsx`（源码里出现
 *     `generateMetadata` 或 `export const metadata`）—— 不写死页面清单，新页面自动纳入；
 *   - **排除**（各带理由，不是漏扫）：
 *       ① `src/app/layout.tsx`：它是**中文态分享块的唯一真源**（未自行声明 `openGraph`/`twitter`
 *          的页靠继承它才逐字符不变），引用中文卡片常量在这里是**正确行为**；
 *       ② `src/app/admin/**` 与 `src/app/qwen-voices/**`：计划里明确的「不翻」范围。
 *       本文件会断言排除集**恰好是这三项**，避免排除项被悄悄放大。
 *   - 判据（对 `openGraph`/`twitter` 里的 `images:` 取值，含局部常量别名展开）：
 *       A. **不得**引用品牌层的分享卡常量（`BRAND_SHARE_IMAGE` / `BRAND_SHARE_IMAGE_EN` 等，
 *          名字从 `src/lib/brand-metadata.ts` 的导出**实时推导**，不写死清单）；
 *       B. **必须**走到按 locale 的入口 `brandShareImage(...)`（直接调用或经局部别名）。
 *
 * 两张卡片的常量名与「按 locale 入口」都是**从品牌层现算**的：品牌层新增一张卡，门禁自动覆盖；
 * 入口函数改名/消失，本门禁会直接红（而不是静默变成空转）。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 工作区相对 POSIX 路径。 */
const rel = (absolute: string) => relative(ROOT, absolute).split(sep).join('/');

/** 品牌层的「分享卡常量」：带 `url` + `alt` 的导出对象（中文卡与英文卡都在内）。 */
const SHARE_CARD_CONSTANTS = Object.entries(brand)
  .filter(([, value]) => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { url?: unknown; alt?: unknown };
    return typeof candidate.url === 'string' && typeof candidate.alt === 'string';
  })
  .map(([name]) => name);

/** 唯一被允许的按 locale 入口。 */
const LOCALE_ENTRY = 'brandShareImage';

/** 排除项（每项都必须在下面的断言里出现，且有理由）。 */
const EXCLUDED: Record<string, string> = {
  'src/app/layout.tsx': '中文态分享块的真源：未声明 openGraph/twitter 的页靠继承它逐字符不变',
  'src/app/admin/': '计划里的「不翻」范围',
  'src/app/qwen-voices/': '计划里的「不翻」范围',
};
const isExcluded = (file: string) =>
  Object.keys(EXCLUDED).some((prefix) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix));

/** 深度优先列出 `src/app/**` 下所有 `.ts`/`.tsx`。 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) return walk(absolute);
    return /\.tsx?$/.test(entry) ? [absolute] : [];
  });
}

const HAS_METADATA = /generateMetadata|export\s+const\s+metadata/;

interface Violation {
  file: string;
  line: number;
  rule: 'A: 直接引用品牌层分享卡常量' | 'B: 没有走到按 locale 的入口';
  detail: string;
}

/** 收集文件里所有 `const X = <expr>`（含函数体内），用于展开局部别名。 */
function constTable(source: ts.SourceFile): Map<string, ts.Expression> {
  const table = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      table.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return table;
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

/** 展开一个节点：收集它引用到的**叶子标识符**与**被调用的函数名**（别名穿透，最多 4 层）。 */
function expand(
  expr: ts.Node,
  table: Map<string, ts.Expression>,
  depth = 0,
): { identifiers: Set<string>; calls: Set<string> } {
  const identifiers = new Set<string>();
  const calls = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text);
      const target = depth < 4 ? table.get(node.text) : undefined;
      if (target) visit(target);
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) calls.add(callee.text);
      ts.forEachChild(node, visit);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expr);
  return { identifiers, calls };
}

/** 找出 `openGraph`/`twitter` 里的 `images:` 取值（分享卡字段）。 */
function shareImageExpressions(source: ts.SourceFile): { expr: ts.Expression; line: number }[] {
  const found: { expr: ts.Expression; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'images') {
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isSourceFile(parent) && !ts.isBlock(parent)) {
        if (ts.isPropertyAssignment(parent)) {
          const owner = propertyName(parent.name);
          if (owner === 'openGraph' || owner === 'twitter') {
            found.push({
              expr: node.initializer,
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            });
            break;
          }
        }
        parent = parent.parent;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function scan(file: string): Violation[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const table = constTable(source);
  return shareImageExpressions(source).flatMap(({ expr, line }) => {
    const { identifiers, calls } = expand(expr, table);
    const violations: Violation[] = [];
    const direct = [...identifiers].filter((name) => SHARE_CARD_CONSTANTS.includes(name));
    if (direct.length) {
      violations.push({
        file,
        line,
        rule: 'A: 直接引用品牌层分享卡常量',
        detail: `images: 取值引用了 ${direct.join(', ')} ⇒ 那张卡是某一语言的死值（中文卡在 en 态会渲染成中文分享卡）`,
      });
    }
    if (!calls.has(LOCALE_ENTRY)) {
      violations.push({
        file,
        line,
        rule: 'B: 没有走到按 locale 的入口',
        detail: `images: 取值没有调用 ${LOCALE_ENTRY}(...)（直接调用或经局部常量别名都算）`,
      });
    }
    return violations;
  });
}

test('门禁自身有效：品牌层确实导出了分享卡常量与按 locale 入口（否则本文件会空转）', () => {
  assert.ok(
    SHARE_CARD_CONSTANTS.includes('BRAND_SHARE_IMAGE'),
    `品牌层应有中文卡常量；实测导出：${SHARE_CARD_CONSTANTS.join(', ')}`,
  );
  assert.ok(
    SHARE_CARD_CONSTANTS.includes('BRAND_SHARE_IMAGE_EN'),
    `品牌层应有英文卡常量；实测导出：${SHARE_CARD_CONSTANTS.join(', ')}`,
  );
  assert.equal(typeof brand.brandShareImage, 'function', '按 locale 入口必须存在');
  // 中文卡的 alt 必须是中文、英文卡的 alt 不得含汉字 —— 上面「哪张是中文卡」的判断依赖这条
  assert.match(brand.BRAND_SHARE_IMAGE.alt, /[\u4e00-\u9fff]/u);
  assert.doesNotMatch(brand.BRAND_SHARE_IMAGE_EN.alt, /[\u4e00-\u9fff]/u);
  assert.equal(brand.brandShareImage('en').url, brand.BRAND_SHARE_IMAGE_EN.url);
  assert.equal(brand.brandShareImage('zh-CN').url, brand.BRAND_SHARE_IMAGE.url);
});

test('src/app/** 的分享卡字段（og/twitter 的 images:）不得直接引用中文品牌常量，必须走 brandShareImage(locale)', () => {
  const all = walk(join(ROOT, 'src/app'));
  const candidates = all.filter((absolute) => HAS_METADATA.test(readFileSync(absolute, 'utf8')));
  const scanned = candidates.map(rel).filter((file) => !isExcluded(file));
  const excluded = candidates.map(rel).filter(isExcluded);

  // 遍历口径：覆盖式（所有含 metadata 的文件），不写死页面清单；排除项只能是已知那三项（不得悄悄放大）
  assert.ok(['src/app/chat/page.tsx','src/app/login/page.tsx','src/app/onboarding/page.tsx'].every(file=>scanned.includes(file)), `必须扫到足够多的页面，实测 ${scanned.length} 个：${scanned.join(', ')}`);
  const known = (file: string) =>
    file === 'src/app/layout.tsx' ? 'src/app/layout.tsx'
      : file.startsWith('src/app/admin/') ? 'src/app/admin/'
        : file.startsWith('src/app/qwen-voices/') ? 'src/app/qwen-voices/' : null;
  const unexpected = excluded.filter((file) => known(file) === null);
  assert.deepEqual(unexpected, [], `出现了已声明之外的排除项：${unexpected.join(', ')}`);
  assert.ok(excluded.includes('src/app/layout.tsx'), '根 layout（中文真源）必须在排除集里');
  assert.ok(excluded.length <= candidates.length, '排除项不得多于候选文件');

  const violations = scanned.flatMap(scan);
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.detail}`),
    [],
    '分享卡字段必须走按 locale 的入口 brandShareImage(locale)',
  );
});

test('正向对照：共享 helper（page-metadata.ts）确实走按 locale 的入口（保证上面的判据不是空转绿）', () => {
  const file = 'src/lib/page-metadata.ts';
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { identifiers, calls } = expand(source, new Map());
  assert.ok(calls.has(LOCALE_ENTRY), '共享分享块 helper 必须调用 brandShareImage');
  for (const name of SHARE_CARD_CONSTANTS) {
    assert.ok(!identifiers.has(name), `共享 helper 不得引用 ${name}（中文卡是 zh 分支的真源，只能经 ${LOCALE_ENTRY} 间接取到）`);
  }
});
