import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecalledMemory } from '../src/lib/memory/service';
import {
  buildLetterTriggerKey,
  decideLetterEligibility,
  selectLetterAnchor,
} from '../src/lib/letters/policy';

/**
 * 简化后的发送规则（2026-09-20 创始人确认）：
 *
 *   1. 互动后从**第一次看到这次互动的 Cron** 起算，连发 3 天（窗口 [D, D+2]）。
 *   2. 窗口结束后停发；第 3 天那封带一句「我先等你」的说明。
 *   3. 重要日期（L0）不受窗口限制，但**不豁免**每天最多一封。
 *   4. 每封信都必须有真实记忆锚点。
 *   5. 锚点优先取**最新对话**，没有合格的新记忆时退回质量最高的一条。
 *
 * 刻意删掉的旧规则：L2/L3 沉默门槛、7 天冷却、每月 2 封上限、L4 永久收尾、休眠。
 */

const DAY = 86_400_000;

function memory(overrides: Partial<RecalledMemory> & { id: string }): RecalledMemory {
  return {
    text: `memory ${overrides.id}`,
    layer: 'L3',
    bucket: 'key_detail',
    domain: 'event',
    memoryType: 'event',
    importance: 0.9,
    confidence: 'explicit',
    evidenceMemoryIds: [],
    score: 0.9,
    observedAt: null,
    occurredAt: null,
    timePrecision: null,
    validUntil: null,
    temporalStatus: 'timeless',
    sourceConversationIds: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function baseNow(): Date {
  return new Date('2026-09-20T12:00:00.000Z');
}
/** 窗口起点（第一次看到这次互动的 Cron）。 */
function windowStart(daysAgo: number, now = baseNow()): string {
  return new Date(now.getTime() - daysAgo * DAY).toISOString();
}
const anchor = { id: 'a', text: '用户说下周要找前老板谈 AI 整合', kind: 'L2' } as const;

test('letters go out on the window start day and the two days after it', () => {
  const now = baseNow();
  for (const daysAgo of [0, 1, 2]) {
    const decision = decideLetterEligibility({
      preferenceStatus: 'enabled',
      anchor,
      windowStartedAt: windowStart(daysAgo, now),
      now,
    });
    assert.equal(decision.kind, 'L2', `day ${daysAgo} of the window must send`);
    assert.equal(decision.skipReason, undefined);
  }
});

test('only the third day is the window end, and only it asks for the gentle note', () => {
  const now = baseNow();
  const third = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor, windowStartedAt: windowStart(2, now), now,
  });
  assert.equal(third.isWindowEnd, true, 'day 3 carries the 「我先等你」 note');

  for (const daysAgo of [0, 1]) {
    const earlier = decideLetterEligibility({
      preferenceStatus: 'enabled', anchor, windowStartedAt: windowStart(daysAgo, now), now,
    });
    assert.equal(earlier.isWindowEnd, false, `day ${daysAgo + 1} must not carry the note`);
  }
});

test('the window closes on the fourth day and stays closed', () => {
  const now = baseNow();
  for (const daysAgo of [3, 4, 10, 60]) {
    const decision = decideLetterEligibility({
      preferenceStatus: 'enabled', anchor, windowStartedAt: windowStart(daysAgo, now), now,
    });
    assert.equal(decision.skipReason, 'window_closed', `${daysAgo} days must stop sending`);
  }
});

test('a new interaction restarts the window', () => {
  const now = baseNow();
  // 沉默 60 天本来停发；但用户在窗口起点后（即新互动）又聊了 → 窗口重新开始。
  const restarted = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor, windowStartedAt: windowStart(1, now), now,
  });
  assert.equal(restarted.kind, 'L2', 'a fresh interaction restarts the 3-day window');
});

test('a visitor with no interaction at all has no window', () => {
  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor, windowStartedAt: null, now: baseNow(),
  });
  assert.equal(decision.skipReason, 'no_interaction');
});

test('an important date is sent even when the window is closed', () => {
  const now = baseNow();
  const important = { id: 'bday', text: '用户生日', kind: 'L0' } as const;
  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor: important, windowStartedAt: windowStart(60, now), now,
  });
  assert.equal(decision.kind, 'L0', 'an important date is not blocked by a closed window');
  // 生日信保持干净：不带「我先等你」的说明。
  assert.equal(decision.isWindowEnd, false);
});

test('an important date on the window-end day still stays clean', () => {
  const now = baseNow();
  const important = { id: 'bday', text: '用户生日', kind: 'L0' } as const;
  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor: important, windowStartedAt: windowStart(2, now), now,
  });
  assert.equal(decision.kind, 'L0');
  assert.equal(decision.isWindowEnd, false, 'the important-date letter never carries the note');
});

test('one letter per visitor per day still holds, and it also binds the important date', () => {
  const now = baseNow();
  const base = { preferenceStatus: 'enabled', anchor, windowStartedAt: windowStart(0, now), now };
  assert.equal(decideLetterEligibility({ ...base, hasLetterToday: true }).skipReason, 'daily_limit');

  const important = { id: 'bday', text: '用户生日', kind: 'L0' } as const;
  assert.equal(
    decideLetterEligibility({ ...base, anchor: important, hasLetterToday: true }).skipReason,
    'daily_limit',
    'the important-date letter does not bypass the one-per-day cap',
  );
});

test('every letter still needs a real memory anchor', () => {
  const now = baseNow();
  for (const daysAgo of [0, 1, 2]) {
    const decision = decideLetterEligibility({
      preferenceStatus: 'enabled', anchor: null, windowStartedAt: windowStart(daysAgo, now), now,
    });
    assert.equal(decision.skipReason, 'missing_anchor', `day ${daysAgo} must not send a generic letter`);
  }
});

test('a paused or suppressed preference always wins over the window', () => {
  const now = baseNow();
  for (const preferenceStatus of ['paused', 'unsubscribed', 'suppressed']) {
    const decision = decideLetterEligibility({
      preferenceStatus, anchor, windowStartedAt: windowStart(1, now), now,
    });
    assert.equal(decision.skipReason, 'preference_disabled', `${preferenceStatus} must block sending`);
  }
});

test('the same anchor can be used on three different days without colliding', () => {
  const now = baseNow();
  const keys = [0, 1, 2].map((daysAgo) =>
    buildLetterTriggerKey('L2', anchor.id, windowStart(daysAgo, now).slice(0, 10)),
  );
  assert.equal(
    new Set(keys).size, 3,
    'each day needs its own trigger key, or days 2-3 are dropped as duplicates of day 1',
  );

  // 同一天同一锚点仍然幂等：重复触发不会写第二行。
  assert.equal(
    buildLetterTriggerKey('L2', anchor.id, '2026-09-20'),
    buildLetterTriggerKey('L2', anchor.id, '2026-09-20'),
  );

  for (const key of keys) assert.ok(key.length <= 160, 'trigger_key must fit the column');
});

test('a long anchor id is truncated so the trigger key still fits the column', () => {
  const key = buildLetterTriggerKey('L2', 'x'.repeat(400), '2026-09-20');
  assert.ok(key.length <= 160, `trigger_key must fit 160 chars, got ${key.length}`);
  // 截断后仍要能区分不同日期，否则跨天幂等会失效。
  assert.notEqual(key, buildLetterTriggerKey('L2', 'x'.repeat(400), '2026-09-21'));
});

test('the newest conversation wins the anchor, falling back to the best older one', () => {
  const now = baseNow();
  // 旧的、重要度更高的记忆，与窗口起点之后观察到的新记忆。
  const older = memory({ id: 'older', bucket: 'relationship_event', importance: 0.99, observedAt: '2026-09-01T00:00:00.000Z' });
  const newer = memory({ id: 'newer', bucket: 'key_detail', importance: 0.7, observedAt: '2026-09-20T09:00:00.000Z' });

  // 第 2 天又聊了 → 必须用最新对话，不能还用旧的「下周三面试」。
  assert.equal(
    selectLetterAnchor([older, newer], now, windowStart(1, now))?.id,
    'newer',
    'the newest memory inside the window must win',
  );

  // 最新对话里没有合格记忆 → 退回质量最高的一条，而不是当天不发。
  assert.equal(
    selectLetterAnchor([older], now, windowStart(1, now))?.id,
    'older',
    'with no fresh memory the best older one is used as a fallback',
  );

  // 没有窗口起点（首封）时，退回质量最高的一条。
  assert.equal(selectLetterAnchor([older, newer], now, null)?.id, 'older');
});

test('an expired or resolved memory is never used, and a live one still is', () => {
  const now = baseNow();
  const expired = memory({ id: 'expired', bucket: 'relationship_event', validUntil: '2026-09-19T00:00:00.000Z' });
  assert.equal(selectLetterAnchor([expired], now, null), null);

  const resolved = memory({ id: 'resolved', bucket: 'relationship_event', temporalStatus: 'resolved' });
  assert.equal(selectLetterAnchor([resolved], now, null), null);

  // 过期/已结束的记忆即使「更新」，也不能赢过可用的旧记忆。
  const live = memory({ id: 'live', bucket: 'relationship_event', importance: 0.8 });
  assert.equal(selectLetterAnchor([expired, resolved, live], now, windowStart(1, now))?.id, 'live');

  // 混合输入下，只有 stale 候选时落到 missing_anchor。
  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled',
    anchor: selectLetterAnchor([resolved, expired], now, null),
    windowStartedAt: '2026-09-01T00:00:00.000Z',
    now,
  });
  assert.equal(decision.skipReason, 'missing_anchor');
});

test('a follow-up memory still gets its own kind so the tone can differ', () => {
  const now = baseNow();
  const due = memory({ id: 'due', bucket: 'key_detail', temporalStatus: 'follow_up_due' });
  assert.equal(selectLetterAnchor([due], now, null)?.kind, 'L1');
});

test('an important date on the current day still gets its own kind', () => {
  const now = baseNow();
  const today = memory({ id: 'today', temporalStatus: 'upcoming', occurredAt: now.toISOString() });
  assert.equal(selectLetterAnchor([today], now, null)?.kind, 'L0');
});

// ── M3：L0 豁免分支是活的，实测钉住，防止被当历史遗留删掉 ──
//
// 审查曾判定 `input.anchor.kind === 'L0'`「已不可达」并建议连同注释一起清理。
// 实测否定：L0 锚点在窗口**已关闭**时仍然出信，而同一输入的 L2 锚点被
// window_closed 挡下 —— 这条分支正是唯一让 L0 不受窗口关闭限制的地方。
// L0 锚点由 selectLetterAnchor 里「今天就是那件事的日子」的记忆锚点产生
//（temporalStatus='upcoming' 且 occurredAt 就是今天）。

test('an L0 anchor still sends after the window closed, and L2 does not', () => {
  const now = baseNow();
  const closedWindow = windowStart(5, now);
  const l0 = { id: 'm-l0', text: '今天你要去面试', kind: 'L0' } as const;
  const l2 = { id: 'm-l2', text: '用户说下周要找前老板谈 AI 整合', kind: 'L2' } as const;

  const l0Decision = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor: l0, windowStartedAt: closedWindow, now,
  });
  assert.equal(l0Decision.kind, 'L0', 'L0 锚点必须豁免「窗口已关闭」');
  assert.equal(l0Decision.skipReason, undefined);
  assert.equal(l0Decision.isWindowEnd, false, 'L0 不带「我先等你」那句');

  const l2Decision = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor: l2, windowStartedAt: closedWindow, now,
  });
  assert.equal(l2Decision.skipReason, 'window_closed', '对照组：L2 在同样输入下必须被挡');
});

test('the L0 exemption does not bypass the requirement that a window exists', () => {
  const l0 = { id: 'm-l0', text: '今天你要去面试', kind: 'L0' } as const;
  const decision = decideLetterEligibility({
    preferenceStatus: 'enabled', anchor: l0, windowStartedAt: null, now: baseNow(),
  });
  assert.equal(
    decision.skipReason,
    'no_interaction',
    'L0 只豁免「窗口已关闭」，不豁免「从未互动过」——后者只有 importantDate 通道能绕过',
  );
});
