import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { decidePalettePatchValue, isMissingPaletteColumnError } from '../src/lib/palette-patch';
import { parsePalettePreference, resolvePalettePreference } from '../src/lib/palette';

/**
 * 访客级「红蓝风格」偏好（palette）的落库契约（契约 t9 / 队内 t4）。
 *
 * 这里不连数据库：值域判定与降级判定是**纯函数**（`decidePalettePatchValue` /
 * `isMissingPaletteColumnError`，t94 起住在 `@/lib/palette-patch`，route 只 import —— 见下方耐久守卫），
 * 单测直接跑它们；结构契约（两处 select 含 palette、单一写入口、schema/迁移/types 对齐）沿用本项目的
 * 源码文本断言传统 —— 扫之前先剥注释，避免注释让断言假绿。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const route = stripComments(read('src/app/api/visitor/route.ts'));
/** t94：两个纯函数 + 类型搬到这里；route 只 import。 */
const patchModule = stripComments(read('src/lib/palette-patch.ts'));

/** 取 POST / PATCH 之间的片段，用来证明「创建档案不写 palette」。 */
function section(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `${from} must exist`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `${to} must follow ${from}`);
  return source.slice(start, end);
}

test('PATCH accepts exactly {rose, blue, null} and rejects everything else', () => {
  assert.deepEqual(decidePalettePatchValue('rose'), { ok: true, value: 'rose' });
  assert.deepEqual(decidePalettePatchValue('blue'), { ok: true, value: 'blue' });
  assert.deepEqual(decidePalettePatchValue(null), { ok: true, value: null });

  for (const invalid of ['', 'ROSE', 'Blue', 'pink', '蓝', 'rose ', 0, 1, true, false, {}, [], undefined]) {
    assert.deepEqual(
      decidePalettePatchValue(invalid),
      { ok: false },
      `${JSON.stringify(invalid)} must be rejected`,
    );
  }

  // 关键区分：显式 null = 「清除回未选择」（合法），undefined 之类都不是。
  assert.notDeepEqual(decidePalettePatchValue(null), decidePalettePatchValue(undefined));
});


test('palette preference resolution: profile wins, illegal profile falls through to storage', () => {
  assert.equal(resolvePalettePreference('blue', 'rose'), 'blue');
  assert.equal(resolvePalettePreference(null, 'rose'), 'rose');
  assert.equal(resolvePalettePreference(undefined, undefined), null);
  assert.equal(resolvePalettePreference('pink', 'rose'), 'rose');
  assert.equal(resolvePalettePreference('ROSE', null), null);
  assert.equal(parsePalettePreference('rose'), 'rose');
  assert.equal(parsePalettePreference('blue'), 'blue');
  assert.equal(parsePalettePreference(null), null);
});


test('type layer exposes palette on VisitorDTO', () => {
  const types = read('src/lib/types.ts');
  const dto = types.slice(types.indexOf('export interface VisitorDTO'), types.indexOf('export interface AuthInfo'));
  assert.match(dto, /palette: string \| null;/);
});


test('the visitor route is the only palette writer under src/app/api', () => {
  const apiRoot = new URL('../src/app/api', import.meta.url).pathname;
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.ts') && !full.endsWith('.tsx')) continue;
      if (readFileSync(full, 'utf8').includes('palette') && !full.endsWith('/api/visitor/route.ts')) {
        offenders.push(full.slice(apiRoot.length));
      }
    }
  };
  walk(apiRoot);

  assert.deepEqual(offenders, [], 'palette 的写入口必须唯一：api/visitor/route.ts');
});

/**
 * 耐久守卫（t94）：route 文件**只允许导出 Next 认得的名字** —— HTTP 方法 + 路由段配置。
 *
 * 起因：Next 16 的**路由类型校验**（机器生成的 `.next/dev/types/app/**\/route.ts`）用索引签名约束
 * route 模块的导出；t4 当年把 `decidePalettePatchValue` / `isMissingPaletteColumnError` 直接
 * `export` 在 `/api/visitor/route.ts` 里 ⇒ 在**类型是新生成**的 worktree 里 `pnpm ts-check` 报
 * `TS2344: Property 'decidePalettePatchValue' is incompatible with index signature`。
 * 本 worktree 的 `.next/dev/types` 是旧产物、结构上抓不到这个错（又一次「陈旧产物造成的假绿」），
 * 所以用这条**源码文本断言**当护栏：下一次有人往 route 里塞纯函数，这里立刻红。
 *
 * 类型导出（`export type` / `interface`）类型擦除、不会触发 Next 报错，但本仓口径要求一并搬走；
 * 违规信息里会区分「值导出（会被 Next 打红）」与「类型导出（仅本仓口径）」。
 */
const ALLOWED_ROUTE_EXPORTS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'runtime', 'dynamic', 'dynamicParams', 'revalidate', 'fetchCache',
  'preferredRegion', 'maxDuration', 'config', 'generateStaticParams',
]);

/** 按行解析 `^export`（先剥注释），返回导出名与类别；`type` / `interface` 视为类型导出。 */
function routeExportNames(source: string): Array<{ name: string; kind: 'value' | 'type' }> {
  const out: Array<{ name: string; kind: 'value' | 'type' }> = [];
  for (const rawLine of stripComments(source).split('\n')) {
    const matched = /^export\s+(?:default\s+)?(?:async\s+)?(const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/.exec(rawLine.trim());
    if (!matched) continue;
    const [, keyword, name] = matched;
    out.push({ name, kind: keyword === 'type' || keyword === 'interface' ? 'type' : 'value' });
  }
  return out;
}

/** 断言 route 源码的导出名全部落在允许清单内；失败信息点名违规导出并标注后果。 */
function assertRouteExportsAllowed(source: string): void {
  const offenders = routeExportNames(source).filter((entry) => !ALLOWED_ROUTE_EXPORTS.has(entry.name));
  assert.deepEqual(
    offenders,
    [],
    offenders.length === 0
      ? ''
      : 'route 只允许导出 HTTP 方法与路由段配置；违规导出：'
        + offenders
          .map((entry) => `${entry.name}（${entry.kind === 'value' ? '值导出 ⇒ Next 路由类型校验会打红 ts-check' : '类型导出 ⇒ 仅本仓口径要求搬走'}）`)
          .join('、'),
  );
}


test('visitor route exports only names Next allows (HTTP methods + route segment config)', () => {
  // ① 真实 route：导出名必须全在允许清单内
  assertRouteExportsAllowed(read('src/app/api/visitor/route.ts'));

  // ② 守卫自我取证（防「守卫永远绿」）：把两个纯函数 + 类型塞回去的源码必须被点名拒绝
  const withPureFunctionsExported = [
    "export const runtime = 'nodejs';",
    "export const dynamic = 'force-dynamic';",
    'export type PalettePatchDecision = { ok: true; value: string } | { ok: false };',
    'export function decidePalettePatchValue(raw: unknown): PalettePatchDecision { return { ok: false }; }',
    'export function isMissingPaletteColumnError(error: unknown): boolean { return false; }',
    'export async function PATCH(request: NextRequest) { return NextResponse.json({}); }',
  ].join('\n');
  let message = '';
  try {
    assertRouteExportsAllowed(withPureFunctionsExported);
  } catch (error) {
    message = (error as Error).message;
  }
  assert.ok(message, '守卫必须拒绝「把纯函数塞回 route」的源码');
  for (const name of ['decidePalettePatchValue', 'isMissingPaletteColumnError', 'PalettePatchDecision']) {
    assert.ok(message.includes(name), `违规信息必须点名 ${name}：${message}`);
  }
  assert.ok(message.includes('值导出'), '必须标注值导出的后果（Next 会打红）');

  // ③ 反假红：只有允许项的源码不得被误判
  assertRouteExportsAllowed("export const runtime = 'nodejs';\nexport async function GET() {}\n");
});
