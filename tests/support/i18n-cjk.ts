import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * 覆盖门禁的 **AST 扫描实现**（自包含；U1 / t5）。
 *
 * 口径（与 `docs/research/2026-10-03-i18n-inventory.md` §2 一致，也是契约 §7.1）：
 *   只统计四类节点里含 Han 的 —— `StringLiteral` / `NoSubstitutionTemplateLiteral` /
 *   `TemplateExpression`（head + spans **拼接后**判定，整串算 1 个节点） / `JsxText`；
 *   **注释不计入**。
 *
 * 为什么注释不计入、且门禁不要用 `ts.createScanner` 单独数注释：那个口径在 TS 5.9.3 上
 * 会**静默漏数 45%**（`src/lib/prompts.ts` 甚至整文件失明：scanner=0 而实际 39 条中文注释），
 * 详见盘点文档 §4。本门禁只需要「注释不算文案」这条结论。
 *
 * **本模块刻意不依赖 `.local/`**：`.local/` 是 gitignored 的工作区，脚本不进仓库；
 * 门禁必须自带实现（照盘点文档 §2.4 的复现代码自写）。
 */

/** Han 字符集（与盘点口径逐字符一致）。 */
export const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** 归一化空白：匹配快照与判定都用这个形态，避免重新缩进/换行造成假红。 */
export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export type CjkNodeKind = 'StringLiteral' | 'NoSubstitutionTemplateLiteral' | 'TemplateExpression' | 'JsxText';

export interface CjkNode {
  /** 工作区相对 POSIX 路径。 */
  file: string;
  line: number;
  /** 归一化空白后的字面量文本。 */
  text: string;
  kind: CjkNodeKind;
  /** 该节点是否落在「内部日志位置」：`throw new *Error(...)` 或 `console.*(...)` 的实参内。 */
  internalLog: boolean;
}

/**
 * 这个节点是否位于内部日志位置（谓词豁免要用）。
 *
 * 判定是「**实参子树内**」而不是「直接的实参」：`throw new Error('前缀: ' + error.message)` 里那个
 * 字面量的父节点是二元表达式，只看直接实参会漏掉（本项目里绝大多数日志都是这个形态）。
 * 因此遇到中间节点继续上溯，直到找到「本节点在其 arguments 里」的调用/构造为止：
 *   - 命中 `*Error(...)` / `console.*(...)` ⇒ 是内部日志位置；
 *   - 命中别的调用（如 `NextResponse.json({error})` 的包装函数、`t(...)`）⇒ 继续上溯，
 *     于是「响应体里新增的中文」不会被这一条放行。
 */
function internalLogPosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (
      (ts.isNewExpression(parent) || ts.isCallExpression(parent)) &&
      parent.arguments?.some((argument) => argument === current)
    ) {
      const callee = parent.expression.getText();
      if (ts.isNewExpression(parent) && /Error$/.test(callee)) return true;
      if (ts.isCallExpression(parent) && /^console\.(log|info|warn|error|debug)$/.test(callee)) return true;
    }
    current = parent;
  }
  return false;
}

/** 扫描单个源文件文本，返回其中的中文字面量节点（`file` 用调用方给的名字）。 */
export function scanSource(file: string, source: string): CjkNode[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  const out: CjkNode[] = [];

  const visit = (node: ts.Node) => {
    let raw: string | null = null;
    let nodeKind: CjkNodeKind | null = null;

    if (ts.isStringLiteral(node)) {
      if (HAN.test(node.text)) {
        raw = node.text;
        nodeKind = 'StringLiteral';
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      if (HAN.test(node.text)) {
        raw = node.text;
        nodeKind = 'NoSubstitutionTemplateLiteral';
      }
    } else if (ts.isTemplateExpression(node)) {
      const joined = node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
      if (HAN.test(joined)) {
        raw = joined;
        nodeKind = 'TemplateExpression';
      }
    } else if (node.kind === ts.SyntaxKind.JsxText) {
      const jsxText = (node as ts.JsxText).text;
      if (HAN.test(jsxText)) {
        raw = jsxText;
        nodeKind = 'JsxText';
      }
    }

    if (raw !== null && nodeKind !== null) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      out.push({
        file,
        line: line + 1,
        text: normalize(raw),
        kind: nodeKind,
        internalLog: internalLogPosition(node),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return out;
}

/** 递归列出目录下的 `.ts` / `.tsx`（跳过点目录）。 */
function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : listSources(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

/**
 * 扫描一棵源码树（默认 `src/`），路径统一成工作区相对 POSIX 形式。
 *
 * 扫的是**工作树**（不是已提交树）：门禁必须看到并发任务此刻的改动，
 * 否则「翻译漏了一句」要到 commit 之后才发现（契约 §7.1）。
 */
export function scanTree(rootDir: string): CjkNode[] {
  const workspaceRoot = join(rootDir, '..');
  return listSources(rootDir).flatMap((abs) => {
    const file = relative(workspaceRoot, abs).split(sep).join('/');
    return scanSource(file, readFileSync(abs, 'utf8'));
  });
}
