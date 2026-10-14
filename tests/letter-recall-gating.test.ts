import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { planLetterRecall } from '../src/lib/letters/scheduler-policy';

test('a paused or unsubscribed preference decides the round without touching memory', () => {
  for (const status of ['paused', 'unsubscribed', 'suppressed']) {
    const plan = planLetterRecall({ preferenceStatus: status, hasLetterToday: false, hasImportantDateToday: false });
    assert.equal(plan.needed, false, status);
    assert.equal(plan.needed === false ? plan.skipReason : null, 'preference_disabled', status);
  }
});

test('a visitor who already received a letter today is gated by the daily cap, not by memory', () => {
  const plan = planLetterRecall({ preferenceStatus: 'enabled', hasLetterToday: true, hasImportantDateToday: false });
  assert.equal(plan.needed, false);
  assert.equal(plan.needed === false ? plan.skipReason : null, 'daily_limit');
});

test('an important date today needs no memory at all: the letter is already determined', () => {
  const plan = planLetterRecall({ preferenceStatus: 'enabled', hasLetterToday: false, hasImportantDateToday: true });
  assert.equal(plan.needed, false);
  if (plan.needed || !('letterKind' in plan)) throw new Error('an important date must be the letterKind branch');
  assert.equal(plan.letterKind, 'important-date');
  assert.equal(plan.skipReason, null);
});

test('a no-recall plan is never ambiguous: it either skips, or it is an important-date letter', () => {
  // 三支可辨识联合的意义：`needed: false` 只有两种合法形状，不存在
  // 「skipReason 为 null 又没有 letterKind」这种调用方只能猜的组合。
  // 这条断言钉住的是「重要日期要发信、不是跳过」——调换两者会让生日信静默漏发。
  const importantDate = planLetterRecall({ preferenceStatus: 'enabled', hasLetterToday: false, hasImportantDateToday: true });
  assert.equal(importantDate.needed, false);
  if (importantDate.needed) throw new Error('unreachable');
  if (!('letterKind' in importantDate)) {
    throw new Error('an important date must NOT be reported as a skip: that would drop the birthday letter');
  }
  assert.equal(importantDate.letterKind, 'important-date');
  assert.equal(importantDate.skipReason, null);

  const skipped = planLetterRecall({ preferenceStatus: 'paused', hasLetterToday: false, hasImportantDateToday: false });
  assert.equal(skipped.needed, false);
  if (skipped.needed) throw new Error('unreachable');
  assert.equal('letterKind' in skipped, false, 'a real skip carries no letter kind');
  assert.equal(skipped.skipReason, 'preference_disabled');
});

test('everybody else still needs a memory anchor, so the recall still runs', () => {
  for (const status of [null, 'enabled']) {
    const plan = planLetterRecall({ preferenceStatus: status, hasLetterToday: false, hasImportantDateToday: false });
    assert.equal(plan.needed, true, String(status));
  }
});

test('the personal scheduler uses scoped local anchors without provider recall fan-out',()=>{
 const source=readFileSync(new URL('../src/lib/letters/personal-scheduler.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/supplementalQueries|recallLongTermMemories|createMemoryService|MEM0_API_KEY/);
 assert.match(source,/visitor_id=\? AND companion_id=\? AND status='active'/);
 assert.match(source,/if\(!pref\.in_app_enabled\)continue/);
});
