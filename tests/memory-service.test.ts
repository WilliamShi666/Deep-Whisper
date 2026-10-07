import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryService,
  RECALL_BUCKET_FLOOR,
  RECALL_LIMIT_DEFAULT,
  type MemoryBucket,
  type MemoryGateway,
  type MemoryOrganizer,
  type ProviderMemory,
} from '../src/lib/memory/service';

class FakeGateway implements MemoryGateway {
  memories: ProviderMemory[] = [];
  searches: Array<{ query: string; filters: Record<string, unknown> }> = [];
  updates: Array<{ id: string; text?: string; metadata?: Record<string, unknown> }> = [];
  deletes: string[] = [];

  async search(query: string, filters: Record<string, unknown>) {
    this.searches.push({ query, filters });
    return this.memories;
  }

  async add(text: string, options: {
    userId: string;
    appId: string;
    metadata: Record<string, unknown>;
    expirationDate?: string;
  }) {
    const memory: ProviderMemory = {
      id: `memory-${this.memories.length + 1}`,
      memory: text,
      metadata: options.metadata,
    };
    this.memories.push(memory);
    return memory;
  }

  async update(
    id: string,
    update: { text?: string; metadata?: Record<string, unknown>; expirationDate?: string | null },
  ) {
    this.updates.push({ id, text: update.text, metadata: update.metadata });
    const target = this.memories.find((memory) => memory.id === id);
    if (target) {
      if (update.text !== undefined) target.memory = update.text;
      if (update.metadata !== undefined) target.metadata = update.metadata;
    }
  }

  async delete(id: string) {
    this.deletes.push(id);
    this.memories = this.memories.filter((memory) => memory.id !== id);
  }
}

class PartiallyFailingGateway extends FakeGateway {
  override async search(query: string, filters: Record<string, unknown>) {
    if (query.includes('失败')) throw new Error('simulated search failure');
    return super.search(query, filters);
  }
}

const noopOrganizer: MemoryOrganizer = {
  async organize() {
    return { operations: [] };
  },
};

function activeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    app_id: 'test-app',
    visitor_id: 'visitor-1',
    companion_id: 'companion-1',
    layer: 'L3',
    memory_type: 'preference',
    status: 'active',
    observed_at: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

test('recall uses exact entity filters and only returns active, unexpired, in-scope memories', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    { id: 'valid', memory: '用户现在最喜欢豆浆油条', score: 0.9, metadata: activeMetadata() },
    {
      id: 'expired',
      memory: '用户今晚十点前在加班',
      metadata: activeMetadata({ valid_until: '2026-07-23T22:00:00.000Z' }),
    },
    {
      id: 'invalid-expiry',
      memory: '有效期损坏的记忆不应进入提示词',
      metadata: activeMetadata({ valid_until: 'not-a-date' }),
    },
    {
      id: 'superseded',
      memory: '用户以前喜欢小笼包',
      metadata: activeMetadata({ status: 'superseded' }),
    },
    {
      id: 'other-companion',
      memory: '不应泄露给当前恋人',
      metadata: activeMetadata({ companion_id: 'companion-2' }),
    },
  ];

  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '我现在喜欢什么早餐？',
  });

  assert.deepEqual(recalled.map((memory) => memory.id), ['valid']);
  assert.deepEqual(gateway.searches[0], {
    query: '我现在喜欢什么早餐？',
    filters: {
      AND: [
        { user_id: 'visitor-1' },
        { app_id: 'test-app' },
        { metadata: { companion_id: 'companion-1' } },
      ],
    },
  });
});

test('recall merges three query paths and prioritizes a due follow-up memory', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    {
      id: 'generic-preference',
      memory: '用户平时喜欢吃辣',
      score: 0.82,
      metadata: activeMetadata({
        importance: 0.7,
        temporal_status: 'timeless',
      }),
    },
    {
      id: 'interview-follow-up',
      memory: '用户于今天下午三点参加产品经理面试，尚未反馈结果',
      score: 0.76,
      metadata: activeMetadata({
        importance: 0.95,
        memory_type: 'time_bounded_commitment',
        temporal_status: 'upcoming',
        occurred_at: '2026-07-24T15:00:00+08:00',
        time_precision: 'exact',
        valid_until: '2026-07-31T23:59:59+08:00',
      }),
    },
  ];
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
    now: () => new Date('2026-07-24T16:00:00+08:00'),
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '我终于忙完回来了',
    supplementalQueries: [
      '近期已经到时间但还没有结果的计划',
      '当前话题相关的具体偏好和关键细节',
    ],
  });

  assert.equal(gateway.searches.length, 3);
  assert.equal(recalled[0]?.id, 'interview-follow-up');
  assert.equal(recalled[0]?.temporalStatus, 'follow_up_due');
  assert.equal(recalled[0]?.timePrecision, 'exact');
});

test('recall keeps useful results when one supplemental query fails', async () => {
  const gateway = new PartiallyFailingGateway();
  gateway.memories = [
    {
      id: 'preferred-name',
      memory: '用户希望被叫作小树',
      score: 0.95,
      metadata: activeMetadata({
        importance: 0.95,
        memory_type: 'preferred_name',
      }),
    },
  ];
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '用户喜欢什么称呼',
    supplementalQueries: ['这个查询会失败', '关键身份细节'],
  });

  assert.deepEqual(recalled.map((memory) => memory.id), ['preferred-name']);
  assert.equal(gateway.searches.length, 2);
});

test('day-precision plans become follow-up due only after the whole local day', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    {
      id: 'day-plan',
      memory: '用户今天参加课程',
      score: 0.9,
      metadata: activeMetadata({
        temporal_status: 'upcoming',
        occurred_at: '2026-07-24T00:00:00+08:00',
        time_precision: 'day',
      }),
    },
  ];
  const beforeEnd = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
    now: () => new Date('2026-07-24T20:00:00+08:00'),
  });
  const afterEnd = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
    now: () => new Date('2026-07-25T00:01:00+08:00'),
  });

  assert.equal(
    (await beforeEnd.recall({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      query: '课程',
    }))[0]?.temporalStatus,
    'upcoming',
  );
  assert.equal(
    (await afterEnd.recall({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      query: '课程',
    }))[0]?.temporalStatus,
    'follow_up_due',
  );
});

test('remember applies ADD, UPDATE, and DELETE lifecycle operations without retaining old text', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    {
      id: 'breakfast',
      memory: '用户最喜欢蟹粉小笼包',
      metadata: activeMetadata(),
    },
    {
      id: 'overtime',
      memory: '用户今晚十点前在加班',
      metadata: activeMetadata({ memory_type: 'temporary_state' }),
    },
  ];

  const organizer: MemoryOrganizer = {
    async organize() {
      return {
        operations: [
          {
            action: 'UPDATE',
            memoryId: 'breakfast',
            text: '用户现在最喜欢豆浆油条，并明确不再喜欢小笼包',
            layer: 'L3',
            memoryType: 'preference',
            reason: '用户明确修正了早餐偏好',
          },
          {
            action: 'DELETE',
            memoryId: 'overtime',
            reason: '用户说明已经下班，提醒作废',
          },
          {
            action: 'ADD',
            text: '用户送给顾川一张 Pink Floyd 首版黑胶，二人因此和好',
            layer: 'L2',
            memoryType: 'relationship_milestone',
            reason: '这是推动关系变化的关键事件',
          },
        ],
      };
    },
  };

  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer,
    organizerModel: 'deepseek-v4-flash-vision-exp',
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  });

  const result = await service.rememberExchange({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    userText: '我现在不喜欢小笼包了，而且已经下班。昨晚的礼物让我们和好了。',
    assistantMessageId: 'assistant-message-1',
    assistantText: '好，我记住了。',
  });

  // 契约在 2026-09-30 有意扩展：结果多带一个 `changes`（本轮真正落地的变更），
  // 供调用方就地维护会话级召回快照。计数部分必须逐字不变。
  const { changes, ...counts } = result;
  assert.deepEqual(counts, { added: 1, updated: 1, deleted: 1, skipped: 0 });
  // changes 按整理器给出的 operations 顺序记录（本例即 UPDATE → DELETE → ADD），不做重排。
  assert.deepEqual(changes?.map((change) => change.kind), ['update', 'delete', 'add']);
  assert.equal(
    gateway.memories.some((memory) => (memory.memory ?? '').includes('蟹粉小笼包')),
    false,
  );
  assert.equal(gateway.memories.some((memory) => memory.id === 'overtime'), false);
  assert.equal(
    gateway.memories.some(
      (memory) =>
        (memory.memory ?? '').includes('Pink Floyd') &&
        memory.metadata?.layer === 'L2' &&
        memory.metadata?.organizer_model ===
          'deepseek-v4-flash-vision-exp',
    ),
    true,
  );
});

test('disabled service is a zero-effect fallback and never calls its dependencies', async () => {
  const gateway = new FakeGateway();
  const organizer: MemoryOrganizer = {
    async organize() {
      throw new Error('organizer must not be called');
    },
  };
  const service = createMemoryService({
    enabled: false,
    appId: 'test-app',
    gateway,
    organizer,
  });

  assert.deepEqual(
    await service.recall({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      query: 'anything',
    }),
    [],
  );
  assert.deepEqual(
    await service.rememberExchange({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      userText: 'anything',
      assistantMessageId: 'assistant-message-1',
      assistantText: 'anything',
    }),
    { added: 0, updated: 0, deleted: 0, skipped: 1 },
  );
  assert.equal(gateway.searches.length, 0);
});
function mixedBucketCandidates(): ProviderMemory[] {
  return [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `impression-${index}`,
      memory: `长期印象 ${index}`,
      score: 0.96 - index / 100,
      metadata: activeMetadata({
        layer: 'L2',
        bucket: 'long_term_impression',
        domain: 'support',
        memory_type: 'support_strategy',
        importance: 0.8,
      }),
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `event-${index}`,
      memory: `关系事件 ${index}`,
      score: index === 0 ? 0.99 : 0.7 - index / 100,
      metadata: activeMetadata({
        layer: 'L2',
        bucket: 'relationship_event',
        domain: 'relationship',
        memory_type: 'relationship_milestone',
        importance: 0.8,
      }),
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `detail-${index}`,
      memory: `关键细节 ${index}`,
      score: 0.6 - index / 100,
      metadata: activeMetadata({
        layer: 'L3',
        bucket: 'key_detail',
        domain: 'support',
        memory_type: 'preference',
        importance: 0.7,
      }),
    })),
  ];
}

test('recall reserves a per-bucket floor and fills the rest by global rank, not bucket concatenation', async () => {
  const gateway = new FakeGateway();
  gateway.memories = mixedBucketCandidates();

  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '你还记得我们之间的事情吗',
  });
  const countIn = (bucket: string) =>
    recalled.filter((memory) => memory.bucket === bucket).length;

  assert.ok(recalled.length <= RECALL_LIMIT_DEFAULT);
  assert.equal(recalled.length, RECALL_LIMIT_DEFAULT);
  for (const bucket of Object.keys(RECALL_BUCKET_FLOOR) as MemoryBucket[]) {
    assert.ok(
      countIn(bucket) >= RECALL_BUCKET_FLOOR[bucket],
      `桶 ${bucket} 至少保留最小配额`,
    );
  }
  assert.ok(countIn('key_detail') >= 1);
  assert.equal(
    recalled.some((memory) => memory.id === 'detail-0'),
    true,
  );
  assert.equal(
    recalled.some((memory) => memory.id === 'detail-19'),
    false,
  );
  assert.equal(recalled[0]?.id, 'event-0');
  assert.deepEqual(
    recalled
      .filter((memory) => memory.bucket === 'long_term_impression')
      .map((memory) => memory.id),
    Array.from({ length: 8 }, (_, index) => `impression-${index}`),
  );
});

test('recallLimit is an explicit finite cap and per-bucket floors survive when it binds', async () => {
  const gateway = new FakeGateway();
  gateway.memories = mixedBucketCandidates();

  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
    recallLimit: 8,
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '你还记得我们之间的事情吗',
  });
  const countIn = (bucket: string) =>
    recalled.filter((memory) => memory.bucket === bucket).length;

  assert.equal(typeof RECALL_LIMIT_DEFAULT, 'number');
  assert.ok(Number.isFinite(RECALL_LIMIT_DEFAULT));
  assert.ok(RECALL_LIMIT_DEFAULT >= 25);
  assert.equal(recalled.length, 8);
  for (const bucket of Object.keys(RECALL_BUCKET_FLOOR) as MemoryBucket[]) {
    assert.ok(
      countIn(bucket) >= RECALL_BUCKET_FLOOR[bucket],
      `上限收紧时桶 ${bucket} 仍保留最小配额`,
    );
  }
  assert.equal(new Set(recalled.map((memory) => memory.bucket)).size, 3);
});

test('a cap tighter than the sum of the floors spreads the budget instead of dropping the floor', async () => {
  const recalledAt = async (limit: number) => {
    const gateway = new FakeGateway();
    gateway.memories = mixedBucketCandidates();
    const service = createMemoryService({
      enabled: true,
      appId: 'test-app',
      gateway,
      organizer: noopOrganizer,
      recallLimit: limit,
    });
    const recalled = await service.recall({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      query: '你还记得我们之间的事情吗',
    });
    const buckets = Object.keys(RECALL_BUCKET_FLOOR) as MemoryBucket[];
    return {
      recalled,
      counts: buckets.map(
        (bucket) => recalled.filter((memory) => memory.bucket === bucket).length,
      ),
      buckets,
    };
  };

  // 5 小于 floor 之和（6）。旧实现会先占满 6 个再被尾部 slice 砍回 5，
  // 等于把保底整个丢掉、退化成「全局 rank 前 5」。现在预算轮转派发。
  for (const limit of [5, 6]) {
    const { recalled, counts, buckets } = await recalledAt(limit);
    assert.equal(recalled.length, limit, `上限 ${limit} 必须精确生效`);
    assert.equal(
      counts.filter((count) => count > 0).length,
      3,
      `上限 ${limit} 时三个桶都要有代表`,
    );
    counts.forEach((count, index) => {
      assert.ok(
        count <= RECALL_BUCKET_FLOOR[buckets[index]] + 1,
        `上限 ${limit} 时 ${buckets[index]} 不该独占预算`,
      );
    });
  }

  // 1 / 2 小于桶数：按 RECALL_BUCKETS 顺序轮转，绝不超上限，也绝不放任一个桶全拿。
  const one = await recalledAt(1);
  assert.equal(one.recalled.length, 1);
  assert.equal(one.recalled[0]?.bucket, 'long_term_impression');
  const two = await recalledAt(2);
  assert.equal(two.recalled.length, 2);
  assert.deepEqual(
    two.recalled.map((memory) => memory.bucket).sort(),
    ['long_term_impression', 'relationship_event'].sort(),
  );
});

test('an unusable recallLimit falls back to the explicit default instead of going unlimited', async () => {
  for (const invalid of [0, -3, Number.NaN]) {
    const gateway = new FakeGateway();
    gateway.memories = mixedBucketCandidates();
    const service = createMemoryService({
      enabled: true,
      appId: 'test-app',
      gateway,
      organizer: noopOrganizer,
      recallLimit: invalid,
    });
    const recalled = await service.recall({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      query: '你还记得我们之间的事情吗',
    });
    assert.equal(
      recalled.length,
      RECALL_LIMIT_DEFAULT,
      `上限 ${String(invalid)} 必须回退默认值`,
    );
  }
});

test('recall keeps exact companion isolation for every bucket under the new selection', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    {
      id: 'mine',
      memory: '我们一起看过的那部电影',
      score: 0.9,
      metadata: activeMetadata({
        layer: 'L3',
        bucket: 'key_detail',
        domain: 'support',
        memory_type: 'preference',
        importance: 0.7,
      }),
    },
    {
      id: 'theirs',
      memory: '另一个恋人的共同经历',
      score: 0.99,
      metadata: activeMetadata({
        companion_id: 'companion-2',
        layer: 'L3',
        bucket: 'key_detail',
        domain: 'support',
        memory_type: 'preference',
        importance: 0.7,
      }),
    },
  ];

  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '我们之间的事',
  });

  assert.deepEqual(
    recalled.map((memory) => memory.id),
    ['mine'],
  );
  assert.deepEqual(gateway.searches[0], {
    query: '我们之间的事',
    filters: {
      AND: [
        { user_id: 'visitor-1' },
        { app_id: 'test-app' },
        { metadata: { companion_id: 'companion-1' } },
      ],
    },
  });
});

const exchangeInput = {
  visitorId: 'visitor-1',
  companionId: 'companion-1',
  conversationId: 'conversation-1',
  userMessageId: 'user-message-1',
  userText: '我到纽约了，这边还是白天。',
  assistantMessageId: 'assistant-message-1',
  assistantText: '那你先倒时差，别急着干活。',
};

test('T-14: rememberExchange resolves one time zone and writes offset ISO instead of bare UTC', async () => {
  const gateway = new FakeGateway();
  const seenNow: string[] = [];
  const organizer: MemoryOrganizer = {
    async organize(input) {
      seenNow.push(input.nowIso);
      return {
        operations: [
          {
            action: 'ADD' as const,
            text: 'TA 住在纽约',
            layer: 'L3' as const,
            bucket: 'key_detail' as const,
            domain: 'identity' as const,
            memoryType: 'identity_detail' as const,
            importance: 0.9,
            confidence: 'explicit' as const,
            evidenceMemoryIds: [],
            reason: '用户自述所在地',
          },
        ],
      };
    },
  };
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer,
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    resolveTimeZone: async () => 'America/New_York',
  });

  await service.rememberExchange(exchangeInput);

  assert.deepEqual(seenNow, ['2026-07-24T08:00:00-04:00']);
  assert.equal(seenNow[0].endsWith('Z'), false);
  assert.equal(
    gateway.memories[0]?.metadata?.observed_at,
    '2026-07-24T08:00:00-04:00',
  );
});

test('T-14: an empty, unparsable or failing time zone falls back to Asia/Shanghai without throwing', async () => {
  const zones: Array<() => Promise<string>> = [
    async () => '',
    async () => 'Not/AZone',
    async () => {
      throw new Error('simulated profile read outage');
    },
  ];

  for (const resolveTimeZone of zones) {
    const gateway = new FakeGateway();
    const seenNow: string[] = [];
    const organizer: MemoryOrganizer = {
      async organize(input) {
        seenNow.push(input.nowIso);
        return { operations: [] };
      },
    };
    const service = createMemoryService({
      enabled: true,
      appId: 'test-app',
      gateway,
      organizer,
      now: () => new Date('2026-07-24T12:00:00.000Z'),
      resolveTimeZone,
    });

    await service.rememberExchange(exchangeInput);
    assert.deepEqual(seenNow, ['2026-07-24T20:00:00+08:00']);
  }
});

test('T-14: rememberExchange defaults to Asia/Shanghai when no resolver is injected', async () => {
  const gateway = new FakeGateway();
  const seenNow: string[] = [];
  const organizer: MemoryOrganizer = {
    async organize(input) {
      seenNow.push(input.nowIso);
      return { operations: [] };
    },
  };
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer,
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  });

  await service.rememberExchange(exchangeInput);

  assert.deepEqual(seenNow, ['2026-07-24T20:00:00+08:00']);
});

test('T-10: recentTurns stay optional and reach the organizer unchanged', async () => {
  const gateway = new FakeGateway();
  const seen: Array<{ recentTurns?: unknown }> = [];
  const organizer: MemoryOrganizer = {
    async organize(input) {
      seen.push({ recentTurns: input.recentTurns });
      return { operations: [] };
    },
  };
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer,
  });

  await service.rememberExchange(exchangeInput);
  assert.equal(seen[0].recentTurns, undefined);

  const turns = [
    { userText: '那家店还不错', assistantText: '下次我们再去' },
    { userText: '就周三吧', assistantText: '好，我记下了' },
  ];
  await service.rememberExchange({ ...exchangeInput, recentTurns: turns });
  assert.deepEqual(seen[1].recentTurns, turns);
});

test('T-18 / T-19: plan feedback and relationship snapshot reach the caller, and silence adds no keys', async () => {
  const gateway = new FakeGateway();
  const organizer: MemoryOrganizer = {
    async organize() {
      return {
        operations: [],
        communicationPrefsFeedback: ['别每次都逗我'],
        relationshipSnapshot: { emotionalTone: '更安心', keyMilestones: ['不再用敬语'] },
      };
    },
  };
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer,
  });

  const result = await service.rememberExchange(exchangeInput);

  assert.deepEqual(result.feedback, ['别每次都逗我']);
  assert.deepEqual(result.relationshipSnapshot, {
    emotionalTone: '更安心',
    keyMilestones: ['不再用敬语'],
  });

  const quietGateway = new FakeGateway();
  const quietService = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway: quietGateway,
    organizer: noopOrganizer,
  });

  const quiet = await quietService.rememberExchange(exchangeInput);

  assert.equal(quiet.feedback, undefined);
  assert.equal(quiet.relationshipSnapshot, undefined);
});

test('T-20: ten idle turns surface no relationship snapshot at all', async () => {
  const gateway = new FakeGateway();
  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
  });

  for (let round = 0; round < 10; round += 1) {
    const result = await service.rememberExchange({
      ...exchangeInput,
      userMessageId: 'user-message-' + String(round),
      userText: '今天天气不错',
      assistantText: '是呀，适合出去走走。',
    });
    assert.equal(result.relationshipSnapshot, undefined);
    assert.equal(result.feedback, undefined);
  }
});
