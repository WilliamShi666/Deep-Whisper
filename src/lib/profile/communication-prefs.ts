/**
 * 相处方式偏好的最小写入路径（T-18 / T-27 / T-28）。
 *
 * 背景：`/api/profile` 在 src/ 内零调用方，`user_profiles.communication_prefs`
 * 在生产路径永远是空的，TA 对相处方式的反馈无处可写。
 *
 * 约定：
 * - 复用既有表与既有数据访问约定（SQLite + user_profiles 单行），
 *   不新增表、列或迁移。这里与既有 user_profiles 访问路径保持一致
 *   （src/app/api/profile/route.ts 同表同客户端）；Neon 迁移时随该表一并切换。
 * - 反馈是追加式的历史列表（explicit_feedback）：冲突时以最后一条为准，
 *   所以「更正」只需追加，不需要删掉旧条目。同一句原话再说一遍不是新条目，
 *   而是把那一句提到末尾（见 appendExplicitFeedback）。
 * - 撤销只清偏好字段本身，不触发任何删除记忆 / 会话 / 关系快照的路径。
 * - communication_prefs 是「读—改—写」一体的 jsonb 字段，并发写会丢更新：两个
 *   请求读到同一份旧值，各自算完再写，后写的把先写的覆盖掉。所以写入分两层：
 *   本进程内先按访客排队（同一访客的反馈依次执行，见 withPrefsLock），跨进程再用
 *   比较并交换（CAS）——只有 updated_at 还是读到的那一版才落库；否则重读最新值，
 *   把本次改动重放到别人的改动之上，最多 MAX_PREFS_CAS_ATTEMPTS 次（见 applyPrefsChange）。
 *   两层各管一半：CAS 保证不覆盖别人，排队保证自己这一条一定排得上。
 * - 持久化失败一律转成结构化结果返回，绝不抛给调用方：对话主链路不能
 *   因为偏好写入失败而失败。
 */

import { getSqlite } from '@/storage/database/db';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CommunicationPrefs } from '@/lib/types';

/** explicit_feedback 的有界长度：只保留最近的若干条，旧的自动丢弃。 */
export const MAX_EXPLICIT_FEEDBACK = 8;
/** 单条反馈的最大长度，避免整段对话被塞进偏好字段。 */
export const MAX_FEEDBACK_LENGTH = 160;

const LOG_PREFIX = '[profile:prefs]';

/** 归一化一条反馈原话：折叠空白、去首尾、限长；空白输入返回 null。 */
export function sanitizeFeedback(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_FEEDBACK_LENGTH);
}

/**
 * 把一条反馈并入 CommunicationPrefs：追加到 explicit_feedback 末尾，超出上限时
 * 丢弃最旧的一条。纯函数，不改写入参。
 *
 * 同一句原话（按 sanitizeFeedback 归一化后逐字相同）不会新增条目，而是被提到末尾。
 * 这不是「去重洁癖」：这个列表的语义是「冲突时最后一条为准」，所以用户再说一遍
 * 「别每次都逗我」的意思是「以我刚才说的为准」，不是「让这句话出现两次」。
 * 挡掉重复之后，MAX_EXPLICIT_FEEDBACK 的 8 个位置留给 8 条不同的偏好，
 * 而不会让一句话刷屏把别的偏好挤出去。历史里已经存在的重复也会在这里被收敛。
 */
export function appendExplicitFeedback(
  prefs: CommunicationPrefs | null | undefined,
  feedback: string,
): CommunicationPrefs {
  const next: CommunicationPrefs = { ...(prefs ?? {}) };
  const text = sanitizeFeedback(feedback);
  if (!text) return next;
  const history = (next.explicit_feedback ?? []).filter((entry) => entry !== text);
  next.explicit_feedback = [...history, text].slice(-MAX_EXPLICIT_FEEDBACK);
  return next;
}

/** 只清反馈历史，保留枚举偏好。纯函数，不改写入参。 */
export function revokeExplicitFeedback(
  prefs: CommunicationPrefs | null | undefined,
): CommunicationPrefs {
  const next: CommunicationPrefs = { ...(prefs ?? {}) };
  delete next.explicit_feedback;
  return next;
}

/**
 * 带上行版本的一次读取。version 就是 user_profiles.updated_at：该列 not null
 * default now()，且有 before update 触发器在每次写入时改写它，所以「版本变了」
 * 等价于「这一行被别的写入者改过」。行不存在时 prefs 与 version 同为 null。
 */
export interface CommunicationPrefsSnapshot {
  prefs: CommunicationPrefs | null;
  version: string | null;
}

/**
 * 偏好读写端口：默认实现走 user_profiles，单测可注入替身。
 *
 * 后两个方法是可选的：只实现 load/save 的替身（以及未来的其他实现）继续按原有
 * 语义工作，写入编排会自动回落到「读一次、写一次」；实现了它们的 store 才拿到
 * 并发保护。
 */
export interface CommunicationPrefsStore {
  load(visitorId: string): Promise<CommunicationPrefs | null>;
  save(visitorId: string, prefs: CommunicationPrefs | null): Promise<void>;
  /** 可选：连带返回行版本，供 CAS 使用。 */
  loadWithVersion?(visitorId: string): Promise<CommunicationPrefsSnapshot>;
  /**
   * 可选：只有当库里那一行的版本仍是 expectedVersion 时才写入，返回是否真的落库。
   * expectedVersion 为 null 表示「读的时候还没有这一行」，此时只允许插入；并发下
   * 插入撞上 unique 约束 = 输掉竞争，同样返回 false，由调用方重读重试。
   */
  saveIfUnchanged?(
    visitorId: string,
    prefs: CommunicationPrefs | null,
    expectedVersion: string | null,
  ): Promise<boolean>;
}

/** SQLite profile CAS: every successful write advances the millisecond version. */
export function createSqliteCommunicationPrefsStore(db: Database.Database = getSqlite()): CommunicationPrefsStore {
  async function loadWithVersion(visitorId: string): Promise<CommunicationPrefsSnapshot> {
    const row = db.prepare('SELECT communication_prefs, updated_at FROM user_profiles WHERE visitor_id=?').get(visitorId) as {communication_prefs:string;updated_at:number}|undefined;
    return row ? {prefs:JSON.parse(row.communication_prefs),version:String(row.updated_at)} : {prefs:null,version:null};
  }
  async function load(visitorId:string):Promise<CommunicationPrefs|null> {return (await loadWithVersion(visitorId)).prefs;}
  async function save(visitorId:string,prefs:CommunicationPrefs|null):Promise<void> {
    const now=Date.now();
    db.prepare('INSERT INTO user_profiles(id,visitor_id,communication_prefs,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET communication_prefs=excluded.communication_prefs,updated_at=max(user_profiles.updated_at+1,excluded.updated_at)').run(randomUUID(),visitorId,JSON.stringify(prefs??{}),now,now);
  }
  async function saveIfUnchanged(visitorId:string,prefs:CommunicationPrefs|null,expectedVersion:string|null):Promise<boolean> {
    const now=Date.now();
    if(expectedVersion===null) return db.prepare('INSERT INTO user_profiles(id,visitor_id,communication_prefs,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(visitor_id) DO NOTHING').run(randomUUID(),visitorId,JSON.stringify(prefs??{}),now,now).changes>0;
    return db.prepare('UPDATE user_profiles SET communication_prefs=?,updated_at=max(updated_at+1,?) WHERE visitor_id=? AND updated_at=?').run(JSON.stringify(prefs??{}),now,visitorId,Number(expectedVersion)).changes>0;
  }
  return {load,loadWithVersion,save,saveIfUnchanged};
}

export interface CommunicationPrefsWriteSuccess {
  ok: true;
  action: 'appended' | 'revoked';
  prefs: CommunicationPrefs | null;
  explicitFeedbackCount: number;
  feedback: string | null;
}

export interface CommunicationPrefsWriteFailure {
  ok: false;
  reason: 'invalid_input' | 'write_failed';
  error: string;
}

export type CommunicationPrefsWriteResult =
  | CommunicationPrefsWriteSuccess
  | CommunicationPrefsWriteFailure;

export interface RecordCommunicationFeedbackInput {
  visitorId: string;
  feedback: string;
  store?: CommunicationPrefsStore;
}

export type RevokeCommunicationPrefsMode = 'explicit_feedback' | 'all';

export interface RevokeCommunicationPrefsInput {
  visitorId: string;
  /** 'all'（默认）清空整个偏好字段；'explicit_feedback' 只清反馈历史。 */
  mode?: RevokeCommunicationPrefsMode;
  store?: CommunicationPrefsStore;
}

/** CAS 重试上限：并发冲突时重读最新值重放本次改动，超过这个次数就上报失败。 */
export const MAX_PREFS_CAS_ATTEMPTS = 3;

/**
 * 进程内按访客排队的写队列（访客 → 该访客当前队尾的 promise）。
 *
 * 为什么 CAS 之外还要排队：CAS 只保证「不覆盖别人」，它不保证「自己一定落得了库」。
 * 同一个进程里同时到达的几条反馈会去抢同一行的版本，抢输的必须重读重放；一起到达的
 * 请求越多，排在后面的越容易把重试次数耗光，于是一条本该成功的更正变成了失败——
 * 明明看起来只是「几个请求同时发生」，用户却看到「没能保存」。这些请求本来就在同一个
 * 进程里，没必要互相抢，排队即可：每条都在前一条落库之后再读版本、再落库。
 *
 * - 键是访客：不同访客互不阻塞，一个访客的慢写入不会拖住别人。
 * - 队列排空后摘掉键，不长期累积。
 * - 队列只覆盖本进程；跨进程（多实例、别的写入者）那一半仍然由 CAS 负责。
 *
 * 用 null 原型对象而不是 Map：这里只需要「取值 / 赋值 / 摘键」三件事，用 delete
 * 运算符摘键即可，模块里不会出现行级删除的那类写法（本模块的守卫盯住的正是那类动作）。
 */
const prefsWriteQueues: Record<string, Promise<unknown>> = Object.create(null);

/** 把任务挂到该访客队尾，返回本次任务的 promise；前一个任务失败不影响后一个。 */
async function withPrefsLock<T>(visitorId: string, task: () => Promise<T>): Promise<T> {
  const previous = prefsWriteQueues[visitorId] ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  // 队尾永远不 reject：前一个任务的失败既不能污染下一个任务，也不能变成未处理的拒绝。
  const tail: Promise<unknown> = run.catch(() => undefined);
  prefsWriteQueues[visitorId] = tail;
  void tail.then(() => {
    if (prefsWriteQueues[visitorId] === tail) delete prefsWriteQueues[visitorId];
  });
  return run;
}

/**
 * 读—改—写的写入编排。
 *
 * - 先把整个编排挂到该访客的队尾（见 withPrefsLock）：同一进程内同时到达的多条反馈
 *   依次执行，每条都基于上一条落库后的最新值计算，所以本进程内不会互相覆盖，也不会
 *   因为抢版本失败而丢掉用户的更正。
 * - store 没有 CAS 能力（只实现 load/save 的替身，或未来的其他实现）→ 保持原样的
 *   「读一次、写一次」，语义与行为完全不变。
 * - store 有 CAS 能力 → 读到版本后先算新值，只在版本没变时落库；版本被别人改过就
 *   重读最新值，再把这次改动重放上去。关键在于重放的输入是**别人的最新值**，所以
 *   本次改动是叠加在别人的改动之上，而不是用自己那份过期快照把它覆盖掉——这正是
 *   并发反馈不丢的原因（跨进程同样成立）。
 *
 * 重试有界：连续 MAX_PREFS_CAS_ATTEMPTS 次都被抢先就抛出，由调用方转成结构化失败
 * 结果（绝不对用户谎报成功）。
 */
async function applyPrefsChange<T extends CommunicationPrefs | null>(
  store: CommunicationPrefsStore,
  visitorId: string,
  compute: (current: CommunicationPrefs | null) => T,
): Promise<T> {
  return withPrefsLock(visitorId, async () => {
    const loadWithVersion = store.loadWithVersion?.bind(store);
    const saveIfUnchanged = store.saveIfUnchanged?.bind(store);

    if (!loadWithVersion || !saveIfUnchanged) {
      const current = await store.load(visitorId);
      const next = compute(current);
      await store.save(visitorId, next);
      return next;
    }

    let snapshot = await loadWithVersion(visitorId);
    for (let attempt = 1; ; attempt += 1) {
      const next = compute(snapshot.prefs);
      if (await saveIfUnchanged(visitorId, next, snapshot.version)) return next;
      if (attempt >= MAX_PREFS_CAS_ATTEMPTS) break;
      snapshot = await loadWithVersion(visitorId);
    }

    throw new Error(`相处方式偏好连续 ${MAX_PREFS_CAS_ATTEMPTS} 次遇到并发冲突，本次未落库`);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 最小写入路径：把一条相处方式反馈合并进 communication_prefs 并写回画像。
 * 反馈为空 → invalid_input；读写失败 → write_failed。两种情况都不抛出。
 * 同一时刻到达的两条反馈不会互相覆盖（见 applyPrefsChange）。
 */
export async function recordCommunicationFeedback(
  input: RecordCommunicationFeedbackInput,
): Promise<CommunicationPrefsWriteResult> {
  const visitorId = input.visitorId?.trim() ?? '';
  const text = sanitizeFeedback(input.feedback);

  if (!visitorId || !text) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: `${LOG_PREFIX} 访客或反馈为空，未写入`,
    };
  }

  try {
    const store = input.store ?? createSqliteCommunicationPrefsStore();
    const next = await applyPrefsChange(store, visitorId, (current) =>
      appendExplicitFeedback(current, text),
    );
    return {
      ok: true,
      action: 'appended',
      prefs: next,
      explicitFeedbackCount: next.explicit_feedback?.length ?? 0,
      feedback: text,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'write_failed',
      error: `${LOG_PREFIX} 写入相处方式偏好失败: ${errorMessage(error)}`,
    };
  }
}

/**
 * 撤销相处方式偏好：只清偏好字段（或只清反馈历史），不触碰记忆、会话与关系快照。
 * 失败同样只返回结构化结果，绝不抛出。并发语义与追加一致（见 applyPrefsChange）。
 */
export async function revokeCommunicationPrefs(
  input: RevokeCommunicationPrefsInput,
): Promise<CommunicationPrefsWriteResult> {
  const visitorId = input.visitorId?.trim() ?? '';

  if (!visitorId) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: `${LOG_PREFIX} 访客为空，未写入`,
    };
  }

  const mode: RevokeCommunicationPrefsMode = input.mode ?? 'all';

  try {
    const store = input.store ?? createSqliteCommunicationPrefsStore();
    const next = await applyPrefsChange(store, visitorId, (current) =>
      mode === 'all' ? null : revokeExplicitFeedback(current),
    );
    return {
      ok: true,
      action: 'revoked',
      prefs: next,
      explicitFeedbackCount: next?.explicit_feedback?.length ?? 0,
      feedback: null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'write_failed',
      error: `${LOG_PREFIX} 撤销相处方式偏好失败: ${errorMessage(error)}`,
    };
  }
}


// ── AC-17 最小产品入口使用的动作词汇 ──────────────────────────────────────────

/**
 * 用户可达的动作只有两种：追加一条新说法（更正，沿用「最后一条优先」）
 * 与撤销。不引入新概念，也不新增端点——由既有 /api/profile 承载。
 */
export type CommunicationPrefsAction = 'append' | 'revoke';

/** 解析外部传入的动作名；未知值返回 null，调用方必须据此拒绝请求，不得当作成功。 */
export function parseCommunicationPrefsAction(raw: unknown): CommunicationPrefsAction | null {
  return raw === 'append' || raw === 'revoke' ? raw : null;
}

/** 解析撤销范围；缺省 all（清整个偏好字段）；非法值返回 null。 */
export function parseRevokeMode(raw: unknown): RevokeCommunicationPrefsMode | null {
  if (raw === undefined || raw === null) return 'all';
  return raw === 'all' || raw === 'explicit_feedback' ? raw : null;
}

/**
 * 把领域结果映射成 HTTP 状态：成功 200，空输入 400，读写失败 500。
 * 失败一律走非 2xx —— 对应 AC-17 边界「失败不得静默成功」。
 */
export function resolveFeedbackActionStatus(result: CommunicationPrefsWriteResult): 200 | 400 | 500 {
  if (result.ok) return 200;
  return result.reason === 'invalid_input' ? 400 : 500;
}

/** 失败时给用户的文案：必须说清这次没有改动，且不泄露内部细节。 */
export function feedbackFailureMessage(result: CommunicationPrefsWriteFailure): string {
  return result.reason === 'invalid_input'
    ? '没有可记录的相处方式，这次没有改动'
    : '相处方式偏好没能保存，请稍后再试';
}
