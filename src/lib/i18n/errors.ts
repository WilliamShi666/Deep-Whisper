import { type Locale } from './locale';
import { MESSAGES, translate, type MessageKey } from './messages';
import { errors as zhErrors } from './messages/zh-CN/errors';

/**
 * 服务端错误 wire → 本地化文案的**唯一映射层**（契约 §6.6，**所有者：U7 / t8**）。
 *
 * 放在纯层而不是 `i18n-client.tsx`：服务端、单测与客户端都要用同一份规则 ——
 * 各写一份必然漂移（中文态就会开始半中半英，正是这一轮要解决的问题）。
 * 本文件零 React / 零 DOM / 零 IO。
 */

export interface LocalizeOptions {
  /** 无 code 且服务端 `error` 为空时的最后兜底（调用点的通用文案）。 */
  fallback?: string;
  /** 会员族分因（§6.4.2）：`errors.MEMBERSHIP_REQUIRED.<feature>`。 */
  feature?: 'letters'|'photo'|'tts'|'tts_preview';
  /** `PROFILE_CONFLICT` 分因（§6.4.1）。 */
  conflict?: 'read_then_save' | 'retry_later';
  /**
   * 分因字段（§6.4.1）：
   *   - `INVALID_APPEARANCE_STYLE` → `'missing'` / `'invalid'`（缺比例 / 比例非法）；
   *   - `INTERNAL_ERROR` → `'brief'`（短文案「服务器开了小差」；其余站点用通用长文案）。
   */
  detail?: 'missing' | 'invalid' | 'brief';
  /** 占位符取值（如 `UNKNOWN_FIELD` 的 `{ field }`）。 */
  vars?: Record<string, string | number>;
}

/**
 * 字典里存在的全部错误键：契约 §6.4 / §6.5 的 code，外加 §6.4.1 的判别后缀形态
 * （`INVALID_APPEARANCE_STYLE.missing` 等，它们**不是** wire code，只是字典键）。
 *
 * 类型源就是 zh 字典本身 —— 新增一条 code 忘了写进联合类型这种事因此不可能发生。
 */
export type ErrorCode = keyof typeof zhErrors;

/**
 * 作用域内的全部错误键（运行时形态）。
 *
 * 从字典**推导**而不是手写一份清单：手写清单会与字典漂移，
 * 而「字典覆盖 code 表全部条目」正是本任务的验收之一。
 */
export const ERROR_CODES: readonly ErrorCode[] = Object.freeze(
  Object.keys(zhErrors) as ErrorCode[],
);

/** 类型守卫：这个字符串是不是已知的错误键（大小写敏感，`reply_limit` 这类小写 legacy code 也认）。 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(zhErrors, value);
}

/** 一个 code 是否带 §6.4.1 的判别后缀形态（用于 `errorMessageKey` 的分因拼装）。 */
type SuffixedCode =
  | 'PROFILE_CONFLICT'
  | 'INVALID_APPEARANCE_STYLE'
  | 'INTERNAL_ERROR';

function isSuffixedCode(code: ErrorCode): code is SuffixedCode {
  return (
    code === 'PROFILE_CONFLICT'
    || code === 'INVALID_APPEARANCE_STYLE'
    || code === 'INTERNAL_ERROR'
  );
}

/**
 * payload → 字典 key（判据 6.6.1 的前两步）。拿不到已知 code 时返回 `null`，
 * 由 `localizeApiError` 走「服务端原文 → 通用兜底」的后两级。
 *
 * §6.4.4：调用点没给出判别字段时**回落该 code 的通用 key**（`errors.<CODE>`），
 * 不抛错、也不把 `{feature}` 之类的模板原样漏到界面。
 */
export function errorMessageKey(payload: unknown, options?: LocalizeOptions): MessageKey | null {
  if (!payload || typeof payload !== 'object') return null;
  const code = (payload as { code?: unknown }).code;
  if (!isErrorCode(code)) return null;

  const suffix = isSuffixedCode(code)
    ? code === 'PROFILE_CONFLICT'
        ? options?.conflict
        : options?.detail
    : undefined;

  if (!suffix) {
    // §6.4.4：调用点没给判别字段 → 该 code 的**通用 key**。
    return `errors.${code}` as MessageKey;
  }

  const suffixedKey = `errors.${code}.${suffix}`;
  // **存在性守卫（U7 / t43）**：判别字段的**值域与 code 不匹配**时（例如把 `detail: 'missing'`
  // 打到 `INTERNAL_ERROR`、把 `detail: 'brief'` 打到 `INVALID_APPEARANCE_STYLE`），拼出来的 key
  // 在字典里**并不存在** —— 一旦直接把它交给 `translate`，缺 key 兜底会把**这串 key 当文案返回**，
  // 界面就会显示 `errors.INTERNAL_ERROR.missing` 这种内部键名（本轮已三次判过「界面渲染 key 名」）。
  //
  // 守卫放在**中央拼接点**，因此 `detail` / `conflict` / `feature` 三族一次覆盖 ——
  // 不给某一族打特例（`detail` 被两个 code 共用：INVALID_APPEARANCE_STYLE 用 'missing'、
  // INTERNAL_ERROR 用 'brief'，跨 code 错配是固有风险）。
  //
  // 缺键是**配置问题**，必须可见：保留一条等价日志（字典里本来就缺这个后缀 key）。
  if (!Object.prototype.hasOwnProperty.call(zhErrors, `${code}.${suffix}`)) {
    // 日志本身用 ASCII：本模块不在覆盖门禁的 internal-log 文件白名单里，而为了打一行日志把整个
    // 模块加进白名单，会让该文件里日后的**任何**中文字面量都被静默放行 —— 宁可这行日志不写中文。
    console.warn(`[i18n] missing dictionary key: ${suffixedKey}`
      + ` (discriminator ${JSON.stringify(suffix)} does not belong to code ${code}) -> falling back to errors.${code}`);
    return `errors.${code}` as MessageKey;
  }

  return suffixedKey as MessageKey;
}

/** 服务端回包里的 `error` 字符串（非空的才算）。 */
function serverErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as { error?: unknown }).error;
  return typeof error === 'string' && error.length > 0 ? error : null;
}

/**
 * **三级回退**（判据 6.6.1，顺序固定，不得调换）：
 *   ① 已知 code → 字典文案（带 §6.4.1/§6.4.2 的分因）；
 *   ② 未知 code / 无 code → 服务端 `error` 原文（它已经是 zh-CN 兜底）；
 *   ③ 两者都没有 → `options.fallback`，再没有 → `errors.UNKNOWN`。
 *
 * 永不抛、永不返回空串（判据 6.6.3）。
 */
export function localizeApiError(locale: Locale, payload: unknown, options?: LocalizeOptions): string {
  const key = errorMessageKey(payload, options);
  if (key) return translate(MESSAGES[locale], key, options?.vars);
  return serverErrorMessage(payload) ?? options?.fallback ?? translate(MESSAGES[locale], 'errors.UNKNOWN');
}
