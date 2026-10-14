import assert from 'node:assert/strict';
import test from 'node:test';

import { getEmbeddingProvider } from '../src/lib/ai/embedding-provider';
import {
  DashScopeEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from '../src/lib/ai/providers/dashscope-embedding-provider';

/**
 * embedding provider 契约测试（第二阶段 2a 的第一步）。
 *
 * 为什么先有它：本地混合检索的向量分支需要我们自己算 embedding —— 这是换掉 Mem0
 * 之后唯一剩下的按次计费依赖。所以它的契约必须与既有 provider 同一口径：
 * 只返回已校验的向量、绝不把上游 URL/临时链接交给调用方、失败必须显式 reject。
 *
 * 这些用例全部离线（注入 fake transport），不打真实 DashScope。
 */

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** 捕获 provider 交给 fetch 的 signal，用来断言「调用方 signal + 有限超时」的合成语义。 */
  signal: AbortSignal | null;
}

function fakeTransport(captured: CapturedRequest[], respond: (req: CapturedRequest) => { status: number; json: unknown }) {
  return (async (url: string | URL, init?: RequestInit) => {
    const request: CapturedRequest = {
      url: url.toString(),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal ?? null,
    };
    captured.push(request);
    const { status, json } = respond(request);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const ENV = { DASHSCOPE_API_KEY: 'test-key' };

test('an embedding provider is selected from the capability registry', () => {
  const provider = getEmbeddingProvider({ ...ENV, AI_EMBEDDING_PROVIDER: 'dashscope' });
  assert.equal(typeof provider.embed, 'function');
});

test('the registry follows the documented selection variable, with a default', () => {
  // 修前这里是硬编码 `new DashScopeEmbeddingProvider(env)`：`AI_EMBEDDING_PROVIDER`
  // **没有任何代码读取**，而一个用例还在给它传值（测试在为一个不存在的开关背书）。
  // 现在选择来自 runtime.ts 的 provider 表。
  assert.equal(typeof getEmbeddingProvider(ENV).embed, 'function', '缺省也要能选出 provider');
  assert.equal(typeof getEmbeddingProvider({ ...ENV, AI_EMBEDDING_PROVIDER: 'dashscope' }).embed, 'function');
});

test('an unknown embedding provider fails closed instead of silently defaulting', () => {
  // 选错供应商不该被静默吞掉：readEnum 对未知取值直接抛错。
  assert.throws(
    () => getEmbeddingProvider({ ...ENV, AI_EMBEDDING_PROVIDER: 'openai' }),
    /AI_EMBEDDING_PROVIDER/,
  );
});

test('the adapter returns one validated vector per input text, in input order', async () => {
  const captured: CapturedRequest[] = [];
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport(captured, () => ({
      status: 200,
      json: { data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1) }, { embedding: Array(EMBEDDING_DIMENSIONS).fill(0.2) }] },
    })),
  );

  const vectors = await provider.embed({ texts: ['第一段', '第二段'] });

  assert.equal(vectors.length, 2);
  assert.equal(vectors[0]!.length, EMBEDDING_DIMENSIONS);
  assert.ok(vectors[0]![0]! < vectors[1]![0]!, '顺序必须与输入一致');
  assert.equal(captured.length, 1, '一次 embed 只发一次请求（批量）');
});

test('the adapter sends the reviewed model and requests the fixed dimension', async () => {
  const captured: CapturedRequest[] = [];
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport(captured, () => ({ status: 200, json: { data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(0) }] } })),
  );

  await provider.embed({ texts: ['x'] });

  // 既钉住常量本身（换模型必须是有意识的一步），也钉住「请求体用的就是这个常量」——
  // 只钉字面量会漏掉「改了常量却忘了改请求」的那种半升级。
  assert.equal(EMBEDDING_MODEL, 'text-embedding-v4', '当前选定的最强通用向量模型（与 v3 同价）');
  assert.equal(captured[0]!.body.model, EMBEDDING_MODEL);
  assert.equal(captured[0]!.body.dimensions, EMBEDDING_DIMENSIONS);
  assert.equal(captured[0]!.body.encoding_format, 'float');
  assert.match(String(captured[0]!.headers.Authorization ?? ''), /^Bearer /);
});

test('the adapter keeps a finite timeout even when the caller passes a signal', async () => {
  // 契约（docs/portability-provider-contracts.md:30）：provider 必须传调用方 AbortSignal，
  // **并**实现有限超时。修前写的是 `request.signal ?? AbortSignal.timeout(...)` ——
  // 一旦调用方传了 signal，超时就被顶掉，等于没有超时。兄弟适配器一律 AbortSignal.any。
  const captured: CapturedRequest[] = [];
  const controller = new AbortController();
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport(captured, () => ({ status: 200, json: { data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(0) }] } })),
  );

  await provider.embed({ texts: ['x'], signal: controller.signal });

  const used = captured[0]!.signal;
  assert.ok(used, '必须给 fetch 一个 signal');
  // ① 不是调用方那个对象本身 ⇒ 确实合成过（超时也在里面）
  assert.notEqual(used, controller.signal, '不能把调用方 signal 直接当唯一 signal（那样超时没了）');
  // ② 调用方中止时它必须跟着中止 ⇒ 调用方 signal 没被丢掉
  controller.abort();
  assert.equal(used!.aborted, true, '调用方中止必须传导下去');
});

test('a response with the wrong vector length is rejected instead of being written to the database', async () => {
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport([], () => ({ status: 200, json: { data: [{ embedding: [0.1, 0.2] }] } })),
  );

  await assert.rejects(provider.embed({ texts: ['x'] }), /vector|dimension|length/i);
});

test('a response with a mismatched vector count is rejected', async () => {
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport([], () => ({ status: 200, json: { data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(0) }] } })),
  );

  await assert.rejects(provider.embed({ texts: ['a', 'b'] }), /count|mismatch|length/i);
});

test('a non-finite vector component is rejected', async () => {
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.1);
  vector[7] = Number.NaN;
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport([], () => ({ status: 200, json: { data: [{ embedding: vector }] } })),
  );

  await assert.rejects(provider.embed({ texts: ['x'] }), /finite|nan|invalid/i);
});

test('a provider error is rejected and never degraded into an empty vector', async () => {
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport([], () => ({ status: 500, json: { error: 'boom' } })),
  );

  await assert.rejects(provider.embed({ texts: ['x'] }));
});

test('a 401 is rejected immediately without retrying', async () => {
  const captured: CapturedRequest[] = [];
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport(captured, () => ({ status: 401, json: { error: 'unauthorized' } })),
  );

  await assert.rejects(provider.embed({ texts: ['x'] }));
  assert.equal(captured.length, 1, '400/401 不得重试');
});

test('a missing api key fails before any network call', async () => {
  const captured: CapturedRequest[] = [];
  const provider = new DashScopeEmbeddingProvider(
    {},
    fakeTransport(captured, () => ({ status: 200, json: { data: [] } })),
  );

  await assert.rejects(provider.embed({ texts: ['x'] }), /DASHSCOPE_API_KEY/);
  assert.equal(captured.length, 0, '缺 key 时绝不能发出付费请求');
});

test('an empty input list short-circuits without a network call', async () => {
  const captured: CapturedRequest[] = [];
  const provider = new DashScopeEmbeddingProvider(
    ENV,
    fakeTransport(captured, () => ({ status: 200, json: { data: [] } })),
  );

  assert.deepEqual(await provider.embed({ texts: [] }), []);
  assert.equal(captured.length, 0);
});

test('E2E mock mode never touches the real provider', () => {
  // E2E mock 的硬闸要求精确本地 profile + 回环资源 + 零真实凭据（见 runtime.isE2EMockProviderMode）。
  const provider = getEmbeddingProvider({
    E2E_MOCK_PROVIDERS: '1', APP_ENV: 'test',
    LOCAL_SUPABASE_PROFILE: 'deepseek-romance', SUPABASE_PROJECT_REF: 'local-deepseek',
    SUPABASE_URL: 'http://127.0.0.1:45421', DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:45422/postgres',
  });
  assert.equal(provider.constructor.name, 'E2EMockEmbeddingProvider');
});
