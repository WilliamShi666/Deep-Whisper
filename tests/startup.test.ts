import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_BOOT_TIMEOUT_MS,
  COMPANION_HINT_STORAGE_KEY,
  CONVERSATION_LOAD_TIMEOUT_MS,
  ENTRY_TIMEOUT_MS,
  buildRetrySchedule,
  readCompanionHint,
  resolveActiveConversationId,
  resolveEntryFallback,
  resolveEntryTarget,
  writeCompanionHint,
  type HintStore,
} from '../src/lib/startup';

/**
 * 弱网启动链路的纯逻辑。
 *
 * 背景：入口页原先串行等待「Supabase 配置 → 登录态 → 访客身份 → 再查一次访客」，
 * 全程只渲染一个爱心 loading，且没有任何超时兜底；网络稍差就无限停在爱心上。
 * chat 页同样，booted 要等一整条串行链（含创建会话）走完才置 true，中途失败就永远转圈。
 *
 * 这里把三件可以离线判定的事抽成纯函数：
 *   1. 退避节奏（原先是固定 1s × 5 次，最坏空等 5 秒）
 *   2. 入口分流目标（只发一次 /api/visitor 就能决定去哪）
 *   3. 超时上限（超过就必须给出可操作结果，而不是继续转圈）
 */

test('retry backoff is exponential and bounded by a total budget', () => {
  // attempts = 总尝试次数（与原 maxRetries 语义一致），因此等待次数 = attempts - 1。
  const schedule = buildRetrySchedule({ attempts: 4, baseMs: 250, maxTotalMs: 2000 });

  assert.deepEqual(schedule, [250, 500, 1000], '指数退避，而不是固定间隔');
  assert.equal(schedule.length, 3, '4 次尝试之间只等待 3 次');
  assert.ok(
    schedule.reduce((a, b) => a + b, 0) <= 2000,
    '总等待必须落在预算内，否则弱网下就是换个姿势空等',
  );
});

test('retry backoff never exceeds the total budget even with many attempts', () => {
  const schedule = buildRetrySchedule({ attempts: 10, baseMs: 250, maxTotalMs: 2000 });
  const total = schedule.reduce((a, b) => a + b, 0);

  assert.ok(total <= 2000, `总等待 ${total}ms 超出 2000ms 预算`);
  assert.ok(schedule.length >= 1, '至少要尝试一次');
  assert.ok(schedule.length <= 10);
});

test('a single attempt schedules no waiting at all', () => {
  assert.deepEqual(buildRetrySchedule({ attempts: 1, baseMs: 250, maxTotalMs: 2000 }), []);
});

test('the entry target is decided from a single visitor response', () => {
  // 有访客且有伴侣 → 进聊天
  assert.equal(resolveEntryTarget({ visitor: { id: 'v1' }, companion: { id: 'c1' } }), '/chat');
  // 匿名访客没有伴侣 → 先看落地页
  assert.equal(resolveEntryTarget({ visitor: { id: 'v1' }, companion: null }), '/love');
  // 没有访客 → 先看落地页
  assert.equal(resolveEntryTarget({ visitor: null, companion: null }), '/love');
  // 已登录但没有伴侣（刚注册、刚 OAuth 回来）→ 直接去捏人，不再看营销页
  assert.equal(
    resolveEntryTarget({ visitor: { id: 'v1' }, companion: null, auth: { authed: true } }),
    '/onboarding',
  );
  // 已登录且有伴侣，依然是聊天页
  assert.equal(
    resolveEntryTarget({ visitor: { id: 'v1' }, companion: { id: 'c1' }, auth: { authed: true } }),
    '/chat',
  );
  // 响应缺字段（老后端/异常）→ 保守去落地页，而不是留在原地
  assert.equal(resolveEntryTarget({}), '/love');
});

test('the entry timeout is short enough to feel responsive', () => {
  assert.ok(ENTRY_TIMEOUT_MS > 0, '必须有超时，否则就是无限转圈');
  // 计划验收口径：「弱网下最多 2s 内进入目标页」，所以兜底必须不晚于 2s 触发。
  assert.ok(
    ENTRY_TIMEOUT_MS <= 2000,
    `入口超时 ${ENTRY_TIMEOUT_MS}ms 超过了「最多 2s 内进入目标页」的验收口径`,
  );
});

// ── F-5：超时兜底必须按已知状态分流，而不是无条件跳捏人流程 ──

test('the timeout fallback sends a known returning user back to chat, not to onboarding', () => {
  // 回归点：上一轮无条件跳 /onboarding，弱网下的老用户每次都被丢进创建新角色的流程。
  assert.equal(resolveEntryFallback(true), '/chat', '有伴侣时回聊天页');
  assert.equal(resolveEntryFallback(false), '/love', '没有伴侣的新访客先看落地页');
  assert.equal(resolveEntryFallback(false, true), '/onboarding', '已登录但没有伴侣才去捏人');
  assert.equal(resolveEntryFallback(true, true), '/chat', '有伴侣标记时登录态不改变去向');
});

test('the companion hint round-trips and is cleared when no companion is known', () => {
  const memory = new Map<string, string>();
  const store: HintStore = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  };

  assert.equal(readCompanionHint(store), false, '默认视为没有伴侣（安全方向）');

  writeCompanionHint(store, true);
  assert.equal(readCompanionHint(store), true);
  assert.equal(memory.get(COMPANION_HINT_STORAGE_KEY), '1');

  writeCompanionHint(store, false);
  assert.equal(readCompanionHint(store), false, '解析出没有伴侣时必须清掉旧提示');
  assert.equal(memory.has(COMPANION_HINT_STORAGE_KEY), false);

  // 存了别的值（老版本/被手改）不能当成「有伴侣」
  memory.set(COMPANION_HINT_STORAGE_KEY, 'true');
  assert.equal(readCompanionHint(store), false, '只认精确的 "1"');
});

// ── M1：迟到的会话列表响应不得覆盖用户已点选的会话 ──

test('a late conversation list must not steal the selection the user already made', () => {
  // 回归点：原先无条件 activeIdRef.current = list[0].id，
  // 弱网下用户先点了 B，迟到的列表响应会把选择弹回 A。
  assert.equal(
    resolveActiveConversationId('B', ['A', 'B', 'C']),
    'B',
    '用户已点选的会话只要还在列表里就必须保持',
  );
  assert.equal(resolveActiveConversationId(null, ['A', 'B']), 'A', '还没选过才自动选第一项');
  assert.equal(resolveActiveConversationId('A', ['A']), 'A');
});

test('the active conversation falls back to the first item only when the old one is gone', () => {
  assert.equal(
    resolveActiveConversationId('B', ['A', 'C']),
    'A',
    '选中的会话已被删除时回落到第一项',
  );
  assert.equal(resolveActiveConversationId('B', []), null, '空列表不选中任何会话');
});

// ── F-6：聊天启动链必须有尽头 ──

test('the chat boot chain and conversation load both have a finite timeout', () => {
  for (const [name, value] of [
    ['CHAT_BOOT_TIMEOUT_MS', CHAT_BOOT_TIMEOUT_MS],
    ['CONVERSATION_LOAD_TIMEOUT_MS', CONVERSATION_LOAD_TIMEOUT_MS],
  ] as const) {
    assert.ok(Number.isFinite(value) && value > 0, `${name} 必须是正数，否则就是无限骨架屏`);
    // 比入口宽松（用户已进入应用），但必须有尽头
    assert.ok(value >= ENTRY_TIMEOUT_MS, `${name} 不该比入口超时还短`);
    assert.ok(value <= 15000, `${name} 太久，用户等不到失败提示`);
  }
});

/* ---------- 登录页直达注册 / next 白名单 / 落地页认老用户（2026-10-01） ---------- */

import { GUEST_REGISTER_HREF, initialLoginMode, resolveLandingEntry, safeNextPath } from '../src/lib/startup';

test('safeNextPath only lets same-site relative paths through (no open redirects)', () => {
  assert.equal(safeNextPath('/chat'), '/chat');
  assert.equal(safeNextPath('/onboarding?repick=1'), '/onboarding?repick=1');
  for (const bad of ['//evil.com', 'https://evil.com', 'http://evil.com/x', '/\\evil.com', 'javascript:alert(1)', '/javascript:alert(1)', 'chat', '', '   ', null, undefined, '/a\u0000b', `/${'a'.repeat(300)}`]) {
    assert.equal(safeNextPath(bad as string | null | undefined), null, `应拒绝：${String(bad).slice(0, 30)}`);
  }
});

test('the login page opens in register mode only for an explicit ?mode=register', () => {
  assert.equal(initialLoginMode('register'), 'register');
  for (const other of ['login', 'Register', '', null, undefined, 'signup']) {
    assert.equal(initialLoginMode(other as string | null | undefined), 'login');
  }
  assert.equal(GUEST_REGISTER_HREF, '/login?mode=register&next=/chat');
  assert.equal(safeNextPath(new URLSearchParams(GUEST_REGISTER_HREF.split('?')[1]).get('next')), '/chat');
});

test('the landing page recognizes returning users without forcing a redirect', () => {
  assert.deepEqual(resolveLandingEntry({ authed: false, hasCompanion: false }), { href: '/onboarding?from=love', label: '开始心动' });
  assert.deepEqual(resolveLandingEntry({ authed: true, hasCompanion: false }), { href: '/onboarding', label: '开始心动' });
  assert.deepEqual(resolveLandingEntry({ authed: false, hasCompanion: true }), { href: '/chat', label: '回到 TA 身边' });
  assert.deepEqual(resolveLandingEntry({ authed: true, hasCompanion: true }), { href: '/chat', label: '回到 TA 身边' });
});
