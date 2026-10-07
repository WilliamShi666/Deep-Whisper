import assert from 'node:assert/strict';
import test from 'node:test';

import { CHARACTER_PRESETS } from '../src/lib/characters';
import { AVOID_TOPIC_TYPE, MEMORY_TYPE_VALUES } from '../src/lib/memory/service';
import { buildOrganizerPrompt } from '../src/lib/memory/organizer';
import { buildOpeningPrompt, buildSystemPrompt } from '../src/lib/prompts';

/*
 * 「别提了 / 忘掉它」的产品口径（2026-10-01）：
 * 人不会说忘就忘 —— 不删除原记忆，另记一条 avoid_topic 边界；边界每轮都注入，
 * 压过「近 72 小时跨会话片段」与开场白「必须承接一条具体信息」的要求。
 */

const companion = { name: '砚深', persona: null, occupation: null, user_title: '小满', appearance_style: 'normal' as const };
const visitor = { gender: 'female' as const };
const preset = CHARACTER_PRESETS.find((entry) => entry.key === 'deepseek_m_01')!;

test('avoid_topic is a first-class memory type', () => {
  assert.equal(AVOID_TOPIC_TYPE, 'avoid_topic');
  assert.ok((MEMORY_TYPE_VALUES as readonly string[]).includes(AVOID_TOPIC_TYPE));
});

test('the organizer records a boundary instead of deleting what the user said', () => {
  const prompt = buildOrganizerPrompt({
    nowIso: '2026-10-01T20:00:00+08:00',
    visitorId: 'v',
    companionId: 'c',
    userText: '去青岛这件事，你忘掉它吧',
    assistantText: '好，青岛我不提了。',
    existingMemories: [],
  });
  assert.match(prompt, /忘掉它 \/ 别提了/);
  assert.match(prompt, /ADD 一条 memoryType=avoid_topic/);
  assert.match(prompt, /不得 DELETE 青岛那条记忆/);
  // 唯一保留的对话内删除：撤销边界本身
  assert.match(prompt, /DELETE 对应的 avoid_topic 那一条（只能删 avoid_topic，不能删别的记忆）/);
});

test('boundaries are injected every turn and outrank recent episodes', () => {
  const prompt = buildSystemPrompt(preset, companion, visitor, {
    profile: null,
    snapshot: null,
    recentEpisodes: [{ role: 'user', content: '下个月 18 号要去青岛', createdAt: '2026-10-01T19:00:00+08:00' }],
    avoidTopics: ['用户不希望再被提起：去青岛旅行的计划'],
  });
  const boundary = prompt.indexOf('【TA 不希望你再提起的事（必须遵守）】');
  assert.ok(boundary > 0, '边界段落必须出现');
  assert.ok(prompt.includes('用户不希望再被提起：去青岛旅行的计划'));
  assert.match(prompt.slice(boundary), /即使「最近聊天的连续情节」或长期记忆里出现，开场时也不要承接它们/);
  assert.match(prompt.slice(boundary), /TA 自己主动说起，就自然地接住/);
});

test('no boundaries means no extra section (zero-cost when unused)', () => {
  const prompt = buildSystemPrompt(preset, companion, visitor, { profile: null, snapshot: null, avoidTopics: [] });
  assert.ok(!prompt.includes('TA 不希望你再提起的事'));
});

test('the opening directive exempts boundaries from "must follow up one concrete thing"', () => {
  const opening = buildOpeningPrompt('砚深', { hasPriorConversation: true, hasRecalledMemory: false, hasRecentContext: true });
  assert.match(opening, /必须自然承接至少一条具体信息（「TA 不希望你再提起的事」除外）/);
});
