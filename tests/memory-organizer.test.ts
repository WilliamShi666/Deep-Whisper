import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOrganizerPrompt,
  parseMemoryPlan,
} from '../src/lib/memory/organizer';

test('accepts bounded, schema-valid lifecycle operations', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户喜欢豆浆油条',
        layer: 'L3',
        memoryType: 'preference',
        reason: '稳定偏好',
      },
      {
        action: 'UPDATE',
        memoryId: 'memory-1',
        text: '用户不再喜欢小笼包，现在喜欢豆浆油条',
        layer: 'L3',
        memoryType: 'preference',
        reason: '明确修正',
      },
      {
        action: 'DELETE',
        memoryId: 'memory-2',
        reason: '用户明确撤销',
      },
    ],
  });

  assert.equal(plan.operations.length, 3);
});

test('accepts absolute event time, precision, lifecycle state, and expiry', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户于 2026-07-25 15:00 参加产品经理面试',
        layer: 'L3',
        bucket: 'key_detail',
        domain: 'event',
        memoryType: 'time_bounded_commitment',
        importance: 0.95,
        confidence: 'explicit',
        evidenceMemoryIds: [],
        occurredAt: '2026-07-25T15:00:00+08:00',
        timePrecision: 'exact',
        validUntil: '2026-08-01T23:59:59+08:00',
        temporalStatus: 'upcoming',
        reason: '用户明确提供了面试时间',
      },
    ],
  });

  assert.equal(plan.operations[0]?.occurredAt, '2026-07-25T15:00:00+08:00');
  assert.equal(plan.operations[0]?.timePrecision, 'exact');
  assert.equal(plan.operations[0]?.temporalStatus, 'upcoming');
});

test('drops an unknown model-generated domain so service can derive it from memory type', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户最喜欢的早餐是蟹粉小笼包',
        layer: 'L3',
        bucket: 'key_detail',
        domain: 'food',
        memoryType: 'preference',
        importance: 0.9,
        confidence: 'explicit',
        reason: '用户明确表达早餐偏好',
      },
    ],
  });

  assert.equal(plan.operations[0]?.domain, undefined);
  assert.equal(plan.operations[0]?.memoryType, 'preference');
});

test('keeps a valid lifecycle operation when the model omits reason', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户刚结束一场 Agent 开发面试，结果尚未确定',
        layer: 'L3',
        bucket: 'key_detail',
        domain: 'event',
        memoryType: 'event',
        importance: 0.85,
        confidence: 'explicit',
        temporalStatus: 'resolved',
      },
    ],
  });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0]?.reason, '模型未提供整理原因');
});

test('rejects UPDATE or DELETE operations without a target memory id', () => {
  assert.throws(
    () =>
      parseMemoryPlan({
        operations: [
          {
            action: 'UPDATE',
            text: '新值',
            layer: 'L3',
            memoryType: 'preference',
            reason: '修正',
          },
        ],
      }),
    /memoryId/,
  );
});

test('rejects low-value operation explosions beyond the configured cap', () => {
  assert.throws(
    () =>
      parseMemoryPlan({
        operations: Array.from({ length: 7 }, (_, index) => ({
          action: 'ADD',
          text: `事实 ${index}`,
          layer: 'L3',
          memoryType: 'other',
          reason: 'test',
        })),
      }),
    /too_big|maximum|less than or equal/i,
  );
});

const KEPT_PHRASE_TURN = {
  nowIso: '2026-09-16T09:30:00+08:00',
  visitorId: 'visitor-1',
  companionId: 'companion-1',
  userText: '把这句话记下来：今晚不是来交作业的',
  assistantText: '好，这句我替你留着。',
  existingMemories: [],
};

test('T-09 the kept-phrase rule keeps the user wording verbatim and forbids character-authored quotes', () => {
  const prompt = buildOrganizerPrompt(KEPT_PHRASE_TURN);

  // (a) the kept phrase is the user's own wording, preserved verbatim.
  assert.match(prompt, /shared_quote/);
  assert.match(prompt, /逐字保留用户原话/);

  // (b) only an explicit user request or a mutual agreement may create the type.
  assert.match(prompt, /用户明确希望被记住/);
  assert.match(prompt, /共同约定留下/);

  // (c) the character's own wording must never be stored as this type.
  assert.match(prompt, /角色自己的措辞[\s\S]{0,80}?不得写入该类型/);

  // The new type must not weaken the existing evidence gates (rules 5 / 9).
  assert.match(prompt, /不要依据角色回复创造用户事实/);
  assert.match(prompt, /不能把“角色”的责备/);
});

const ORGANIZER_RECENT_TURNS = [
  { userText: '我下周要去杭州出差', assistantText: '嗯，那边最近降温。' },
  { userText: '就是上次说的那个客户', assistantText: '记得，你说过他很难缠。' },
];

test('T-11 the organizer renders bounded recent turns with labelled speakers and never treats them as user facts', () => {
  const prompt = buildOrganizerPrompt({
    ...KEPT_PHRASE_TURN,
    recentTurns: ORGANIZER_RECENT_TURNS,
  });
  const first = ORGANIZER_RECENT_TURNS[0];
  const second = ORGANIZER_RECENT_TURNS[1];

  // (a) every prior turn renders as a labelled user/character pair.
  assert.ok(prompt.includes('用户：' + first.userText));
  assert.ok(prompt.includes('角色：' + first.assistantText));
  assert.ok(prompt.includes('用户：' + second.userText));
  assert.ok(prompt.includes('角色：' + second.assistantText));

  // (b) the pairs stay in chronological order, oldest first.
  const firstUserAt = prompt.indexOf('用户：' + first.userText);
  const firstCharacterAt = prompt.indexOf('角色：' + first.assistantText);
  const secondUserAt = prompt.indexOf('用户：' + second.userText);
  const secondCharacterAt = prompt.indexOf('角色：' + second.assistantText);
  assert.ok(firstUserAt < firstCharacterAt);
  assert.ok(firstCharacterAt < secondUserAt);
  assert.ok(secondUserAt < secondCharacterAt);

  // (c) the character's own words are explicitly not user facts.
  assert.match(prompt, /「角色」说过的[^。]{0,40}不是用户事实/);

  // (d) prior context only resolves references and confirms context.
  assert.match(prompt, /只用于解析指代与确认语境/);
  assert.match(prompt, /不得据此新建事实/);

  // (e) rule 5 keeps its original wording.
  assert.match(prompt, /不要依据角色回复创造用户事实/);
});

test('T-11 recent turns are byte-for-byte backward compatible when undefined or empty', () => {
  const withTurns = buildOrganizerPrompt({
    ...KEPT_PHRASE_TURN,
    recentTurns: ORGANIZER_RECENT_TURNS,
  });
  const withoutTurns = buildOrganizerPrompt({ ...KEPT_PHRASE_TURN });
  const emptyTurns = buildOrganizerPrompt({ ...KEPT_PHRASE_TURN, recentTurns: [] });

  // undefined and [] both render exactly the pre-T-11 prompt.
  assert.equal(withoutTurns, emptyTurns);
  // 探针用完整标题：规则 13 的正文里也提到了这一段的名字，短前缀会误判。
  assert.ok(!withoutTurns.includes('【最近几轮前文（按时间顺序，旧→新）】'));
  assert.ok(!withoutTurns.includes(ORGANIZER_RECENT_TURNS[0].userText));

  // the one and only difference is a single contiguous inserted block.
  const blockStart = withTurns.indexOf('【最近几轮前文（按时间顺序，旧→新）】');
  const blockEnd = withTurns.indexOf('【三类记忆】');
  assert.ok(blockStart > 0);
  assert.ok(blockEnd > blockStart);
  assert.equal(withTurns.replace(withTurns.slice(blockStart, blockEnd), ''), withoutTurns);
});

test('T-12 the end of a matter resolves it instead of forgetting it', () => {
  const prompt = buildOrganizerPrompt(KEPT_PHRASE_TURN);

  // (a) the resolved lifecycle status stays available to the model.
  assert.ok(prompt.includes('"temporalStatus":"timeless|upcoming|ongoing|resolved或null"'));

  // (b) 「忘掉它」不再删除（产品口径 2026-10-01）：唯一允许的 DELETE 是撤销边界本身。
  const deleteLine = prompt.split('\n').find((line) => line.includes('DELETE 对应的 avoid_topic')) ?? '';
  assert.ok(deleteLine.length > 0);
  assert.ok(!deleteLine.includes('已经结束'));
  assert.match(deleteLine, /只能删 avoid_topic/);

  // (c) "it is over" updates the lifecycle status and keeps the record.
  assert.match(prompt, /结束不等于遗忘/);
  assert.match(prompt, /temporalStatus 设为 resolved/);
  assert.match(prompt, /不得再追问此事的结果/);
  assert.match(prompt, /不得再把它当成待办/);
});

test('T-13 the three end states are separated: resolved, reminder-off, and explicit forget', () => {
  const prompt = buildOrganizerPrompt(KEPT_PHRASE_TURN);

  // (a) 三种都保留原记忆：「忘掉它」也不删除用户说过的事，而是记一条 avoid_topic 边界。
  assert.match(prompt, /三种都必须保留原记忆/);
  assert.match(prompt, /不得 DELETE 青岛那条记忆/);
  assert.match(prompt, /memoryType=avoid_topic/);
  assert.match(prompt, /用户不希望再被提起：/);

  // (b) each state is described in the user's own words.
  assert.ok(prompt.includes('已经结束了 / 有结果了'));
  assert.ok(prompt.includes('不需要提醒我 / 别提醒我了'));
  assert.ok(prompt.includes('忘掉它 / 别提了 / 不要再提 / 删掉这条 / 不要再记'));

  // (c) reminder-off keeps the record and expires it through validUntil.
  assert.match(prompt, /validUntil 设为不晚于【当前时间】的时刻/);
  assert.match(prompt, /立即过期/);
  assert.match(prompt, /这类记忆之后不得再被主动提起/);

  // (d) every state ships a concrete example.
  const examples = prompt.match(/例：/g) ?? [];
  assert.ok(examples.length >= 3);
});

test('T-14 the organizer takes the time zone from the injected current time, not a hard-coded default', () => {
  const prompt = buildOrganizerPrompt(KEPT_PHRASE_TURN);

  // (a) the injected current time is still the single time anchor.
  assert.ok(prompt.includes('当前时间：' + KEPT_PHRASE_TURN.nowIso));

  // (b) no hard-coded default time zone survives in the prompt.
  assert.ok(!prompt.includes('默认时区'));
  assert.ok(!prompt.includes('Asia/Shanghai'));

  // (c) the offset carried by nowIso is the authority for date math.
  assert.match(prompt, /以【当前时间】自带的时区偏移为准/);

  // (d) an explicit time zone or location from the user still wins.
  assert.match(prompt, /用户在对话里明确给出其它时区或地点时，才改用用户给出的时区/);
});

test('T-19 a chat-only plan carries no relationship snapshot', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户今天加班到很晚',
        layer: 'L3',
        bucket: 'key_detail',
        memoryType: 'event',
        reason: '短期事件',
      },
    ],
  });

  assert.equal(plan.relationshipSnapshot, undefined);
  assert.ok(plan.relationshipSnapshot !== null);
});

test('T-19 a real relationship change is mapped into the plan', () => {
  const plan = parseMemoryPlan({
    operations: [],
    relationshipSnapshot: {
      relationshipStage: 'dating',
      emotionalTone: 'tender',
      dynamicSummary: '两人从试探转为稳定的线下约会关系',
      keyMilestones: ['第一次线下见面'],
    },
  });

  assert.deepEqual(plan.relationshipSnapshot, {
    relationshipStage: 'dating',
    emotionalTone: 'tender',
    dynamicSummary: '两人从试探转为稳定的线下约会关系',
    keyMilestones: ['第一次线下见面'],
  });
});

test('T-19 rejects an over-long relationship stage beyond the varchar(32) column', () => {
  assert.throws(
    () =>
      parseMemoryPlan({
        operations: [],
        relationshipSnapshot: { relationshipStage: 'x'.repeat(33) },
      }),
    /too_big|maximum|less than or equal/i,
  );
});

test('T-19 the prompt only allows a snapshot for a real relationship change', () => {
  const prompt = buildOrganizerPrompt(KEPT_PHRASE_TURN);

  assert.ok(prompt.includes('只有在真实关系变化时才允许输出 relationshipSnapshot'));
  assert.ok(prompt.includes('普通闲聊、日常问候、无关系含义的琐事必须完全不输出 relationshipSnapshot'));
  assert.match(prompt, /keyMilestones 只写新增/);
  assert.match(prompt, /无法判断时不要输出 relationshipSnapshot/);
  assert.ok(prompt.includes('"relationshipSnapshot"'));
});

const COMMUNICATION_FEEDBACK_TURN = {
  ...KEPT_PHRASE_TURN,
  userText: '以后别每次都逗我，先听我说完',
  assistantText: '好，我记住了。',
};

test('T-18 a directly expressed preference for how to be treated is surfaced as feedback', () => {
  const plan = parseMemoryPlan({
    operations: [],
    communicationPrefsFeedback: ['别每次都逗我', '有事直接说'],
  });

  assert.deepEqual(plan.communicationPrefsFeedback, ['别每次都逗我', '有事直接说']);
});

test('T-18 a chat-only plan carries no communication feedback', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户今天加班到很晚',
        layer: 'L3',
        bucket: 'key_detail',
        memoryType: 'event',
        reason: '短期事件',
      },
    ],
  });

  assert.equal(plan.communicationPrefsFeedback, undefined);
});

test('T-18 rejects per-item and total feedback beyond the persisted bounds', () => {
  assert.throws(
    () => parseMemoryPlan({ operations: [], communicationPrefsFeedback: ['x'.repeat(161)] }),
    /too_big|maximum|less than or equal/i,
  );
  assert.throws(
    () =>
      parseMemoryPlan({
        operations: [],
        communicationPrefsFeedback: Array.from({ length: 9 }, (unused, index) => 'feedback-' + index),
      }),
    /too_big|maximum|less than or equal/i,
  );
});

test('T-18 blank-only feedback is treated as no feedback instead of failing the plan', () => {
  const plan = parseMemoryPlan({
    operations: [
      {
        action: 'ADD',
        text: '用户今天加班到很晚',
        layer: 'L3',
        bucket: 'key_detail',
        memoryType: 'event',
        reason: '短期事件',
      },
    ],
    communicationPrefsFeedback: ['', '   '],
  });

  assert.equal(plan.communicationPrefsFeedback, undefined);
  // 一份带格式噪声的计划不能因此丢掉真正有价值的记忆操作。
  assert.equal(plan.operations.length, 1);
});

test('T-18 the prompt only allows feedback the user expressed about how to be treated', () => {
  const prompt = buildOrganizerPrompt(COMMUNICATION_FEEDBACK_TURN);

  assert.ok(prompt.includes('"communicationPrefsFeedback"'));
  assert.match(prompt, /只有用户自己说出口的才算/);
  assert.match(prompt, /单纯的情绪宣泄必须完全不输出 communicationPrefsFeedback/);
  assert.match(prompt, /这是「用户希望被怎样对待」，不是对用户性格的推断/);
});

// 2026-09-27 事故后的补充口径：来源必须按说话人判定，而且能被逐字核对。
// 事故里模型把「角色：」那一行的台词（表态、检讨、承诺）当成了用户提出的要求。
test('T-18 反馈来源只看「用户：」那一行，角色的表态一律不得作为来源', () => {
  const prompt = buildOrganizerPrompt(COMMUNICATION_FEEDBACK_TURN);

  assert.match(prompt, /以「角色：」开头的内容/);
  assert.match(prompt, /一律不得作为来源/);
  assert.match(prompt, /用户只是在追问、询问或复述角色说过的话/);
  assert.match(prompt, /能在用户那一行里逐字找到/);
});
