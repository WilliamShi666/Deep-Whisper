import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * `time-zone-sync.tsx` 的**注释—实现一致性**门禁（t63 / 用户 2026-10-04 点名）。
 *
 * 背景：该文件头注释声明了一条不变量 ——「副作用定义：该调用永不抛（**失败只记日志**）」，
 * 而实现是 `.catch(() => undefined)`：既不上屏也不记日志，把 `ensureVisitorIdentity()` 的
 * **业务失败**静默吞掉 ⇒ 成文的不变量没有兑现（`i18n-core` 实测发现，t62 登记为「本轮不修」）。
 *
 * 口径是**修实现去满足注释**，不是改注释迁就实现 —— 后者等于删掉不变量。
 * 本测试把这条不变量钉住：catch 处理器必须记日志、日志文案必须 ASCII（覆盖门禁会拦中文）、
 * 且对外行为不变（仍不抛、不阻塞渲染）。
 *
 * 注意**不要顺手扩大**：`chat-shell.tsx:515/:1224`、`lib/storage/approved-upload.ts:111`、
 * `lib/profile/communication-prefs.ts:269` 的 `.catch(() => undefined)` 是 `reader.cancel()`
 * 之类的**收尾**、不吞业务失败，性质不同（按性质区分，不按模式批量改）。
 */

const SOURCE = readFileSync(
  new URL('../src/components/time-zone-sync.tsx', import.meta.url),
  'utf8',
);

/**
 * 去掉注释后的代码文本：本文件的注释里**故意引用了**被修掉的那段写法
 * （`.catch(() => undefined)`），直接对整份源码做正则会被自己的注释命中。
 * 说明口径与覆盖门禁一致：**注释不计**。
 */
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

test('头注释声明「永不抛、失败只记日志」这条不变量仍在（改注释迁就实现即违规）', () => {
  assert.match(
    SOURCE,
    /副作用定义：该调用永不抛（失败只记日志）/,
    '注释里的不变量不得被删掉或改弱（改注释迁就实现＝删不变量）',
  );
});

test('访客身份探测失败的 catch 必须记日志，不得静默吞错（t63）', () => {
  // ① 不得回到静默吞错的写法。
  assert.doesNotMatch(
    CODE,
    /\.catch\(\s*\(\s*\)\s*=>\s*(?:undefined|void 0|\{\s*\})\s*\)/,
    '不得用空 catch 处理器吞掉 ensureVisitorIdentity() 的业务失败（必须记日志）',
  );

  // ② 该链上的 catch 处理器必须带 console.* 记录（非空实现）。
  const handler = /\.catch\(\(error: unknown\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/.exec(CODE);
  assert.ok(handler, '必须存在带错误参数的 catch 处理器（本文件里唯一那条身份探测链）');
  const body = handler[1]!;
  assert.match(body, /console\.(?:warn|error|info)\(/, 'catch 处理器必须真的记日志');

  // ③ 日志文案必须是 ASCII —— 覆盖门禁（Han 扫描）会拦中文字面量（t43 已实测）。
  const copy = /console\.(?:warn|error|info)\(\s*'([^']*)'/.exec(body)?.[1];
  assert.equal(typeof copy, 'string', '日志文案必须是一个字符串字面量（便于钉住 ASCII 口径）');
  assert.doesNotMatch(copy!, CJK, `日志文案不得含 CJK（实际 ${JSON.stringify(copy)}）`);
  assert.ok(copy!.trim().length > 0, '日志文案不得为空串');

  // ④ 对外行为不变：处理器不得抛（仍不产生未处理的 rejection）。
  assert.doesNotMatch(body, /\bthrow\b/, 'catch 处理器不得抛 —— 头注释的不变量是「永不抛」');

  // ⑤ 仍然是 `void` 掉的（不阻塞渲染、不把 promise 抛给调用方）。
  assert.match(CODE, /void ensureVisitorIdentity\(\)/, '该调用仍须是 void 掉的副作用');
});

test('该不变量只在本组件兑现，不越界改同族的收尾型 catch（t63 边界）', () => {
  // 本文件里不应出现第二处 catch（改动必须局限在这一条链上）。
  assert.equal(
    (CODE.match(/\.catch\(/g) ?? []).length,
    1,
    'time-zone-sync.tsx 只应有一条 .catch（本任务只修它）',
  );
});
