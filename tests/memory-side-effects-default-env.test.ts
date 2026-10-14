import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractExchangeSideEffects,
} from '../src/lib/memory/index';
import type {
  MemoryOrganizer,
  MemoryOrganizerInput,
  MemoryPlan,
  RememberExchangeInput,
} from '../src/lib/memory/service';

// 本文件全部 fixture 都是合成数据；不含任何真实对话、凭证或私人聊天内容。

/** 「别每次都逗我」这类原话：用户直接说出口的相处方式要求。 */
const INPUT: RememberExchangeInput = {
  visitorId: 'visitor-synthetic',
  companionId: 'companion-synthetic',
  conversationId: 'conversation-synthetic',
  userMessageId: 'message-user-synthetic',
  userText: '别每次都逗我',
  assistantMessageId: 'message-assistant-synthetic',
  assistantText: '好，我记着了。',
  recentTurns: [{ userText: '今天有点累', assistantText: '那就早点休息。' }],
};

interface OrganizerSpy {
  organizer: MemoryOrganizer;
  inputs: MemoryOrganizerInput[];
}

function organizerReturning(plan: Partial<MemoryPlan>, options: { throws?: Error } = {}): OrganizerSpy {
  const inputs: MemoryOrganizerInput[] = [];
  return {
    inputs,
    organizer: {
      async organize(input: MemoryOrganizerInput): Promise<MemoryPlan> {
        inputs.push(input);
        if (options.throws) throw options.throws;
        return { operations: [], ...plan };
      },
    },
  };
}

const TIME_ZONE = { resolveTimeZone: async () => 'Asia/Shanghai' };

/** Pure extraction fixtures; persistent worker effects are covered by sqlite-memory.test.ts. */
async function withSyntheticFixture<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

test('AC-17: 纯整理器识别时，用户当场说的相处方式要求仍被识别并带出', async () => {
  await withSyntheticFixture(async () => {

    const spy = organizerReturning({ communicationPrefsFeedback: ['别每次都逗我'] });
    const result = await extractExchangeSideEffects(INPUT, {
      organizer: spy.organizer,
      ...TIME_ZONE,
    });

    assert.deepEqual(result.feedback, ['别每次都逗我'], '原话必须原样带出，供写入侧落库');
    // 向量记忆这一轮确实没有产出，计数必须如实为零——不能假装记住了。
  });
});

test('AC-13: 纯整理器识别时，关系状态变化同样被带出到写入侧', async () => {
  await withSyntheticFixture(async () => {
    const spy = organizerReturning({
      relationshipSnapshot: { emotionalTone: '更松弛了' },
    });
    const result = await extractExchangeSideEffects(INPUT, {
      organizer: spy.organizer,
      ...TIME_ZONE,
    });

    assert.deepEqual(result.relationshipSnapshot, { emotionalTone: '更松弛了' });
  });
});

test('T-23: 识别失败只是这一轮没有副作用，绝不把错误传回对话主链路', async () => {
  await withSyntheticFixture(async () => {
    const spy = organizerReturning({}, { throws: new Error('organizer unavailable') });
    const result = await extractExchangeSideEffects(INPUT, {
      organizer: spy.organizer,
      ...TIME_ZONE,
    });

    assert.deepEqual(result, {});
    assert.equal(result.feedback, undefined);
    assert.equal(result.relationshipSnapshot, undefined);
  });
});

test('没有产物时不增加任何键，合成环境下的返回值与既有形状逐字节一致', async () => {
  await withSyntheticFixture(async () => {
    const spy = organizerReturning({});
    const result = await extractExchangeSideEffects(INPUT, {
      organizer: spy.organizer,
      ...TIME_ZONE,
    });

    assert.deepEqual(Object.keys(result), []);
    assert.deepEqual(result, {});
  });
});

test('T-14: 整理器的 nowIso 与快照 observedAt 同源，用的是用户时区', async () => {
  await withSyntheticFixture(async () => {
    const spy = organizerReturning({});
    await extractExchangeSideEffects(INPUT, { organizer: spy.organizer, ...TIME_ZONE });

    assert.equal(spy.inputs.length, 1);
    assert.match(spy.inputs[0].nowIso, /\+08:00$/, 'nowIso 必须带用户时区偏移');
    assert.ok(
      Number.isFinite(new Date(spy.inputs[0].nowIso).getTime()),
      'nowIso 必须是可解析的绝对时间',
    );
  });
});

test('纯整理器识别时没有既有记忆可给：整理器只做本轮识别，且仍然看到最近几轮前文', async () => {
  await withSyntheticFixture(async () => {
    const spy = organizerReturning({});
    await extractExchangeSideEffects(INPUT, { organizer: spy.organizer, ...TIME_ZONE });

    assert.deepEqual(spy.inputs[0].existingMemories, [], '不能凭空捏造既有记忆');
    assert.deepEqual(spy.inputs[0].recentTurns, INPUT.recentTurns, 'T-10：指代解析仍需要前文');
    assert.equal(spy.inputs[0].userText, INPUT.userText);
    assert.equal(spy.inputs[0].visitorId, INPUT.visitorId);
    assert.equal(spy.inputs[0].companionId, INPUT.companionId);
  });
});
