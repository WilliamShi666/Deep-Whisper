/**
 * 启动链路的纯逻辑。
 *
 * 为什么单独成模块：入口页与聊天页的卡顿都来自「串行等待 + 无超时 + 无降级」，
 * 而这些决策本身是可以离线判定的纯函数。把它们抽出来既便于单测，
 * 也让两个页面共用同一套节奏，不会各调各的。
 */

/**
 * 入口分流的超时上限。
 *
 * 超过它就不再等，改用「已知状态」兜底分流（见 resolveEntryFallback），
 * 而不是让用户继续停在 loading。计划里的验收口径是「弱网下最多 2s 内进入目标页」，
 * 因此这里取 2000ms，而不是更宽松的 3.5s。
 */
export const ENTRY_TIMEOUT_MS = 2000;

/**
 * 指数退避的重试节奏。
 *
 * 原先是固定 1s × 5 次：弱网下最坏空等约 5 秒，而这期间界面上什么都不变，
 * 观感就是「卡住了」。改成指数退避并把总等待封顶，让失败尽快暴露、
 * 把剩余时间还给超时兜底与用户操作。
 *
 * 返回的是「每次重试前的等待时长」；attempts=1 表示只尝试一次、不需要重试等待。
 */
export function buildRetrySchedule(input: {
  attempts: number;
  baseMs: number;
  maxTotalMs: number;
}): number[] {
  const { attempts, baseMs, maxTotalMs } = input;
  const schedule: number[] = [];
  let total = 0;
  for (let i = 1; i < attempts; i += 1) {
    const delay = baseMs * 2 ** (i - 1);
    if (total + delay > maxTotalMs) break;
    schedule.push(delay);
    total += delay;
  }
  return schedule;
}

/** 入口分流只需要看这两件事。 */
export interface EntryVisitorResponse {
  visitor?: unknown;
  companion?: unknown;
  auth?: { authed?: boolean } | null;
}

/** 入口分流的三个去向：老用户回聊天，已登录但没伴侣的人去捏人，其余新访客先看落地页。 */
export type EntryTarget = '/chat' | '/onboarding' | '/love';

/**
 * 由**单次** /api/visitor 响应决定去聊天还是去捏人。
 *
 * 入口页原先先 await ensureVisitorIdentity()（冷启动时它内部会裸发一次
 * /api/visitor 去读老 Cookie），紧接着又 apiFetch('/api/visitor') ——
 * 冷启动确实会打两次同样的请求，每次服务端都要走一遍身份解析。
 * 现在由 `fetchEntryVisitor()`（src/lib/api.ts）用**一次**请求同时带回身份与分流依据，
 * 本函数只负责判定，与网络无关。
 *
 * 缺字段时保守去 /love：那是安全的方向（落地页上的主按钮一步直达开屏流程），
 * 而误判去 /chat 会撞上「没有伴侣」的空页面。
 */
export function resolveEntryTarget(data: EntryVisitorResponse): EntryTarget {
  if (data.visitor && data.companion) return '/chat';
  // 刚注册/刚 OAuth 回来的人已经做出了决定，不该再看一遍营销页。
  if (data.auth?.authed) return '/onboarding';
  return '/love';
}

/**
 * 本地记住「上一次入口解析结果里有没有伴侣」。
 *
 * 为什么需要：超时/失败时我们**恰恰没拿到**访客与伴侣信息，而
 * `resolveEntryTarget` 依赖的正是这两件事。上一轮的做法是无条件跳 /onboarding，
 * 于是弱网下的老用户每次都被丢进捏人流程（审查 F-5）——既不是他要去的地方，
 * 在那之前还会经过一次画像写入（F-1 的数据丢失就是被它触发的）。
 *
 * 只认「上一次成功解析」这一个事实，比拿登录态去猜更可靠：
 * 登录 ≠ 已经建过伴侣（注册后没捏人就退出的用户是存在的）。
 */
export const COMPANION_HINT_STORAGE_KEY = 'vl_has_companion';

/** 只依赖 Storage 的两个方法，便于离线单测。 */
export interface HintStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readCompanionHint(store: HintStore): boolean {
  return store.getItem(COMPANION_HINT_STORAGE_KEY) === '1';
}

export function writeCompanionHint(store: HintStore, hasCompanion: boolean): void {
  if (hasCompanion) store.setItem(COMPANION_HINT_STORAGE_KEY, '1');
  else store.removeItem(COMPANION_HINT_STORAGE_KEY);
}

/**
 * 超时/请求失败时的兜底去向：按「已知状态」分流，不知道就当新用户。
 *
 * 有伴侣 → /chat（老用户回到自己的聊天页）
 * 已登录但没有伴侣 → /onboarding
 * 没有/未知 → /love（安全方向，且画像写入已是合并语义，不再清空数据）
 */
export function resolveEntryFallback(hasCompanionHint: boolean, authed = false): EntryTarget {
  if (hasCompanionHint) return '/chat';
  return authed ? '/onboarding' : '/love';
}

/**
 * 聊天页启动链（身份解析 + 伴侣查询）的超时上限。
 *
 * 审查 F-6：这一链原先没有任何超时，`/api/visitor` 一挂起就永远停在骨架屏上。
 * 比入口的 2000ms 宽松：用户已经进入应用，多等一会儿比误报失败好；
 * 但必须有个尽头，超时后给出可操作的重试入口。
 */
export const CHAT_BOOT_TIMEOUT_MS = 8000;

/**
 * 会话列表（含「没有会话时新建一个」的写请求）的超时上限。
 *
 * 这是弱网下最容易卡住的一步（写请求），而它已经在后台异步补齐，
 * 所以超时后就报错并给重试，而不是让侧栏一直转圈。
 */
export const CONVERSATION_LOAD_TIMEOUT_MS = 8000;

/**
 * 主人密码提交动作的超时上限。
 *
 * 审查 F-7：这些提交原先没有超时，弱网下按钮会一直转圈且无法再次点击，
 * 用户只能刷新页面。超时后统一按失败处理，给出可读提示并允许重试。
 */
export const AUTH_SUBMIT_TIMEOUT_MS = 15000;

/**
 * 拉取个人能力配置的超时上限。
 */
export const CONFIG_FETCH_TIMEOUT_MS = 8000;

/**
 * 会话列表加载完成后应该选中哪个会话。
 *
 * 审查 M1：`loadConversations` 原先无条件把 `activeIdRef` 设成列表第一项。
 * 弱网下用户在列表回来之前点了另一个会话，这个迟到的响应就会把用户的选择盖掉 ——
 * 表现为「点了 B，界面自己跳回 A」。
 *
 * 规则：用户已经选中的会话只要还在列表里就必须保持；只有「还没选」或
 * 「选中的已经不在列表里」（被删除）时才回落到第一项。
 */
export function resolveActiveConversationId(
  currentActiveId: string | null,
  conversationIds: readonly string[],
): string | null {
  if (conversationIds.length === 0) return null;
  if (currentActiveId && conversationIds.includes(currentActiveId)) return currentActiveId;
  return conversationIds[0]!;
}

/**
 * 给一个 promise 加超时兜底。
 *
 * 超时不是错误路径，而是「必须给出结果」的保证：调用方拿到 fallback 后照常分流。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * 给一个 promise 加超时，超时就**拒绝**。
 *
 * 与 withTimeout 的区别是语义：那里超时是一种「降级结果」，这里超时必须让用户
 * 看到失败并重试 —— 用于密码提交与配置拉取，
 * 它们没有合理的兜底值，卡住就等于按钮永远转圈（审查 F-7）。
 *
 * 注意：不支持取消的底层 promise 可能仍在运行，
 * 本函数只保证调用方不再无限等待。
 */
export function rejectAfterTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 登录 / 注册页的 `?next=`：只接受站内相对路径，防开放跳转（`//evil.com`、`https://…`、`/\evil`）。
 * 不合法一律返回 null，调用方回到原有分流（有伴侣 /chat，否则 /onboarding）。
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/^\/[^/]*:/.test(value) || /[\u0000-\u001f]/.test(value)) return null;
  return value.length <= 200 ? value : null;
}

/** 登录页初始是登录还是注册：只有明确写 `?mode=register` 才进注册。 */
export function initialLoginMode(raw: string | null | undefined): 'login' | 'register' {
  return raw === 'register' ? 'register' : 'login';
}

/** 落地页的主按钮：认出老用户，但不强制跳走（分享出去的 /love 仍然能看）。 */
export interface LandingEntry {
  href: string;
  label: string;
}

export function resolveLandingEntry(input: { authed: boolean; hasCompanion: boolean }): LandingEntry {
  if (input.hasCompanion) return { href: '/chat', label: '回到 TA 身边' };
  if (input.authed) return { href: '/onboarding', label: '开始心动' };
  return { href: '/onboarding?from=love', label: '开始心动' };
}

/** 游客注册入口：注册后回到聊天页（新账号会认领当前匿名身份，TA 和聊天记录都在）。 */
export const GUEST_REGISTER_HREF = '/login?mode=register&next=/chat';
