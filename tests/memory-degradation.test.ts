import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryService,
  type MemoryGateway,
  type MemoryOperation,
  type MemoryOrganizer,
  type ProviderMemory,
  type RememberResult,
} from '../src/lib/memory/service';

/**
 * T-23 - failure degradation contracts for long-term memory.
 *
 * Long-term memory is a best-effort side channel: a broken organizer, gateway or
 * recall path must never harm the user's reply, and must never leave half-written
 * data behind. These tests drive the service directly through fakes only - no
 * database, no network and no model provider is involved.
 *
 * The rememberExchange degradation cases (organizer failure, gateway add failure,
 * recall failure) are expected to be RED until the degradation work lands.
 */

type AddCall = {
  text: string;
  userId: string;
  appId: string;
  metadata: Record<string, unknown>;
  expirationDate?: string;
};

/**
 * A record may only reach storage fully classified, so this is the minimum
 * metadata shape every ADD call has to carry.
 */
const REQUIRED_ADD_METADATA_KEYS = [
  'companion_id',
  'bucket',
  'layer',
  'importance',
  'confidence',
] as const;

function isCompleteAddMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return REQUIRED_ADD_METADATA_KEYS.every((key) => {
    const value = metadata[key];
    if (key === 'importance') {
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      );
    }
    return typeof value === 'string' && value.trim().length > 0;
  });
}

class RecordingGateway implements MemoryGateway {
  memories: ProviderMemory[] = [];
  searches: Array<{ query: string; filters: Record<string, unknown> }> = [];
  adds: AddCall[] = [];
  updates: Array<{
    id: string;
    text?: string;
    metadata?: Record<string, unknown>;
  }> = [];
  deletes: string[] = [];

  /** Every search path rejects: a total recall outage. */
  failEverySearch = false;
  /** Any query containing one of these fragments rejects: a partial outage. */
  failQueries: string[] = [];
  /** When set, a query returns exactly this batch instead of `memories`. */
  resultsByQuery: Record<string, ProviderMemory[]> = {};
  /** 1-based index of the `add` call that must reject. */
  failAddAtIndex: number | null = null;

  get mutationCount(): number {
    return this.adds.length + this.updates.length + this.deletes.length;
  }

  async search(
    query: string,
    filters: Record<string, unknown>,
  ): Promise<ProviderMemory[]> {
    this.searches.push({ query, filters });
    if (this.failEverySearch) throw new Error('simulated search outage');
    if (this.failQueries.some((fragment) => query.includes(fragment))) {
      throw new Error('simulated search failure: ' + query);
    }
    return this.resultsByQuery[query] ?? this.memories;
  }

  async add(
    text: string,
    options: {
      userId: string;
      appId: string;
      metadata: Record<string, unknown>;
      expirationDate?: string;
    },
  ): Promise<ProviderMemory> {
    this.adds.push({ text, ...options });
    if (
      this.failAddAtIndex !== null &&
      this.adds.length === this.failAddAtIndex
    ) {
      throw new Error('simulated add outage at call ' + this.adds.length);
    }
    const memory: ProviderMemory = {
      id: 'memory-' + (this.memories.length + 1),
      memory: text,
      metadata: options.metadata,
    };
    this.memories.push(memory);
    return memory;
  }

  async update(
    id: string,
    update: {
      text?: string;
      metadata?: Record<string, unknown>;
      expirationDate?: string | null;
    },
  ): Promise<void> {
    this.updates.push({ id, text: update.text, metadata: update.metadata });
    const target = this.memories.find((memory) => memory.id === id);
    if (target) {
      if (update.text !== undefined) target.memory = update.text;
      if (update.metadata !== undefined) target.metadata = update.metadata;
    }
  }

  async delete(id: string): Promise<void> {
    this.deletes.push(id);
    this.memories = this.memories.filter((memory) => memory.id !== id);
  }
}

function activeMetadata(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    app_id: 'test-app',
    visitor_id: 'visitor-1',
    companion_id: 'companion-1',
    layer: 'L3',
    memory_type: 'preference',
    importance: 0.8,
    confidence: 'explicit',
    status: 'active',
    observed_at: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

const noopOrganizer: MemoryOrganizer = {
  async organize() {
    return { operations: [] };
  },
};

function addOperation(
  overrides: Partial<MemoryOperation> = {},
): MemoryOperation {
  return {
    action: 'ADD',
    text: '用户喜欢在深夜写代码',
    layer: 'L3',
    memoryType: 'preference',
    importance: 0.8,
    confidence: 'explicit',
    evidenceMemoryIds: [],
    reason: '用户明确表达了自己的偏好',
    ...overrides,
  };
}

function buildService(gateway: MemoryGateway, organizer: MemoryOrganizer) {
  return createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer,
    organizerModel: 'test-organizer-model',
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  });
}

const EXCHANGE = {
  visitorId: 'visitor-1',
  companionId: 'companion-1',
  conversationId: 'conversation-1',
  userMessageId: 'user-message-1',
  userText: '我今天把模型量化跑通了，晚上想吃点好的。',
  assistantMessageId: 'assistant-message-1',
  assistantText: '太好了，那我记住这件好事。',
};

/**
 * Memory failures degrade, they do not propagate: the caller is the chat route,
 * and a rejected rememberExchange there is an outage the user must never see.
 */
async function requireResolvedRemember(
  run: () => Promise<RememberResult>,
  context: string,
): Promise<RememberResult> {
  try {
    return await run();
  } catch (error) {
    throw new Error(
      context +
        ' must resolve when memory degrades, but it rejected with: ' +
        String(error),
    );
  }
}

test('recall rejects when every search path fails so the chat route can fall back to []', async () => {
  const gateway = new RecordingGateway();
  gateway.failEverySearch = true;
  const service = buildService(gateway, noopOrganizer);

  // src/app/api/chat/route.ts wraps recallLongTermMemories(...).catch(() => []):
  // a total search outage must keep rejecting so that fallback stays load-bearing.
  await assert.rejects(
    service.recall({
      visitorId: 'visitor-1',
      companionId: 'companion-1',
      query: '我最近在忙什么',
      supplementalQueries: ['用户稳定偏好与沟通方式', '近期事件与未完成承诺'],
    }),
    /simulated search outage/,
  );
  assert.equal(gateway.searches.length, 3);
  assert.equal(gateway.mutationCount, 0);
});

test('recall still resolves with the surviving paths when only some searches fail', async () => {
  const gateway = new RecordingGateway();
  gateway.failQueries = ['会失败的补充查询'];
  gateway.resultsByQuery = {
    '我最近在忙什么': [
      {
        id: 'preference-survived',
        memory: '用户喜欢在深夜写代码',
        score: 0.9,
        metadata: activeMetadata(),
      },
    ],
    '近期事件与未完成承诺': [
      {
        id: 'event-survived',
        memory: '用户本周要交付一版量化报告',
        score: 0.8,
        metadata: activeMetadata({
          memory_type: 'time_bounded_commitment',
          importance: 0.9,
        }),
      },
    ],
  };
  const service = buildService(gateway, noopOrganizer);

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '我最近在忙什么',
    supplementalQueries: ['会失败的补充查询', '近期事件与未完成承诺'],
  });

  // Promise.allSettled contract: one broken path must not erase the others.
  assert.deepEqual(
    recalled.map((memory) => memory.id).sort(),
    ['event-survived', 'preference-survived'],
  );
  assert.equal(gateway.searches.length, 3);
});

test('recall resolves with an empty list when every path returns nothing', async () => {
  const gateway = new RecordingGateway();
  const service = buildService(gateway, noopOrganizer);

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '一个还没有任何记忆的新访客',
    supplementalQueries: ['稳定偏好', '近期事件'],
  });

  assert.deepEqual(recalled, []);
  assert.equal(gateway.searches.length, 3);
});

test('rememberExchange resolves with a zero-effect result when the organizer fails', async () => {
  const gateway = new RecordingGateway();
  const organizer: MemoryOrganizer = {
    async organize() {
      throw new Error('simulated organizer outage');
    },
  };
  const service = buildService(gateway, organizer);

  // RED today: rememberExchange awaits the organizer, so a model outage rejects the
  // whole call. Degrading must hold added/updated/deleted at 0 and write nothing.
  const result = await requireResolvedRemember(
    () => service.rememberExchange(EXCHANGE),
    'rememberExchange',
  );

  assert.equal(result.added, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.deleted, 0);
  assert.equal(gateway.adds.length, 0);
  assert.equal(gateway.updates.length, 0);
  assert.equal(gateway.deletes.length, 0);
  assert.equal(gateway.memories.length, 0);
});

test('an out-of-shape plan never throws, never exceeds the cap and never writes an unclassified operation', async () => {
  const gateway = new RecordingGateway();
  gateway.memories = [
    {
      id: 'existing-memory',
      memory: '用户喜欢喝美式',
      score: 0.7,
      metadata: activeMetadata({ importance: 0.7 }),
    },
  ];
  // Shape the organizer must never be trusted to produce: an unknown classification
  // and an action outside the ADD/UPDATE/DELETE lifecycle.
  const outOfShapeOperations = [
    {
      action: 'ADD',
      text: '分类非法的记忆',
      layer: 'L3',
      memoryType: 'not_a_real_memory_type',
      reason: '整理器返回了未知分类',
    },
    {
      action: 'UPSERT',
      memoryId: 'existing-memory',
      text: '非法动作不应该被写成更新',
      reason: '整理器返回了未知动作',
    },
  ] as unknown as MemoryOperation[];
  const operations: MemoryOperation[] = [
    addOperation({ text: '正常记忆一' }),
    addOperation({ text: '正常记忆二' }),
    addOperation({ text: '正常记忆三' }),
    addOperation({ text: '正常记忆四' }),
    addOperation({ text: '正常记忆五' }),
    addOperation({ text: '正常记忆六' }),
    addOperation({ text: '超出上限的第七条记忆' }),
    ...outOfShapeOperations,
  ];
  const organizer: MemoryOrganizer = {
    async organize() {
      return { operations };
    },
  };
  const service = buildService(gateway, organizer);

  const result = await requireResolvedRemember(
    () => service.rememberExchange(EXCHANGE),
    'rememberExchange',
  );

  assert.equal(gateway.adds.length, 6, 'the six-operation cap must hold');
  assert.equal(
    gateway.adds.some((call) => call.text === '超出上限的第七条记忆'),
    false,
    'the seventh operation must never reach storage',
  );
  assert.equal(
    gateway.adds.some((call) => call.text === '分类非法的记忆'),
    false,
    'an operation with an unknown classification must be skipped, not written',
  );
  for (const call of gateway.adds) {
    assert.equal(
      isCompleteAddMetadata(call.metadata),
      true,
      'incomplete metadata reached storage for: ' + call.text,
    );
  }
  assert.equal(result.added, 6);
  assert.equal(
    gateway.updates.length,
    0,
    'an action outside ADD/UPDATE/DELETE must never be coerced into a write',
  );
});

test('rememberExchange resolves when the gateway rejects the first add', async () => {
  const gateway = new RecordingGateway();
  gateway.failAddAtIndex = 1;
  const organizer: MemoryOrganizer = {
    async organize() {
      return {
        operations: [
          addOperation({ text: '第一条记忆' }),
          addOperation({ text: '第二条记忆', memoryType: 'personal_fact' }),
        ],
      };
    },
  };
  const service = buildService(gateway, organizer);

  // RED today: the first rejected add rejects the whole rememberExchange call.
  const result = await requireResolvedRemember(
    () => service.rememberExchange(EXCHANGE),
    'rememberExchange',
  );

  assert.ok(
    gateway.adds.length >= 2 || result.skipped >= 1,
    'a rejected add must be retried-or-counted, never silently swallowed',
  );
  for (const call of gateway.adds) {
    assert.equal(
      isCompleteAddMetadata(call.metadata),
      true,
      'partial metadata reached the gateway for: ' + call.text,
    );
  }
  for (const memory of gateway.memories) {
    assert.equal(
      isCompleteAddMetadata(memory.metadata),
      true,
      'a half-written record reached storage',
    );
  }
  assert.ok(result.added + result.skipped >= 1);
});

test('rememberExchange writes nothing when recall itself fails', async () => {
  const gateway = new RecordingGateway();
  gateway.failEverySearch = true;
  let organizeCalls = 0;
  const organizer: MemoryOrganizer = {
    async organize() {
      organizeCalls += 1;
      return { operations: [addOperation({ text: '不应该被写入的记忆' })] };
    },
  };
  const service = buildService(gateway, organizer);

  // RED today: recall rejects inside rememberExchange, so the whole call rejects.
  // Without a trustworthy existing-memory set the organizer could duplicate facts,
  // so the honest degradation is to skip the write entirely.
  const result = await requireResolvedRemember(
    () => service.rememberExchange(EXCHANGE),
    'rememberExchange',
  );

  assert.equal(result.added, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.deleted, 0);
  assert.equal(gateway.adds.length, 0);
  assert.equal(gateway.updates.length, 0);
  assert.equal(gateway.deletes.length, 0);
  assert.equal(
    organizeCalls,
    0,
    'without a trustworthy existing-memory set the organizer must not even run',
  );
});

test('a well-formed plan still writes exactly the expected records', async () => {
  const gateway = new RecordingGateway();
  gateway.memories = [
    {
      id: 'breakfast',
      memory: '用户最喜欢蟹粉小笼包',
      metadata: activeMetadata({ importance: 0.7 }),
    },
    {
      id: 'overtime',
      memory: '用户今晚十点前在加班',
      metadata: activeMetadata({
        memory_type: 'temporary_state',
        importance: 0.7,
      }),
    },
  ];
  const organizer: MemoryOrganizer = {
    async organize() {
      return {
        operations: [
          {
            action: 'UPDATE',
            memoryId: 'breakfast',
            text: '用户现在最喜欢豆浆油条，不再喜欢小笼包',
            layer: 'L3',
            memoryType: 'preference',
            importance: 0.8,
            confidence: 'explicit',
            reason: '用户明确修正了早餐偏好',
          },
          {
            action: 'DELETE',
            memoryId: 'overtime',
            reason: '用户说明已经下班，提醒作废',
          },
          addOperation({
            text: '用户送给恋人一张黑胶唱片，二人因此和好',
            layer: 'L2',
            memoryType: 'relationship_milestone',
            importance: 0.9,
          }),
        ],
      };
    },
  };
  const service = buildService(gateway, organizer);

  const result = await service.rememberExchange(EXCHANGE);

  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 0);
  assert.equal(gateway.adds.length, 1);
  assert.equal(gateway.updates.length, 1);
  assert.deepEqual(gateway.deletes, ['overtime']);
  assert.equal(
    gateway.updates[0]?.text,
    '用户现在最喜欢豆浆油条，不再喜欢小笼包',
  );
  assert.equal(
    gateway.memories.some((memory) =>
      (memory.memory ?? '').includes('蟹粉小笼包'),
    ),
    false,
  );
  assert.equal(
    gateway.memories.some(
      (memory) =>
        memory.metadata?.layer === 'L2' &&
        memory.metadata?.bucket === 'relationship_event',
    ),
    true,
  );
  for (const call of gateway.adds) {
    assert.equal(isCompleteAddMetadata(call.metadata), true);
  }
});