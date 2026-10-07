import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSnapshotWriteAllowed,
  normalizeSnapshotUpdate,
  persistRelationshipSnapshot,
  type RelationshipSnapshotFields,
  type RelationshipSnapshotRecord,
  type RelationshipSnapshotStore,
  type RelationshipSnapshotUpdate,
} from '../src/lib/memory/relationship-snapshot';

// 关系快照写入守卫的模块级测试。
//
// 全程使用内存假存储，不连数据库、不发网络请求：
// - fake.load / fake.write 都计数，用来断言「零调用」与「write 从未被尝试」。
// - fake.write 内部实现与真实 store 相同的原子守卫（updated_at 严格早于
//   observedAt 才落库），因此测试既能驱动「预检拒绝」，也能驱动「写入时输掉竞争」。

const TURN_A_OBSERVED_AT = '2026-09-16T10:00:00.000Z';
const TURN_B_OBSERVED_AT = '2026-09-16T10:05:00.000Z';
const STORED_UPDATED_AT = '2026-09-16T09:00:00.000Z';

interface FakeStoreState {
  record: RelationshipSnapshotRecord | null;
  loadCalls: number;
  writeCalls: number;
  loadInputs: Array<{ visitorId: string; companionId: string }>;
  writeInputs: Array<{
    visitorId: string;
    companionId: string;
    observedAt: string;
    fields: RelationshipSnapshotFields;
  }>;
}

interface FakeStoreOptions {
  record?: RelationshipSnapshotRecord | null;
  loadError?: unknown;
  writeError?: unknown;
  /** 强制 write 返回固定 changed 值，模拟「写入时输掉竞争」。 */
  forcedChanged?: number;
}

function emptyRecord(
  overrides: Partial<RelationshipSnapshotRecord> = {},
): RelationshipSnapshotRecord {
  return {
    relationshipStage: null,
    emotionalTone: null,
    dynamicSummary: null,
    keyMilestones: [],
    updatedAt: null,
    ...overrides,
  };
}

function createFakeStore(options: FakeStoreOptions = {}): {
  store: RelationshipSnapshotStore;
  state: FakeStoreState;
} {
  const state: FakeStoreState = {
    record: options.record ?? null,
    loadCalls: 0,
    writeCalls: 0,
    loadInputs: [],
    writeInputs: [],
  };

  const store: RelationshipSnapshotStore = {
    async load(input) {
      state.loadCalls += 1;
      state.loadInputs.push({ visitorId: input.visitorId, companionId: input.companionId });
      if (options.loadError !== undefined) throw options.loadError;
      const current = state.record;
      if (!current) return null;
      return { ...current, keyMilestones: [...current.keyMilestones] };
    },

    async write(input) {
      state.writeCalls += 1;
      state.writeInputs.push({
        visitorId: input.visitorId,
        companionId: input.companionId,
        observedAt: input.observedAt,
        fields: { ...input.fields },
      });
      if (options.writeError !== undefined) throw options.writeError;
      if (options.forcedChanged !== undefined) return { changed: options.forcedChanged };

      const current = state.record;
      const storedAt = current?.updatedAt ? Date.parse(current.updatedAt) : Number.NaN;
      const observed = Date.parse(input.observedAt);
      if (current && Number.isFinite(storedAt) && Number.isFinite(observed) && storedAt >= observed) {
        return { changed: 0 };
      }

      state.record = {
        relationshipStage: input.fields.relationshipStage ?? current?.relationshipStage ?? null,
        emotionalTone: input.fields.emotionalTone ?? current?.emotionalTone ?? null,
        dynamicSummary: input.fields.dynamicSummary ?? current?.dynamicSummary ?? null,
        keyMilestones: input.fields.keyMilestones
          ? [...input.fields.keyMilestones]
          : (current?.keyMilestones ?? []),
        updatedAt: input.observedAt,
      };
      return { changed: 1 };
    },
  };

  return { store, state };
}

test('normalizeSnapshotUpdate returns null for empty updates', () => {
  assert.equal(normalizeSnapshotUpdate(null), null);
  assert.equal(normalizeSnapshotUpdate(undefined), null);
  assert.equal(normalizeSnapshotUpdate({}), null);
  assert.equal(normalizeSnapshotUpdate({ relationshipStage: '   ' }), null);
  assert.equal(
    normalizeSnapshotUpdate({ relationshipStage: null, emotionalTone: undefined, dynamicSummary: '  ' }),
    null,
  );
  assert.equal(normalizeSnapshotUpdate({ keyMilestones: [] }), null);
  assert.equal(normalizeSnapshotUpdate({ keyMilestones: ['', '   '] }), null);
});

test('normalizeSnapshotUpdate trims strings, drops blanks, trims and de-duplicates milestones', () => {
  const fields = normalizeSnapshotUpdate({
    relationshipStage: '  暧昧期  ',
    emotionalTone: '  温柔但克制  ',
    dynamicSummary: '   ',
    keyMilestones: ['  第一次一起看日出 ', '第一次一起看日出', '   ', '她记住了他的口味', '她记住了他的口味'],
  });

  assert.deepEqual(fields, {
    relationshipStage: '暧昧期',
    emotionalTone: '温柔但克制',
    keyMilestones: ['第一次一起看日出', '她记住了他的口味'],
  });
  assert.equal('dynamicSummary' in (fields ?? {}), false);
});

test('normalizeSnapshotUpdate ignores non-string junk instead of throwing', () => {
  const junk = normalizeSnapshotUpdate({
    relationshipStage: 42,
    emotionalTone: { text: '温柔' },
    keyMilestones: ['  有效  ', 7, null, '有效'],
  } as unknown as RelationshipSnapshotUpdate);

  assert.deepEqual(junk, { keyMilestones: ['有效'] });

  const notAnArray = normalizeSnapshotUpdate({
    keyMilestones: '不是数组',
  } as unknown as RelationshipSnapshotUpdate);

  assert.equal(notAnArray, null);
});

test('isSnapshotWriteAllowed allows the first write when nothing is stored', () => {
  assert.equal(isSnapshotWriteAllowed(null, TURN_A_OBSERVED_AT), true);
});

test('isSnapshotWriteAllowed allows an observation strictly later than the stored one', () => {
  const current = emptyRecord({ updatedAt: STORED_UPDATED_AT });

  assert.equal(isSnapshotWriteAllowed(current, TURN_B_OBSERVED_AT), true);
});

test('isSnapshotWriteAllowed refuses an earlier or equal observation (先发后到)', () => {
  const current = emptyRecord({ updatedAt: TURN_B_OBSERVED_AT });

  assert.equal(isSnapshotWriteAllowed(current, TURN_A_OBSERVED_AT), false);
  assert.equal(isSnapshotWriteAllowed(current, TURN_B_OBSERVED_AT), false);
});

test('isSnapshotWriteAllowed fails open on an unparseable stored updatedAt', () => {
  let allowed = false;

  assert.doesNotThrow(() => {
    allowed = isSnapshotWriteAllowed(emptyRecord({ updatedAt: 'not-a-date' }), TURN_A_OBSERVED_AT);
  });

  assert.equal(allowed, true);
  assert.equal(isSnapshotWriteAllowed(emptyRecord({ updatedAt: '' }), TURN_A_OBSERVED_AT), true);
  assert.equal(isSnapshotWriteAllowed(emptyRecord({ updatedAt: null }), TURN_A_OBSERVED_AT), true);
});

test('persistRelationshipSnapshot skips a null or undefined update without touching the store', async () => {
  const fromNull = createFakeStore();
  const nullOutcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_A_OBSERVED_AT,
    update: null,
    store: fromNull.store,
  });

  assert.deepEqual(nullOutcome, { status: 'skipped', reason: 'no-update' });
  assert.equal(fromNull.state.loadCalls, 0);
  assert.equal(fromNull.state.writeCalls, 0);

  const fromUndefined = createFakeStore();
  const undefinedOutcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_A_OBSERVED_AT,
    update: undefined,
    store: fromUndefined.store,
  });

  assert.deepEqual(undefinedOutcome, { status: 'skipped', reason: 'no-update' });
  assert.equal(fromUndefined.state.loadCalls, 0);
  assert.equal(fromUndefined.state.writeCalls, 0);
});

test('persistRelationshipSnapshot skips an update that normalizes to empty without touching the store', async () => {
  const empty = createFakeStore();
  const outcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_A_OBSERVED_AT,
    update: { relationshipStage: '   ', keyMilestones: ['  '] },
    store: empty.store,
  });

  assert.deepEqual(outcome, { status: 'skipped', reason: 'empty-update' });
  assert.equal(empty.state.loadCalls, 0);
  assert.equal(empty.state.writeCalls, 0);

  // 十轮日常寒暄：整理器每轮都可能被触发，但没有任何可写入的字段。
  const chitChat = createFakeStore();
  const ordinaryUpdates: RelationshipSnapshotUpdate[] = [
    {},
    { relationshipStage: '' },
    { emotionalTone: '   ' },
    { dynamicSummary: '' },
    { relationshipStage: '\t', emotionalTone: '\n' },
    { keyMilestones: [] },
    { keyMilestones: ['', '  '] },
    { dynamicSummary: null },
    { relationshipStage: null, emotionalTone: null, dynamicSummary: null },
    { keyMilestones: [' '], dynamicSummary: '   ' },
  ];

  const outcomes = [];
  for (const update of ordinaryUpdates) {
    outcomes.push(
      await persistRelationshipSnapshot({
        visitorId: 'visitor-1',
        companionId: 'companion-1',
        observedAt: TURN_B_OBSERVED_AT,
        update,
        store: chitChat.store,
      }),
    );
  }

  assert.equal(outcomes.length, 10);
  for (const item of outcomes) {
    assert.deepEqual(item, { status: 'skipped', reason: 'empty-update' });
  }
  assert.equal(chitChat.state.writeCalls, 0);
  assert.equal(chitChat.state.loadCalls, 0);
});

test('a late async result never overwrites newer state (先发后到, end to end)', async () => {
  const fake = createFakeStore({
    record: emptyRecord({
      relationshipStage: '初识',
      emotionalTone: '客气',
      dynamicSummary: '还在互相试探',
      updatedAt: STORED_UPDATED_AT,
    }),
  });

  // 轮次 B 后发生、先到：允许写入。
  const turnB = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_B_OBSERVED_AT,
    update: {
      relationshipStage: '心动期',
      emotionalTone: '黏人',
      dynamicSummary: 'B 的结果',
    },
    store: fake.store,
  });

  assert.deepEqual(turnB, {
    status: 'written',
    fields: ['dynamicSummary', 'emotionalTone', 'relationshipStage'],
  });
  const writeCallsAfterB = fake.state.writeCalls;

  // 轮次 A 先发起、后到：observedAt 更早，必须被拒绝。
  const turnA = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_A_OBSERVED_AT,
    update: {
      relationshipStage: '冷淡期',
      emotionalTone: '疏离',
      dynamicSummary: 'A 的迟到结果',
    },
    store: fake.store,
  });

  assert.deepEqual(turnA, { status: 'rejected', reason: 'stale-update' });
  assert.equal(fake.state.writeCalls, writeCallsAfterB);
  assert.equal(fake.state.writeInputs.length, 1);
  assert.deepEqual(fake.state.record, {
    relationshipStage: '心动期',
    emotionalTone: '黏人',
    dynamicSummary: 'B 的结果',
    keyMilestones: [],
    updatedAt: TURN_B_OBSERVED_AT,
  });
});

test('a store that loses the race itself (changed = 0) is reported as rejected, not written', async () => {
  const fake = createFakeStore({ forcedChanged: 0 });
  const outcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_B_OBSERVED_AT,
    update: { emotionalTone: '温柔' },
    store: fake.store,
  });

  assert.deepEqual(outcome, { status: 'rejected', reason: 'stale-update' });
  assert.notEqual(outcome.status, 'written');
  assert.equal(fake.state.writeCalls, 1);
  assert.equal(fake.state.record, null);
});

test('a rejecting load resolves to failed/load-failed and never throws', async () => {
  const loadError = new Error('database down');
  const fake = createFakeStore({ loadError });

  const outcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_B_OBSERVED_AT,
    update: { emotionalTone: '温柔' },
    store: fake.store,
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') throw new Error('expected a failed outcome');
  assert.equal(outcome.reason, 'load-failed');
  assert.equal(outcome.error, loadError);
  assert.equal(fake.state.writeCalls, 0);

  await assert.doesNotReject(async () =>
    persistRelationshipSnapshot({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      observedAt: TURN_B_OBSERVED_AT,
      update: { emotionalTone: '温柔' },
      store: fake.store,
    }),
  );
});

test('a rejecting write resolves to failed/write-failed and never throws', async () => {
  const writeError = new Error('write conflict');
  const fake = createFakeStore({ record: emptyRecord({ updatedAt: STORED_UPDATED_AT }), writeError });

  const outcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_B_OBSERVED_AT,
    update: { dynamicSummary: '新状态' },
    store: fake.store,
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') throw new Error('expected a failed outcome');
  assert.equal(outcome.reason, 'write-failed');
  assert.equal(outcome.error, writeError);

  await assert.doesNotReject(async () =>
    persistRelationshipSnapshot({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      observedAt: TURN_B_OBSERVED_AT,
      update: { dynamicSummary: '新状态' },
      store: fake.store,
    }),
  );
});

test('written reports only the fields that were actually persisted', async () => {
  const fake = createFakeStore();
  const outcome = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_B_OBSERVED_AT,
    update: { emotionalTone: '  温柔  ', dynamicSummary: '   ' },
    store: fake.store,
  });

  assert.deepEqual(outcome, { status: 'written', fields: ['emotionalTone'] });

  const written = fake.state.writeInputs[0]?.fields ?? {};
  assert.deepEqual(written, { emotionalTone: '温柔' });
  assert.equal('relationshipStage' in written, false);
  assert.equal('dynamicSummary' in written, false);
  assert.equal('keyMilestones' in written, false);
});

test('persistRelationshipSnapshot forwards the identity and observedAt it was given', async () => {
  const fake = createFakeStore();
  await persistRelationshipSnapshot({
    visitorId: 'visitor-9',
    companionId: 'companion-9',
    observedAt: TURN_B_OBSERVED_AT,
    update: { relationshipStage: '暧昧期' },
    store: fake.store,
  });

  assert.deepEqual(fake.state.loadInputs, [{ visitorId: 'visitor-9', companionId: 'companion-9' }]);
  assert.equal(fake.state.writeInputs.length, 1);
  assert.equal(fake.state.writeInputs[0]?.visitorId, 'visitor-9');
  assert.equal(fake.state.writeInputs[0]?.companionId, 'companion-9');
  assert.equal(fake.state.writeInputs[0]?.observedAt, TURN_B_OBSERVED_AT);
});

test('an empty update never constructs the default (Supabase) store', async () => {
  // 测试环境没有数据库环境变量：一旦提前构造默认 store 就会抛错，
  // 因此「不抛错」即证明默认 store 是惰性构造的。
  const noUpdate = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_A_OBSERVED_AT,
    update: null,
  });
  assert.deepEqual(noUpdate, { status: 'skipped', reason: 'no-update' });

  const emptyUpdate = await persistRelationshipSnapshot({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    observedAt: TURN_A_OBSERVED_AT,
    update: { relationshipStage: '   ' },
  });
  assert.deepEqual(emptyUpdate, { status: 'skipped', reason: 'empty-update' });
});