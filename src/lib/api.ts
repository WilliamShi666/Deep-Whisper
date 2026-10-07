'use client';

/** Personal owner identity mirror and same-origin request helpers. */

import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, parseLocale, type Locale } from './i18n/locale';
import { MESSAGES, translate, type MessageKey } from './i18n/messages';

const STORAGE_KEY = 'vl_visitor_id';

let cachedId: string | null = null;
let initPromise: Promise<string> | null = null;
let identityGeneration = 0;

// ── 身份类错误的稳定 code + 本地化（t58 / F2） ────────────────────────────────
//
// 这三条原先写成中文字面量并直接 `throw new Error(中文)`，而上屏点普遍是
// `toast.error(e.message)` / `setError(e.message)`（onboarding 的 start()、chat-shell 的
// 音色/流式/开场白/反馈/删除/重发、palette-switch、主题/性格/语音弹窗）—— 于是**英文界面里
// 冒出中文**。修法沿用服务端那一套「稳定 code + 上屏点按 code 本地化」：
//   - 抛出的 Error 带 `i18nKey`（字典 key，见 `core.identity.*`），上屏点用 `errorCopy()` 取词；
//   - `message` 仍填**当前界面语言**的字典文案，好让所有未改造的上屏点（以及日志）自动正确。
// 没有引入第二套映射：文案只有一个来源，即字典。

/** 身份类错误的稳定 code（= 字典 key；跨语言不变）。 */
export const IDENTITY_ERROR_KEY = {
  changed: 'core.identity.changed',
  changedRetry: 'core.identity.changed_retry',
  probeFailed: 'core.identity.probe_failed',
} as const satisfies Record<string, MessageKey>;

/** 带字典 key 的 Error（上屏点据此本地化；`message` 已是当前语言文案）。 */
export interface LocalizedError extends Error {
  readonly i18nKey: MessageKey;
  readonly i18nVars?: Record<string, string | number>;
}

/**
 * 非 React 模块里的「当前界面语言」：`document.documentElement.lang` 是契约 §11.3 指定的
 * **唯一写入点**（LocaleProvider 写入解析结果，含档案优先），其次设备镜像，最后默认值。
 */
function currentLocale(): Locale {
  if (typeof document !== 'undefined') {
    const declared = parseLocale(document.documentElement?.lang);
    if (declared) return declared;
  }
  if (typeof window !== 'undefined') {
    const stored = parseLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  }
  return DEFAULT_LOCALE;
}

/** 按字典生成一条身份类错误（zh 与原字面量逐字符相同）。`locale` 仅供测试注入。 */
export function identityErrorMessage(
  key: MessageKey,
  vars?: Record<string, string | number>,
  locale: Locale = currentLocale(),
): string {
  return translate(MESSAGES[locale], key, vars);
}

function identityError(key: MessageKey, vars?: Record<string, string | number>): LocalizedError {
  return Object.assign(new Error(identityErrorMessage(key, vars)), {
    i18nKey: key,
    i18nVars: vars,
  });
}

/**
 * 上屏点一键用：身份类错误 → 当前语言的字典文案；其它错误 → 原 `message`；
 * 两者都没有 → 调用点给的 `fallback`。**不吞错**：原 Error 对象照常抛出/记录，只是取词换了来源。
 */
export function errorCopy(
  error: unknown,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  fallback: string,
): string {
  const key = (error as Partial<LocalizedError> | null | undefined)?.i18nKey;
  if (typeof key === 'string') return t(key as MessageKey, (error as LocalizedError).i18nVars);
  return error instanceof Error && error.message ? error.message : fallback;
}

export const VISITOR_IDENTITY_EVENT = 'deep-whisper:visitor-identity';
export function getIdentityGeneration(): number {
  return identityGeneration;
}
export function notifyVisitorIdentityChanged(): void {
  identityGeneration += 1;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VISITOR_IDENTITY_EVENT));
}

/** This cache mirrors the server's fixed owner ID; it grants no access. */
export function getLocalVisitorId(): string {
  if (!cachedId) throw identityError(IDENTITY_ERROR_KEY.probeFailed, { status: 401 });
  return cachedId;
}
export function syncLocalVisitorId(id: string): void {
  const changed = cachedId !== id;
  cachedId = id;
  initPromise = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  if (changed) notifyVisitorIdentityChanged();
}
export function clearLocalVisitorId(): void {
  cachedId = null;
  initPromise = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
  notifyVisitorIdentityChanged();
}
export const VISITOR_PROBE_TIMEOUT_MS = 6000;
export interface EntryVisitorPayload {
  visitor?: {
    id?: string;
    palette?: string | null;
    gender?: string | null;
    orientation?: string | null;
  } | null;
  companion?: unknown;
  visitor_id?: string | null;
  is_new?: boolean;
  auth?: { authed: boolean; email: string | null };
}
export async function fetchEntryVisitor(): Promise<EntryVisitorPayload> {
  const generation = identityGeneration;
  const response = await apiFetch('/api/visitor', {
    signal: AbortSignal.timeout(VISITOR_PROBE_TIMEOUT_MS),
  });
  if (!response.ok)
    throw identityError(IDENTITY_ERROR_KEY.probeFailed, { status: response.status });
  const data = (await response.json()) as EntryVisitorPayload;
  if (generation !== identityGeneration) throw identityError(IDENTITY_ERROR_KEY.changed);
  if (!data.visitor_id) throw identityError(IDENTITY_ERROR_KEY.probeFailed, { status: 500 });
  syncLocalVisitorId(data.visitor_id);
  return data;
}
export async function ensureVisitorIdentity(options: { timeoutMs?: number } = {}): Promise<string> {
  if (cachedId) return cachedId;
  if (!initPromise) {
    const generation = identityGeneration;
    const pending = (async () => {
      const response = await apiFetch('/api/visitor', {
        signal: AbortSignal.timeout(options.timeoutMs ?? VISITOR_PROBE_TIMEOUT_MS),
      });
      if (!response.ok)
        throw identityError(IDENTITY_ERROR_KEY.probeFailed, { status: response.status });
      const data = (await response.json()) as EntryVisitorPayload;
      if (generation !== identityGeneration) throw identityError(IDENTITY_ERROR_KEY.changed);
      if (!data.visitor_id) throw identityError(IDENTITY_ERROR_KEY.probeFailed, { status: 500 });
      syncLocalVisitorId(data.visitor_id);
      return data.visitor_id;
    })();
    initPromise = pending;
    const settle = () => {
      if (initPromise === pending) initPromise = null;
    };
    void pending.then(settle, settle);
  }
  return initPromise!;
}
/** Authentication uses a same-origin httpOnly owner cookie or the server's loopback guard. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.delete('x-visitor-id');
  headers.delete('x-session');
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}
