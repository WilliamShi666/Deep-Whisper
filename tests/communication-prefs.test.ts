import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MAX_EXPLICIT_FEEDBACK,
  MAX_PREFS_CAS_ATTEMPTS,
  appendExplicitFeedback,
  feedbackFailureMessage,
  parseCommunicationPrefsAction,
  parseRevokeMode,
  recordCommunicationFeedback,
  resolveFeedbackActionStatus,
  revokeCommunicationPrefs,
  revokeExplicitFeedback,
} from '../src/lib/profile/communication-prefs';
import type {
  CommunicationPrefsSnapshot,
  CommunicationPrefsStore,
  CommunicationPrefsWriteFailure,
  CommunicationPrefsWriteResult,
} from '../src/lib/profile/communication-prefs';
import type { CommunicationPrefs } from '../src/lib/types';

// 全部 fixture 均为合成数据，不含任何真实对话或私密内容。

class RecordingPrefsStore {
  loads: string[] = [];
  saves: Array<{ visitorId: string; prefs: CommunicationPrefs | null }> = [];
  deletes: string[] = [];
  failLoad: Error | null = null;
  failSave: Error | null = null;

  constructor(public current: CommunicationPrefs | null) {}

  async load(visitorId: string): Promise<CommunicationPrefs | null> {
    this.loads.push(visitorId);
    if (this.failLoad) throw this.failLoad;
    return this.current;
  }

  async save(visitorId: string, prefs: CommunicationPrefs | null): Promise<void> {
    if (this.failSave) throw this.failSave;
    this.saves.push({ visitorId, prefs });
    this.current = prefs;
  }

  /** 删除类替身：撤销偏好时任何情况下都不应被调用。 */
  async delete(visitorId: string): Promise<void> {
    this.deletes.push(visitorId);
  }
}

const SUPABASE_ENV_NAMES = [
  'APP_ENV',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PROJECT_REF',
  'PRODUCTION_SUPABASE_PROJECT_REF',
] as const;

function moduleSource(): string {
  return readFileSync(new URL('../src/lib/profile/communication-prefs.ts', import.meta.url), 'utf8');
}

test('T-27 追加相处方式反馈：保留旧条目、追加到末尾，同一句原话提到末尾而不新增', () => {
  const first = appendExplicitFeedback(null, '别每次都逗我');
  assert.deepEqual(first.explicit_feedback, ['别每次都逗我']);

  const second = appendExplicitFeedback(first, '其实你可以多逗我一点');
  assert.deepEqual(second.explicit_feedback, ['别每次都逗我', '其实你可以多逗我一点']);

  // 再说一遍同一句话 = 「以我刚才说的为准」，所以它变成最后一条，
  // 而不是让列表里出现两个一模一样的条目。
  const repeated = appendExplicitFeedback(second, '别每次都逗我');
  assert.deepEqual(repeated.explicit_feedback, ['其实你可以多逗我一点', '别每次都逗我']);

  // 归一化后相同的写法同样收敛（空白折叠成同一串）
  const respaced = appendExplicitFeedback(repeated, '  别每次都逗我  ');
  assert.deepEqual(respaced.explicit_feedback, ['其实你可以多逗我一点', '别每次都逗我']);

  // 纯函数：不得改写传入的 prefs
  assert.deepEqual(first.explicit_feedback, ['别每次都逗我']);
  assert.deepEqual(second.explicit_feedback, ['别每次都逗我', '其实你可以多逗我一点']);
});

test('T-27 跨轮重复反馈不会占满 8 个位置，历史里的旧重复也会收敛', () => {
  const legacy: CommunicationPrefs = {
    explicit_feedback: ['别每次都逗我', '记得问我今天怎么样', '别每次都逗我'],
  };
  // 既有数据里已经存在的重复，在下次写入时被收敛成一条。
  const healed = appendExplicitFeedback(legacy, '别每次都逗我');
  assert.deepEqual(healed.explicit_feedback, ['记得问我今天怎么样', '别每次都逗我']);

  let prefs: CommunicationPrefs | null = null;
  for (let turn = 0; turn < 5; turn += 1) {
    prefs = appendExplicitFeedback(prefs, '别每次都逗我');
    prefs = appendExplicitFeedback(prefs, `第 ${turn} 次的另一条偏好`);
  }
  assert.equal(
    prefs?.explicit_feedback?.filter((entry) => entry === '别每次都逗我').length,
    1,
    '十轮里说了五遍的同一句话只应占一个位置',
  );
  // 十次写入里五条是重复的：不去重的话这里会被截成 8 条，且全是同一句话在刷屏。
  assert.equal(
    prefs?.explicit_feedback?.length,
    6,
    '重复的那句只应占一个位置，不该把额度吃掉',
  );
  assert.ok(6 <= MAX_EXPLICIT_FEEDBACK);
  assert.equal(
    prefs?.explicit_feedback?.[5],
    '第 4 次的另一条偏好',
    '最后写入的说法必须留在末尾（冲突时以最后一条为准）',
  );
});

test('T-18 追加相处方式反馈：保留既有枚举偏好，空白输入不写入', () => {
  const prefs: CommunicationPrefs = {
    love_language: 'playful',
    sensitivity: 'medium',
    avoided_topics: ['工作'],
  };

  const merged = appendExplicitFeedback(prefs, '  认真一点  也可以  ');
  assert.equal(merged.love_language, 'playful');
  assert.equal(merged.sensitivity, 'medium');
  assert.deepEqual(merged.avoided_topics, ['工作']);
  assert.deepEqual(merged.explicit_feedback, ['认真一点 也可以']);

  const untouched = appendExplicitFeedback(merged, '   ');
  assert.deepEqual(untouched.explicit_feedback, ['认真一点 也可以']);
});

test('T-18 追加相处方式反馈有界：超过上限时丢弃最旧条目', () => {
  let prefs: CommunicationPrefs = {};
  for (let index = 1; index <= MAX_EXPLICIT_FEEDBACK + 2; index += 1) {
    prefs = appendExplicitFeedback(prefs, `反馈 ${index}`);
  }

  assert.equal(MAX_EXPLICIT_FEEDBACK, 8);
  assert.equal(prefs.explicit_feedback?.length, MAX_EXPLICIT_FEEDBACK);
  assert.equal(prefs.explicit_feedback?.[0], '反馈 3');
  assert.equal(
    prefs.explicit_feedback?.[MAX_EXPLICIT_FEEDBACK - 1],
    `反馈 ${MAX_EXPLICIT_FEEDBACK + 2}`,
  );
});

test('T-18(c) 最小写入路径：反馈被合并进 communication_prefs 并写回既有画像行', async () => {
  const store = new RecordingPrefsStore({ love_language: 'playful' });

  const first = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '别每次都逗我',
    store,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.action, 'appended');

  const second = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '其实你可以多逗我一点',
    store,
  });
  assert.equal(second.ok, true);

  assert.deepEqual(store.loads, ['visitor-1', 'visitor-1']);
  assert.equal(store.saves.length, 2);
  assert.deepEqual(store.saves[1]?.prefs?.explicit_feedback, [
    '别每次都逗我',
    '其实你可以多逗我一点',
  ]);
  // 既有枚举偏好不被覆盖
  assert.equal(store.saves[1]?.prefs?.love_language, 'playful');
  assert.deepEqual(store.deletes, []);
});

test('T-18(c) 空反馈被判为非法输入，且不写库', async () => {
  const store = new RecordingPrefsStore(null);
  const result = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '   ',
    store,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_input');
  assert.equal(store.saves.length, 0);
});

test('T-18(c)(AC-14 同构) 写入失败不抛出，只返回结构化失败结果', async () => {
  const failingSave = new RecordingPrefsStore(null);
  failingSave.failSave = new Error('database unavailable');
  const writeResult = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '别每次都逗我',
    store: failingSave,
  });
  assert.equal(writeResult.ok, false);
  if (writeResult.ok) return;
  assert.equal(writeResult.reason, 'write_failed');
  assert.match(writeResult.error, /database unavailable/);

  const failingLoad = new RecordingPrefsStore(null);
  failingLoad.failLoad = new Error('read timeout');
  const readResult = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '别每次都逗我',
    store: failingLoad,
  });
  assert.equal(readResult.ok, false);
});

test('the default communication preference store is SQLite, without remote account credentials',()=>{
 const source=moduleSource();
 assert.match(source,/createSqliteCommunicationPrefsStore/);
 assert.match(source,/getSqlite/);
 assert.doesNotMatch(source,/getSupabaseAdminClient|supabase-client/);
});

test('T-27 更正偏好：新说法成为列表最后一条，旧说法保留但不被当作依据', async () => {
  const store = new RecordingPrefsStore({});
  await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '别每次都逗我',
    store,
  });
  const corrected = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '其实你可以多逗我一点',
    store,
  });

  assert.equal(corrected.ok, true);
  const saved = store.current?.explicit_feedback ?? [];
  assert.equal(saved.length, 2);
  assert.equal(saved[saved.length - 1], '其实你可以多逗我一点');
});

test('T-28 撤销偏好只清偏好字段：不调用任何删除路径', async () => {
  const store = new RecordingPrefsStore({
    love_language: 'playful',
    explicit_feedback: ['别每次都逗我'],
  });

  const result = await revokeCommunicationPrefs({ visitorId: 'visitor-1', mode: 'all', store });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, 'revoked');
  assert.equal(result.prefs, null);
  assert.deepEqual(store.loads, ['visitor-1']);
  assert.deepEqual(store.saves, [{ visitorId: 'visitor-1', prefs: null }]);
  // 关系历史零删除：没有任何删除调用
  assert.deepEqual(store.deletes, []);

  // 源码级守卫：撤销模块不触碰 messages / conversations / 关系快照 / 记忆系统
  const source = moduleSource();
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /forget/i);
  assert.doesNotMatch(source, /relationship_snapshots/);
  assert.doesNotMatch(source, /from\('messages'\)/);
  assert.doesNotMatch(source, /from\('conversations'\)/);
});

test('T-28 撤销可只清反馈：既有枚举偏好保留，且同样不删除任何数据', async () => {
  const store = new RecordingPrefsStore({
    love_language: 'playful',
    explicit_feedback: ['别每次都逗我'],
  });

  const result = await revokeCommunicationPrefs({
    visitorId: 'visitor-1',
    mode: 'explicit_feedback',
    store,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.prefs?.love_language, 'playful');
  assert.equal(result.prefs?.explicit_feedback, undefined);
  assert.deepEqual(store.deletes, []);
});

test('T-28 撤销的纯函数语义：只返回清空后的 prefs，不改写入参', () => {
  const prefs: CommunicationPrefs = {
    love_language: 'playful',
    explicit_feedback: ['别每次都逗我'],
  };

  const clearedFeedback = revokeExplicitFeedback(prefs);
  assert.equal(clearedFeedback.love_language, 'playful');
  assert.equal(clearedFeedback.explicit_feedback, undefined);
  assert.deepEqual(prefs.explicit_feedback, ['别每次都逗我']);

  assert.equal(revokeExplicitFeedback(null).explicit_feedback, undefined);
});


// ── AC-17 最小产品入口（更正 / 撤销）：动作解析与失败映射 ──────────────────────

test('AC-17 入口：动作名只认 append / revoke，未知值一律拒绝', () => {
  assert.equal(parseCommunicationPrefsAction('append'), 'append');
  assert.equal(parseCommunicationPrefsAction('revoke'), 'revoke');
  assert.equal(parseCommunicationPrefsAction('delete'), null);
  assert.equal(parseCommunicationPrefsAction(''), null);
  assert.equal(parseCommunicationPrefsAction(undefined), null);
  assert.equal(parseCommunicationPrefsAction({ action: 'append' }), null);
});

test('AC-17 入口：撤销范围缺省 all，非法值被拒绝', () => {
  assert.equal(parseRevokeMode(undefined), 'all');
  assert.equal(parseRevokeMode(null), 'all');
  assert.equal(parseRevokeMode('all'), 'all');
  assert.equal(parseRevokeMode('explicit_feedback'), 'explicit_feedback');
  assert.equal(parseRevokeMode('everything'), null);
  assert.equal(parseRevokeMode(1), null);
});

test('AC-17 入口：成功才映射 200，失败绝不映射 2xx（不静默成功）', () => {
  const appended: CommunicationPrefsWriteResult = {
    ok: true,
    action: 'appended',
    prefs: { explicit_feedback: ['别每次都逗我'] },
    explicitFeedbackCount: 1,
    feedback: '别每次都逗我',
  };
  assert.equal(resolveFeedbackActionStatus(appended), 200);

  const revoked: CommunicationPrefsWriteResult = {
    ok: true,
    action: 'revoked',
    prefs: null,
    explicitFeedbackCount: 0,
    feedback: null,
  };
  assert.equal(resolveFeedbackActionStatus(revoked), 200);

  const emptyInput: CommunicationPrefsWriteResult = {
    ok: false,
    reason: 'invalid_input',
    error: 'visitor or feedback empty',
  };
  assert.equal(resolveFeedbackActionStatus(emptyInput), 400);

  const writeFailed: CommunicationPrefsWriteResult = {
    ok: false,
    reason: 'write_failed',
    error: 'boom',
  };
  assert.equal(resolveFeedbackActionStatus(writeFailed), 500);
});

test('AC-17 入口：失败文案必须承认这次没有改动', () => {
  const writeFailed: CommunicationPrefsWriteFailure = { ok: false, reason: 'write_failed', error: 'boom' };
  assert.match(feedbackFailureMessage(writeFailed), /没能保存/);

  const emptyInput: CommunicationPrefsWriteFailure = { ok: false, reason: 'invalid_input', error: 'empty' };
  assert.match(feedbackFailureMessage(emptyInput), /没有改动/);
});

// ── P2-5：并发写入不得丢更新 ────────────────────────────────────────────────────
//
// communication_prefs 是「读—改—写」一体的 jsonb 字段：两个请求读到同一份旧值，
// 各自算完再写，后写的会把先写的覆盖掉。并发保护分两层，测试也分两层：
// ① 本进程内同一访客的写入排队 —— 同时到达的多条反馈要全部落库，且一条都不能失败；
// ② 跨进程用 CAS —— 别人的改动不许被覆盖，自己的改动要重放在别人的改动之上。
// 外加一段对照基线：朴素的读—改—写并发时确实会丢更新，这是两层保护存在的理由，
// 也是「谁把实现退回朴素写法就红」的那根钉子（另有文末的源码级守卫兜底）。

/**
 * 并发替身：一张只有一行的内存表 + 自增行版本号。真实表里 updated_at 的角色由版本号
 * 扮演，CAS 语义与默认 store 完全一致（读版本 → 只在版本没变时才落库）。
 */
class CasPrefsStore implements CommunicationPrefsStore {
  private row: { prefs: CommunicationPrefs | null; version: number } | null;
  private nextVersion = 1;
  readonly reads: string[] = [];
  readonly writes: Array<CommunicationPrefs | null> = [];
  conflicts = 0;

  constructor(initial: CommunicationPrefs | null = null, exists = false) {
    this.row = exists ? { prefs: initial, version: 0 } : null;
  }

  get current(): CommunicationPrefs | null {
    return this.row?.prefs ?? null;
  }

  async load(visitorId: string): Promise<CommunicationPrefs | null> {
    return (await this.loadWithVersion(visitorId)).prefs;
  }

  async save(visitorId: string, prefs: CommunicationPrefs | null): Promise<void> {
    this.reads.push(visitorId);
    this.commit(prefs);
  }

  async loadWithVersion(visitorId: string): Promise<CommunicationPrefsSnapshot> {
    this.reads.push(visitorId);
    if (!this.row) return { prefs: null, version: null };
    return { prefs: this.row.prefs, version: String(this.row.version) };
  }

  async saveIfUnchanged(
    visitorId: string,
    prefs: CommunicationPrefs | null,
    expectedVersion: string | null,
  ): Promise<boolean> {
    this.reads.push(visitorId);
    const actual = this.row ? String(this.row.version) : null;
    if (actual !== expectedVersion) {
      this.conflicts += 1;
      return false;
    }
    this.commit(prefs);
    return true;
  }

  private commit(prefs: CommunicationPrefs | null): void {
    this.row = { prefs, version: this.nextVersion };
    this.nextVersion += 1;
    this.writes.push(prefs);
  }
}

const CONCURRENT_FEEDBACK = [
  '别每次都逗我',
  '少用感叹号',
  '叫我阿舟就行',
  '晚上别催我睡',
  '别复述我的话',
];

/**
 * 跨进程替身：模拟「另一个写入者」正好在我们读到版本之后、落库之前写了一次。
 * 我们的 CAS 必须因此被拒绝（版本已经变了），重读后把本次改动重放在别人的改动之上。
 */
class InterleavedPrefsStore implements CommunicationPrefsStore {
  private prefs: CommunicationPrefs | null;
  private version = 0;
  foreignWrites = 0;
  staleRejects = 0;
  readonly commits: Array<CommunicationPrefs | null> = [];

  constructor(initial: CommunicationPrefs | null) {
    this.prefs = initial;
  }

  get current(): CommunicationPrefs | null {
    return this.prefs;
  }

  async load(): Promise<CommunicationPrefs | null> {
    return this.prefs;
  }

  async save(_visitorId: string, prefs: CommunicationPrefs | null): Promise<void> {
    this.commit(prefs);
  }

  async loadWithVersion(): Promise<CommunicationPrefsSnapshot> {
    return { prefs: this.prefs, version: String(this.version) };
  }

  async saveIfUnchanged(
    _visitorId: string,
    prefs: CommunicationPrefs | null,
    expectedVersion: string | null,
  ): Promise<boolean> {
    if (this.foreignWrites === 0) {
      // 另一个进程抢在这一条语句之前落库了一次，行版本因此前进。
      this.foreignWrites += 1;
      this.commit({ explicit_feedback: ['别老问我怎么了'] });
    }
    if (String(this.version) !== expectedVersion) {
      this.staleRejects += 1;
      return false;
    }
    this.commit(prefs);
    return true;
  }

  private commit(prefs: CommunicationPrefs | null): void {
    this.prefs = prefs;
    this.version += 1;
    this.commits.push(prefs);
  }
}

test('P2-5 同一进程内并发：同时到达的多条反馈全部落库，且一条都不能失败', async () => {
  const store = new CasPrefsStore();

  const results = await Promise.all(
    CONCURRENT_FEEDBACK.map((feedback) =>
      recordCommunicationFeedback({ visitorId: 'visitor-1', feedback, store }),
    ),
  );

  assert.ok(
    results.every((result) => result.ok),
    '同时到达的反馈不该有失败：本进程内的写入会排队，没必要互相抢版本',
  );
  assert.equal(store.writes.length, CONCURRENT_FEEDBACK.length, '五条反馈必须各落库一次');
  assert.deepEqual(
    store.current?.explicit_feedback,
    CONCURRENT_FEEDBACK,
    '五条并发反馈必须全部落库，且保持到达顺序',
  );
});

/**
 * 修复前的写入路径：读一次、算一次、写一次，中间没有任何并发保护。
 * 这是两层保护要修掉的那个缺陷本身，用来当对照基线。
 *
 * 它替身化地重现缺陷，所以**不是回归保护**：它不会因为生产代码退化而变红。
 * 防回退由上面那条「同一进程内并发」承担（直接调用生产的
 * recordCommunicationFeedback + CasPrefsStore）。这里的作用是证明「并发保护不是
 * 多余的」：如果朴素实现也不丢更新，那两层保护就没有存在理由。
 */
async function naiveRecord(
  store: RecordingPrefsStore,
  visitorId: string,
  feedback: string,
): Promise<void> {
  const current = await store.load(visitorId);
  await store.save(visitorId, appendExplicitFeedback(current, feedback));
}

test('P2-5 对照基线（非回归保护，防回退见上一条）：朴素的读—改—写并发时确实会丢更新', async () => {
  const store = new RecordingPrefsStore(null);

  await Promise.all(
    CONCURRENT_FEEDBACK.map((feedback) => naiveRecord(store, 'visitor-1', feedback)),
  );

  // 五次写入都发生过，库里却只剩下最后写进去的那一条 —— 这就是要修的缺陷本身。
  assert.equal(store.saves.length, CONCURRENT_FEEDBACK.length);
  assert.ok(
    (store.current?.explicit_feedback?.length ?? 0) < CONCURRENT_FEEDBACK.length,
    '朴素实现必须真的丢更新，否则本测试无法证明并发保护是必要的',
  );
});

test('P2-5 一直抢不到版本：重试有界，且如实上报失败而不是谎报成功', async () => {
  let attempts = 0;
  const touched: string[] = [];
  const alwaysLosing: CommunicationPrefsStore = {
    async load(visitorId) {
      touched.push(visitorId);
      return null;
    },
    async save(visitorId) {
      touched.push(visitorId);
    },
    async loadWithVersion(visitorId) {
      touched.push(visitorId);
      return { prefs: null, version: `stale-${attempts}` };
    },
    async saveIfUnchanged(visitorId) {
      touched.push(visitorId);
      attempts += 1;
      return false;
    },
  };

  const result = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '别每次都逗我',
    store: alwaysLosing,
  });

  assert.equal(
    attempts,
    MAX_PREFS_CAS_ATTEMPTS,
    '重试次数必须有界，不能无限重读重写',
  );
  assert.ok(touched.length > 0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'write_failed');
  assert.match(result.error, /并发冲突/, '失败原因必须指向并发冲突，而不是含糊的写入失败');
});

test('P2-5 跨进程交错：别人的改动不被覆盖，自己的改动重放上去', async () => {
  const store = new InterleavedPrefsStore(null);

  const result = await recordCommunicationFeedback({
    visitorId: 'visitor-1',
    feedback: '少用感叹号',
    store,
  });

  assert.equal(result.ok, true);
  assert.equal(store.foreignWrites, 1, '这段替身必须真的插入一次「别人的写入」');
  assert.equal(
    store.staleRejects,
    1,
    '版本已经变了，第一次落库必须被 CAS 拒绝，否则本测试是空转',
  );
  assert.deepEqual(
    store.current?.explicit_feedback,
    ['别老问我怎么了', '少用感叹号'],
    '重读时要拿到别人的最新值，把本次改动叠加在上面，而不是把别人的改动覆盖掉',
  );
});

test('P2-5 并发「追加 + 撤销」：两者都成功，且结果必是某种合法串行序', async () => {
  const store = new CasPrefsStore({ explicit_feedback: ['别每次都逗我'] }, true);

  const [appended, revoked] = await Promise.all([
    recordCommunicationFeedback({ visitorId: 'visitor-1', feedback: '少用感叹号', store }),
    revokeCommunicationPrefs({ visitorId: 'visitor-1', mode: 'explicit_feedback', store }),
  ]);

  assert.equal(appended.ok, true);
  assert.equal(revoked.ok, true);
  assert.equal(store.writes.length, 2, '两条改动都要真的落库');

  const finalFeedback = store.current?.explicit_feedback ?? null;
  // 两种合法串行序：撤销先落库→只剩新追加的那条；追加先落库→撤销把两条一起清掉。
  const legalOutcomes = [JSON.stringify(['少用感叹号']), JSON.stringify(null)];
  assert.ok(
    legalOutcomes.includes(JSON.stringify(finalFeedback)),
    `最终状态必须是某种合法串行序，实际为 ${JSON.stringify(finalFeedback)}`,
  );

  // 反过来排队（撤销先落库）：撤销清掉旧条目，后到的追加仍然要落库。
  const reversed = new CasPrefsStore({ explicit_feedback: ['别每次都逗我'] }, true);
  const [revokedFirst, appendedSecond] = await Promise.all([
    revokeCommunicationPrefs({ visitorId: 'visitor-1', mode: 'explicit_feedback', store: reversed }),
    recordCommunicationFeedback({ visitorId: 'visitor-1', feedback: '少用感叹号', store: reversed }),
  ]);

  assert.equal(revokedFirst.ok, true);
  assert.equal(appendedSecond.ok, true);
  assert.deepEqual(
    reversed.current?.explicit_feedback,
    ['少用感叹号'],
    '撤销不该把随后到达的更正一起吞掉',
  );
});

test('P2-5 源码级守卫：默认 store 带 CAS 能力，且两条写路径都只走同一套编排', () => {
  const source = moduleSource();

  assert.match(source, /export interface CommunicationPrefsSnapshot/);
  assert.match(source, /loadWithVersion\?\(visitorId: string\): Promise<CommunicationPrefsSnapshot>/);
  assert.match(source, /saveIfUnchanged\?\(/);
  // 守卫必须和写入在同一条语句里，不能退化成「先读一次、再单独判断一次」。
  assert.match(source, /WHERE visitor_id=\? AND updated_at=\?/);
  // 追加与撤销都只能通过编排函数写入，不得在别处退回朴素的 load + save。
  assert.equal(
    (source.match(/applyPrefsChange\(store, visitorId/g) ?? []).length,
    2,
    '追加与撤销两条写路径都必须走 CAS 编排',
  );
  // 本进程内也要排队：CAS 只保证「不覆盖别人」，排队才保证「自己排得上」。
  assert.match(source, /async function withPrefsLock<T>\(/);
  assert.match(source, /return withPrefsLock\(visitorId, async \(\) => \{/);
  assert.match(source, /delete prefsWriteQueues\[visitorId\]/, '队列排空后要摘键，不能长期累积');
});
