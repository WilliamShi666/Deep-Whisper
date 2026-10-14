/**
 * `PATCH /api/visitor` 的 palette 写入判定（契约 t9 / 队内 t4；**t94 从 route 搬出**）。
 *
 * 为什么单独成模块：Next 16 的**路由类型校验**要求 `route.ts` 只导出允许的名字（HTTP 方法 +
 * 路由段配置）。当初把这两个纯函数直接 `export` 在 `src/app/api/visitor/route.ts` 里，在**类型是
 * 新生成**的 worktree 里 `pnpm ts-check` 会报
 * `TS2344: Property 'decidePalettePatchValue' is incompatible with index signature`
 * —— 而本 worktree 的 `.next/dev/types` 是旧产物、结构上抓不到（又一次「陈旧产物造成的假绿」）。
 * 搬到这里之后：route 只 import，单测仍可脱离数据库直接跑它们；
 * `tests/palette-preference.test.ts` 另有一条**耐久守卫**，断言 route 的导出名只落在允许清单内。
 *
 * 本模块是纯函数，不碰 IO / 不碰数据库（与 `@/lib/visitor` 那种带 IO 的模块分开）。
 */

import { parsePalettePreference, type PalettePreference } from '@/lib/palette';

/**
 * PATCH body 里 palette 值的判定结果。
 *
 * 单独放在这里（而不是 route 里）以便脱离数据库做单测。
 */
export type PalettePatchDecision = { ok: true; value: PalettePreference } | { ok: false };

/**
 * 把 PATCH body 的 palette 值判定为「可落库」或「非法」。
 *
 * 值域恰好 `{null, 'rose', 'blue'}`（区分大小写），其余一切（`''`、`'ROSE'`、`'pink'`、
 * 数字、布尔、对象、数组、`undefined`）都是非法 → 由调用方回 400 `INVALID_PALETTE`。
 *
 * 与 `ui_theme` 的关键差别：这里**没有**「默认值折叠成 NULL」这一步 ——
 * `'rose'`/`'blue'` 原样落库，`null` 落 NULL（`null` 是真实的「未选择」，不是别名）。
 * 值域解析复用 `@/lib/palette` 的 `parsePalettePreference`，不在此自算。
 */
export function decidePalettePatchValue(raw: unknown): PalettePatchDecision {
  if (raw === null) return { ok: true, value: null };
  const parsed = parsePalettePreference(raw);
  return parsed === null ? { ok: false } : { ok: true, value: parsed };
}

/**
 * 这个数据库错误是不是「visitors 没有 palette 列」。
 *
 * 迁移 0014 尚未应用的环境里，`select … palette …` 会以 PostgREST 的 schema cache
 * 报错（`PGRST204`）或 Postgres 的 `undefined_column`（`42703`）失败。此时读取降级为
 * `palette: null`（**可观测**：调用方会 `console.warn`），而不是 500 —— palette 只是
 * 样式偏好，缺列不该打断聊天 boot。
 *
 * 判定刻意收窄：只认「palette 列不存在」，别的列缺失、连接失败等一律不触发降级。
 */
export function isMissingPaletteColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  if (!/palette/i.test(text)) return false;
  if (/could not find the ['"]?palette['"]? column/i.test(text)) return true;
  return code === '42703' && /does not exist/i.test(text);
}
