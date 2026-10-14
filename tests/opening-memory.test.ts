import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOpeningPrompt } from '../src/lib/prompts';

test('first-ever opening keeps the initial-meeting guidance', () => {
  const prompt = buildOpeningPrompt('晚星', {
    hasPriorConversation: false,
    hasRecalledMemory: false,
  });

  assert.match(prompt, /第一句话/);
  assert.match(prompt, /几乎一无所知/);
});

test('returning-companion opening continues the relationship and forbids re-introduction', () => {
  const prompt = buildOpeningPrompt('晚星', {
    hasPriorConversation: true,
    hasRecalledMemory: true,
  });

  assert.match(prompt, /不是第一次见面/);
  assert.match(prompt, /长期记忆或最近聊天情节/);
  assert.match(prompt, /必须自然承接至少一条具体信息/);
  assert.match(prompt, /优先.*跟进|主动关心/);
  assert.match(prompt, /不能无视这些内容自说自话/);
  assert.match(prompt, /禁止重新自我介绍/);
  assert.match(prompt, /刚看到.*名字/);
  assert.doesNotMatch(prompt, /这是你对 TA 说的第一句话/);
});

test('recent cross-conversation context forces a concrete continuation even without Mem0 recall', () => {
  const prompt = buildOpeningPrompt('晚星', {
    hasPriorConversation: true,
    hasRecalledMemory: false,
    hasRecentContext: true,
  });

  assert.match(prompt, /最近聊天情节/);
  assert.match(prompt, /待确认结果、未完成事项或身体不适/);
  assert.match(prompt, /不能无视这些内容自说自话/);
});
