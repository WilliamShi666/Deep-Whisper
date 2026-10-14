import assert from 'node:assert/strict';
import test from 'node:test';
import { DashScopeEmbeddingProvider, EMBEDDING_DIMENSIONS } from '../src/lib/ai/providers/dashscope-embedding-provider';

test('OSS-020: Qwen profile defaults pair endpoint and splits 23 inputs into batches of at most ten in order', async () => {
  const captures: { url: string; input: string[] }[] = [];
  const fetcher = (async (url, init) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    captures.push({ url: String(url), input });
    return Response.json({ data: input.map((text, index) => ({ index,
      embedding: Array(EMBEDDING_DIMENSIONS).fill(Number(text.split('-')[1])) })) });
  }) as typeof fetch;
  const provider = new DashScopeEmbeddingProvider({ DASHSCOPE_API_KEY: 'fake-own-key' }, fetcher);
  const vectors = await provider.embed({ texts: Array.from({ length: 23 }, (_, i) => `text-${i}`) });
  assert.deepEqual(captures.map((x) => x.input.length), [10, 10, 3]);
  assert.ok(captures.every((x) => x.url === 'https://maas.qianwenaiapi.com/compatible-mode/v1/embeddings'));
  assert.deepEqual(vectors.map((vector) => vector[0]), Array.from({ length: 23 }, (_, i) => i));
});

test('OSS-020: partially completed batches never return a partial successful result', async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    if (++calls === 2) return new Response('not supported', { status: 400 });
    return Response.json({ data: input.map((_, index) => ({ index, embedding: Array(EMBEDDING_DIMENSIONS).fill(1) })) });
  }) as typeof fetch;
  const provider = new DashScopeEmbeddingProvider({ DASHSCOPE_API_KEY: 'fake-own-key' }, fetcher);
  await assert.rejects(provider.embed({ texts: Array.from({ length: 11 }, (_, i) => `text-${i}`) }), /failed/i);
  assert.equal(calls, 2);
});
