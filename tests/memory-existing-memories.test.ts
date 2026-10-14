import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryService,
  type MemoryGateway,
  type MemoryOrganizer,
  type MemoryOrganizerInput,
  type ProviderMemory,
  type RecalledMemory,
} from '../src/lib/memory/service';

class CountingGateway implements MemoryGateway {
  memories: ProviderMemory[] = [];
  searches: string[] = [];
  adds: string[] = [];

  async search(query: string) {
    this.searches.push(query);
    return this.memories;
  }

  async add(text: string, options: { userId: string; appId: string; metadata: Record<string, unknown> }) {
    this.adds.push(text);
    const created: ProviderMemory = { id: `memory-${this.memories.length + 1}`, memory: text, metadata: options.metadata };
    this.memories.push(created);
    return created;
  }

  async update() {}
  async delete() {}
}

/** 整理器被调用时「看到」的既有记忆，用来断言复用是否真的生效。 */
class RecordingOrganizer implements MemoryOrganizer {
  seen: RecalledMemory[][] = [];

  async organize(input: MemoryOrganizerInput) {
    this.seen.push(input.existingMemories);
    return { operations: [] };
  }
}

function recalled(id: string, text: string): RecalledMemory {
  return {
    id, text, layer: 'L2', bucket: 'long_term_impression', domain: 'preference',
    memoryType: 'preference_summary', importance: 0.8, confidence: 'explicit',
    evidenceMemoryIds: [], score: 0.9, observedAt: '2026-09-29T10:00:00.000Z',
    occurredAt: null, timePrecision: null, validUntil: null, temporalStatus: 'timeless',
    sourceConversationIds: ['c1'], createdAt: null, updatedAt: null,
  };
}

const exchange = {
  visitorId: 'v1', companionId: 'c1', conversationId: 'conv1',
  userMessageId: 'u1', userText: '我最近喜欢上了红烧肉', assistantMessageId: 'a1', assistantText: '记住了',
};

function build(gateway: CountingGateway, organizer: RecordingOrganizer) {
  return createMemoryService({
    enabled: true,
    appId: 'app',
    gateway,
    organizer,
    organizerModel: 'test-model',
  });
}

test('the write path reuses the memories recalled for this turn instead of paying for another search', async () => {
  const gateway = new CountingGateway();
  const organizer = new RecordingOrganizer();
  const service = build(gateway, organizer);
  const alreadyRecalled = [recalled('m1', '用户喜欢红烧肉'), recalled('m2', '用户养了一只猫')];

  await service.rememberExchange({ ...exchange, existingMemories: alreadyRecalled });

  assert.deepEqual(gateway.searches, [], 'no extra Mem0 search may be issued when the turn already recalled');
  assert.deepEqual(organizer.seen[0]?.map((m) => m.id), ['m1', 'm2'], 'the organizer must see exactly the memories recalled this turn');
});

test('omitting existingMemories keeps the original behaviour: one recall before writing', async () => {
  const gateway = new CountingGateway();
  const organizer = new RecordingOrganizer();
  gateway.memories = [{
    id: 'm1',
    memory: '用户喜欢红烧肉',
    score: 0.9,
    metadata: {
      app_id: 'app', visitor_id: 'v1', companion_id: 'c1', layer: 'L2',
      memory_type: 'preference_summary', status: 'active', observed_at: '2026-09-29T10:00:00.000Z',
    },
  }];
  const service = build(gateway, organizer);

  await service.rememberExchange({ ...exchange });

  assert.equal(gateway.searches.length, 1, 'the legacy path still recalls exactly once');
  assert.equal(organizer.seen[0]?.length, 1);
});

test('an explicitly empty set means "recall ran and found nothing" — so only pass it when it did', async () => {
  // 服务层无法分辨「确实是空的」与「我们不知道」：它只看到一个数组。
  // 因此**区分必须发生在调用方**（见路由的 memoriesTrusted 分支，以及
  // memory-recall-snapshot-store 的 isRecallTrusted 用例）。服务层在这里保证的是：
  // 显式传 `[]` 时不额外检索 —— 这正是「可信地空」才配得到的待遇。
  const gateway = new CountingGateway();
  const organizer = new RecordingOrganizer();
  const service = build(gateway, organizer);

  await service.rememberExchange({ ...exchange, existingMemories: [] });

  assert.deepEqual(gateway.searches, []);
  assert.deepEqual(organizer.seen[0], []);
});

test('omitting the set must NOT be confused with an empty one: it still recalls', async () => {
  // 反面对照：同一套输入，唯一的差别是「不传」而不是传 `[]`。
  // 这条与上一条一起钉住 `undefined !== []` 这个契约 ——
  // 路由的 F1 缺陷正是把「召回不可信」折叠成了 `[]`，于是丢掉了写前的安全召回。
  const gateway = new CountingGateway();
  const organizer = new RecordingOrganizer();
  const service = build(gateway, organizer);

  await service.rememberExchange({ ...exchange });

  assert.equal(gateway.searches.length, 1, 'undefined must fall back to a real recall');
});
