import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { forgetConversationMemories as cascadeForget } from '../src/lib/memory/cascade-forget';
import {
  summarizeForgetOutcome,
} from '../src/lib/memory/index';
import { deleteConversationNotice } from '../src/lib/memory/forget-notice';
import { withoutConversationSource } from '../src/lib/memory/recall-snapshot-db';
import type { ForgetConversationReport } from '../src/lib/types';
import {
  createMemoryService,
  type MemoryGateway,
  type MemoryOrganizer,
  type ProviderMemory,
} from '../src/lib/memory/service';

// All fixtures in this file are synthetic. No real conversation, credential or
// private chat content is copied into tests.

class FakeGateway implements MemoryGateway {
  memories: ProviderMemory[] = [];
  searches: Array<{ query: string; filters: Record<string, unknown> }> = [];
  updates: Array<{ id: string; text?: string }> = [];
  deletes: string[] = [];
  failDeleteIds = new Set<string>();
  searchError: Error | null = null;

  async search(query: string, filters: Record<string, unknown>) {
    if (this.searchError) throw this.searchError;
    this.searches.push({ query, filters });
    return this.memories.map((memory) => ({ ...memory }));
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
    const memory: ProviderMemory = {
      id: 'memory-' + String(this.memories.length + 1),
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
  ) {
    this.updates.push({ id, text: update.text });
    const target = this.memories.find((memory) => memory.id === id);
    if (!target) return;
    if (update.text !== undefined) target.memory = update.text;
    if (update.metadata !== undefined) target.metadata = update.metadata;
  }

  async delete(id: string) {
    if (this.failDeleteIds.has(id)) {
      throw new Error('simulated delete failure for ' + id);
    }
    this.deletes.push(id);
    this.memories = this.memories.filter((memory) => memory.id !== id);
  }
}

const noopOrganizer: MemoryOrganizer = {
  async organize() {
    return { operations: [] };
  },
};

const APP_ID = 'test-app';
const VISITOR_ID = 'visitor-1';
const COMPANION_A = 'companion-1';
const COMPANION_B = 'companion-2';
const CONVERSATION_A = 'conversation-a';
const CONVERSATION_B = 'conversation-b';
const NOW = new Date('2026-09-16T12:00:00.000Z');

function memoryMetadata(overrides: Record<string, unknown> = {}) {
  return {
    app_id: APP_ID,
    visitor_id: VISITOR_ID,
    companion_id: COMPANION_A,
    layer: 'L3',
    memory_type: 'preference',
    status: 'active',
    observed_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function conversationMemory(
  id: string,
  conversationId: string,
  companionId: string,
  text: string,
): ProviderMemory {
  return {
    id,
    memory: text,
    score: 0.85,
    metadata: memoryMetadata({
      companion_id: companionId,
      source_conversation_id: conversationId,
    }),
  };
}

function snapshot(memories: ProviderMemory[]) {
  const map: Record<string, unknown> = {};
  for (const memory of memories) {
    map[memory.id] = {
      memory: memory.memory,
      companion_id: memory.metadata?.companion_id,
      source_conversation_id: memory.metadata?.source_conversation_id,
      valid_until: memory.metadata?.valid_until ?? null,
      temporal_status: memory.metadata?.temporal_status ?? null,
    };
  }
  return map;
}

function createTestService(gateway: MemoryGateway) {
  return createMemoryService({
    enabled: true,
    appId: APP_ID,
    gateway,
    organizer: noopOrganizer,
    now: () => NOW,
  });
}

// ---------------------------------------------------------------------------
// T-24 / AC-15 - deleting a conversation must also forget the long-term
// memories whose metadata.source_conversation_id points at that conversation.
// The delete is addressed through the existing memory metadata; no new table,
// column or migration is introduced.
// ---------------------------------------------------------------------------

test('T-24 (AC-15): deleting a conversation forgets the long-term memories sourced from it', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '这段对话里用户说过喜欢香菜'),
    conversationMemory('a-2', CONVERSATION_A, COMPANION_A, '这段对话里用户提到周末要去看展'),
    conversationMemory('b-1', CONVERSATION_B, COMPANION_A, '另一段对话里用户说过喜欢猫'),
  ];

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.deleted, 2, '来源为被删会话的记忆必须被清理');
  assert.equal(result.failed, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.scanned, 3);
  assert.deepEqual(
    gateway.memories.map((memory) => memory.id),
    ['b-1'],
    '只有来源为被删会话的记忆被清理，而不是只删 SQL 行',
  );
  assert.deepEqual([...gateway.deletes].sort(), ['a-1', 'a-2']);
});

test('T-25 (AC-15): cascade forget keeps the exact-entity search filter contract', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '本会话的记忆'),
  ];

  await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.ok(gateway.searches.length > 0, '清理必须先做候选检索');
  for (const search of gateway.searches) {
    assert.deepEqual(
      search.filters,
      {
        AND: [
          { user_id: VISITOR_ID },
          { app_id: APP_ID },
          { metadata: { companion_id: COMPANION_A } },
        ],
      },
      '检索过滤必须沿用既有精确实体契约，隔离条件不得放宽',
    );
  }
});

// ---------------------------------------------------------------------------
// T-25 / AC-15 - isolation is a hard gate. Deleting conversation A must not
// touch conversation B, another companion, or unrelated memories, even when the
// provider returns candidates that ignore the requested filters.
// ---------------------------------------------------------------------------

test('T-25 (AC-15): cascade forget never touches other conversations or other companions', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '本会话的记忆一'),
    conversationMemory('a-2', CONVERSATION_A, COMPANION_A, '本会话的记忆二'),
    conversationMemory('b-1', CONVERSATION_B, COMPANION_A, '另一会话的记忆'),
    conversationMemory('c-1', CONVERSATION_A, COMPANION_B, '另一个伴侣的记忆'),
    {
      id: 'leaked',
      memory: '越界返回、属于另一伴侣的候选',
      score: 0.9,
      metadata: memoryMetadata({
        companion_id: COMPANION_B,
        source_conversation_id: CONVERSATION_A,
      }),
    },
    {
      id: 'no-source',
      memory: '没有来源会话信息的老记忆',
      score: 0.7,
      metadata: memoryMetadata(),
    },
  ];

  const before = snapshot(gateway.memories);

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.deleted, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.errors, []);

  const after = snapshot(gateway.memories);
  const survivors = ['b-1', 'c-1', 'leaked', 'no-source'];
  assert.deepEqual(Object.keys(after).sort(), survivors);
  for (const id of survivors) {
    assert.deepEqual(after[id], before[id], '非本会话来源的记忆必须逐字未变');
  }
  assert.ok(after['c-1'], '另一伴侣的记忆不得被清理');
  assert.ok(
    after['leaked'],
    'companion_id 过滤必须独立生效，不能只依赖 provider 的搜索过滤',
  );
  assert.ok(after['no-source'], '没有来源会话信息的记忆不得被清理');
});

test('T-25 (AC-15): a per-memory delete failure is reported and does not abort the rest', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '可以正常删除的记忆'),
    conversationMemory('a-2', CONVERSATION_A, COMPANION_A, '删除时会抛错的记忆'),
  ];
  gateway.failDeleteIds = new Set(['a-2']);

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.deleted, 1, '单条失败不得中断其余清理');
  assert.equal(result.failed, 1, '失败必须体现在返回值里，不得静默成功');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /a-2/);
  assert.deepEqual(gateway.memories.map((memory) => memory.id), ['a-2']);
});

test('T-25 (AC-15): a provider search failure is reported instead of throwing', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '本会话的记忆'),
  ];
  gateway.searchError = new Error('simulated provider outage');

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0], /simulated provider outage/);
  assert.equal(gateway.memories.length, 1, '检索失败时不得误删任何记忆');
  assert.deepEqual(gateway.deletes, []);
});
// ---------------------------------------------------------------------------
// P2-4 / AC-15 - a memory can be formed in conversation A and later refined by
// conversation B's organizer, so provenance is a SET of conversations.
// Deleting either conversation must still find and forget that memory.
// Before P2-4 the UPDATE overwrote source_conversation_id with the refining
// conversation, so deleting A left the memory behind and it stayed recallable -
// exactly the "UI says deleted, memory still in use" silent success AC-15 bans.
// ---------------------------------------------------------------------------

const refiningOrganizer: MemoryOrganizer = {
  async organize() {
    return {
      operations: [
        {
          action: 'UPDATE',
          memoryId: 'a-1',
          text: '用户喜欢香菜，而且最近研究出了新吃法',
          layer: 'L3',
          memoryType: 'preference',
          reason: '这条偏好被再次确认并补充了细节',
        },
      ],
    };
  },
};

async function refineAcrossConversations(gateway: FakeGateway) {
  const service = createMemoryService({
    enabled: true,
    appId: APP_ID,
    gateway,
    organizer: refiningOrganizer,
    now: () => NOW,
  });
  const result = await service.rememberExchange({
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_B,
    userMessageId: 'user-message-b',
    userText: '我还是喜欢香菜，最近在研究新吃法。',
    assistantMessageId: 'assistant-message-b',
    assistantText: '好，我记住了。',
  });
  assert.equal(result.updated, 1, '前提：这条记忆是被另一个会话的整理器改写的');
  return result;
}

test('P2-4 (AC-15): the origin conversation still recognises a memory that another conversation refined', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '这段对话里用户说过喜欢香菜'),
  ];

  await refineAcrossConversations(gateway);

  const written = gateway.memories.find((memory) => memory.id === 'a-1');
  assert.ok(written, '改写不得删除记忆本身');
  assert.deepEqual(
    written.metadata?.source_conversation_id,
    [CONVERSATION_A, CONVERSATION_B],
    '来源会话是集合：原来的来源必须保留，后来的来源追加在后面，不得覆盖',
  );

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.deleted, 1, '删掉最初产生这条记忆的会话，必须把它一起遗忘');
  assert.equal(result.failed, 0);
  assert.deepEqual(gateway.memories, [], '不得留下「界面已删除、记忆仍会被引用」的残留');
});

test('P2-4 (AC-15): the refining conversation forgets the same memory as well', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '这段对话里用户说过喜欢香菜'),
  ];

  await refineAcrossConversations(gateway);

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_B,
  });

  assert.equal(result.deleted, 1, '改写这条记忆的会话同样是它的来源，删它也要一并遗忘');
  assert.equal(result.failed, 0);
  assert.deepEqual(gateway.memories, []);
});

test('P2-4 (AC-15): a source set that does not contain the deleted conversation is left untouched', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    conversationMemory('a-1', CONVERSATION_A, COMPANION_A, '只属于会话 A 的记忆'),
    {
      id: 'ab-1',
      memory: '会话 A 与 B 共同塑造的记忆',
      score: 0.8,
      metadata: memoryMetadata({
        source_conversation_id: [CONVERSATION_A, CONVERSATION_B],
      }),
    },
    {
      id: 'c-1',
      memory: '来源是第三个会话的记忆',
      score: 0.8,
      metadata: memoryMetadata({ source_conversation_id: ['conversation-c'] }),
    },
    {
      id: 'junk-1',
      memory: '来源字段是脏数据的记忆',
      score: 0.8,
      metadata: memoryMetadata({ source_conversation_id: ['', 42, null] }),
    },
  ];

  const first = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_B,
  });

  assert.equal(first.deleted, 1, '只有来源集合真的包含被删会话的记忆才允许删除');
  assert.deepEqual(
    gateway.memories.map((memory) => memory.id),
    ['a-1', 'c-1', 'junk-1'],
    '来源集合不含被删会话的记忆必须逐字保留',
  );

  const second = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(second.deleted, 1, '字符串形态与集合形态的来源都要认得');
  assert.equal(second.failed, 0);
  assert.equal(second.skipped, 2, '脏数据与无关来源必须计入跳过，而不是被误删');
  assert.deepEqual(gateway.memories.map((memory) => memory.id), ['c-1', 'junk-1']);
});


// ---------------------------------------------------------------------------
// Gating: memory writes can be off while old persisted snapshots still need clearing.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wiring: the DELETE route must use the cascade and must stay structurally
// unable to fail the user-visible delete because of a memory problem.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// T-25 (AC-15) - "删除失败要有明确结果，不得出现静默成功".
//
// The user's delete must still succeed as a delete, but a memory cleanup that
// did not finish may no longer be swallowed into a bare 2xx: the outcome has to
// survive to the client, and the client copy may only claim success when
// nothing was left behind.
// ---------------------------------------------------------------------------

test('T-25 (AC-15): summarizeForgetOutcome never reports a clean forget while memories survive', () => {
  const result = (
    overrides: Partial<{
      enabled: boolean;
      scanned: number;
      deleted: number;
      skipped: number;
      failed: number;
      exhaustive: boolean;
      remaining: number;
      unattributable: number;
      snapshotCleared: boolean;
    }>,
  ) => ({
    enabled: true,
    scanned: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    // 默认「列举穷尽、删除后复核为零、没有无来源行、快照已清」—— 只有这些都成立才允许报 cleared。
    exhaustive: true,
    remaining: 0,
    unattributable: 0,
    snapshotCleared: true,
    ...overrides,
  });

  // 遗忘调用本身抛错（例如缺 MEM0_API_KEY）：剩余条数未知。
  assert.deepEqual(summarizeForgetOutcome(null), {
    status: 'unavailable',
    deleted: 0,
    failed: 0,
  });
  assert.deepEqual(
    summarizeForgetOutcome(result({ enabled: false })),
    { status: 'disabled', deleted: 0, failed: 0 },
  );
  assert.deepEqual(
    summarizeForgetOutcome(result({ scanned: 2, deleted: 2 })),
    { status: 'cleared', deleted: 2, failed: 0 },
  );
  // 有候选但没删干净：必须如实报告残留条数。
  assert.deepEqual(
    summarizeForgetOutcome(result({ scanned: 3, deleted: 2, skipped: 1, failed: 1 })),
    { status: 'partial', deleted: 2, failed: 1 },
  );
  // 检索阶段就失败：连候选都没拿到，不得当成已清理。
  assert.equal(
    summarizeForgetOutcome(result({ scanned: 0, failed: 1 })).status,
    'unavailable',
  );
});

test('T-25 (AC-15): the user-visible delete copy never claims success while memories survive', () => {
  const risky: ForgetConversationReport[] = [
    { status: 'partial', deleted: 2, failed: 1 },
    { status: 'partial', deleted: 0, failed: 3 },
    { status: 'unavailable', deleted: 0, failed: 1 },
    { status: 'unavailable', deleted: 0, failed: 0 },
  ];

  for (const report of risky) {
    const notice = deleteConversationNotice(report);
    assert.equal(
      notice.level,
      'warning',
      `${report.status} 状态下不得给「已删除」的正向反馈`,
    );
    assert.doesNotMatch(
      notice.message,
      /^已删除这段回忆$/,
      '有残留或结果未知时，文案必须说明情况',
    );
  }

  // 确认没有残留、或长期记忆本来就没开启，才允许正向反馈。
  assert.equal(deleteConversationNotice({ status: 'cleared', deleted: 3, failed: 0 }).level, 'success');
  assert.equal(deleteConversationNotice({ status: 'disabled', deleted: 0, failed: 0 }).level, 'success');
  assert.equal(deleteConversationNotice(undefined).level, 'success');
  assert.match(deleteConversationNotice({ status: 'partial', deleted: 2, failed: 1 }).message, /1/);

  const shell = readFileSync(
    new URL('../src/components/chat/chat-shell.tsx', import.meta.url),
    'utf8',
  );
  assert.match(shell, /deleteConversationNotice\(/, '删除会话的文案必须由遗忘结果决定');
  assert.doesNotMatch(
    shell,
    /\.then\(\(\) => \{[\s\S]{0,600}toast\.success\('已删除这段回忆'\)/,
    '不得再无条件地宣布删除成功',
  );
});

// ---------------------------------------------------------------------------
// T-26 / AC-16 - "stop bringing this up" retires recall but keeps history.
//
// The retirement mechanism (validUntil -> isExpired -> normalizeMemory returns
// null) already exists in service.ts. These tests LOCK that behaviour in place;
// they are not new implementation. The distinguishing point against AC-08 is
// that "this is over" (temporal_status = resolved) remains recallable while
// "stop bringing this up" does not.
// ---------------------------------------------------------------------------

test('T-26 (AC-16): a retired memory is no longer recalled but its record is kept', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    {
      id: 'retired',
      memory: '用户提过曾经在年会上出过洋相',
      score: 0.95,
      metadata: memoryMetadata({ valid_until: '2026-09-10T00:00:00.000Z' }),
    },
    {
      id: 'live',
      memory: '用户喜欢在雨天听爵士乐',
      score: 0.9,
      metadata: memoryMetadata(),
    },
  ];

  const service = createTestService(gateway);
  const recalled = await service.recall({
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    query: '年会上发生了什么？',
  });

  assert.equal(
    recalled.some((memory) => memory.id === 'retired'),
    false,
    '「别再提这个」之后，失效记忆不得再进入回复上下文',
  );
  assert.equal(
    recalled.some((memory) => memory.id === 'live'),
    true,
    '失效只作用于被点名的记忆，其它记忆不受影响',
  );
  assert.equal(gateway.memories.length, 2, '历史记录必须保留，而不是被删除');
  assert.deepEqual(gateway.deletes, [], '「别再提」不得走删除路径');
  assert.deepEqual(gateway.updates, [], '「别再提」不得改写记录正文');
});

test('T-26 (AC-16 vs AC-08): a finished event stays recallable, so 结束 and 别再提 stay distinguishable', async () => {
  const gateway = new FakeGateway();
  gateway.memories = [
    {
      id: 'resolved',
      memory: '用户上个月的搬家已经结束了',
      score: 0.9,
      metadata: memoryMetadata({ temporal_status: 'resolved' }),
    },
    {
      id: 'retired',
      memory: '用户提过曾经在年会上出过洋相',
      score: 0.9,
      metadata: memoryMetadata({ valid_until: '2026-09-10T00:00:00.000Z' }),
    },
  ];

  const service = createTestService(gateway);
  const recalled = await service.recall({
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    query: '搬家的事情怎么样了？',
  });

  const resolved = recalled.find((memory) => memory.id === 'resolved');
  assert.ok(resolved, '「事情结束了」是事实状态，仍然可以被回忆起');
  assert.equal(resolved.temporalStatus, 'resolved');
  assert.equal(
    recalled.some((memory) => memory.id === 'retired'),
    false,
    '「别再提」是不再使用，与「结束」行为不同',
  );
  assert.equal(gateway.memories.length, 2, '两种语义都保留记录，都不删除历史');
});

// ---------------------------------------------------------------------------
// F4（code review r1）：快照按 (visitor, companion) 缓存，所以「删会话」必须
// 显式清掉快照里来源为该会话的条目，否则已删除的记忆会在缓存里继续存活。
// 这里断言判定口径本身（纯函数），以及删除路径确实接上了这一步。
// ---------------------------------------------------------------------------

function snapshotMemory(id: string, sourceConversationIds: string[]) {
  return {
    id, text: `记忆 ${id}`, layer: 'L2' as const, bucket: 'long_term_impression' as const,
    domain: 'preference' as const, memoryType: 'preference_summary' as const, importance: 0.8,
    confidence: 'explicit' as const, evidenceMemoryIds: [], score: 0.9,
    observedAt: '2026-09-29T10:00:00.000Z', occurredAt: null, timePrecision: null,
    validUntil: null, temporalStatus: 'timeless' as const,
    sourceConversationIds, createdAt: null, updatedAt: null,
  };
}

test('F4 a deleted conversation\'s memories are dropped from the recall snapshot', () => {
  const payload = [
    snapshotMemory('from-deleted', [CONVERSATION_A]),
    snapshotMemory('from-kept', ['some-other-conversation']),
    snapshotMemory('from-both', [CONVERSATION_A, 'some-other-conversation']),
  ];

  const kept = withoutConversationSource(payload, CONVERSATION_A);

  // 「来源是一个集合」：同时来自被删会话与另一会话的记忆，只要沾到被删会话就必须剔除 ——
  // 用户删的是那段对话，不该还从缓存里把它说出来。
  assert.deepEqual(kept.map((memory) => memory.id), ['from-kept']);
});

test('F4 a snapshot entry with no recorded source is conservatively kept', () => {
  // 口径与 cascade-forget 的 sourceConversationIds 一致：字段缺失 = 不知道来源，
  // 保守保留（宁可多留一轮，也不误删一条仍然有效的记忆）。
  const kept = withoutConversationSource([snapshotMemory('unknown-source', [])], CONVERSATION_A);
  assert.deepEqual(kept.map((memory) => memory.id), ['unknown-source']);
});

test('forgetting a conversation is not capped by the retrieval limit', async () => {
  // 修前 `forgetConversationMemories` 借 search() 找候选，而 search 有上限
  // （本地网关每腿 48、最终 30）。于是超过上限的记忆**永远不会被扫描**，
  // 删掉会话它们却留在库里 —— 本地表已是唯一存储，这就是隐私面的漏删。
  // 这里让检索腿只给 30 条（模拟上限），而穷尽列举给出全部 40 条。
  const all = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    memory: `记忆 ${index}`,
    metadata: {
      app_id: 'app-1', visitor_id: 'v1', companion_id: 'c1',
      source_conversation_id: 'conv-1',
    },
  }));
  const deleted: string[] = [];
  const gateway = {
    search: async () => all.slice(0, 30),
    listBySourceConversation: async () => all,
    add: async () => { throw new Error('unused'); },
    update: async () => {},
    delete: async (id: string) => { deleted.push(id); },
  };

  const result = await cascadeForget({
    gateway, appId: 'app-1', visitorId: 'v1', companionId: 'c1', conversationId: 'conv-1',
  });

  assert.equal(result.deleted, 40, '全部 40 条都必须被清掉，不能被检索上限截成 30');
  assert.equal(deleted.length, 40);
});

test('a gateway without the exhaustive lister still works through search', async () => {
  // 可选能力：Mem0 之类的后端不实现它，回退路径必须照旧可用。
  const deleted: string[] = [];
  const gateway = {
    search: async () => [{
      id: 'm1', memory: 'x',
      metadata: { app_id: 'app-1', visitor_id: 'v1', companion_id: 'c1', source_conversation_id: 'conv-1' },
    }],
    add: async () => { throw new Error('unused'); },
    update: async () => {},
    delete: async (id: string) => { deleted.push(id); },
  };

  const result = await cascadeForget({
    gateway, appId: 'app-1', visitorId: 'v1', companionId: 'c1', conversationId: 'conv-1',
  });

  assert.equal(result.deleted, 1);
});

test('a snapshot that could not be pruned makes the report partial, not cleared', () => {
  // 独立核验 t8 真库实测：注入失败 runner ⇒ forgetConversationSnapshot 返回 false、快照仍留 2 条该会话条目，
  // 而另一次遗忘仍报 **cleared** —— 因为 index.ts 丢弃了那个返回值。
  // 快照会注入提示词，所以那正是 AC-15 禁止的「界面已删除、记忆仍被引用」（最多一个 TTL / 轮次上限）。
  const base = {
    scanned: 3, deleted: 3, skipped: 0, failed: 0, errors: [] as string[],
    exhaustive: true, remaining: 0, unattributable: 0, snapshotCleared: true,
  };

  assert.equal(summarizeForgetOutcome({ enabled: true, ...base }).status, 'cleared', '前置：清干净时才报 cleared');
  assert.equal(
    summarizeForgetOutcome({ enabled: true, ...base, snapshotCleared: false }).status,
    'partial',
    '快照没清干净必须让汇总说 partial，而不是 cleared',
  );
});

test('cleared requires proof: not-exhaustive / rows left / unattributable all downgrade', () => {
  // 这是本类缺陷的根因对策（独立核验 t5→t8 逐个实测出来的四条路径）。
  // 原先的成功判据是「每一次 delete 都返回了」——计的是意图，不是效果；
  // 现在三项都能各自把结论压回 partial：
  const result = (
    overrides: Partial<{ exhaustive: boolean; remaining: number; unattributable: number }>,
  ) => ({
    enabled: true,
    scanned: 2, deleted: 2, skipped: 0, failed: 0, errors: [] as string[],
    exhaustive: true, remaining: 0, unattributable: 0, snapshotCleared: true,
    ...overrides,
  });

  assert.equal(summarizeForgetOutcome(result({})).status, 'cleared', '三项都成立时才报 cleared');

  assert.equal(
    summarizeForgetOutcome(result({ exhaustive: false })).status,
    'partial',
    '列举不穷尽 ⇒「没找到」与「不存在」不可区分，不许报 cleared',
  );
  assert.equal(
    summarizeForgetOutcome(result({ remaining: 2 })).status,
    'partial',
    '删除后复核仍然看得见 ⇒ 删了没删掉，不许报 cleared',
  );
  assert.equal(
    summarizeForgetOutcome(result({ unattributable: 4 })).status,
    'partial',
    '有看不出归属的行 ⇒ 无法确认它们是否属于这段对话，不许报 cleared',
  );
});

test('a delete that returns success without deleting cannot be reported as cleared', async () => {
  // 这是本类缺陷的**根因场景**：`deleted` 原先计的是「gateway.delete 返回了」，而不是「那行真的没了」。
  // 这里让 delete 返回成功、却什么都不删 —— 修前会得到 deleted=2 / cleared，而库里两行都在。
  const sourced = (id: string): ProviderMemory => ({
    id,
    memory: `记忆 ${id}`,
    metadata: {
      app_id: APP_ID,
      visitor_id: VISITOR_ID,
      companion_id: COMPANION_A,
      source_conversation_id: CONVERSATION_A,
    },
  });
  const rows = [sourced('m1'), sourced('m2')];
  const gateway: MemoryGateway = {
    search: async () => rows,
    // 穷尽列举提供得到（所以失败只能来自「删了还在」，而不是来自「列举不穷尽」）
    listBySourceConversation: async () => rows,
    delete: async () => {}, // 返回成功，一行没删
    add: async () => {
      throw new Error('unused');
    },
    update: async () => {},
  };

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.deleted, 2, '按「叫过删除」的口径仍会记 2 —— 这正是修前的算法');
  assert.equal(result.remaining, 2, '删除后复核必须看见它们还在');
  assert.equal(
    // cascade-forget 的 result 不带 snapshotCleared（那是 index 包装层补的），这里显式给 true，
    // 让失败只可能来自「删了还在」这一项。
    summarizeForgetOutcome({ enabled: true, snapshotCleared: true, ...result }).status,
    'partial',
    '计效果而不是计意图：删了没删掉就不许报 cleared',
  );
});

test('a gateway with only the lister cannot prove completeness either', async () => {
  // t9 抓到的最后一处同类毛病：counter 是**可选**成员，缺失时被静默当成「0 行无来源」，
  // 于是「有 lister、没 counter」的网关仍会报 cleared，而库里可能还留着无来源的记忆（t9 真库复现）。
  // 完整性可证明，需要**两项**能力齐备。
  const sourced = (id: string): ProviderMemory => ({
    id,
    memory: `记忆 ${id}`,
    metadata: {
      app_id: APP_ID,
      visitor_id: VISITOR_ID,
      companion_id: COMPANION_A,
      source_conversation_id: CONVERSATION_A,
    },
  });
  const gateway: MemoryGateway = {
    search: async () => [],
    listBySourceConversation: async () => [sourced('m1')],
    // 故意**不提供** countUnattributableMemories
    delete: async () => {},
    add: async () => {
      throw new Error('unused');
    },
    update: async () => {},
  };

  const result = await cascadeForget({
    gateway,
    appId: APP_ID,
    visitorId: VISITOR_ID,
    companionId: COMPANION_A,
    conversationId: CONVERSATION_A,
  });

  assert.equal(result.exhaustive, false, '缺 counter ⇒ 完整性不可证明');
  assert.equal(
    summarizeForgetOutcome({ enabled: true, snapshotCleared: true, ...result }).status,
    'partial',
    '不能因为「数不出来」就当成「没有无来源行」',
  );
});

test('a missing snapshotCleared reads as "not cleared", not as "fine"', () => {
  // 独立核验 t10 的类型邀请：写成 `?:` 时「没给这个字段」会被读成「快照没问题」。
  // 我把类型改成必填，但实测**退回可选时编译器一处都不报**（现存构造点本来就都给了值）——
  // 所以必填只拦未来新写的代码，真正的护栏是运行时的 `!== true` 读法。这条用例钉的就是它。
  const withoutField = {
    enabled: true,
    scanned: 3, deleted: 3, skipped: 0, failed: 0, errors: [] as string[],
    exhaustive: true, remaining: 0, unattributable: 0,
  } as unknown as Parameters<typeof summarizeForgetOutcome>[0];

  assert.equal(
    summarizeForgetOutcome(withoutField)?.status,
    'partial',
    '缺字段 ⇒ 不能当成「快照已清」',
  );
});
