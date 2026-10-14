import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistExchangeMemories,
  type ExchangeMemoryDeps,
} from '../src/lib/memory/exchange-persistence';
import type { RelationshipSnapshotOutcome } from '../src/lib/memory/relationship-snapshot';

type PreferenceCall = {
  visitorId: string;
  companionId: string;
  conversationId: string;
  observedAt: string;
  text: string;
};

function harness(overrides: Partial<ExchangeMemoryDeps> = {}) {
  const feedbackCalls: PreferenceCall[] = [];
  const snapshotCalls: Array<{ visitorId: string; companionId: string; observedAt: string; update: unknown }> = [];

  const deps: ExchangeMemoryDeps = {
    recordPreference: async (input) => {
      feedbackCalls.push(input);
      return true;
    },
    persistSnapshot: async (input) => {
      snapshotCalls.push(input);
      return { status: 'written', fields: ['emotionalTone'] };
    },
    ...overrides,
  };

  return { deps, feedbackCalls, snapshotCalls };
}

test('T-18 route side: each distinct piece of feedback is written once, duplicates and blanks are dropped', async () => {
  const { deps, feedbackCalls } = harness();

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-07-24T20:00:00+08:00',
    feedback: ['别每次都逗我', '别每次都逗我', '   ', '真的别逗了'],
    userTexts: ['你到底听没听见，真的别逗了，别每次都逗我'],
    deps,
  });

  assert.deepEqual(
    feedbackCalls.map((call) => call.text),
    ['别每次都逗我', '真的别逗了'],
  );
  assert.deepEqual(outcome.feedback, {
    attempted: 2,
    written: 2,
    failed: 0,
    dropped: 0,
    droppedAssistantEcho: 0,
    droppedUnverifiable: 0,
  });
});

test('T-20 route side: a quiet turn touches nothing at all and reports it honestly', async () => {
  const { deps, feedbackCalls, snapshotCalls } = harness();

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-07-24T20:00:00+08:00',
    feedback: [],
    snapshotUpdate: undefined,
    deps,
  });

  assert.equal(feedbackCalls.length, 0);
  assert.equal(snapshotCalls.length, 0);
  assert.deepEqual(outcome.feedback, {
    attempted: 0,
    written: 0,
    failed: 0,
    dropped: 0,
    droppedAssistantEcho: 0,
    droppedUnverifiable: 0,
  });
  assert.deepEqual(outcome.snapshot, { status: 'skipped', reason: 'no-update' });
});

test('T-21 / T-22 route side: a stale snapshot is rejected silently and counted, never thrown', async () => {
  const { deps, snapshotCalls } = harness({
    persistSnapshot: async (input) => {
      snapshotCalls.push(input);
      return { status: 'rejected', reason: 'stale-update' };
    },
  });

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-07-24T20:00:00+08:00',
    snapshotUpdate: { emotionalTone: '更安心' },
    deps,
  });

  assert.equal(snapshotCalls.length, 1);
  assert.deepEqual(outcome.snapshot, { status: 'rejected', reason: 'stale-update' });
  assert.equal(outcome.snapshotRejected, 1);
  // 迟到的结果不改写任何内容：调用方没有拿到新的写入，也就无从覆盖。
  assert.equal(outcome.snapshotWritten, 0);
});

test('T-23 route side: a failing feedback write and a failing snapshot never reach the conversation', async () => {
  const { deps } = harness({
    recordPreference: async () => {
      throw new Error('simulated feedback outage');
    },
    persistSnapshot: async () => {
      throw new Error('simulated snapshot outage');
    },
  });

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-07-24T20:00:00+08:00',
    feedback: ['别每次都逗我'],
    userTexts: ['别每次都逗我'],
    snapshotUpdate: { emotionalTone: '更安心' },
    deps,
  });

  assert.deepEqual(outcome.feedback, {
    attempted: 1,
    written: 0,
    failed: 1,
    dropped: 0,
    droppedAssistantEcho: 0,
    droppedUnverifiable: 0,
  });
  assert.equal(outcome.snapshot.status, 'failed');
  assert.equal(outcome.snapshotFailed, 1);
});

test('T-18 route side: a structured failure result counts as failed, not written', async () => {
  const { deps } = harness({
    recordPreference: async () => false,
  });

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-07-24T20:00:00+08:00',
    feedback: ['别每次都逗我'],
    userTexts: ['别每次都逗我'],
    deps,
  });

  assert.deepEqual(outcome.feedback, {
    attempted: 1,
    written: 0,
    failed: 1,
    dropped: 0,
    droppedAssistantEcho: 0,
    droppedUnverifiable: 0,
  });
});

test('T-20 regression gate: the snapshot write always carries companion_id so partners stay separate', async () => {
  const { deps, snapshotCalls } = harness();

  await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-a',
    conversationId: 'conversation-a',
    observedAt: '2026-07-24T20:00:00+08:00',
    snapshotUpdate: { emotionalTone: '更安心' },
    deps,
  });
  await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-b',
    conversationId: 'conversation-b',
    observedAt: '2026-07-24T20:01:00+08:00',
    snapshotUpdate: { emotionalTone: '还客气' },
    deps,
  });

  assert.deepEqual(
    snapshotCalls.map((call) => call.companionId),
    ['companion-a', 'companion-b'],
  );
  assert.deepEqual(
    snapshotCalls.map((call) => call.visitorId),
    ['visitor-1', 'visitor-1'],
  );
  assert.equal(snapshotCalls[0].observedAt, '2026-07-24T20:00:00+08:00');
});

test('T-19 route side: the snapshot outcome is passed through unchanged for the caller to log', async () => {
  const outcome: RelationshipSnapshotOutcome = { status: 'written', fields: ['dynamicSummary'] };
  const { deps } = harness({ persistSnapshot: async () => outcome });

  const result = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-07-24T20:00:00+08:00',
    snapshotUpdate: { dynamicSummary: '开始互相报备行程' },
    deps,
  });

  assert.deepEqual(result.snapshot, outcome);
  assert.equal(result.snapshotWritten, 1);
  assert.equal(result.snapshotRejected, 0);
});
// ── 2026-09-27 事故：整理器把「角色自己的台词」写成「用户提出的相处方式要求」 ──
//
// 现场：澜汐在房间里编了一句「还有几颗你上次说喜欢的那种小蓝珠子」，整理器把这句话
// （连同用户随后的问责提问、以及澜汐自己的检讨台词）写进了 visitor 级的
// communication_prefs.explicit_feedback。该字段每个伴侣、每次对话都会读进去并渲染成
// 「TA 提出的相处方式要求」，于是之后新建的伴侣（星寻）开口就替一件它没做过的事道歉。

test('反馈来源校验：角色自己的台词不会被写成用户的要求（澜汐-星寻事故）', async () => {
  const { deps, feedbackCalls } = harness();

  const assistantLine = '用记忆当道具，编出你没说过的话来显得我懂你——今晚就犯过一次，我记着。';
  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-09-27T00:43:00+08:00',
    feedback: [assistantLine, '跟你说实话，包括说错的时候认账'],
    userTexts: ['换个问题——你作为 AI，训练的时候有没有什么是你不喜欢的？'],
    assistantText: '这个刚才答过一半。' + assistantLine + '想坚持的两件事：一是跟你说实话，包括说错的时候认账。',
    deps,
  });

  assert.equal(feedbackCalls.length, 0, '角色的台词一个字都不该写进用户偏好');
  assert.deepEqual(outcome.feedback, {
    attempted: 2,
    written: 0,
    failed: 0,
    dropped: 2,
    droppedAssistantEcho: 2,
    droppedUnverifiable: 0,
  });
});

test('反馈来源校验：用户原话照写，标点与引号差异不影响判定', async () => {
  const { deps, feedbackCalls } = harness();

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-09-27T00:43:00+08:00',
    feedback: ['别每次都逗我'],
    userTexts: ['其实……"别每次都逗我"，行吗？'],
    assistantText: '好，记下了。',
    deps,
  });

  assert.deepEqual(feedbackCalls.map((call) => call.text), ['别每次都逗我']);
  assert.equal(outcome.feedback.written, 1);
  assert.equal(outcome.feedback.dropped, 0);
});

test('反馈来源校验：上一轮用户说过的话算有来源，来源不明的一律不写（fail closed）', async () => {
  const { deps, feedbackCalls } = harness();

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-09-27T00:43:00+08:00',
    feedback: ['有事直接说', '你希望我以后温柔一点'],
    userTexts: ['这轮没提要求', '上周我说过有事直接说'],
    assistantText: '好。',
    deps,
  });

  assert.deepEqual(feedbackCalls.map((call) => call.text), ['有事直接说']);
  assert.equal(outcome.feedback.droppedUnverifiable, 1, '找不到来源的条目 fail closed');
});

test('反馈来源校验：没有提供用户原文时一律不写（宁可不记，也不误记）', async () => {
  const { deps, feedbackCalls } = harness();

  const outcome = await persistExchangeMemories({
    visitorId: 'visitor-1',
    companionId: 'companion-1',
    conversationId: 'conversation-1',
    observedAt: '2026-09-27T00:43:00+08:00',
    feedback: ['别每次都逗我'],
    deps,
  });

  assert.equal(feedbackCalls.length, 0);
  assert.equal(outcome.feedback.droppedUnverifiable, 1);
});
