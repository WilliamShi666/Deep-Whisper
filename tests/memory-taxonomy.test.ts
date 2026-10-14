import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHARACTER_PRESETS } from '../src/lib/characters';
import {
  createMemoryService,
  RECALL_BUCKET_FLOOR,
  RECALL_LIMIT_DEFAULT,
  type MemoryBucket,
  type MemoryGateway,
  type MemoryOrganizer,
  type ProviderMemory,
} from '../src/lib/memory/service';
import { parseMemoryPlan } from '../src/lib/memory/organizer';
import { buildSystemPrompt } from '../src/lib/prompts';

class TaxonomyGateway implements MemoryGateway {
  memories: ProviderMemory[] = [];

  async search() {
    return this.memories;
  }

  async add(
    text: string,
    options: {
      userId: string;
      appId: string;
      metadata: Record<string, unknown>;
      expirationDate?: string;
    },
  ) {
    const memory = {
      id: `added-${this.memories.length + 1}`,
      memory: text,
      metadata: options.metadata,
    };
    this.memories.push(memory);
    return memory;
  }

  async update() {}

  async delete(id: string) {
    this.memories = this.memories.filter((memory) => memory.id !== id);
  }
}

const noopOrganizer: MemoryOrganizer = {
  async organize() {
    return { operations: [] };
  },
};

function metadata(
  bucket: 'long_term_impression' | 'relationship_event' | 'key_detail',
  index: number,
) {
  const layer = bucket === 'key_detail' ? 'L3' : 'L2';
  const memoryType =
    bucket === 'long_term_impression'
      ? 'support_strategy'
      : bucket === 'relationship_event'
        ? 'relationship_milestone'
        : 'preference';
  return {
    app_id: 'test-app',
    visitor_id: 'visitor-1',
    companion_id: 'companion-1',
    layer,
    bucket,
    domain: bucket === 'relationship_event' ? 'relationship' : 'support',
    memory_type: memoryType,
    importance: (bucket === 'key_detail' ? 0.7 : 0.8) + index / 100,
    confidence: 'explicit',
    status: 'active',
    observed_at: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    valid_until: null,
  };
}

test('recall reserves a per-bucket floor instead of hard capping each bucket', async () => {
  const gateway = new TaxonomyGateway();
  gateway.memories = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `impression-${index}`,
      memory: `长期印象 ${index}`,
      score: 0.9 - index / 100,
      metadata: metadata('long_term_impression', index),
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `event-${index}`,
      memory: `关系事件 ${index}`,
      score: 0.85 - index / 100,
      metadata: metadata('relationship_event', index),
    })),
    ...Array.from({ length: 15 }, (_, index) => ({
      id: `detail-${index}`,
      memory: `关键细节 ${index}`,
      score: 0.8 - index / 100,
      metadata: metadata('key_detail', index),
    })),
    {
      id: 'low-value-provider-detail',
      memory: '用户路过时看见一把蓝色雨伞',
      score: 1,
      metadata: {
        ...metadata('key_detail', 20),
        importance: 0.59,
      },
    },
  ];

  const service = createMemoryService({
    enabled: true,
    appId: 'test-app',
    gateway,
    organizer: noopOrganizer,
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  });

  const recalled = await service.recall({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    query: '你还记得我吗？',
  });

  const countIn = (bucket: string) =>
    recalled.filter((memory) => memory.bucket === bucket).length;

  // 选择策略的性质断言：先按每桶下限保底，再按全局 rank 补足到上限。
  // 旧的逐桶硬上限（5/8/12）已废弃——它会让长期印象把关系事件与关键细节整体挤掉。
  assert.ok(recalled.length <= RECALL_LIMIT_DEFAULT);
  assert.equal(recalled.length, RECALL_LIMIT_DEFAULT);
  for (const bucket of Object.keys(RECALL_BUCKET_FLOOR) as MemoryBucket[]) {
    assert.ok(
      countIn(bucket) >= RECALL_BUCKET_FLOOR[bucket],
      `桶 ${bucket} 至少保留最小配额`,
    );
  }
  assert.equal(new Set(recalled.map((memory) => memory.bucket)).size, 3);
  assert.equal(
    recalled.some((memory) => memory.id === 'low-value-provider-detail'),
    false,
  );
  assert.equal(recalled[0]?.id, 'impression-0');
});

test('legacy records receive deterministic buckets without a migration', async () => {
  const gateway = new TaxonomyGateway();
  gateway.memories = [
    {
      id: 'legacy-event',
      memory: '二人曾经化解误会并和好',
      metadata: {
        ...metadata('relationship_event', 1),
        bucket: undefined,
        layer: 'L2',
        memory_type: 'relationship_milestone',
      },
    },
    {
      id: 'legacy-detail',
      memory: '用户喜欢蟹粉小笼包',
      metadata: {
        ...metadata('key_detail', 2),
        bucket: undefined,
        layer: 'L3',
        memory_type: 'preference',
      },
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
    query: '过去发生过什么，我喜欢什么？',
  });

  assert.equal(recalled.find((memory) => memory.id === 'legacy-event')?.bucket, 'relationship_event');
  assert.equal(recalled.find((memory) => memory.id === 'legacy-detail')?.bucket, 'key_detail');
});

test('service rejects a new low-value L3 detail but stores an evidence-backed L2 impression', async () => {
  const gateway = new TaxonomyGateway();
  const organizer: MemoryOrganizer = {
    async organize() {
      return {
        operations: [
          {
            action: 'ADD',
            text: '用户今天路过便利店时看见一把蓝色雨伞',
            layer: 'L3',
            bucket: 'key_detail',
            domain: 'event',
            memoryType: 'event',
            importance: 0.25,
            confidence: 'explicit',
            reason: '一次性琐事',
          },
          {
            action: 'ADD',
            text: '用户焦虑时更希望先被倾听，而不是立刻听解决方案',
            layer: 'L2',
            bucket: 'long_term_impression',
            domain: 'support',
            memoryType: 'support_strategy',
            importance: 0.9,
            confidence: 'explicit',
            evidenceMemoryIds: [],
            reason: '用户明确表达了稳定的陪伴偏好',
          },
          {
            action: 'ADD',
            text: '用户似乎总是喜欢独处',
            layer: 'L2',
            bucket: 'long_term_impression',
            domain: 'identity',
            memoryType: 'personal_impression',
            importance: 0.75,
            confidence: 'inferred',
            evidenceMemoryIds: [],
            reason: '没有具体证据的推断',
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
  });

  const result = await service.rememberExchange({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    userText: '我焦虑的时候先听我说就好。刚才路过便利店看到一把蓝色雨伞。',
    assistantMessageId: 'assistant-message-1',
    assistantText: '好，我先陪你慢慢说。',
  });

  // 2026-09-30 契约扩展：结果多带 `changes`（本轮真正落地的变更），计数部分逐字不变。
  const { changes, ...counts } = result;
  assert.deepEqual(counts, { added: 1, updated: 0, deleted: 0, skipped: 2 });
  assert.deepEqual(changes?.map((change) => change.kind), ['add']);
  assert.equal(gateway.memories.length, 1);
  assert.equal(gateway.memories[0]?.metadata?.bucket, 'long_term_impression');
});

test('prompt separates long-term impressions, relationship events, and key details', () => {
  const prompt = buildSystemPrompt(
    CHARACTER_PRESETS[0]!,
    {
      name: '顾川',
      persona: null,
      occupation: null,
      user_title: null,
    },
    { gender: 'female', nickname: '林夏' },
    {
      profile: null,
      snapshot: null,
      recalled: [
        {
          id: 'impression',
          text: '用户焦虑时希望先被倾听',
          layer: 'L2',
          bucket: 'long_term_impression',
          domain: 'support',
          memoryType: 'support_strategy',
          importance: 0.9,
          confidence: 'explicit',
          score: 0.9,
          observedAt: null,
          occurredAt: null,
          timePrecision: null,
          validUntil: null,
          temporalStatus: 'timeless',
          createdAt: null,
          updatedAt: null,
        },
        {
          id: 'event',
          text: '二人曾通过解释黑胶礼物化解误会',
          layer: 'L2',
          bucket: 'relationship_event',
          domain: 'relationship',
          memoryType: 'relationship_milestone',
          importance: 0.95,
          confidence: 'explicit',
          score: 0.9,
          observedAt: null,
          occurredAt: null,
          timePrecision: null,
          validUntil: null,
          temporalStatus: 'timeless',
          createdAt: null,
          updatedAt: null,
        },
        {
          id: 'detail',
          text: '用户喜欢被叫微信名“小树”',
          layer: 'L3',
          bucket: 'key_detail',
          domain: 'identity',
          memoryType: 'identity_detail',
          importance: 0.85,
          confidence: 'explicit',
          score: 0.9,
          observedAt: null,
          occurredAt: null,
          timePrecision: null,
          validUntil: null,
          temporalStatus: 'timeless',
          createdAt: null,
          updatedAt: null,
        },
      ],
    },
  );

  assert.match(prompt, /对 TA 的长期印象/);
  assert.match(prompt, /你们重要的共同经历/);
  assert.match(prompt, /值得记住的关键细节/);
  assert.match(prompt, /核心画像.*当前权威值/);
  assert.match(prompt, /微信名.*不得覆盖核心画像/);
});

test('prompt includes recent cross-conversation episodes as non-authoritative continuity context', () => {
  const prompt = buildSystemPrompt(
    CHARACTER_PRESETS[0]!,
    {
      name: '林晚星',
      persona: null,
      occupation: null,
      user_title: null,
    },
    { gender: 'male', nickname: 'William' },
    {
      profile: null,
      snapshot: null,
      recalled: [],
      recentEpisodes: [
        {
          role: 'user',
          content: '面试结果还不知道，而且吃外卖后拉肚子了',
          createdAt: '2026-07-25T12:28:14.000Z',
        },
        {
          role: 'assistant',
          content: '现在好点了吗，有没有吃药？',
          createdAt: '2026-07-25T12:28:18.000Z',
        },
      ],
    },
  );

  assert.match(prompt, /最近一次聊天的连续情节/);
  assert.match(prompt, /面试结果还不知道/);
  assert.match(prompt, /短期上下文，不是长期定论/);
  assert.match(prompt, /你自己此前的回复.*不能反过来当作 TA 的事实/);
});

const KEPT_PHRASE_MEMORY_TYPE = 'shared_quote';

// --- T-08 / AC-06：用户明确希望被记住的一句话 ------------------------------

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('T-08a the organizer schema accepts a kept-phrase memory type', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '今晚不是来交作业的',
        layer: 'L3',
        memoryType: KEPT_PHRASE_MEMORY_TYPE,
        importance: 0.8,
        confidence: 'explicit',
        reason: '用户明确要求记住这句话',
      },
    ],
  });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].memoryType, KEPT_PHRASE_MEMORY_TYPE);
});

test('T-08b the kept-phrase type is stored in the existing key_detail bucket only', async () => {
  const gateway = new TaxonomyGateway();
  const organizer: MemoryOrganizer = {
    async organize() {
      return {
        operations: [
          {
            action: 'ADD',
            text: '今晚不是来交作业的',
            layer: 'L3',
            memoryType: KEPT_PHRASE_MEMORY_TYPE,
            importance: 0.8,
            confidence: 'explicit',
            reason: '用户明确要求记住这句话',
          },
          {
            action: 'ADD',
            text: '短引语不该落进长期印象桶',
            layer: 'L2',
            memoryType: KEPT_PHRASE_MEMORY_TYPE,
            importance: 0.95,
            confidence: 'explicit',
            reason: 'L2 桶不接受短引语类型',
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
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  });

  const result = await service.rememberExchange({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-1',
    userText: '把这句话记下来：今晚不是来交作业的',
    assistantMessageId: 'message-2',
    assistantText: '好，这句我替你留着。',
  });

  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(gateway.memories.length, 1);
  assert.equal(gateway.memories[0].memory, '今晚不是来交作业的');
  assert.equal(gateway.memories[0].metadata?.bucket, 'key_detail');
  assert.equal(gateway.memories[0].metadata?.layer, 'L3');
  assert.equal(gateway.memories[0].metadata?.memory_type, KEPT_PHRASE_MEMORY_TYPE);
});

test('T-08c memory buckets remain fixed while SQLite persistence tables are explicit', () => {
  const organizerSource = readRepoFile('src/lib/memory/organizer.ts');
  const bucketBlock = organizerSource.slice(
    organizerSource.indexOf('const memoryBucketSchema'),
    organizerSource.indexOf('const memoryDomainValueSchema'),
  );
  assert.deepEqual(
    [...bucketBlock.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
    ['long_term_impression', 'relationship_event', 'key_detail'],
  );

  const schemaSource = readRepoFile('src/storage/database/shared/memory-schema.ts');
  const tables = [...schemaSource.matchAll(/sqliteTable\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(tables.sort(), ['memories','memory_jobs','memory_recall_snapshots','memory_scope_versions','memory_sources']);
  assert.equal(tables.some(table => /^(quote|phrase)/.test(table)), false);

  const serviceSource = readRepoFile('src/lib/memory/service.ts');
  const declarations =
    [...organizerSource.matchAll(/'shared_quote'/g)].length +
    [...serviceSource.matchAll(/'shared_quote'/g)].length;
  assert.equal(declarations, 1, 'the memory type list must have a single source of truth');
});
