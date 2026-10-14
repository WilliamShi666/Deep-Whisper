import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMemoryWritesToSnapshot, existingMemoriesForWrite, recallWithSnapshot, type RecallSnapshotStore } from '../src/lib/memory/recall-snapshot-store';
import { recallQueries } from '../src/lib/memory/service';
import { DEFAULT_RECALL_TTL_MS, isRecallTrusted, type RecallSnapshot, type RecallSource } from '../src/lib/memory/recall-snapshot';
import type { RecalledMemory } from '../src/lib/memory/service';

function memory(id: string, text = `记忆 ${id}`): RecalledMemory {
  return {
    id, text, layer: 'L2', bucket: 'long_term_impression', domain: 'preference',
    memoryType: 'preference_summary', importance: 0.8, confidence: 'explicit',
    evidenceMemoryIds: [], score: 0.9, observedAt: '2026-09-29T10:00:00.000Z',
    occurredAt: null, timePrecision: null, validUntil: null, temporalStatus: 'timeless',
    sourceConversationIds: ['c1'], createdAt: null, updatedAt: null,
  };
}

class FakeStore implements RecallSnapshotStore {
  current: RecallSnapshot | null = null;
  writes: RecallSnapshot[] = [];

  async read() { return this.current; }
  async write(snapshot: RecallSnapshot) { this.current = snapshot; this.writes.push(snapshot); }
}

const now = new Date('2026-09-30T04:00:00.000Z');
// 与真实聊天路径同形：1 个主 query + 2 个补充角度 = 3 次扇出。
// 不再传 searchesPerRecall —— 它被废弃了，上报值只能由编排层推导。
const base = {
  visitorId: 'v1', companionId: 'c1', query: '围绕当前消息召回',
  supplementalQueries: ['补充角度一', '补充角度二'],
  messageText: '今天有点累',
  now, ttlMs: DEFAULT_RECALL_TTL_MS, maxTurns: 10,
};

test('a fresh snapshot is served without a single memory search', async () => {
  const store = new FakeStore();
  store.current = { memories: [memory('cached')], refreshedAt: '2026-09-30T03:59:00.000Z', turnsSinceRefresh: 0 };
  let calls = 0;

  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => { calls += 1; return []; } });

  assert.equal(calls, 0, 'the whole point: no Mem0 search when the snapshot is fresh');
  assert.equal(outcome.source, 'snapshot');
  assert.equal(outcome.searches, 0);
  assert.deepEqual(outcome.memories.map((m) => m.id), ['cached']);
  assert.equal(store.current?.turnsSinceRefresh, 1, 'the reuse counter advances');
});

test('an empty snapshot is still a snapshot: recall ran and found nothing', async () => {
  const store = new FakeStore();
  store.current = { memories: [], refreshedAt: '2026-09-30T03:59:00.000Z', turnsSinceRefresh: 0 };
  let calls = 0;

  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => { calls += 1; return []; } });

  assert.equal(calls, 0);
  assert.equal(outcome.source, 'snapshot');
  assert.deepEqual(outcome.memories, []);
});

test('a missing snapshot recalls live and stores the result for the next turn', async () => {
  const store = new FakeStore();

  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => [memory('fresh')] });

  assert.equal(outcome.source, 'live');
  assert.equal(outcome.searches, 3);
  assert.deepEqual(store.current?.memories.map((m) => m.id), ['fresh']);
  assert.equal(store.current?.turnsSinceRefresh, 0);
  assert.equal(store.current?.refreshedAt, now.toISOString());
});

test('a failed refresh falls back to the previous snapshot instead of going blank', async () => {
  const store = new FakeStore();
  store.current = { memories: [memory('old')], refreshedAt: '2026-09-30T02:00:00.000Z', turnsSinceRefresh: 0 };

  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => { throw new Error('429 quota exceeded'); } });

  assert.equal(outcome.source, 'stale-fallback');
  assert.deepEqual(outcome.memories.map((m) => m.id), ['old'], 'the companion keeps remembering the last known things');
  assert.equal(store.current?.refreshedAt, '2026-09-30T02:00:00.000Z', 'a failed refresh must not overwrite the good snapshot');
});

test('a failed refresh with nothing cached degrades to unavailable rather than throwing', async () => {
  const store = new FakeStore();

  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => { throw new Error('network down'); } });

  assert.equal(outcome.source, 'unavailable');
  assert.deepEqual(outcome.memories, []);
});

test('without a store the behaviour is exactly today: always live', async () => {
  let calls = 0;
  const outcome = await recallWithSnapshot({ ...base, store: null, recall: async () => { calls += 1; return [memory('live')]; } });

  assert.equal(calls, 1);
  assert.equal(outcome.source, 'live');
  assert.equal(outcome.searches, 3);
});

test('a written memory joins the snapshot so the next turn can use it for free', async () => {
  const store = new FakeStore();
  store.current = { memories: [memory('a')], refreshedAt: now.toISOString(), turnsSinceRefresh: 2 };

  await applyMemoryWritesToSnapshot({ store, writes: [{ kind: 'add', memory: memory('new', '用户喜欢被叫小朋友') }] });

  assert.deepEqual(store.current?.memories.map((m) => m.id), ['new', 'a']);
  assert.equal(store.current?.turnsSinceRefresh, 2, 'a write does not reset the reuse counter');
});

test('snapshot maintenance never breaks the caller when storage is unavailable', async () => {
  const store: RecallSnapshotStore = {
    async read() { throw new Error('db down'); },
    async write() {},
  };

  await assert.doesNotReject(applyMemoryWritesToSnapshot({ store, writes: [{ kind: 'add', memory: memory('x') }] }));
});

test('a whole batch of writes touches the snapshot exactly once', async () => {
  const store = new FakeStore();
  store.current = { memories: [memory('a')], refreshedAt: now.toISOString(), turnsSinceRefresh: 0 };

  await applyMemoryWritesToSnapshot({
    store,
    writes: [
      { kind: 'add', memory: memory('new') },
      { kind: 'delete', memory: memory('a') },
    ],
  });

  assert.equal(store.writes.length, 1, 'one read + one write for the whole batch');
  assert.deepEqual(store.current?.memories.map((m) => m.id), ['new']);
});

test('an empty batch is a no-op and never touches storage', async () => {
  const store = new FakeStore();
  store.current = { memories: [memory('a')], refreshedAt: now.toISOString(), turnsSinceRefresh: 0 };

  await applyMemoryWritesToSnapshot({ store, writes: [] });

  assert.equal(store.writes.length, 0);
});

// ── code review r1 的 F2：快照读写必须与召回解耦 ──────────────────────────
// 评审用真实代码复现出三个子问题，这里把修复后的语义钉住。

class ThrowingReadStore implements RecallSnapshotStore {
  async read(): Promise<RecallSnapshot | null> { throw new Error('db read down'); }
  async write(): Promise<void> {}
}

class ThrowingWriteStore implements RecallSnapshotStore {
  current: RecallSnapshot | null = null;
  constructor(initial: RecallSnapshot | null) { this.current = initial; }
  async read() { return this.current; }
  async write(): Promise<void> { throw new Error('db write down'); }
}

test('a snapshot read failure must not take the turn down, nor lose the live recall', async () => {
  let calls = 0;
  const outcome = await recallWithSnapshot({
    ...base,
    store: new ThrowingReadStore(),
    recall: async () => { calls += 1; return [memory('live')]; },
  });

  assert.equal(calls, 1, '读快照失败不能阻止这一轮真的去召回');
  assert.equal(outcome.source, 'live');
  assert.deepEqual(outcome.memories.map((m) => m.id), ['live']);
});

test('when the live recall succeeded, a failed snapshot write must NOT discard the paid-for result', async () => {
  let calls = 0;
  const outcome = await recallWithSnapshot({
    ...base,
    store: new ThrowingWriteStore(null),
    recall: async () => { calls += 1; return [memory('fresh')]; },
  });

  assert.equal(calls, 1);
  assert.equal(outcome.source, 'live', '写快照失败 ≠ 召回失败');
  assert.deepEqual(outcome.memories.map((m) => m.id), ['fresh'], '已付费拿到的记忆不能因为缓存写不进去就被丢掉');
});

test('when reusing a snapshot, a failed counter write must not break the turn', async () => {
  const store = new ThrowingWriteStore({
    memories: [memory('cached')], refreshedAt: '2026-09-30T03:59:00.000Z', turnsSinceRefresh: 0,
  });

  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => { throw new Error('must not be called'); } });

  assert.equal(outcome.source, 'snapshot');
  assert.deepEqual(outcome.memories.map((m) => m.id), ['cached']);
});

test('a write-through failure must never surface to the caller', async () => {
  const store = new ThrowingWriteStore({ memories: [memory('a')], refreshedAt: now.toISOString(), turnsSinceRefresh: 0 });
  await assert.doesNotReject(applyMemoryWritesToSnapshot({ store, writes: [{ kind: 'add', memory: memory('x') }] }));
});

/**
 * F1 回归：`memoriesTrusted` 是「这份 `memories` 能不能当去重依据」的唯一出口。
 *
 * 为什么这条不能省：调用方通常只拿到 `memories` 数组，而 `[]` 有两种含义。
 * 纯逻辑这一层必须把「不知道」与「确实是空的」分开，否则路由只能靠猜 ——
 * 猜错的后果是把 Mem0 里已有的事实再 ADD 一遍（同一句话存成两条记忆）。
 */
test('isRecallTrusted: only "unavailable" is untrustworthy, because only it means "we do not know"', () => {
  const trusted: RecallSource[] = ['live', 'snapshot', 'stale-fallback'];
  for (const source of trusted) {
    assert.equal(isRecallTrusted(source), true, `${source} 建立在真实召回结果之上，可以当去重依据`);
  }
  assert.equal(isRecallTrusted('unavailable'), false, '召回失败 = 不知道有哪些既有记忆，绝不可当空集复用');
});

test('every source reports whether its memories may be reused as a dedup baseline', async () => {
  // live：真查过 → 可信
  const live = await recallWithSnapshot({ ...base, store: new FakeStore(), recall: async () => [memory('live')] });
  assert.equal(live.source, 'live');
  assert.equal(live.memoriesTrusted, true);

  // snapshot：过去某次真实查询的结果 → 可信，且本轮零检索
  const cached = new FakeStore();
  cached.current = { memories: [memory('cached')], refreshedAt: '2026-09-30T03:59:00.000Z', turnsSinceRefresh: 0 };
  const reused = await recallWithSnapshot({ ...base, store: cached, recall: async () => [] });
  assert.equal(reused.source, 'snapshot');
  assert.equal(reused.memoriesTrusted, true);
  assert.equal(reused.searches, 0);

  // stale-fallback：沿用上一次**真实**的结果 → 仍可信（那些记忆确实在 Mem0 里）
  const stale = new FakeStore();
  stale.current = { memories: [memory('old')], refreshedAt: '2026-09-30T02:00:00.000Z', turnsSinceRefresh: 0 };
  const fell = await recallWithSnapshot({ ...base, store: stale, recall: async () => { throw new Error('429'); } });
  assert.equal(fell.source, 'stale-fallback');
  assert.equal(fell.memoriesTrusted, true, '沿用旧快照时我们仍然知道 Mem0 里有什么');

  // unavailable：什么都不知道 → 不可信。这是 F1 的关键：它必须是一个显式的 false，
  // 而不是让调用方从「数组是空的」去反推。
  const failed = await recallWithSnapshot({ ...base, store: new FakeStore(), recall: async () => { throw new Error('down'); } });
  assert.equal(failed.source, 'unavailable');
  assert.equal(failed.memoriesTrusted, false);
  assert.deepEqual(failed.memories, []);
});

test('a total recall failure resolves as unavailable instead of rejecting at the caller', async () => {
  // 之前这种失败会 reject，调用方兜成 `[]` —— 于是「不可信」被折叠成「空」。
  // 现在它必须**解析**成一个带 memoriesTrusted:false 的结论，让调用方无法忽略。
  const store = new FakeStore();
  const outcome = await recallWithSnapshot({ ...base, store, recall: async () => { throw new Error('all searches failed'); } });
  assert.equal(outcome.source, 'unavailable');
  assert.equal(outcome.memoriesTrusted, false);
  assert.equal(outcome.searches, 3, '付费与否要如实上报：这 3 次检索确实发出去了');
});

// ── code review r1 的 F1：`[]` 不能冒充「召回成功且没有记忆」 ────────────────
// 评审用真实代码复现：Mem0 健康、既有记忆就在库里时，降级路径传 [] 会让写前去重被跳过，
// 于是同一条事实被写成两条记忆（旧路径 searches=1 added=0；新路径 searches=0 added=1）。

test('only a trustworthy recall result may skip the pre-write safety recall', () => {
  const memories = [memory('a')];

  assert.deepEqual(existingMemoriesForWrite({ source: 'live', memories }), memories);
  assert.deepEqual(existingMemoriesForWrite({ source: 'snapshot', memories }), memories);
  assert.deepEqual(existingMemoriesForWrite({ source: 'stale-fallback', memories }), memories);

  // 召回不可信时必须交回 undefined —— 让写路径自己安全召回一次，而不是当作「没有记忆」。
  assert.equal(existingMemoriesForWrite({ source: 'unavailable', memories: [] }), undefined);
  assert.equal(existingMemoriesForWrite({ source: 'unavailable', memories }), undefined,
    '不可信就是不可信，即使手里有一批来源不明的记忆');
});

// ── spec review r2 的 F3-b：成本度量必须有回归防护 ──────────────────────────
// 评审用变异测试证明：把 route 的 `recallQueries(...).length` 硬编码成 3、或去掉
// recallQueries 的去重，整套 245 项仍然全绿 —— 也就是「上报的 searches」与
// 「实际发出的 SEARCH 次数」可以各自漂移。这两条断言把等价关系钉死。

test('the reported `searches` equals what the recall actually issued', async () => {
  const issued: string[] = [];
  const outcome = await recallWithSnapshot({
    ...base,
    store: null,
    // 故意不传 searchesPerRecall：上报值必须由编排层自己推导出来
    recall: async () => { issued.push('call'); return []; },
  } as never);

  // 没有任何 gateway 计数可看时，至少证明它等于唯一来源 recallQueries 的长度
  assert.equal(outcome.searches, recallQueries(base).length);
  assert.equal(outcome.searches, 3, '主 query + 2 个补充角度 = 3 次扇出');
});

test('the derived `searches` counts supplemental queries and de-duplicates them', () => {
  // 去重：重复的补充 query 只算一次（变异 D 去掉 new Set 后这里会红）
  assert.equal(recallQueries({ query: 'q', supplementalQueries: ['q'] }).length, 1);
  // 截断：最多 3 条（变异 B 改成 slice(0,2) 后这里会红）
  assert.equal(recallQueries({ query: 'q', supplementalQueries: ['a', 'b', 'c', 'd'] }).length, 3);
  // 空串被过滤
  assert.equal(recallQueries({ query: 'q', supplementalQueries: ['', '  '] }).length, 1);
});

test('the reported search count has no caller input at all', async () => {
  // 这个数字曾经可以由调用方传入（被忽略并记一条日志）。但那条日志**永远不会触发** ——
  // 唯一调用方传的是正确值 —— 留下的只是「存在一个可以说谎的 API 面」。
  // 2026-09-30 两轴评审把入参彻底删除：没有任何入口能影响它，唯一来源是
  // 与 `service.recall` 共用 `recallQueries` 的那一处推导。
  const supplementalQueries = ['第二个查询', '第三个查询'];
  const outcome = await recallWithSnapshot({
    ...base,
    store: null,
    supplementalQueries,
    recall: async () => [],
  });

  assert.equal(
    outcome.searches,
    recallQueries({ query: base.query, supplementalQueries }).length,
    '上报值必须等于真实扇出',
  );
  assert.equal(outcome.searches, 3, '主查询 + 两个补充查询 = 3 次');
});
