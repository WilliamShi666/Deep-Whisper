import assert from 'node:assert/strict';
import test from 'node:test';

import { clearLocalVisitorId, fetchEntryVisitor } from '../src/lib/api';

/**
 * 入口冷启动**只打一次** /api/visitor 的回归（审查 M2 / F-4）。
 *
 * 上一轮的提交信息承诺「冷启动只打一次访客接口」，但实现仍是
 * `await ensureVisitorIdentity()`（本地无 id 时内部会裸发一次 /api/visitor 去读老 Cookie）
 * 之后再 `apiFetch('/api/visitor')` —— 恰恰在冷启动这一档打两次。
 *
 * 这里用替换过的 fetch/localStorage 数请求次数，直接钉住行为，而不是读源码猜。
 */

const STORAGE_KEY = 'vl_visitor_id';

interface Call {
  url: string;
  visitorHeader: string | null;
}

function installFetch(responder: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    const call: Call = { url, visitorHeader: headers.get('X-Visitor-Id') };
    calls.push(call);
    return {
      ok: true,
      status: 200,
      json: async () => responder(call),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  (globalThis as unknown as { fetch: typeof fetch }).fetch = fake;
  return calls;
}

function installLocalStorage(initial?: Record<string, string>): Map<string, string> {
  const memory = new Map<string, string>(Object.entries(initial ?? {}));
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  };
  (globalThis as unknown as { window: { localStorage: unknown } }).window = Object.assign(new EventTarget(), { localStorage: storage });
  return memory;
}

/**
 * 准备一个干净的起点。
 *
 * 顺序很重要：clearLocalVisitorId() 会读写 window.localStorage，所以必须先装好
 * window 替身；而它同时会清掉 localStorage，因此期望存在的 id 要在它之后写入。
 */
function prepare(initial?: Record<string, string>): Map<string, string> {
  const memory = installLocalStorage();
  clearLocalVisitorId();
  for (const [key, value] of Object.entries(initial ?? {})) memory.set(key, value);
  return memory;
}

test('a cold start (no local id) hits /api/visitor exactly once and without the id header', async () => {
  const memory = prepare();
  const calls = installFetch(() => ({
    visitor: { id: 'cookie-identity' },
    companion: { id: 'c1' },
    visitor_id: 'cookie-identity',
  }));

  const data = await fetchEntryVisitor();

  assert.equal(calls.length, 1, `冷启动必须只打一次 /api/visitor，实际 ${calls.length} 次`);
  assert.equal(calls[0]!.url, '/api/visitor');
  // 不带 X-Visitor-Id 才能让服务端先从 Cookie 认出老身份（服务端 header 优先于 Cookie）
  assert.equal(calls[0]!.visitorHeader, null, '冷启动的探测请求不得携带访客 id 头');
  assert.equal(data.visitor_id, 'cookie-identity');
  assert.equal(memory.get(STORAGE_KEY), 'cookie-identity', '服务端解析出的 id 必须写回本地');
});

test('a warm start (local id present) hits /api/visitor exactly once and ignores the untrusted stored id', async () => {
  // 刻意只放 localStorage，不放模块缓存：模拟浏览器刷新后的真实形态
  const memory = prepare({ [STORAGE_KEY]: 'stored-id' });
  const calls = installFetch(() => ({ visitor: { id: 'stored-id' }, companion: null, visitor_id: 'stored-id' }));

  await fetchEntryVisitor();

  assert.equal(calls.length, 1, `已有本地 id 时也必须只打一次，实际 ${calls.length} 次`);
  assert.equal(calls[0]!.visitorHeader, null);
  assert.equal(memory.get(STORAGE_KEY), 'stored-id');
});

test('a cold start adopts the id the server minted when no cookie identity exists', async () => {
  const memory = prepare();
  installFetch(() => ({ visitor: null, companion: null, visitor_id: 'server-minted', is_new: true }));

  await fetchEntryVisitor();

  assert.equal(memory.get(STORAGE_KEY), 'server-minted', '不能再用一个本地随机 id 覆盖服务端身份');
});

test('a failed response is surfaced instead of silently routing on empty data', async () => {
  prepare();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: '服务器开了小差' }),
  })) as unknown as typeof fetch;

  await assert.rejects(() => fetchEntryVisitor(), /HTTP 500/);
});
