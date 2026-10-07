import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { decideLocalePatchValue } from '../src/lib/i18n/locale-patch';

/**
 * 访客级**界面语言偏好**的落库契约（U1 / t5，契约 §9.1–§9.3、§13.3）。
 *
 * 与 `tests/palette-preference.test.ts` 同构：值域判定与降级判定是**纯函数**（单测直接跑），
 * 结构契约（两处 select 含 locale、迁移文本、schema/types 对齐、e2e 夹具钉语言）沿用本项目的
 * 源码文本断言传统 —— 扫之前先剥注释，避免注释让断言假绿。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/**
 * 允许自行处理语言的 spec —— **文件级白名单，恰好一项**。
 *
 * 口径（契约 §13.3）：语言夹具由 `playwright.config.ts` 的 `use.storageState` 对**全部** spec 统一钉住，
 * 所以 spec 不得自己设置 `vl_locale`；**唯一例外**是契约 §13.3 点名的 `e2e/locale-switch.spec.ts` ——
 * 它的职责恰恰是断言「点一下之后语言生效」（`<html lang>` / localStorage / cookie 三处都变），
 * 必然要引用语言存储。
 *
 * 因此这里用的是**文件名精确相等**，不是 `name.includes('locale')`（会误放行 `locale-*` 之外的同名技巧）
 * 也不是 `endsWith('.spec.ts')`（那等于把断言改成空转）。要加第二项，必须先改契约 §13.3。
 */


/** 「这个 spec 在处理语言」的口径：字面量 `vl_locale`，或从纯层 import 的键名常量。 */


function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('decideLocalePatchValue 只接受 {zh-CN, en, null}', () => {
  assert.deepEqual(decideLocalePatchValue('zh-CN'), { ok: true, value: 'zh-CN' });
  assert.deepEqual(decideLocalePatchValue('en'), { ok: true, value: 'en' });
  assert.deepEqual(decideLocalePatchValue(null), { ok: true, value: null });

  const rejected: unknown[] = ['EN', 'en-US', 'zh', 'zh-cn', '', 'pink', 0, 1, true, false, {}, [], new Date(), undefined];
  for (const raw of rejected) {
    assert.deepEqual(decideLocalePatchValue(raw), { ok: false }, `decideLocalePatchValue(${String(raw)}) 必须非法`);
  }
});


test('VisitorDTO 增加 locale: string | null，其余字段不变', () => {
  const types = read('src/lib/types.ts');
  const start = types.indexOf('export interface VisitorDTO {');
  const end = types.indexOf('}', start);
  const block = types.slice(start, end);

  assert.match(block, /locale: string \| null;/);
  for (const field of [
    'id: string;',
    'gender: string | null;',
    'orientation: string | null;',
    'nickname: string | null;',
    'theme_id: string | null;',
    'ui_theme: string | null;',
    'palette: string | null;',
    'auth_user_id: string | null;',
    'created_at: string;',
  ]) {
    assert.ok(block.includes(field), `VisitorDTO 既有字段被改动了：${field}`);
  }
});


test('visitor route 只导出 Next 认得的名字（纯函数必须住在外面的模块）', () => {
  const ALLOWED = new Set([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
    'runtime', 'dynamic', 'dynamicParams', 'revalidate', 'fetchCache',
    'preferredRegion', 'maxDuration', 'config', 'generateStaticParams',
  ]);
  const source = stripComments(read('src/app/api/visitor/route.ts'));
  const exports = [...source.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm)]
    .map((match) => match[1]);
  const offenders = exports.filter((name) => !ALLOWED.has(name));
  assert.deepEqual(offenders, [], `route 不得导出纯函数/类型：${offenders.join('、')}`);
});


test('i18n 内核三件套的 import 方向正确（纯层 ← 边界；route 只碰纯层）', () => {
  const client = stripComments(read('src/lib/i18n-client.tsx'));
  const server = stripComments(read('src/lib/i18n-server.ts'));
  const patch = stripComments(read('src/lib/i18n/locale-patch.ts'));

  assert.match(client, /from '@\/lib\/i18n\/locale'/);
  assert.equal(client.includes('i18n-server'), false, '客户端边界不得 import 服务端边界');

  assert.match(server, /from '\.\/i18n\/locale'/);
  assert.equal(server.includes('i18n-client'), false, '服务端边界不得 import 客户端边界');

  assert.match(patch, /from '@\/lib\/i18n\/locale'/);
  assert.equal(patch.includes('i18n-client'), false, 'route 侧纯函数不得 import 客户端边界');
  assert.equal(patch.includes('react'), false, 'route 侧纯函数不得 import React');
});

/**
 * t47：`/love` 上「客户端不得翻掉服务端已定的语言」，但**只钉真信号**、且 URL 覆盖不落进设备镜像。
 *
 * 背景（两个方向的缺陷都要挡住）：
 *   - t36 的 high（F1）：无 cookie 时 `getServerLocale()` 返回 `DEFAULT_LOCALE`，把它当 `profileLocale`
 *     传进去 = 把「没有偏好」当成「偏好是中文」插到链首 ⇒ 这里必须仍然传 `undefined`；
 *   - t47：`/love` 的正文由 `getLandingCopy(locale)` 在渲染期固定，客户端若用 localStorage 里那份
 *     陈旧镜像把语言翻掉，就会「正文中文 / lang 英文 / 镜像被改写」（A 态）；而 `?lang=en` 又是
 *     渲染期覆盖、不是持久偏好（旧行为会把镜像与 cookie 都写成 en）。
 *
 * 下面钉住三个落地口径（都是源码级，因为这两处是 React 内部解析链、离线单测进不去）：
 */

test('页面声明的语言由 Provider 判真假：真信号压过镜像、裸默认值不压（t47 + t36 F1 同时成立）', () => {
  const client = stripComments(read('src/lib/i18n-client.tsx'));
  /**
   * 判定：`initialLocale`（契约定义 = 「`getServerLocale()` 或 `/love?lang=en`」）是真信号 ⟺
   * 等于客户端看得见的那份 cookie（服务端正是解析它得到的）**或**本身不是默认值（`?lang=en` 覆盖）。
   * 否则（= DEFAULT 且无 cookie）说明服务端没有任何信号 —— 不能当声明，否则重演 t36 的 high 缺陷。
   */
  assert.match(
    client,
    /const declared =\s*\n?\s*pageLocale !== null && \(pageLocale === cookie \|\| \(pageLocale !== DEFAULT_LOCALE && pageLocale !== geoDefault\)\)/,
    '真假判定：cookie 副本 / 既非默认值、也非地理默认（t67）才算声明',
  );
  assert.match(client, /const deviceLocale = declared \?\? stored \?\? cookie \?\? pageLocale;/, '真声明压过设备镜像');
});


test('url 覆盖不落进设备镜像；页面级 Provider 独占设备镜像的写', () => {
  const client = stripComments(read('src/lib/i18n-client.tsx'));
  // ① 页面声明只在本设备上已是同一个值时才写回 —— `?lang=en` 是渲染期覆盖，不得静默变成持久偏好（§9.4）。
  assert.match(client, /const backedByDevice = stored === resolved \|\| cookie === resolved;/);
  // t67：地理默认**只是默认值** —— 解析若完全来自它，就一个字都不许写进设备镜像。
  assert.match(
    client,
    /const fromGeoDefaultOnly =\s*\n?\s*declared === null && stored === null && cookie === null && profile === null && resolved === geoDefault;/,
    '地理默认绝不当真实值（不得写进设备镜像）',
  );
  assert.match(
    client,
    /if \(ownsDeviceWrite && !fromGeoDefaultOnly && \(declared === null \|\| backedByDevice\)\) writeLocale\(resolved\);/,
    '声明未落在设备上、或结果完全来自地理默认时不写回',
  );
  // t67：链的顺序不变，末端换成地理默认（`resolveLocale` 的第三个参数）。
  assert.match(
    client,
    /const resolved = resolveLocale\(profile, deviceLocale, geoDefault\);/,
    '链尾必须是地理默认（链顺序仍是 档案 > 设备镜像 > 默认）',
  );
  // ② 页面级 Provider（pageLocale 非空）独占设备镜像的写 —— 否则根 Provider 会按默认值写 zh-CN，
  //    而页面正渲染着 `?lang=en` 的英文（t47 的 C 态实测）。
  assert.match(
    client,
    /const ownsDeviceWrite = inherited\.owner \? pageLocale !== null : !pageClaim\.page;/,
    '页面级 Provider 必须独占设备镜像的写权',
  );
  assert.match(client, /if \(pageLocale !== null\) pageClaim\.page = true;/, '页面级 Provider 一挂载就接管');
});
