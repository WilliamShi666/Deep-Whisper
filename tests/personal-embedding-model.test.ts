import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/storage/database/db';
import { DashScopeEmbeddingProvider, EMBEDDING_DIMENSIONS } from '../src/lib/ai/providers/dashscope-embedding-provider';
import { getMemoryDependencies, getMemoryWorkerOptions } from '../src/lib/memory/dependencies';
import { createSqliteMemoryGateway, PERSONAL_MEMORY_APP_ID, setSqliteMemoryEmbedding } from '../src/lib/memory/sqlite-gateway';
import { enqueueMissingEmbeddingJobs, processMemoryJobs } from '../src/lib/memory/sqlite-jobs';

const NOW = new Date('2026-10-07T04:00:00Z');
const MODEL_A = 'text-embedding-v4';
const MODEL_B = 'compatible-embedding-b';
const COMPANION = 'fixture-companion';
const SOURCE = 'fixture-conversation';
const DIMENSIONS = 1024;
function fixture(t: { after(fn: () => void): void }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'whisper-embedding-model-'));
  const db = openDatabase({ dataDir });
  const { id: owner } = db.prepare('SELECT id FROM visitors').get() as { id: string };
  db.prepare(`INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at)
    VALUES (?,?,?,'Fixture','normal',?,?)`).run(COMPANION, owner, 'fixture-character', NOW.getTime(), NOW.getTime());
  db.prepare('INSERT INTO conversations(id,visitor_id,companion_id,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(SOURCE, owner, COMPANION, NOW.getTime(), NOW.getTime());
  t.after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { db, owner };
}
async function fact(db: Database.Database, owner: string, text = '用户周五做胃镜') {
  return createSqliteMemoryGateway(db, { now: () => NOW }).add(text, { userId: owner, appId: PERSONAL_MEMORY_APP_ID,
    metadata: { visitor_id: owner, companion_id: COMPANION, layer: 'L3', bucket: 'key_detail', domain: 'identity',
      memory_type: 'personal_fact', importance: .8, confidence: 'explicit', status: 'active', temporal_status: 'timeless',
      evidence_memory_ids: [], source_conversation_id: SOURCE, observed_at: NOW.toISOString() } });
}
function vector(axis: number) { const result = Array<number>(DIMENSIONS).fill(0); result[axis] = 1; return result; }
function filters(owner: string) { return { AND: [{ user_id: owner }, { app_id: PERSONAL_MEMORY_APP_ID }, { metadata: { companion_id: COMPANION } }] }; }
function worker(db: Database.Database, model: string, clock = () => NOW) {
  return { retrievalMode: 'hybrid' as const, embeddingModel: model, embeddingDimensions: DIMENSIONS, now: clock, limit: 1,
    organizer: { async organize() { return { operations: [] }; } },
    embed: async () => { assert.equal(db.inTransaction, false); return [vector(model === MODEL_A ? 0 : 1)]; } };
}
function stored(db: Database.Database, id: string) {
  return db.prepare('SELECT content,content_version,embedding_model,embedding_dimensions,embedding_content_version FROM memories WHERE id=?').get(id) as
    { content: string; content_version: number; embedding_model: string | null; embedding_dimensions: number | null; embedding_content_version: number | null };
}

test('selected embedding model reaches every provider batch with fixed 1024 dimensions', async () => {
  const requests: Array<{ model: string; dimensions: number; input: string[] }> = [];
  const provider = new DashScopeEmbeddingProvider({ DASHSCOPE_API_KEY: 'fixture', AI_EMBEDDING_MODEL: MODEL_B },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; dimensions: number; input: string[] };
      requests.push(body);
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: vector(1) })) });
    });
  const result = await provider.embed({ texts: Array.from({ length: 11 }, (_, i) => `fixture-${i}`) });
  assert.equal(result.length, 11);
  assert.deepEqual(requests.map(request => request.input.length), [10, 1]);
  assert.ok(requests.every(request => request.model === MODEL_B && request.dimensions === EMBEDDING_DIMENSIONS));
});

test('chat and worker use the same selected embedding model and preserve keyword-only wiring', async t => {
  const { db, owner } = fixture(t); const memory = await fact(db, owner);
  const env = { APP_ENV: 'test', E2E_MOCK_PROVIDERS: '1', MEMORY_RETRIEVAL_MODE: 'hybrid', AI_EMBEDDING_MODEL: MODEL_B };
  const options = getMemoryWorkerOptions(env);
  assert.equal(options.embeddingModel, MODEL_B);
  assert.equal(options.embeddingDimensions, DIMENSIONS);
  const [queryVector] = await options.embed!({ texts: ['semantic-only fixture query'] });
  assert.equal(setSqliteMemoryEmbedding(db, { id: memory.id!, contentVersion: 1, model: MODEL_B, dimensions: DIMENSIONS, vector: queryVector }), true);
  const dependencies = getMemoryDependencies(env, db);
  const recalled = await dependencies.gateway.search('semantic-only fixture query', filters(owner));
  assert.equal(recalled[0]?.id, memory.id, 'chat must accept the worker-selected vector space');
  assert.ok((recalled[0]?.score ?? 0) > .999);
  const keywordEnv = { ...env, MEMORY_RETRIEVAL_MODE: 'keyword' };
  assert.equal(getMemoryWorkerOptions(keywordEnv).embed, undefined);
  assert.equal((await getMemoryDependencies(keywordEnv, db).gateway.search('胃镜', filters(owner)))[0]?.score, undefined);
});

test('same-dimension A to B to A switching rebuilds historical completed jobs without changing facts or keyword recall', async t => {
  const { db, owner } = fixture(t); const memory = await fact(db, owner);
  assert.equal((await processMemoryJobs(db, worker(db, MODEL_A))).completed, 1);
  const first = db.prepare("SELECT id,state FROM memory_jobs WHERE kind='embedding'").get() as { id: string; state: string };
  assert.equal(first.state, 'completed');
  // Simulate the pre-model-configuration completed job format in an existing DB.
  db.prepare('UPDATE memory_jobs SET payload=? WHERE id=?').run('{}', first.id);
  const gatewayB = createSqliteMemoryGateway(db, { retrievalMode: 'hybrid', embeddingModel: MODEL_B, embeddingDimensions: DIMENSIONS,
    now: () => NOW, embed: async () => [vector(1)] });
  assert.equal((await gatewayB.search('semantic-only fixture query', filters(owner))).length, 0, 'same dimensions cannot make A vectors eligible in B');
  assert.equal((await gatewayB.search('胃镜', filters(owner)))[0]?.id, memory.id, 'FTS remains usable during reindex');
  assert.equal((await processMemoryJobs(db, worker(db, MODEL_B))).completed, 1, 'a historical completed content-version job must be reusable for a new model');
  assert.equal(stored(db, memory.id!).embedding_model, MODEL_B);
  assert.equal((await gatewayB.search('semantic-only fixture query', filters(owner)))[0]?.score, 1);
  assert.equal((await processMemoryJobs(db, worker(db, MODEL_A))).completed, 1, 'switching back also rebuilds the current content version');
  assert.deepEqual(stored(db, memory.id!), { content: '用户周五做胃镜', content_version: 1, embedding_model: MODEL_A,
    embedding_dimensions: DIMENSIONS, embedding_content_version: 1 });
  assert.equal((db.prepare('SELECT count(*) n FROM memory_jobs').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT id FROM memory_jobs').get() as { id: string }).id, first.id);
  assert.deepEqual(JSON.parse((db.prepare('SELECT payload FROM memory_jobs').get() as { payload: string }).payload),
    { embeddingModel: MODEL_A, embeddingDimensions: DIMENSIONS });
  assert.equal((db.prepare('SELECT count(*) n FROM memory_sources').get() as { n: number }).n, 1);
  assert.equal((await createSqliteMemoryGateway(db, { now: () => NOW }).search('胃镜', filters(owner))).length, 1);
  db.prepare("INSERT INTO memories_fts(memories_fts,rank) VALUES ('integrity-check',1)").run();
});

test('same-model terminal retries stay bounded while a new model receives a fresh bounded job', async t => {
  const { db, owner } = fixture(t); const memory = await fact(db, owner); let clock = NOW; let failures = 0;
  const options = { ...worker(db, MODEL_A, () => clock), embed: async (): Promise<number[][]> => { failures++; throw new Error('fixture failure'); } };
  for (let i = 0; i < 4; i++) {
    assert.equal((await processMemoryJobs(db, options)).failed, 1);
    clock = new Date(clock.getTime() + 60_000);
  }
  const terminal = db.prepare('SELECT state,attempt_count FROM memory_jobs').get() as { state: string; attempt_count: number };
  assert.deepEqual(terminal, { state: 'failed', attempt_count: 4 });
  assert.equal((await processMemoryJobs(db, options)).completed, 0);
  assert.equal(failures, 4, 'same-model backfill must not reset an exhausted retry budget');
  assert.equal((await processMemoryJobs(db, worker(db, MODEL_B, () => clock))).completed, 1);
  assert.equal(stored(db, memory.id!).embedding_model, MODEL_B);
  assert.deepEqual(db.prepare('SELECT state,attempt_count FROM memory_jobs').get(), { state: 'completed', attempt_count: 1 });
});

test('model catch-up leaves a live lease alone and fences an expired old-model completion', async t => {
  const { db, owner } = fixture(t); const memory = await fact(db, owner); let clock = NOW;
  const b = { embeddingModel: MODEL_B, embeddingDimensions: DIMENSIONS };
  const a = { ...worker(db, MODEL_A, () => clock), embed: async () => {
    assert.equal(db.inTransaction, false);
    const live = db.prepare('SELECT lease_token,state,attempt_count FROM memory_jobs').get();
    assert.equal(enqueueMissingEmbeddingJobs(db, clock, b), 0, 'model changes cannot revoke a live provider lease');
    assert.deepEqual(db.prepare('SELECT lease_token,state,attempt_count FROM memory_jobs').get(), live);
    clock = new Date(clock.getTime() + 120001);
    assert.equal(enqueueMissingEmbeddingJobs(db, clock, b), 1, 'expired claims can be fenced and retargeted');
    return [vector(0)];
  } };
  const stale = await processMemoryJobs(db, a);
  assert.equal(stale.completed, 0); assert.equal(stale.cancelled, 1);
  assert.equal(stored(db, memory.id!).embedding_model, null);
  assert.equal((await processMemoryJobs(db, worker(db, MODEL_B, () => clock))).completed, 1);
  assert.equal(stored(db, memory.id!).embedding_model, MODEL_B);
});

test('model catch-up schedules at most fifty jobs per transaction without completed-job starvation', async t => {
  const { db, owner } = fixture(t);
  for (let i = 0; i < 51; i++) await fact(db, owner, `用户胃镜事实 ${i}`);
  const first = await processMemoryJobs(db, { ...worker(db, MODEL_A), limit: 51 });
  assert.equal(first.completed, 50);
  assert.equal((await processMemoryJobs(db, { ...worker(db, MODEL_A), limit: 51 })).completed, 1);
  const target = { embeddingModel: MODEL_B, embeddingDimensions: DIMENSIONS };
  assert.equal(enqueueMissingEmbeddingJobs(db, NOW, target), 50);
  assert.equal(enqueueMissingEmbeddingJobs(db, NOW, target), 1, 'already queued current-model rows cannot hide later eligible facts');
  assert.equal(enqueueMissingEmbeddingJobs(db, NOW, target), 0);
  assert.equal((db.prepare("SELECT count(*) n FROM memory_jobs WHERE state='queued'").get() as { n: number }).n, 51);
});
