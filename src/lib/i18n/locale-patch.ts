/**
 * `PATCH /api/visitor` 的 locale 写入判定（契约 §9.3 / U1）。
 *
 * 为什么单独成模块（与 `src/lib/palette-patch.ts` 同样的理由）：Next 16 的**路由类型校验**
 * 要求 `route.ts` 只导出允许的名字（HTTP 方法 + 路由段配置）。把这两个纯函数 `export` 在
 * `src/app/api/visitor/route.ts` 里，在**类型是新生成**的 worktree 里 `pnpm ts-check` 会报
 * `TS2344`；搬到独立模块后 route 只 import，单测也能脱离数据库直接跑它们。
 *
 * 本模块是纯函数：不碰 IO、不碰数据库（与带 IO 的 `@/lib/visitor` 分开）。
 */

import { parseLocale, type Locale } from '@/lib/i18n/locale';

/**
 * PATCH body 里 locale 值的判定结果。
 *
 * `null` 是合法输入（=「未选择」，落库为 NULL）；`undefined` **不是**（区分「不传」与「显式传 null」
 * 由 route 的 `'locale' in body` 分支负责）。
 */
export type LocalePatchDecision = { ok: true; value: Locale | null } | { ok: false };

/**
 * 把 PATCH body 的 locale 值判定为「可落库」或「非法」。
 *
 * 值域恰好 `{null, 'zh-CN', 'en'}`（区分大小写）：`'EN'`、`'en-US'`、`''`、数字、布尔、对象、数组
 * 一律非法 → 由调用方回 400 `INVALID_LOCALE`。值域解析复用 `@/lib/i18n/locale` 的 `parseLocale`，
 * 不在此自算。
 */
export function decideLocalePatchValue(raw: unknown): LocalePatchDecision {
  if (raw === null) return { ok: true, value: null };
  const parsed = parseLocale(raw);
  return parsed === null ? { ok: false } : { ok: true, value: parsed };
}

/**
 * 这个数据库错误是不是「visitors 没有 locale 列」。
 *
 * 迁移 0021 尚未应用的环境里，`select … locale …` 会以 PostgREST 的 schema cache 报错
 * （`PGRST204`）或 Postgres 的 `undefined_column`（`42703`）失败。此时读取降级为 `locale: null`
 * （**可观测**：调用方会 `console.warn`），而不是 500 —— 语言只是偏好，缺列不该打断聊天 boot。
 *
 * 判定刻意收窄：只认「locale 列不存在」，别的列缺失、连接失败等一律不触发降级。
 */
export function isMissingLocaleColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  if (!/locale/i.test(text)) return false;
  if (/could not find the ['"]?locale['"]? column/i.test(text)) return true;
  return code === '42703' && /does not exist/i.test(text);
}
