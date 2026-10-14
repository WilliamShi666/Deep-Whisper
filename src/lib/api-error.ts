import { NextResponse } from 'next/server';

import type { ErrorCode } from './i18n/errors';

/**
 * 服务端错误响应的**统一构造器**（契约 §6.2 / §6.6，**所有者：U7 / t8**）。
 *
 * 为什么要有它：契约把「会上屏的失败」统一成**唯一形状** `{ error, code }` ——
 * `error` 是 zh-CN 兜底（逐字符保留既有取值，中文态零变化），`code` 是稳定机器码，
 * 前端按 code 取本地化文案（`localizeApiError`）。散落各处手写这个对象时，
 * 总会有人漏掉 `code`，于是那一处就永远是中文 —— 正是本轮要消灭的「半中半英」。
 *
 * 刻意**不**在这里做 code → 中文兜底的自动查表：`error` 必须逐字符等于改造前的既有取值
 * （H4 硬约束），把它交给调用点显式写出，code 与文案的对应关系一眼可审。
 * 字典覆盖率的证明在 `tests/i18n-messages.test.ts`（按扫描口径断言未映射集合为空）。
 *
 * 本文件零 React、零 DOM；只在 route handler 里使用。
 */

/**
 * 可以出现在 wire 上的 code：字典键里**去掉** §6.4.1 的判别后缀形态
 * （`INVALID_APPEARANCE_STYLE.missing` 这类只是字典内部键，不是 wire code）。
 */
export type ApiErrorCode = Exclude<ErrorCode, `${string}.${string}`>;

/** 失败响应的 body 形状（附加诊断字段如 `diagnosticId` / `message` 原样保留）。 */
export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  [key: string]: unknown;
}

/** 失败 body（给 `new Response(JSON.stringify(...))` 这类需要自己拼装的调用点用）。 */
export function apiErrorBody(
  code: ApiErrorCode,
  error: string,
  extra?: Record<string, unknown>,
): ApiErrorBody {
  return { ...extra, error, code };
}

/**
 * 失败响应（`NextResponse.json` 形态，作用域内绝大多数 route 用它）。
 *
 * 参数顺序与响应体一致（status → code → error），读起来就是 `{ error, code }` + 状态码。
 */
export function apiError(
  status: number,
  code: ApiErrorCode,
  error: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(apiErrorBody(code, error, extra), { status });
}

/** 失败响应（`new Response(JSON.stringify(body))` 形态，仅 `/api/chat` 的早期校验用它）。 */
export function apiErrorResponse(
  status: number,
  code: ApiErrorCode,
  error: string,
  extra?: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(apiErrorBody(code, error, extra)), { status });
}
