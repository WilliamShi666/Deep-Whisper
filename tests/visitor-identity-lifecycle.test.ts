import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLocalVisitorId, ensureVisitorIdentity, syncLocalVisitorId } from '../src/lib/api';

test('an identity probe started before logout cannot repopulate cleared storage', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: EventTarget.prototype.dispatchEvent.bind(new EventTarget()), localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } });
  try {
    clearLocalVisitorId();
    globalThis.fetch = async () => {
      await gate;
      return Response.json({ visitor: { id: 'owner-id' }, visitor_id: 'owner-id' });
    };
    const pending = ensureVisitorIdentity();
    const settled = pending.then(() => 'resolved', () => 'rejected');
    clearLocalVisitorId();
    release();
    assert.equal(await settled, 'rejected');
    assert.equal(values.get('vl_visitor_id'), undefined);

    globalThis.fetch = async () => Response.json({ visitor: { id: 'fresh-identity' }, visitor_id: 'fresh-identity' });
    assert.equal(await ensureVisitorIdentity(), 'fresh-identity');
    assert.equal(values.get('vl_visitor_id'), 'fresh-identity');
  } finally {
    release();
    clearLocalVisitorId();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('a late probe cannot overwrite a newer confirmed owner mirror', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: EventTarget.prototype.dispatchEvent.bind(new EventTarget()), localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } });
  try {
    clearLocalVisitorId();
    globalThis.fetch = async () => {
      await gate;
      return Response.json({ visitor: { id: 'stale-cookie-identity' }, visitor_id: 'stale-cookie-identity' });
    };
    const pending = ensureVisitorIdentity();
    const settled = pending.then(() => 'resolved', () => 'rejected');
    syncLocalVisitorId('restored-account-identity');
    release();
    assert.equal(await settled, 'rejected');
    assert.equal(values.get('vl_visitor_id'), 'restored-account-identity');
    assert.equal(await ensureVisitorIdentity(), 'restored-account-identity');
  } finally {
    release();
    clearLocalVisitorId();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

// ── E2E-1：探测永远不 settle 时，「重试」必须能真正重新探测 ──
//
// 线上取证：/api/visitor 永不返回时，聊天页每次点「重试」都复用同一具
// 挂了死的 initPromise，一个请求都发不出去（route 命中数 1→1），用户只能刷新整页。

/** 只依赖 window.localStorage 的最小替身 */
function stubWindow(values: Map<string, string>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: EventTarget.prototype.dispatchEvent.bind(new EventTarget()), localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}

test('a probe that never settles is abandoned and a later call probes again', async () => {
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const restoreWindow = stubWindow(values);
  let calls = 0;
  try {
    clearLocalVisitorId();
    // 忠实模拟真实 fetch：挂起的请求只有在 signal 中止时才 settle
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as unknown as typeof fetch;

    const first = ensureVisitorIdentity({ timeoutMs: 30 });
    await assert.rejects(() => first, '探测超时必须抛错，而不是永久挂起');
    assert.equal(calls, 1);
    assert.equal(values.get('vl_visitor_id'), undefined, '失败时绝不伪造并持久化身份');

    // 关键：initPromise 已被清出缓存，所以这一次会**真的重新发请求**
    const second = ensureVisitorIdentity({ timeoutMs: 30 });
    await assert.rejects(() => second);
    assert.equal(calls, 2, '重试必须重新探测（这正是线上失效的那一步）');
  } finally {
    clearLocalVisitorId();
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test('a non-2xx probe is a failure, not a licence to mint a new identity', async () => {
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const restoreWindow = stubWindow(values);
  try {
    clearLocalVisitorId();
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: '服务器开了小差' }), { status: 500 })) as unknown as typeof fetch;

    await assert.rejects(() => ensureVisitorIdentity({ timeoutMs: 100 }), /HTTP 500/);
    assert.equal(
      values.get('vl_visitor_id'),
      undefined,
      '5xx 时必须抛错：凭空造 id 会被后续请求当头部发出，顶掉用户真正的 Cookie 身份',
    );
  } finally {
    clearLocalVisitorId();
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test('a malformed 2xx response never mints a client identity', async () => {
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const restoreWindow = stubWindow(values);
  try {
    clearLocalVisitorId();
    globalThis.fetch = async () => Response.json({ visitor: null });
    await assert.rejects(() => ensureVisitorIdentity({ timeoutMs: 100 }));
    assert.equal(values.get('vl_visitor_id'), undefined);
  } finally {
    clearLocalVisitorId();
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test('an entry probe completing after logout cannot restore its owner mirror', async () => {
  const { fetchEntryVisitor } = await import('../src/lib/api');
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const restoreWindow = stubWindow(values);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    clearLocalVisitorId();
    globalThis.fetch = async () => {
      await gate;
      return Response.json({visitor: {id: 'owner-id'}, visitor_id: 'owner-id'});
    };
    const pending = fetchEntryVisitor();
    const settled = pending.then(() => 'resolved', () => 'rejected');
    clearLocalVisitorId();
    release();
    assert.equal(await settled, 'rejected');
    assert.equal(values.get('vl_visitor_id'), undefined);
  } finally {
    release();
    clearLocalVisitorId();
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test('the probe timeout is shorter than the chat boot budget so retry can re-probe', async () => {
  const { VISITOR_PROBE_TIMEOUT_MS } = await import('../src/lib/api');
  const { CHAT_BOOT_TIMEOUT_MS } = await import('../src/lib/startup');
  // 聊天页 8s 超时后才给出重试入口；用户点重试时探测必须已经 settle 并被清出缓存，
  // 否则重试又会复用那具死 promise（E2E-1 的根因）。
  assert.ok(
    VISITOR_PROBE_TIMEOUT_MS < CHAT_BOOT_TIMEOUT_MS,
    `探测超时 ${VISITOR_PROBE_TIMEOUT_MS}ms 必须小于启动预算 ${CHAT_BOOT_TIMEOUT_MS}ms`,
  );
});
