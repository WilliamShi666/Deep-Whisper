import { chat as zhChat } from './zh-CN/chat';
import { core as zhCore } from './zh-CN/core';
import { email as zhEmail } from './zh-CN/email';
import { entry as zhEntry } from './zh-CN/entry';
import { errors as zhErrors } from './zh-CN/errors';
import { legal as zhLegal } from './zh-CN/legal';
import { server as zhServer } from './zh-CN/server';
import { chat as enChat } from './en/chat';
import { core as enCore } from './en/core';
import { email as enEmail } from './en/email';
import { entry as enEntry } from './en/entry';
import { errors as enErrors } from './en/errors';
import { legal as enLegal } from './en/legal';
import { server as enServer } from './en/server';
import type { Locale } from '../locale';

/**
 * 字典的**唯一聚合入口**（contract §2.3.2）。
 *
 * 设计要点：
 *   1. 每个 area 文件是**扁平对象**（键名自带点分层级），本文件只做聚合与类型推导 ——
 *      某个 area 文件里新增一条 key，`MessageKey` 与 en 侧的 `Record<...>` 约束**自动跟随**，
 *      不需要改本文件（只有「新增一个 area 文件」才需要在这里加两行 import 与两个字段）。
 *   2. zh 侧是 `as const`（字面量类型 = key 集合的类型源）；en 侧每个 area 用
 *      `Record<keyof typeof zh<Area>, string>` 约束（缺/多 key 都在 ts-check 红）。
 *   3. `Messages` 刻意**不是**字面量类型：en 的字符串不可能等于 zh 的字面量，
 *      因此它按「area → Record<该 area 的 key, string>」映射成形。
 */
export const zhCN = {
  core: zhCore,
  chat: zhChat,
  entry: zhEntry,
  legal: zhLegal,
  email: zhEmail,
  server: zhServer,
  errors: zhErrors,
} as const;

export const en = {
  core: enCore,
  chat: enChat,
  entry: enEntry,
  legal: enLegal,
  email: enEmail,
  server: enServer,
  errors: enErrors,
} as const;

/** 字典的形状（area → 该 area 的 key → 文案）。 */
export type Messages = {
  [Area in keyof typeof zhCN]: Record<keyof (typeof zhCN)[Area] & string, string>;
};

/** 全量 key 联合：`<area>.<area 内的 key>`（area 内的 key 可再含点，如 `errors.MEMBERSHIP_REQUIRED.letters`）。 */
export type MessageKey = {
  [Area in keyof typeof zhCN]: `${Area & string}.${keyof (typeof zhCN)[Area] & string}`;
}[keyof typeof zhCN];

/** 两种语言的完整字典。 */
export const MESSAGES: Readonly<Record<Locale, Messages>> = {
  'zh-CN': zhCN,
  en,
};

/** 模板里的占位符名集合（`{name}` 形态）。 */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]);
}

/**
 * 取名（不含插值）：area 段之后的剩余部分就是该 area 文件里的**扁平键**（可含点），
 * 因此 `errors.MEMBERSHIP_REQUIRED.letters` 这类三段 key 与 `core.common.save` 同一条路径解析。
 */
function lookup(messages: Messages, key: string): string | undefined {
  const separator = key.indexOf('.');
  if (separator < 0) return undefined;
  const area = key.slice(0, separator);
  const rest = key.slice(separator + 1);
  const table = (messages as unknown as Record<string, Record<string, string> | undefined>)[area];
  if (!table) return undefined;
  return typeof table[rest] === 'string' ? table[rest] : undefined;
}

/** 替换 `{name}` 占位符；缺变量渲染空串并留痕（不把 `{name}` 原样漏到界面上）。 */
function interpolate(template: string, values: Record<string, string | number> | undefined): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
    const value = values?.[name];
    if (value === undefined) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] 缺少占位符取值: {${name}} @ ${template}`);
      }
      return '';
    }
    return String(value);
  });
}

/**
 * 取名 + 插值。**纯函数**：客户端 Provider 与测试共用（不碰任何环境）。
 *
 * 找不到 key（类型上不可能，运行时兜底）时开发期告警并回显 key 本身 —— 比渲染空白更好排障。
 */
export function translate(
  messages: Messages,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const template = lookup(messages, key);
  if (template === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[i18n] 字典缺少 key: ${key}`);
    }
    return key;
  }
  return interpolate(template, values);
}
