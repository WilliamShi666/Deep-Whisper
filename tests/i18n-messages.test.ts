import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

import { MESSAGES, placeholders, translate, zhCN, en, type MessageKey } from '../src/lib/i18n/messages';
import { deleteConversationNotice } from '../src/lib/memory/forget-notice';

/**
 * 字典契约（U1 / t5，契约 §2）。
 *
 * 这里既跑**运行时**口径（key 双向对齐、无空串、占位符集合一致），也钉住**文件级**结构
 * （zh-CN / en 两侧文件名集合相同、7 个 area 一个不缺）。
 *
 * 类型级约束（en 侧 `Record<keyof typeof zh, string>`）由 `pnpm ts-check` 负责：
 * 少一条 key 报 TS2739、多一条报 TS2353 —— 不在这里重复实现。
 */

const AREAS = ['core', 'chat', 'entry', 'legal', 'email', 'server', 'errors'] as const;
type Area = (typeof AREAS)[number];

/** 含 CJK 即视为「没翻」：中文态允许，英文态一律不允许。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 普通 area 的 key 规则（契约 §2.2）：小写 + 点分层级，2–3 段。 */
const PLAIN_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,2}$/;

/**
 * errors area 的 key 规则（契约 §2.2 的例外 + §6.4/§6.4.1/§6.5）：
 * `errors.<CODE>`，或带一个判别后缀的 `errors.<CODE>.<suffix>`。
 * CODE 是大写下划线机器码（逐字符等于契约 §6.4 表的 code），suffix 只允许契约列出的判别值。
 *
 * 例外 = 契约 §6.5 冻结的 4 个**既有小写** code（`reply_limit` / `opening_limit` /
 * `opening_exists` / `conversation_busy`）：它们既是 wire 上的 `error` 又是 `code`
 * （`chat-shell.tsx` 已在消费 `code === 'reply_limit'`），字典键名逐字符等于该 token，
 * 不得改写成 `QUOTA_*`。只放行这四个字面量，其余小写 token 仍然违规。
 */
const LEGACY_LOWERCASE_CODE = /^(reply_limit|opening_limit|opening_exists|conversation_busy)$/;
// 判别后缀取自契约 §6.4.1 / §6.4.2（`brief` 是 t37 为 INTERNAL_ERROR 的一码两文加的那一条）。
const ERROR_KEY = /^[A-Z][A-Z0-9_]*(\.(letters|photo|tts|tts_preview|read_then_save|retry_later|missing|invalid|brief))?$/;

test('7 个 area 的 zh-CN / en 文件对全部存在且文件名集合相同', () => {
  const zhFiles = readdirSync(new URL('../src/lib/i18n/messages/zh-CN/', import.meta.url))
    .filter((name) => name.endsWith('.ts'))
    .sort();
  const enFiles = readdirSync(new URL('../src/lib/i18n/messages/en/', import.meta.url))
    .filter((name) => name.endsWith('.ts'))
    .sort();

  assert.deepEqual(zhFiles, enFiles, 'zh-CN 与 en 的文件名集合必须完全一致');
  assert.deepEqual(zhFiles, [...AREAS].map((area) => `${area}.ts`).sort());
  assert.deepEqual(zhFiles, [...AREAS].map((area) => `${area}.ts`).sort());
});

test('中英 key 双向完全对齐（无缺无余）', () => {
  for (const area of AREAS) {
    const zhKeys = Object.keys(zhCN[area] as Record<string, string>).sort();
    const enKeys = Object.keys(en[area] as Record<string, string>).sort();
    assert.deepEqual(enKeys, zhKeys, `area=${area} 的 en key 集合必须与 zh 相同`);
  }
});

/**
 * 单条文案的空白规则（**不是**契约 §2.4 的原文，是 t5 自加、队长 2026-10-03 裁定的 v2 口径）。
 *
 * 为什么不能用「不得带首尾空白」一刀切：有两类**合法片段**必须自带空白，而且空白与语言有关 ——
 *   - 拼接后缀：`dates.yearly_suffix = ' · 每年'`（中文用「 · 」，英文用 " · "，首部空格是语义）；
 *   - 分隔符：`oauth.blocked.separator = '; '`（英文是分号 + 半角空格，中文是「；」不带空格）。
 * 一刀切会把语言差异挤回代码（`parts.join(`${sep} `)`），恰好是字典化要消灭的东西。
 *
 * 因此判据从「禁止哪一侧的空白」改成「**空白必须由 key 末段声明的角色放行**」：
 *   1. `trim()` 后必须非空（纯空白值仍然违规）；
 *   2. 首部空白仅当 key 末段匹配 `/(^|_)suffix$/` 时允许；
 *   3. 尾部空白仅当 key 末段匹配 `/(^|_)separator$/` 时允许；
 *   4. 其余任何首尾空白一律违规（普通键两侧的隐形空白笔误防护没有丢）。
 *
 * 抽成函数是为了能做反向验证：下面「变异自证」用例逐条证明五种违规真的会红。
 */
const SUFFIX_SEGMENT = /(^|_)suffix$/;
const SEPARATOR_SEGMENT = /(^|_)separator$/;

function lastSegmentOf(key: string): string {
  return key.slice(key.lastIndexOf('.') + 1);
}

function assertMessageWhitespace(area: string, key: string, value: unknown): void {
  assert.equal(typeof value, 'string', `${area}.${key} 必须是字符串`);
  const text = value as string;
  assert.ok(text.trim().length > 0, `${area}.${key} 不得为空串或纯空白`);

  const segment = lastSegmentOf(key);
  // 末段声明了角色才放行对应一侧的空白；声明的是 suffix 就**不能**吃尾部空白（反之亦然）。
  if (!SUFFIX_SEGMENT.test(segment)) {
    assert.equal(text, text.trimStart(), `${area}.${key} 不得带首部空白（需要拼接的后缀片段请把 key 末段写成 _suffix）`);
  }
  if (!SEPARATOR_SEGMENT.test(segment)) {
    assert.equal(text, text.trimEnd(), `${area}.${key} 不得带尾部空白（分隔符请把 key 末段写成 _separator）`);
  }
}

test('每条文案都非空、无未配对占位符、空白规则符合 §2.4 的裁定口径（v2）', () => {
  for (const area of AREAS) {
    for (const [key, value] of Object.entries(zhCN[area] as Record<string, string>)) {
      assertMessageWhitespace(area, key, value);

      const all = placeholders(value);
      const closed = [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].length;
      const opened = (value.match(/\{/g) ?? []).length;
      const closedBraces = (value.match(/\}/g) ?? []).length;
      assert.equal(opened, closedBraces, `${area}.${key} 的花括号必须成对`);
      assert.equal(all.length, closed, `${area}.${key} 不得出现非法占位符形态`);
    }
  }

  for (const area of AREAS) {
    for (const [key, value] of Object.entries(en[area] as Record<string, string>)) {
      assertMessageWhitespace(`en.${area}`, key, value);
    }
  }
});

test('变异自证：五种空白违规都必须变红，两个合法片段必须放行', () => {
  // ① 纯空白值 → 红
  assert.throws(() => assertMessageWhitespace('core', 'common.save', '   '), /不得为空串或纯空白/);
  // ② 普通键尾部带空格 → 红
  assert.throws(() => assertMessageWhitespace('core', 'foo.label', 'x '), /不得带尾部空白/);
  // ③ 普通键首部带空格 → 红
  assert.throws(() => assertMessageWhitespace('core', 'foo.label', ' x'), /不得带首部空白/);
  // ④ 末段是 suffix 却带尾部空格 → 红（声明的是哪一种角色就只放行那一侧）
  assert.throws(() => assertMessageWhitespace('core', 'dates.yearly_suffix', ' · 每年 '), /不得带尾部空白/);
  // ⑤ 末段是 separator 却带首部空格 → 红
  assert.throws(() => assertMessageWhitespace('core', 'oauth.blocked.separator', ' ;'), /不得带首部空白/);
  // ⑥ 合法后缀片段（首部空格是语义）→ 放行
  assertMessageWhitespace('core', 'dates.yearly_suffix', ' · 每年');
  // ⑦ 合法分隔符（尾部空格是语义）→ 放行
  assertMessageWhitespace('core', 'oauth.blocked.separator', '; ');
  // ⑧ 非字符串 → 红
  assert.throws(() => assertMessageWhitespace('core', 'common.save', 42), /必须是字符串/);
});


test('同 key 的中英占位符集合必须一致', () => {
  for (const area of AREAS) {
    const zhTable = zhCN[area] as Record<string, string>;
    const enTable = en[area] as Record<string, string>;
    for (const key of Object.keys(zhTable)) {
      const zhNames = [...new Set(placeholders(zhTable[key]))].sort();
      const enNames = [...new Set(placeholders(enTable[key]))].sort();
      assert.deepEqual(enNames, zhNames, `${area}.${key} 的中英占位符集合必须相同`);
    }
  }
});

test('key 命名符合规则（普通 area 小写点分层级；errors area 用 code 形态）', () => {
  for (const area of AREAS) {
    for (const key of Object.keys(zhCN[area] as Record<string, string>)) {
      if (area === 'errors') {
        assert.ok(
          LEGACY_LOWERCASE_CODE.test(key) || ERROR_KEY.test(key),
          `errors key 必须是 <CODE>[.<判别后缀>] 形态（或 §6.5 冻结的 4 个 legacy 小写 code）：${key}`,
        );
      } else {
        assert.match(key, PLAIN_KEY, `${area}.${key} 不符合 key 规则`);
      }
    }
  }
});

test('translate：插值、缺 key 兜底、缺变量不把占位符漏到界面', () => {
  assert.equal(translate(MESSAGES['zh-CN'], 'core.locale.changed', { name: 'English' }), '已切换到「English」');
  assert.equal(translate(MESSAGES['en'], 'core.locale.changed', { name: '中文' }), 'Switched to 中文');
  assert.equal(translate(MESSAGES['zh-CN'], 'core.locale.switch', { name: 'English' }), '切换到 English');
  assert.equal(translate(MESSAGES['en'], 'core.locale.switch', { name: '中文' }), 'Switch to 中文');

  // 缺变量：渲染成空串（不得把 {name} 原样漏出去）
  assert.equal(translate(MESSAGES['zh-CN'], 'core.locale.changed'), '已切换到「」');

  // 无占位符的键不受影响
  assert.equal(translate(MESSAGES['zh-CN'], 'core.common.save'), '保存');
  assert.equal(translate(MESSAGES['en'], 'core.common.save'), 'Save');

  // 运行期兜底：不在字典里的 key 回显 key 本身（类型上不该发生，防的是运行期脏数据）
  const missing = 'core.nope.missing' as MessageKey;
  assert.equal(translate(MESSAGES['zh-CN'], missing), missing);
});

test('core 字典由本任务实际写入，且语言开关用到的两条文案在两种语言下都存在', () => {
  const zhCore = zhCN.core as Record<string, string>;
  const enCore = en.core as Record<string, string>;
  for (const key of ['locale.switch', 'locale.changed', 'locale.switch_failed']) {
    assert.ok(zhCore[key], `core.${key} 必须存在（zh）`);
    assert.ok(enCore[key], `core.${key} 必须存在（en）`);
  }
  assert.deepEqual([...new Set(placeholders(zhCore['locale.switch']))], ['name']);
  assert.deepEqual([...new Set(placeholders(enCore['locale.changed']))], ['name']);
});

/**
 * t61：删除会话的**用户可见**文案必须按 locale 取字典。
 *
 * 缺陷原形：`src/lib/memory/forget-notice.ts` 的三条中文 message 经
 * `chat-shell.tsx` 的 `toast.warning/success(notice.message)` 直接上屏，
 * 于是 en 界面删会话会看到中文（t51 曾按陈旧的「界面文案待翻」标签判为「合法保留」）。
 * 这条断言**非空转**：把任一条改回硬编码中文，en 侧就会出现 CJK ⇒ 变红。
 */
test('删除会话的用户可见文案按 locale 取词：en 零 CJK、zh 逐字符不变，且上屏点传了 locale（t61）', () => {
  const cases: Array<[string, Parameters<typeof deleteConversationNotice>[0]]> = [
    ['cleared', { status: 'cleared', deleted: 3, failed: 0 }],
    ['disabled', { status: 'disabled', deleted: 0, failed: 0 }],
    ['字段缺失（旧服务端）', undefined],
    ['partial', { status: 'partial', deleted: 2, failed: 1 }],
    ['unavailable', { status: 'unavailable', deleted: 0, failed: 1 }],
  ];
  for (const [name, report] of cases) {
    const zh = deleteConversationNotice(report, 'zh-CN');
    const en = deleteConversationNotice(report, 'en');
    assert.ok(zh.message.trim().length > 0 && en.message.trim().length > 0, `${name}: 两侧都不得为空`);
    assert.doesNotMatch(en.message, CJK, `${name}: en 文案不得含 CJK（实际 ${JSON.stringify(en.message)}）`);
    assert.match(zh.message, CJK, `${name}: zh 文案仍应是中文`);
  }

  // zh 三条与改造前的字面量逐字符相同（含 partial 的插值与空格）。
  assert.equal(deleteConversationNotice({ status: 'cleared', deleted: 3, failed: 0 }, 'zh-CN').message, '已删除这段回忆');
  assert.equal(deleteConversationNotice({ status: 'unavailable', deleted: 0, failed: 1 }, 'zh-CN').message, '对话已删除，但长期记忆是否清理干净无法确认');
  assert.equal(deleteConversationNotice({ status: 'partial', deleted: 2, failed: 1 }, 'zh-CN').message, '对话已删除，但有 1 条长期记忆没清理掉');
  // 计数插值两种语言都要带出来。
  assert.match(deleteConversationNotice({ status: 'partial', deleted: 0, failed: 7 }, 'en').message, /7/);

  // 上屏点必须显式传 locale —— 缺省是 zh-CN，漏传就会让 en 界面回落中文。
  assert.match(
    read('src/components/chat/chat-shell.tsx'),
    /deleteConversationNotice\(payload\?\.forget, locale\)/,
    'chat-shell 的删除路径必须把当前 locale 传给 deleteConversationNotice',
  );
});

test('字典模块是纯数据：不 import React / next，也不读浏览器或文件', () => {
  const code = read('src/lib/i18n/messages/index.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const token of ["from 'react'", "from 'next/", 'window', 'document', 'readFileSync']) {
    assert.equal(code.includes(token), false, `字典聚合模块不得出现 ${token}`);
  }
});
