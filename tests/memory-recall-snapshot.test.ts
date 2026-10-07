import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RECALL_MAX_TURNS,
  DEFAULT_RECALL_TTL_MS,
  SNAPSHOT_MAX_MEMORIES,
  applyWriteToSnapshot,
  hasRecallTrigger,
  resolveRecallMaxTurns,
  resolveRecallTtlMs,
  shouldRefreshRecall,
  type RecallSnapshot,
} from '../src/lib/memory/recall-snapshot';
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

function snapshot(overrides: Partial<RecallSnapshot> = {}): RecallSnapshot {
  return { memories: [memory('a')], refreshedAt: '2026-09-30T04:00:00.000Z', turnsSinceRefresh: 0, ...overrides };
}

const now = new Date('2026-09-30T04:05:00.000Z');
const base = { snapshot: snapshot(), messageText: '今天有点累', now, ttlMs: DEFAULT_RECALL_TTL_MS, maxTurns: DEFAULT_RECALL_MAX_TURNS };

test('a session without a snapshot always recalls live', () => {
  const decision = shouldRefreshRecall({ ...base, snapshot: null });
  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, 'no-snapshot');
});

test('a snapshot inside the TTL is reused instead of paying for another recall', () => {
  const decision = shouldRefreshRecall(base);
  assert.equal(decision.refresh, false);
  assert.equal(decision.reason, 'reuse');
});

test('an expired snapshot is refreshed once the ttl has passed', () => {
  const decision = shouldRefreshRecall({ ...base, now: new Date('2026-09-30T04:16:00.000Z') });
  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, 'expired');
});

test('a long run of turns refreshes even inside the ttl', () => {
  const decision = shouldRefreshRecall({ ...base, snapshot: snapshot({ turnsSinceRefresh: DEFAULT_RECALL_MAX_TURNS }) });
  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, 'turn-limit');
});

test('recall trigger words force a refresh, because the user is asking about the past', () => {
  for (const text of ['你还记得我上次说的面试吗', '之前那个事怎么样了', '我跟你说过的那只猫', '那天真的很开心']) {
    const decision = shouldRefreshRecall({ ...base, messageText: text });
    assert.equal(decision.refresh, true, text);
    assert.equal(decision.reason, 'trigger', text);
  }
  assert.equal(hasRecallTrigger('今天吃什么'), false);
  assert.equal(hasRecallTrigger('你还记得吗'), true);
});

test('ttl=0 disables the cache so behaviour can be rolled back to today', () => {
  const decision = shouldRefreshRecall({ ...base, ttlMs: 0 });
  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, 'disabled');
});

test('env knobs fall back to defaults on blank or nonsense values', () => {
  assert.equal(resolveRecallTtlMs({}), DEFAULT_RECALL_TTL_MS);
  assert.equal(resolveRecallTtlMs({ MEMORY_RECALL_TTL_MS: '' }), DEFAULT_RECALL_TTL_MS);
  assert.equal(resolveRecallTtlMs({ MEMORY_RECALL_TTL_MS: 'abc' }), DEFAULT_RECALL_TTL_MS);
  assert.equal(resolveRecallTtlMs({ MEMORY_RECALL_TTL_MS: '0' }), 0);
  assert.equal(resolveRecallTtlMs({ MEMORY_RECALL_TTL_MS: '60000' }), 60_000);
  assert.equal(resolveRecallMaxTurns({}), DEFAULT_RECALL_MAX_TURNS);
  assert.equal(resolveRecallMaxTurns({ MEMORY_RECALL_MAX_TURNS: '-3' }), DEFAULT_RECALL_MAX_TURNS);
  assert.equal(resolveRecallMaxTurns({ MEMORY_RECALL_MAX_TURNS: '4' }), 4);
});

test('a memory written this turn is usable next turn without paying for a recall', () => {
  const fresh = memory('new', '用户喜欢被叫小朋友');
  const afterAdd = applyWriteToSnapshot([memory('a'), memory('b')], { kind: 'add', memory: fresh });
  assert.deepEqual(afterAdd.map((m) => m.id), ['new', 'a', 'b']);

  // UPDATE 与 ADD 一样提到最前：刚被改写的记忆是「最新鲜的事实」，比旧快照里的任何一条都更该被看到。
  const afterUpdate = applyWriteToSnapshot([memory('a'), memory('b')], { kind: 'update', memory: memory('b', '改过的内容') });
  assert.deepEqual(afterUpdate.map((m) => m.id), ['b', 'a']);
  assert.equal(afterUpdate[0]!.text, '改过的内容');

  const afterDelete = applyWriteToSnapshot([memory('a'), memory('b')], { kind: 'delete', memory: memory('b') });
  assert.deepEqual(afterDelete.map((m) => m.id), ['a']);
});

test('adding a memory that already exists replaces instead of duplicating', () => {
  const afterAdd = applyWriteToSnapshot([memory('a'), memory('b')], { kind: 'add', memory: memory('a', '更新后的 a') });
  assert.deepEqual(afterAdd.map((m) => m.id), ['a', 'b']);
  assert.equal(afterAdd[0]!.text, '更新后的 a');
});

test('the snapshot stays bounded no matter how long the session runs', () => {
  const many = Array.from({ length: SNAPSHOT_MAX_MEMORIES }, (_, index) => memory(`m${index}`));
  const afterAdd = applyWriteToSnapshot(many, { kind: 'add', memory: memory('fresh') });
  assert.equal(afterAdd.length, SNAPSHOT_MAX_MEMORIES);
  assert.equal(afterAdd[0]!.id, 'fresh');
});
