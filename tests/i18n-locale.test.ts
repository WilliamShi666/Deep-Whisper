import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import {
  DEFAULT_LOCALE,
  HTML_LANG,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  LOCALE_VALUES,
  isLocale,
  localeBadge,
  localeSelfName,
  nextLocale,
  parseLocale,
  resolveLocale,
  type Locale,
} from '../src/lib/i18n/locale';
import { readStoredLocale } from '../src/lib/i18n-client';
import type { DisplayLocale } from '../src/lib/character-display';

/**
 * 纯层 / 边界契约（U1 / t5，契约 §1、§3、§4、§10.2）。
 *
 * 这里不连数据库、不渲染 React：值域与优先级是**纯函数**，边界是**源码形态**，
 * 两者都能离线断言。源码断言前先剥注释（本仓传统），避免注释让断言假绿。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------- 编译期类型等价（契约 §10.2） */

/**
 * 双向可赋值 ⇒ `Locale` 与 `src/lib/character-display.ts` 的 `DisplayLocale` 成员集合相同。
 * 任一方向漂移（多一个成员、少一个成员、改名），`pnpm ts-check` 立刻红。
 * 刻意**不改** `character-display.ts`：显示层保持零 i18n 依赖，等价性由这里钉住。
 */
const _localeFromDisplay: Locale = null as unknown as DisplayLocale;
const _displayFromLocale: DisplayLocale = null as unknown as Locale;
void _localeFromDisplay;
void _displayFromLocale;

test('Locale 值域恰好两个，逐字符且顺序固定', () => {
  assert.deepEqual([...LOCALE_VALUES], ['zh-CN', 'en']);
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.equal(DEFAULT_LOCALE, LOCALE_VALUES[0]);
  assert.equal(LOCALE_STORAGE_KEY, 'vl_locale');
  assert.equal(LOCALE_COOKIE, 'vl_locale');
  assert.equal(LOCALE_COOKIE_MAX_AGE, 31536000);
  assert.deepEqual({ ...HTML_LANG }, { 'zh-CN': 'zh-CN', en: 'en' });
});

test('parseLocale：值域之外的一切都回落 null，且从不抛', () => {
  const cases: Array<[unknown, Locale | null]> = [
    ['zh-CN', 'zh-CN'],
    ['en', 'en'],
    ['EN', null],
    ['en-US', null],
    ['zh', null],
    ['zh-cn', null],
    ['zh_CN', null],
    ['zh-CN ', null],
    ['', null],
    ['pink', null],
    [0, null],
    [1, null],
    [Number.NaN, null],
    [true, null],
    [false, null],
    [{}, null],
    [{ locale: 'en' }, null],
    [['en'], null],
    [new Date(), null],
    [null, null],
    [undefined, null],
  ];

  for (const [input, expected] of cases) {
    assert.doesNotThrow(() => parseLocale(input), `parseLocale(${String(input)}) 不得抛`);
    assert.equal(parseLocale(input), expected, `parseLocale(${JSON.stringify(input)})`);
  }
});

test('resolveLocale：访客档案 > 设备镜像 > 默认；非法值不短路下一级', () => {
  assert.equal(resolveLocale('en', 'zh-CN'), 'en');
  assert.equal(resolveLocale(null, 'en'), 'en');
  assert.equal(resolveLocale(undefined, undefined), 'zh-CN');
  // 非法档案值不得短路本地选择（palette 同口径）
  assert.equal(resolveLocale('en-US', 'en'), 'en');
  assert.equal(resolveLocale('EN', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale('', 'en'), 'en');
  assert.equal(resolveLocale({}, 'en'), 'en');
  assert.equal(resolveLocale([], 'en'), 'en');
  assert.equal(resolveLocale(42, 'en'), 'en');
  // 非法设备值同样不短路（回落默认）
  assert.equal(resolveLocale('en', 'en-US'), 'en');
  assert.equal(resolveLocale(null, 'EN'), 'zh-CN');
  assert.equal(resolveLocale(null, ''), 'zh-CN');
  // 返回值永不为 null
  assert.equal(typeof resolveLocale(null, null), 'string');
});

test('nextLocale / localeSelfName / localeBadge 的取值逐字符', () => {
  assert.equal(nextLocale('en'), 'zh-CN');
  assert.equal(nextLocale('zh-CN'), 'en');
  assert.equal(nextLocale(null), 'en');
  assert.equal(nextLocale('en-US'), 'en');

  assert.equal(localeSelfName('zh-CN'), '中文');
  assert.equal(localeSelfName('en'), 'English');
  assert.equal(localeBadge('zh-CN'), '中文');
  assert.equal(localeBadge('en'), 'EN');

  assert.equal(isLocale('zh-CN'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('en-US'), false);
});

test('readStoredLocale 在没有浏览器环境时不抛、返回 null', () => {
  // 单测跑在 node 里（没有 window）：这一档是 SSR/首帧路径，必须是 null 而不是异常。
  assert.equal(typeof window, 'undefined');
  assert.equal(readStoredLocale(), null);
});

/* --------------------------------------------------------------- 源码形态守卫 */

test('纯层零 React / 零 DOM / 零 IO', () => {
  const code = stripComments(read('src/lib/i18n/locale.ts'));
  for (const token of ['useState', 'useEffect', 'useClient', 'window', 'document', 'fetch(', 'localStorage', 'next/headers', "from 'react'"]) {
    assert.equal(code.includes(token), false, `纯层不得出现 ${token}`);
  }
  assert.equal(/^import /m.test(code), false, '纯层不得 import 任何模块');
});

test('server locale reads explicit cookie before the personal browser default',()=>{
 const code=stripComments(read('src/lib/i18n-server.ts'));
 assert.match(code,/import 'server-only'/);
 assert.match(code,/cookies\(\)/);
 assert.match(code,/LOCALE_COOKIE/);
 assert.match(code,/personalDefaultLocale/);
 assert.match(code,/accept-language/);
 assert.doesNotMatch(code,/i18n-client|\.set\(/);
});

test('客户端边界导出契约要求的五个名字，且带 use client', () => {
  const code = stripComments(read('src/lib/i18n-client.tsx'));
  assert.match(code, /^'use client';$/m);
  assert.match(code, /export function LocaleProvider\(/);
  assert.match(code, /export function useLocale\(\): LocaleContextValue/);
  assert.match(code, /export function useT\(\): \(key: MessageKey, vars\?: TranslateVars\) => string/);
  assert.match(code, /export async function saveLocale\(value: Locale\): Promise<void>/);
  assert.match(code, /export function writeLocale\(value: Locale\): void/);
  assert.match(code, /export function readStoredLocale\(\): Locale \| null/);
  assert.match(code, /import \{ apiFetch \} from '@\/lib\/api';/, '写库必须走 apiFetch');
});

test('saveLocale 是非乐观写：PATCH 失败时不写设备镜像', () => {
  const code = stripComments(read('src/lib/i18n-client.tsx'));
  const start = code.indexOf('export async function saveLocale');
  const end = code.indexOf('export interface LocaleContextValue');
  assert.ok(start >= 0 && end > start, 'saveLocale 必须存在且在 LocaleContextValue 之前');
  const body = code.slice(start, end);

  const patchIndex = body.indexOf("apiFetch('/api/visitor'");
  const okCheck = body.search(/if \(!response\.ok\)/);
  const writeIndex = body.indexOf('writeLocale(value)');
  assert.ok(patchIndex >= 0, '必须 PATCH /api/visitor');
  assert.ok(okCheck >= 0, '必须先判 response.ok');
  assert.ok(writeIndex > okCheck, 'writeLocale 必须排在失败判断之后（非乐观）');
});

test('服务端 route 不得 import 客户端边界', () => {
  const apiRoot = new URL('../src/app/api/', import.meta.url);
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = stripComments(readFileSync(child, 'utf8'));
      if (/from '@\/lib\/i18n-client'/.test(source)) offenders.push(child.pathname);
    }
  };
  walk(apiRoot);
  assert.deepEqual(offenders, [], 'i18n-client 是浏览器边界（apiFetch + React），route 不得 import');
});

test('layout 包住 LocaleProvider，且保持静态 lang="zh-CN"（不读 cookie）', () => {
  const code = stripComments(read('src/app/layout.tsx'));
  assert.match(code, /<html lang="zh-CN" className="dark">/, 'lang 首帧必须是静态字面量');
  assert.match(code, /<LocaleProvider>/);
  assert.match(code, /<\/LocaleProvider>/);
  assert.equal(code.includes('i18n-server'), false, 'layout 不得读 cookie（否则整站转动态渲染）');
  assert.equal(code.includes('getServerLocale'), false, 'layout 不得调用 getServerLocale');

  // 顺序：LocaleProvider 在 SupabaseConfigProvider 之外（它只依赖浏览器存储与访客档案）。
  assert.ok(code.indexOf('<LocaleProvider>') < code.indexOf('<AuthProvider>'));
});

test('语言开关：testid / data-locale-value / 两档 persist / 不渲染 palette-toggle', () => {
  const code = stripComments(read('src/components/locale-switch.tsx'));
  assert.match(code, /data-testid="locale-switch"/);
  assert.equal((code.match(/data-testid="locale-switch"/g) ?? []).length, 1, 'testid 只允许渲染一处');
  assert.match(code, /data-locale-value=\{next\}/);
  assert.match(code, /persist\?: 'server' \| 'local'/);
  assert.match(code, /localeBadge\(next\)/);
  assert.match(code, /localeSelfName\(next\)/);
  assert.match(code, /disabled=\{busy\}/);
  // 与 palette 的 DOM 约定解耦：不渲染 palette-toggle、不改它的任何属性
  assert.equal(code.includes('palette-toggle'), false);
  assert.equal(code.includes('data-palette-value'), false);
  assert.equal(code.includes('transition-all'), false, '焦点环不得被过渡（palette 踩过的坑）');
});
