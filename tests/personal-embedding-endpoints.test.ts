import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/storage/database/db';
import { DashScopeEmbeddingProvider } from '../src/lib/ai/providers/dashscope-embedding-provider';
import { getEmbeddingNamespace } from '../src/lib/ai/embedding-namespace';
import { getProviderConfig } from '../src/lib/config/runtime';
import { getMemoryWorkerOptions } from '../src/lib/memory/dependencies';
import { getEmbeddingProvider } from '../src/lib/ai/embedding-provider';
import { createSqliteMemoryGateway, PERSONAL_MEMORY_APP_ID } from '../src/lib/memory/sqlite-gateway';
import { enqueueMissingEmbeddingJobs, processMemoryJobs } from '../src/lib/memory/sqlite-jobs';

const env = { AI_EMBEDDING_PROVIDER: 'openai-compatible', AI_EMBEDDING_BASE_URL: 'http://127.0.0.1:8765/v1/',
  AI_EMBEDDING_MODEL: 'fixture-embedding', AI_EMBEDDING_DIMENSIONS: '2' };
const namespace = (value: Record<string, string>) => getEmbeddingNamespace(getProviderConfig(value).embedding);
const NOW = new Date('2026-10-08T02:00:00Z');
function fixture(t: { after(fn: () => void): void }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'whisper-endpoint-'));
  const db = openDatabase({ dataDir });
  const { id: owner } = db.prepare('SELECT id FROM visitors').get() as { id: string };
  db.prepare("INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES ('companion',?,'fixture','Fixture','normal',?,?)").run(owner, NOW.getTime(), NOW.getTime());
  db.prepare("INSERT INTO conversations(id,visitor_id,companion_id,created_at,updated_at) VALUES ('source',?,'companion',?,?)").run(owner, NOW.getTime(), NOW.getTime());
  t.after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { db, owner };
}
test('compatible embeddings use their own endpoint/key and selected dimensions, reorder batches, and omit optional dimensions', async () => {
  const captures: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  const provider = new DashScopeEmbeddingProvider({ ...env, DASHSCOPE_API_KEY: 'unrelated-fixture-key', AI_EMBEDDING_SEND_DIMENSIONS: 'false' }, async (url, init) => {
    const body = JSON.parse(String(init?.body)); captures.push({ url: String(url), body, headers: new Headers(init?.headers) });
    return Response.json({ data: (body.input as string[]).map((_, index) => ({ index, embedding: [index + 1, 1] })).reverse() });
  });
  const vectors = await provider.embed({ texts: Array.from({ length: 11 }, (_, i) => `text-${i}`) });
  assert.deepEqual(captures.map(c => (c.body.input as string[]).length), [10, 1]);
  assert.ok(captures.every(c => c.url === 'http://127.0.0.1:8765/v1/embeddings' && c.body.model === 'fixture-embedding'));
  assert.ok(captures.every(c => !Object.hasOwn(c.body, 'dimensions') && !c.headers.has('Authorization')));
  assert.deepEqual(vectors.slice(0, 2), [[1, 1], [2, 1]]);
});
test('canonical native embedding URL/key override legacy values and dimensional mismatch rejects', async () => {
  const captures: Array<{ url: string; headers: Headers }> = [];
  const provider = new DashScopeEmbeddingProvider({ AI_EMBEDDING_BASE_URL: 'https://fixture.example/prefix/', AI_EMBEDDING_API_KEY: 'own-fixture',
    DASHSCOPE_API_KEY: 'legacy-fixture', DASHSCOPE_EMBEDDING_BASE_URL: 'https://legacy.example/v1', AI_EMBEDDING_DIMENSIONS: '3' }, async (url, init) => {
    captures.push({ url: String(url), headers: new Headers(init?.headers) });
    assert.equal(JSON.parse(String(init?.body)).dimensions, 3);
    return Response.json({ data: [{ embedding: [1, 0] }] });
  });
  await assert.rejects(provider.embed({ texts: ['fixture'] }), /expected 3 finite dimensions/);
  assert.equal(captures[0].url, 'https://fixture.example/prefix/embeddings');
  assert.equal(captures[0].headers.get('Authorization'), 'Bearer own-fixture');
});
test('namespace preserves legacy default vectors, normalizes URL, and changes on endpoint/protocol/dimension but not key rotation', () => {
  assert.equal(namespace({ DASHSCOPE_API_KEY: 'fixture' }), 'text-embedding-v4');
  const base = namespace(env);
  assert.equal(base, namespace({ ...env, AI_EMBEDDING_BASE_URL: 'http://127.0.0.1:8765/v1', AI_EMBEDDING_API_KEY: 'rotated-fixture' }));
  assert.notEqual(base, namespace({ ...env, AI_EMBEDDING_BASE_URL: 'http://127.0.0.1:8766/v1' }));
  assert.notEqual(base, namespace({ ...env, AI_EMBEDDING_DIMENSIONS: '3' }));
  assert.notEqual(base, namespace({ ...env, AI_EMBEDDING_PROVIDER: 'dashscope', DASHSCOPE_API_KEY: 'fixture' }));
  assert.equal(namespace({ DASHSCOPE_API_KEY: 'fixture', AI_EMBEDDING_MODEL: 'legacy-custom-model' }), 'legacy-custom-model');
});
test('same-name endpoint switches rebuild vectors without changing facts or keyword retrieval; another target fences live output', async t => {
  const { db, owner } = fixture(t);
  const memory = await createSqliteMemoryGateway(db, { now: () => NOW }).add('用户周五做胃镜', { userId: owner, appId: PERSONAL_MEMORY_APP_ID,
    metadata: { visitor_id: owner, companion_id: 'companion', source_conversation_id: 'source', status: 'active', confidence: 'explicit',
      layer: 'L3', bucket: 'key_detail', domain: 'identity', importance: .8, memory_type: 'personal_fact', temporal_status: 'timeless', observed_at: NOW.toISOString() } });
  const targetA = namespace(env); const targetB = namespace({ ...env, AI_EMBEDDING_BASE_URL: 'http://127.0.0.1:8766/v1' });
  const opts = (target: string) => ({ retrievalMode: 'hybrid' as const, embeddingModel: target, embeddingDimensions: 2,
    now: () => NOW, limit: 1, organizer: { async organize() { return { operations: [] }; } }, embed: async () => [[1, 0]] });
  const first = await processMemoryJobs(db, { ...opts(targetA), embed: async () => {
    assert.equal(db.inTransaction, false);
    assert.equal(enqueueMissingEmbeddingJobs(db, NOW, opts(targetB)), 0, 'a live lease is retained');
    return [[1, 0]];
  } });
  assert.equal(first.completed, 0, 'old endpoint output cannot commit after another target was selected');
  assert.equal((db.prepare('SELECT embedding FROM memories WHERE id=?').get(memory.id) as { embedding: unknown }).embedding, null);
  assert.equal((await processMemoryJobs(db, opts(targetB))).completed, 1);
  const filters = { AND: [{ user_id: owner }, { app_id: PERSONAL_MEMORY_APP_ID }, { metadata: { companion_id: 'companion' } }] };
  const gatewayA = createSqliteMemoryGateway(db, { ...opts(targetA), limit: 10 });
  assert.equal((await gatewayA.search('semantic-fixture', filters)).length, 0);
  assert.equal((await gatewayA.search('胃镜', filters))[0]?.id, memory.id);
  assert.equal((await processMemoryJobs(db, opts(targetA))).completed, 1);
  assert.equal((db.prepare('SELECT embedding_model FROM memories WHERE id=?').get(memory.id) as { embedding_model: string }).embedding_model, targetA);
  db.prepare("INSERT INTO memories_fts(memories_fts,rank) VALUES ('integrity-check',1)").run();
});
test('worker wiring shares configured dimension and detects in-flight endpoint changes', () => {
  const mutable = { ...env, MEMORY_RETRIEVAL_MODE: 'hybrid' };
  const options = getMemoryWorkerOptions(mutable);
  assert.equal(options.embeddingModel, namespace(mutable));
  assert.equal(options.embeddingDimensions, 2);
  assert.equal(options.isEmbeddingTargetCurrent(), true);
  mutable.AI_EMBEDDING_BASE_URL = 'http://127.0.0.1:8766/v1';
  assert.equal(options.isEmbeddingTargetCurrent(), false);
});
test('in-flight A to B to A clears the obsolete desired target and finishes without spending retry budget', async t => {
  const { db, owner } = fixture(t);
  const memory = await createSqliteMemoryGateway(db, { now: () => NOW }).add('用户喜欢桂花乌龙', { userId: owner, appId: PERSONAL_MEMORY_APP_ID,
    metadata: { visitor_id: owner, companion_id: 'companion', source_conversation_id: 'source', status: 'active', confidence: 'explicit',
      layer: 'L3', bucket: 'key_detail', domain: 'identity', importance: .8, memory_type: 'personal_fact', temporal_status: 'timeless', observed_at: NOW.toISOString() } });
  const targetA = namespace(env);
  const targetB = namespace({ ...env, AI_EMBEDDING_BASE_URL: 'http://127.0.0.1:8766/v1' });
  const options = { retrievalMode: 'hybrid' as const, embeddingModel: targetA, embeddingDimensions: 2,
    now: () => NOW, limit: 1, organizer: { async organize() { return { operations: [] }; } },
    embed: async () => {
      assert.equal(enqueueMissingEmbeddingJobs(db, NOW, { embeddingModel: targetB, embeddingDimensions: 2 }), 0);
      assert.equal(enqueueMissingEmbeddingJobs(db, NOW, { embeddingModel: targetA, embeddingDimensions: 2 }), 0);
      return [[1, 0]];
    } };
  const result = await processMemoryJobs(db, options);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal((db.prepare('SELECT embedding_model FROM memories WHERE id=?').get(memory.id) as { embedding_model: string }).embedding_model, targetA);
  assert.deepEqual(db.prepare('SELECT state,attempt_count FROM memory_jobs').get(), { state: 'completed', attempt_count: 1 });
});
test('in-flight env changes reject old output and stop stale worker from rebuilding again', async t => {
  const { db, owner } = fixture(t);
  const memory = await createSqliteMemoryGateway(db, { now: () => NOW }).add('用户明天复查胃镜', { userId: owner, appId: PERSONAL_MEMORY_APP_ID,
    metadata: { visitor_id: owner, companion_id: 'companion', source_conversation_id: 'source', status: 'active', confidence: 'explicit',
      layer: 'L3', bucket: 'key_detail', domain: 'identity', importance: .8, memory_type: 'personal_fact', temporal_status: 'timeless', observed_at: NOW.toISOString() } });
  const mutable = { ...env, MEMORY_RETRIEVAL_MODE: 'hybrid' };
  const oldOptions = { ...getMemoryWorkerOptions(mutable), now: () => NOW, limit: 1, embed: async () => {
    mutable.AI_EMBEDDING_BASE_URL = 'http://127.0.0.1:8766/v1';
    return [[1, 0]];
  } };
  assert.equal((await processMemoryJobs(db, oldOptions)).completed, 0);
  assert.equal((db.prepare('SELECT embedding FROM memories WHERE id=?').get(memory.id) as { embedding: unknown }).embedding, null);
  const before = db.prepare('SELECT attempt_count,state FROM memory_jobs').get();
  assert.deepEqual(await processMemoryJobs(db, oldOptions), { completed: 0, failed: 0, cancelled: 0 });
  assert.deepEqual(db.prepare('SELECT attempt_count,state FROM memory_jobs').get(), before);
  const newOptions = { ...getMemoryWorkerOptions(mutable), now: () => NOW, limit: 1, embed: async () => [[0, 1]] };
  assert.equal((await processMemoryJobs(db, newOptions)).completed, 1);
  assert.equal((db.prepare('SELECT embedding_model FROM memories WHERE id=?').get(memory.id) as { embedding_model: string }).embedding_model, namespace(mutable));
});
test('mock embedding vectors honor the same configured dimensions without credentials', async () => {
  const vectors = await getEmbeddingProvider({ APP_ENV: 'test', E2E_MOCK_PROVIDERS: '1', AI_EMBEDDING_DIMENSIONS: '3' }).embed({ texts: ['fixture'] });
  assert.equal(vectors[0].length, 3);
});
