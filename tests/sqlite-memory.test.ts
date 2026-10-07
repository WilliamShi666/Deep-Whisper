import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { memoryMigrationSql } from '../src/storage/database/migrations/0002-memory';
import { createSqliteMemoryGateway, deleteSqliteMemoryEvidenceClosure, indexMemoryTokens, memoryScopeRevision, setSqliteMemoryEmbedding } from '../src/lib/memory/sqlite-gateway';
import { createSqliteRecallSnapshotStore, forgetSqliteConversationMemories } from '../src/lib/memory/sqlite-snapshot';
import { claimMemoryJob, enqueueOrganizerJob, processMemoryJobs, renewMemoryJobLease } from '../src/lib/memory/sqlite-jobs';
import { persistSqliteRelationshipSnapshot } from '../src/lib/memory/relationship-snapshot';
import { enterMaintenance } from '../src/lib/personal/maintenance';
import { createMemoryService, RECALL_LIMIT_DEFAULT, type MemoryPlan } from '../src/lib/memory/service';

const NOW = new Date('2026-10-07T04:00:00.000Z');
const OWNER = 'owner';
const A = 'companion-a';
const B = 'companion-b';
const CA = 'conversation-a';
const CB = 'conversation-b';
const APP = 'deep-whisper:personal:v1';

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'whisper-memory-'));
  const db = new Database(join(dir, 'memory.sqlite'));
  db.pragma('foreign_keys=ON');
  db.pragma('journal_mode=WAL');
  db.exec(`CREATE TABLE visitors(id TEXT PRIMARY KEY);
    CREATE TABLE companions(id TEXT PRIMARY KEY,visitor_id TEXT REFERENCES visitors(id));
    CREATE TABLE conversations(id TEXT PRIMARY KEY,visitor_id TEXT,companion_id TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT);
    CREATE TABLE user_profiles(visitor_id TEXT PRIMARY KEY,timezone TEXT);
    CREATE TABLE relationship_snapshots(id TEXT PRIMARY KEY,visitor_id TEXT,companion_id TEXT,
      relationship_stage TEXT,emotional_tone TEXT,dynamic_summary TEXT,key_milestones TEXT,
      observed_at INTEGER,created_at INTEGER,updated_at INTEGER,UNIQUE(visitor_id,companion_id));`);
  db.exec(memoryMigrationSql);
  db.prepare('INSERT INTO visitors VALUES (?)').run(OWNER);
  db.prepare('INSERT INTO companions VALUES (?,?)').run(A, OWNER);
  db.prepare('INSERT INTO companions VALUES (?,?)').run(B, OWNER);
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run(CA, OWNER, A);
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run(CB, OWNER, A);
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run('conversation-other', OWNER, B);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return db;
}
function meta(overrides: Record<string, unknown> = {}) {
  return { app_id: APP, visitor_id: OWNER, companion_id: A, layer: 'L3', bucket: 'key_detail',
    domain: 'identity', memory_type: 'personal_fact', importance: 0.8, confidence: 'explicit',
    status: 'active', temporal_status: 'timeless', observed_at: NOW.toISOString(),
    evidence_memory_ids: [], source_conversation_id: CA, ...overrides };
}
function filters(companionId = A) {
  return { AND: [{ user_id: OWNER }, { app_id: APP }, { metadata: { companion_id: companionId } }] };
}
function gateway(db: Database.Database, overrides = {}) {
  return createSqliteMemoryGateway(db, { now: () => NOW, ...overrides });
}
async function add(db: Database.Database, text: string, overrides = {}) {
  return gateway(db).add(text, { userId: OWNER, appId: APP, metadata: meta(overrides) });
}
function enqueue(db: Database.Database, overrides = {}) {
  const userId = randomUUID();
  const assistantId = randomUUID();
  const source = (overrides as { conversationId?: string }).conversationId ?? CA;
  db.prepare('INSERT INTO messages VALUES (?,?,?,?)').run(userId, source, 'user', '我周五要做胃镜');
  db.prepare('INSERT INTO messages VALUES (?,?,?,?)').run(assistantId, source, 'assistant', '我记住了');
  const input = { visitorId: OWNER, companionId: A, conversationId: CA, userMessageId: userId,
    userText: '我周五要做胃镜', assistantMessageId: assistantId, assistantText: '我记住了',
    observedAt: NOW.toISOString(), ...overrides };
  return { id: enqueueOrganizerJob(db, input), input };
}
const plan: MemoryPlan = { operations: [{ action: 'ADD', text: '用户周五要做胃镜',
  layer: 'L3', memoryType: 'personal_fact', confidence: 'explicit', importance: 0.8, reason: '用户明确说过' }] };

test('OSS-022/023: real FTS retains Chinese bigram frequency and scopes before LIMIT', async (t) => {
  const db = fixture(t);
  assert.equal(indexMemoryTokens('胃镜胃镜 deadline').split(' ').filter((x) => x === '胃镜').length, 2);
  await add(db, '我周五要做胃镜检查');
  await add(db, '团子是橘猫');
  await add(db, 'deadline is Friday');
  await add(db, '猫');
  await add(db, '胃镜胃镜胃镜', { companion_id: B, source_conversation_id: 'conversation-other' });
  await add(db, '胃镜过期了', { valid_until: '2026-10-01T00:00:00Z' });
  assert.equal((await gateway(db).search('胃镜', filters())).length, 1);
  assert.equal((await gateway(db).search('团子', filters())).length, 1);
  assert.equal((await gateway(db).search('猫', filters())).length, 1);
  assert.equal((await gateway(db).search('DEADLINE', filters())).length, 1);
  assert.equal((await gateway(db).search('" OR NOT * 😄', filters())).length, 0);
  await assert.rejects(gateway(db).search('胃镜', {}), /scope/i);
});

test('OSS-023/025: text updates atomically replace FTS and invalidate existing embeddings', async (t) => {
  const db = fixture(t);
  const memory = await add(db, '周五胃镜');
  assert.equal(setSqliteMemoryEmbedding(db, { id: memory.id, contentVersion: 1, vector: [1, 0], model: 'fixture', dimensions: 2 }), true);
  await gateway(db).update(memory.id, { text: '周六牙医' });
  assert.equal((await gateway(db).search('胃镜', filters())).length, 0);
  assert.equal((await gateway(db).search('牙医', filters())).length, 1);
  assert.equal(setSqliteMemoryEmbedding(db, { id: memory.id, contentVersion: 1, vector: [1, 0], model: 'fixture', dimensions: 2 }), false);
  assert.equal((db.prepare('SELECT embedding FROM memories WHERE id=?').get(memory.id) as { embedding: unknown }).embedding, null);
  await gateway(db).delete(memory.id);
  assert.equal((await gateway(db).search('牙医', filters())).length, 0);
  db.prepare("INSERT INTO memories_fts(memories_fts) VALUES ('integrity-check')").run();
});

test('OSS-024: hybrid semantic leg scans full scope and returns real cosine, keyword-only can degrade', async (t) => {
  const db = fixture(t);
  const memory = await add(db, '周五去医院做内窥镜');
  setSqliteMemoryEmbedding(db, { id: memory.id, contentVersion: 1, vector: [1, 0], model: 'fixture', dimensions: 2 });
  const hybrid = gateway(db, { retrievalMode: 'hybrid', embeddingModel: 'fixture', embeddingDimensions: 2,
    embed: async () => { assert.equal(db.inTransaction, false); return [[1, 0]]; } });
  const result = await hybrid.search('完全不同字面', filters());
  assert.equal(result[0]?.id, memory.id);
  assert.equal(result[0]?.score, 1);
  const degraded = gateway(db, { retrievalMode: 'hybrid', embed: async () => { throw new Error('429'); } });
  assert.equal((await degraded.search('内窥镜', filters()))[0]?.score, undefined);
});

test('OSS-027/028: snapshot revisions fence stale writers and forgetting is exhaustive across sources', async (t) => {
  const db = fixture(t);
  for (let i = 0; i < 60; i++) await add(db, `胃镜记忆第${i}`, { source_conversation_id: [CA, CB],
    ...(i % 2 ? { status: 'retired' } : { valid_until: '2026-10-01T00:00:00Z' }) });
  const store = createSqliteRecallSnapshotStore(db, { visitorId: OWNER, companionId: A });
  await store.read();
  await store.write({ memories: [], refreshedAt: NOW.toISOString(), turnsSinceRefresh: 0 });
  const outcome = forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CA });
  assert.equal(outcome.deleted, 60);
  assert.equal((db.prepare('SELECT count(*) n FROM memory_sources').get() as { n: number }).n, 0);
  await assert.rejects(store.write({ memories: [], refreshedAt: NOW.toISOString(), turnsSinceRefresh: 0 }), /invalidated/i);
  assert.equal(await createSqliteRecallSnapshotStore(db, { visitorId: OWNER, companionId: A }).read(), null);
});

test('OSS-026/029: durable organizer saves facts without embeddings and uses source time outside transactions', async (t) => {
  const db = fixture(t);
  const job = enqueue(db);
  assert.equal(enqueueOrganizerJob(db, job.input), job.id);
  const result = await processMemoryJobs(db, { now: () => NOW, organizer: { async organize(input) {
    assert.equal(db.inTransaction, false);
    assert.equal(Date.parse(input.nowIso), NOW.getTime());
    return { ...plan, communicationPrefsFeedback: ['不要叫我宝贝', '我周五要做胃镜'] };
  } } });
  assert.equal(result.completed, 1);
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 2);
  assert.equal((db.prepare("SELECT count(*) n FROM memories WHERE content='不要叫我宝贝'").get() as { n: number }).n, 0);
  assert.equal((await processMemoryJobs(db, { now: () => NOW, organizer: { async organize() { throw new Error('must not repeat'); } } })).completed, 0);
});

test('OSS-029: a crash between effects and completion rolls back both and retry applies once', async (t) => {
  const db = fixture(t);
  enqueue(db);
  db.exec("CREATE TRIGGER crash_completion BEFORE UPDATE OF state ON memory_jobs WHEN new.state='completed' BEGIN SELECT RAISE(ABORT,'simulated crash'); END;");
  await processMemoryJobs(db, { now: () => NOW, organizer: { async organize() { return plan; } } });
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 0);
  db.exec('DROP TRIGGER crash_completion');
  const later = new Date(NOW.getTime() + 60_000);
  await processMemoryJobs(db, { now: () => later, organizer: { async organize() { return plan; } } });
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 1);
});

test('OSS-028/029: deletion during organizer IO cannot revive source memories', async (t) => {
  const db = fixture(t);
  enqueue(db);
  await processMemoryJobs(db, { now: () => NOW, organizer: { async organize() {
    forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CA });
    db.prepare('DELETE FROM conversations WHERE id=?').run(CA);
    return plan;
  } } });
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 0);
});

test('OSS-026/027: SQLite gateway preserves resolved events, explicit boundaries and bucket domain rules', async (t) => {
  const db = fixture(t);
  await add(db, '用户的搬家结束了', { temporal_status: 'resolved' });
  await add(db, '不要再提分手', { memory_type: 'avoid_topic', domain: 'communication' });
  const service = createMemoryService({ enabled: true, appId: APP, gateway: gateway(db), now: () => NOW,
    organizer: { async organize() { return { operations: [] }; } } });
  const recalled = await service.recall({ visitorId: OWNER, companionId: A, query: '搬家' });
  assert.equal(recalled[0]?.temporalStatus, 'resolved');
  assert.equal((await gateway(db).listAvoidTopics!({ visitorId: OWNER, companionId: A, appId: APP })).length, 1);
});

test('OSS-024: embeddings must also be finite when serialized to Float32', async (t) => {
  const db = fixture(t);
  const memory = await add(db, '精度边界');
  assert.throws(() => setSqliteMemoryEmbedding(db, { id: memory.id, contentVersion: 1,
    vector: [1e99, 1], model: 'fixture', dimensions: 2 }), /invalid/i);
});

test('OSS-029: final-attempt crash becomes a visible failed job instead of an immortal running lease', (t) => {
  const db = fixture(t);
  const job = enqueue(db);
  db.prepare("UPDATE memory_jobs SET state='running',attempt_count=4,lease_token='old',lease_expires_at=? WHERE id=?")
    .run(NOW.getTime() - 1, job.id);
  assert.equal(claimMemoryJob(db, { now: NOW }), null);
  assert.equal((db.prepare('SELECT state FROM memory_jobs WHERE id=?').get(job.id) as { state: string }).state, 'failed');
});

test('OSS-028/029: another conversation deletion causes bounded retry while valid source survives', async (t) => {
  const db = fixture(t);
  enqueue(db);
  let calls = 0;
  const organizer = { async organize() {
    if (++calls === 1) forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CB });
    return plan;
  } };
  await processMemoryJobs(db, { now: () => NOW, organizer });
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 0);
  await processMemoryJobs(db, { now: () => new Date(NOW.getTime() + 60_000), organizer });
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 1);
  assert.equal(calls, 2);
});

test('OSS-029: completion rejects replaced lease token and reclaims a crashed process on restart', async (t) => {
  const db = fixture(t);
  const job = enqueue(db);
  const claimed = claimMemoryJob(db, { now: NOW });
  assert.ok(claimed);
  assert.equal(claimMemoryJob(db, { now: NOW }), null);
  const later = new Date(NOW.getTime() + 180_000);
  const outcome = await processMemoryJobs(db, { now: () => later, organizer: { async organize() {
    db.prepare("UPDATE memory_jobs SET lease_token='replacement' WHERE id=?").run(job.id);
    return plan;
  } } });
  assert.equal(outcome.completed, 0);
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 0);
  const final = await processMemoryJobs(db, { now: () => new Date(later.getTime() + 180_000), organizer: { async organize() { return plan; } } });
  assert.equal(final.completed, 1);
});

test('OSS-029: lease renewal only extends the live token and cannot revive expired or invalidated work', t => {
  const db = fixture(t); enqueue(db);
  const job = claimMemoryJob(db, { now: NOW })!;
  assert.equal(renewMemoryJobLease(db, job, new Date(NOW.getTime() + 60000)), true);
  assert.equal((db.prepare('SELECT lease_expires_at FROM memory_jobs WHERE id=?').get(job.id) as { lease_expires_at: number }).lease_expires_at, NOW.getTime() + 180000);
  assert.equal(renewMemoryJobLease(db, { ...job, lease_token: 'foreign-token' }, new Date(NOW.getTime() + 60000)), false);
  assert.equal(renewMemoryJobLease(db, job, new Date(NOW.getTime() + 180001)), false);
  forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CB });
  assert.equal(renewMemoryJobLease(db, job, new Date(NOW.getTime() + 60000)), false);
});

test('OSS-026: SQLite relationship effects keep source observation order and companion ownership', t => {
  const db = fixture(t);
  const input = { visitorId: OWNER, companionId: A, observedAt: NOW.toISOString(), fields: { emotionalTone: '松弛', keyMilestones: ['一起散步'] } };
  assert.equal(persistSqliteRelationshipSnapshot(db, input), 1);
  assert.equal(persistSqliteRelationshipSnapshot(db, { ...input, fields: { emotionalTone: '旧内容' } }), 0);
  assert.equal(persistSqliteRelationshipSnapshot(db, { ...input, observedAt: new Date(NOW.getTime() - 1000).toISOString() }), 0);
  assert.equal(persistSqliteRelationshipSnapshot(db, { ...input, observedAt: new Date(NOW.getTime() + 1000).toISOString(), fields: { keyMilestones: ['一起散步','一起看展'] } }), 1);
  const row = db.prepare('SELECT * FROM relationship_snapshots WHERE companion_id=?').get(A) as { emotional_tone: string; key_milestones: string };
  assert.equal(row.emotional_tone, '松弛'); assert.deepEqual(JSON.parse(row.key_milestones), ['一起散步','一起看展']);
  assert.throws(() => persistSqliteRelationshipSnapshot(db, { ...input, visitorId: 'not-owner' }), /owned/);
});

test('OSS-023: add cannot override the exact owner via inconsistent metadata', async t => {
  const db = fixture(t);
  await assert.rejects(gateway(db).add('用户喜欢蓝色', { userId: 'not-owner', appId: APP, metadata: meta() }), /scope|owner/);
  assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 0);
});

test('OSS-025: later hybrid configuration durably backfills facts written without credentials', async t => {
  const db = fixture(t); const fact = await add(db, '用户周五做胃镜');
  assert.equal((db.prepare('SELECT count(*) n FROM memory_jobs').get() as { n: number }).n, 0);
  const options = { organizer: { async organize() { return { operations: [] }; } }, retrievalMode: 'hybrid' as const,
    embeddingDimensions: 2, now: () => NOW, limit: 1, embed: async () => { assert.equal(db.inTransaction, false); return [[1,0]]; } };
  assert.equal((await processMemoryJobs(db, options)).completed, 1);
  const row = db.prepare('SELECT embedding_content_version,embedding FROM memories WHERE id=?').get(fact.id) as { embedding_content_version: number; embedding: Buffer };
  assert.equal(row.embedding_content_version, 1); assert.equal(row.embedding.length, 8);
  assert.equal((await processMemoryJobs(db, options)).completed, 0, 'backfill must not enqueue a completed version twice');
});

test('OSS-025: delayed embedding failure preserves facts and retries; correction fences stale completion', async t => {
  const db = fixture(t); const fact = await add(db, '用户周五做胃镜');
  let clock = NOW;
  const options = { organizer: { async organize() { return { operations: [] }; } }, retrievalMode: 'hybrid' as const,
    embeddingDimensions: 2, now: () => clock, limit: 1, embed: async (): Promise<number[][]> => { throw new Error('synthetic 429'); } };
  assert.equal((await processMemoryJobs(db, options)).failed, 1);
  assert.equal((await gateway(db).search('胃镜', filters())).length, 1);
  clock = new Date(NOW.getTime() + 5000);
  options.embed = async () => { await gateway(db).update(fact.id!, { text: '用户改为周一做检查' }); return [[1,0]]; };
  const result = await processMemoryJobs(db, options);
  assert.equal(result.completed, 0); assert.equal(result.cancelled, 1);
  const row = db.prepare('SELECT embedding,content_version FROM memories WHERE id=?').get(fact.id) as { embedding: Buffer | null; content_version: number };
  assert.equal(row.content_version, 2); assert.equal(row.embedding, null);
});

test('OSS-029: organizer model is retained on the finalized fact', async t => {
  const db = fixture(t); enqueue(db);
  await processMemoryJobs(db, { organizer: { async organize() { return plan; } }, organizerModel: 'synthetic-chat-model', now: () => NOW });
  assert.equal((db.prepare('SELECT organizer_model FROM memories WHERE memory_type=\'personal_fact\'').get() as { organizer_model: string }).organizer_model, 'synthetic-chat-model');
});

test('OSS-029: independent SQLite connections cannot double claim; a stopped claim is recoverable', t => {
  const db = fixture(t); const queued = enqueue(db);
  const restarted = new Database(db.name); restarted.pragma('foreign_keys=ON'); restarted.pragma('busy_timeout=5000');
  try {
    const first = claimMemoryJob(db, { now: NOW })!;
    assert.equal(first.id, queued.id);
    assert.equal(claimMemoryJob(restarted, { now: NOW }), null);
    const recovered = claimMemoryJob(restarted, { now: new Date(NOW.getTime() + 120001) })!;
    assert.equal(recovered.id, queued.id); assert.notEqual(recovered.lease_token, first.lease_token);
    assert.equal(renewMemoryJobLease(db, first, new Date(NOW.getTime() + 120001)), false);
  } finally { restarted.close(); }
});

test('OSS-029: backup maintenance allows the claimed finalization and pauses the next claim', async t => {
  const db = fixture(t); enqueue(db); enqueue(db);
  let leave: (() => void) | undefined;
  try {
    const result = await processMemoryJobs(db, { now: () => NOW, organizer: { async organize() {
      leave = enterMaintenance(dirname(db.name)); return plan;
    } } });
    assert.equal(result.completed, 1);
    assert.equal((db.prepare("SELECT count(*) n FROM memory_jobs WHERE state='queued'").get() as { n: number }).n, 1);
    assert.equal((await processMemoryJobs(db, { now: () => NOW, organizer: { async organize() { throw new Error('must not run'); } } })).completed, 0);
  } finally { leave?.(); }
});

test('R2/OSS-028: deleting a fact source forgets same-scope inferred descendants from other conversations', async t => {
  const db = fixture(t);
  const evidence = await add(db, '用户做胃镜很紧张');
  const inferred = await gateway(db, { retrievalMode: 'hybrid', embed: async () => [[1,0]], embeddingDimensions: 2 }).add('用户胃镜时希望被安慰', {
    userId: OWNER, appId: APP, metadata: meta({ source_conversation_id: CB, layer: 'L2', bucket: 'long_term_impression',
      confidence: 'inferred', evidence_memory_ids: [evidence.id] }) });
  const descendant = await add(db, '用户胃镜时重视持续陪伴', { source_conversation_id: CB, confidence: 'inferred', evidence_memory_ids: [inferred.id] });
  await add(db, '另一伴侣的胃镜记录', { companion_id: B, source_conversation_id: 'conversation-other' });
  persistSqliteRelationshipSnapshot(db, { visitorId: OWNER, companionId: A, observedAt: NOW.toISOString(), fields: { emotionalTone: '平静' } });
  db.prepare('INSERT INTO user_profiles VALUES (?,?)').run(OWNER, 'Asia/Shanghai');
  const result = forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CA });
  assert.equal(result.deleted, 3, 'all two-hop inferred descendants must be removed');
  assert.equal((await gateway(db).search('胃镜', filters())).length, 0);
  assert.equal((await gateway(db).search('胃镜', filters(B))).length, 1);
  assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(descendant.id), undefined);
  assert.equal((db.prepare('SELECT count(*) n FROM memory_jobs WHERE memory_id=?').get(inferred.id) as { n: number }).n, 0);
  assert.ok(db.prepare('SELECT * FROM relationship_snapshots').get(), 'relationship summary semantics stay unchanged');
  assert.ok(db.prepare('SELECT * FROM user_profiles').get(), 'profile semantics stay unchanged');
  db.prepare("INSERT INTO memories_fts(memories_fts,rank) VALUES ('integrity-check',1)").run();
});

test('R2/OSS-028: deletion closure has no top-K/status/expiry cap and handles legacy evidence cycles', async t => {
  const db = fixture(t); const evidence = await add(db, '来源里的胃镜事实');
  let parent = evidence.id!; let first = '';
  for (let i = 0; i < 70; i++) {
    const child = await add(db, `胃镜推断 ${i}`, { source_conversation_id: CB, confidence: 'inferred', evidence_memory_ids: [parent],
      ...(i % 2 ? { status: 'retired' } : { valid_until: '2026-10-01T00:00:00Z' }) });
    if (i === 0) first = child.id!;
    parent = child.id!;
  }
  // Emulate a pre-fix/corrupted cycle. New writes must reject cycles, deletion must still terminate.
  db.prepare('UPDATE memories SET evidence_memory_ids=? WHERE id=?').run(JSON.stringify([parent, first]), evidence.id);
  const result = forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CA });
  assert.equal(result.deleted, 71);
  assert.equal((db.prepare('SELECT count(*) n FROM memories WHERE companion_id=?').get(A) as { n: number }).n, 0);
  assert.equal(result.remaining, 0); assert.equal(result.exhaustive, true);
});

test('R2/OSS-026: evidence writes reject missing, malformed, cross-scope, self and cyclic IDs atomically', async t => {
  const db = fixture(t); const evidence = await add(db, '用户喜欢蓝色');
  const foreign = await add(db, '另一伴侣事实', { companion_id: B, source_conversation_id: 'conversation-other' });
  const inferredMeta = { source_conversation_id: CB, layer: 'L2', bucket: 'long_term_impression', confidence: 'inferred' };
  for (const ids of [[], ['missing-id'], [foreign.id], [evidence.id, null], [' '], evidence.id]) {
    await assert.rejects(add(db, '非法推断', { ...inferredMeta, evidence_memory_ids: ids }), /evidence/i);
  }
  const child = await add(db, '用户可能喜欢安静', { ...inferredMeta, evidence_memory_ids: [evidence.id] });
  await assert.rejects(add(db, '非法空证据形态', { evidence_memory_ids: null }), /evidence/i);
  await assert.rejects(gateway(db).update(child.id!, { text: '非法空更正', metadata: { evidence_memory_ids: null } }), /evidence/i);
  await assert.rejects(gateway(db).update(child.id!, { text: '非法自引用', metadata: { evidence_memory_ids: [child.id] } }), /evidence/i);
  await assert.rejects(gateway(db).update(evidence.id!, { text: '非法循环', metadata: { evidence_memory_ids: [child.id] } }), /evidence/i);
  await assert.rejects(gateway(db).update(child.id!, { text: '非法跨伴侣', metadata: { evidence_memory_ids: [foreign.id] } }), /evidence/i);
  assert.equal((db.prepare('SELECT content FROM memories WHERE id=?').get(child.id) as { content: string }).content, '用户可能喜欢安静');
  assert.equal((await gateway(db).search('非法', filters())).length, 0);
});

test('R2/OSS-028/029: another-source deletion fences an old inference job and rejects its deleted evidence after retry', async t => {
  const db = fixture(t); const evidence = await add(db, '用户做胃镜时紧张');
  enqueue(db, { conversationId: CB, userText: '胃镜' });
  let clock = NOW; let calls = 0;
  const inferredPlan: MemoryPlan = { operations: [{ action: 'ADD', text: '用户胃镜时想被安慰', layer: 'L2', bucket: 'long_term_impression',
    domain: 'support', memoryType: 'preference', confidence: 'inferred', importance: .8, evidenceMemoryIds: [evidence.id!], reason: '合成推断' }] };
  const options = { now: () => clock, limit: 1, organizer: { async organize() {
    if (++calls === 1) {
      forgetSqliteConversationMemories(db, { visitorId: OWNER, companionId: A, conversationId: CA });
      db.prepare('DELETE FROM conversations WHERE id=?').run(CA);
    }
    return inferredPlan;
  } } };
  assert.equal((await processMemoryJobs(db, options)).completed, 0);
  clock = new Date(NOW.getTime() + 5000);
  assert.equal((await processMemoryJobs(db, options)).completed, 0, 'stale evidence must not finalize after a legitimate source retry');
  assert.equal((db.prepare('SELECT count(*) n FROM memories WHERE companion_id=?').get(A) as { n: number }).n, 0);
  assert.equal((await gateway(db).search('胃镜', filters())).length, 0);
});

test('R2/OSS-028: direct gateway delete removes scoped descendants and their jobs, including inactive evidence links', async t => {
  const db = fixture(t); const evidence = await add(db, '用户胃镜时紧张');
  const inferred = await gateway(db, { retrievalMode: 'hybrid', embed: async () => [[1, 0]] }).add('用户胃镜时希望被安慰', {
    userId: OWNER, appId: APP, metadata: meta({ source_conversation_id: CB, confidence: 'inferred',
      evidence_memory_ids: [evidence.id], status: 'retired', valid_until: '2026-10-01T00:00:00Z' }) });
  const descendant = await add(db, '用户胃镜时需要陪伴', { source_conversation_id: CB,
    confidence: 'inferred', evidence_memory_ids: [inferred.id] });
  const unrelated = await add(db, '用户喜欢蓝色', { source_conversation_id: CB });
  const foreign = await add(db, '另一个伴侣的胃镜记录', { companion_id: B, source_conversation_id: 'conversation-other' });
  // Existing malformed cross-scope provenance must never widen a deletion scope.
  db.prepare('UPDATE memories SET evidence_memory_ids=? WHERE id=?').run(JSON.stringify([evidence.id]), foreign.id);
  persistSqliteRelationshipSnapshot(db, { visitorId: OWNER, companionId: A, observedAt: NOW.toISOString(), fields: { emotionalTone: '平静' } });
  db.prepare('INSERT INTO user_profiles VALUES (?,?)').run(OWNER, 'Asia/Shanghai');
  const scope = { visitorId: OWNER, companionId: A };
  const store = createSqliteRecallSnapshotStore(db, scope); await store.read();
  await store.write({ memories: [], refreshedAt: NOW.toISOString(), turnsSinceRefresh: 0 });
  const revision = memoryScopeRevision(db, scope);
  assert.throws(() => deleteSqliteMemoryEvidenceClosure(db, scope, [evidence.id!, foreign.id!]), /outside scope/i);
  assert.throws(() => deleteSqliteMemoryEvidenceClosure(db, scope, [evidence.id!, 'missing-id']), /missing/i);
  assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(evidence.id), 'invalid mixed targets must roll back before any deletion');
  assert.equal(memoryScopeRevision(db, scope), revision);
  await gateway(db).delete(evidence.id!);
  assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(inferred.id), undefined, 'direct delete must remove inactive inferred descendants');
  assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(descendant.id), undefined, 'transitive active descendants must also disappear');
  assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(unrelated.id));
  assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(foreign.id));
  assert.equal((db.prepare('SELECT count(*) n FROM memory_jobs WHERE memory_id=?').get(inferred.id) as { n: number }).n, 0);
  assert.equal(memoryScopeRevision(db, scope), revision + 1);
  await assert.rejects(store.write({ memories: [], refreshedAt: NOW.toISOString(), turnsSinceRefresh: 0 }), /invalidated/i);
  assert.equal(await createSqliteRecallSnapshotStore(db, scope).read(), null);
  assert.equal((await gateway(db).search('胃镜', filters())).length, 0);
  assert.equal((await gateway(db).search('胃镜', filters(B))).length, 1);
  assert.ok(db.prepare('SELECT * FROM relationship_snapshots').get());
  assert.ok(db.prepare('SELECT * FROM user_profiles').get());
  db.prepare("INSERT INTO memories_fts(memories_fts,rank) VALUES ('integrity-check',1)").run();
});

test('R2/OSS-028/029: organizer DELETE uses the same evidence closure and commits completion atomically', async t => {
  const db = fixture(t); const evidence = await add(db, '用户胃镜时紧张');
  const inferred = await add(db, '用户胃镜时需要安慰', { source_conversation_id: CB, layer: 'L2', bucket: 'long_term_impression',
    memory_type: 'preference_summary', domain: 'support', confidence: 'inferred', evidence_memory_ids: [evidence.id] });
  const descendant = await add(db, '用户胃镜时需要持续陪伴', { source_conversation_id: CB, confidence: 'inferred', evidence_memory_ids: [inferred.id] });
  const foreign = await add(db, '另一个伴侣的胃镜', { companion_id: B, source_conversation_id: 'conversation-other' });
  const job = enqueue(db, { conversationId: CB, userText: '胃镜' });
  const result = await processMemoryJobs(db, { now: () => NOW, limit: 1, organizer: { async organize() {
    assert.equal(db.inTransaction, false);
    return { operations: [{ action: 'DELETE', memoryId: evidence.id, reason: '合成删除' }] };
  } } });
  assert.equal(result.completed, 1);
  assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(inferred.id), undefined, 'worker delete must remove inferred descendants');
  assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(descendant.id), undefined);
  assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(foreign.id));
  assert.equal((db.prepare('SELECT state FROM memory_jobs WHERE id=?').get(job.id) as { state: string }).state, 'completed');
  assert.equal((await gateway(db).search('胃镜', filters())).length, 0);
});

test('R2/OSS-029: a deletion closure overlapping a later mutation rolls back the whole plan and retries safely', async t => {
  for (const nextAction of ['DELETE', 'UPDATE'] as const) {
    const db = fixture(t); const evidence = await add(db, '用户胃镜时紧张');
    const inferred = await add(db, '用户胃镜时需要安慰', { source_conversation_id: CB, layer: 'L2', bucket: 'long_term_impression',
      memory_type: 'preference_summary', domain: 'support', confidence: 'inferred', evidence_memory_ids: [evidence.id] });
    const recalled = await createMemoryService({ enabled: true, appId: APP, gateway: gateway(db), now: () => NOW,
      organizer: { async organize() { return { operations: [] }; } } }).recall({ visitorId: OWNER, companionId: A, query: '胃镜' });
    assert.deepEqual(new Set(recalled.map(memory => memory.id)), new Set([evidence.id, inferred.id]), 'both mutation targets must be valid recalled domain memories');
    const scope = { visitorId: OWNER, companionId: A };
    const snapshot = createSqliteRecallSnapshotStore(db, scope); await snapshot.read();
    await snapshot.write({ memories: [], refreshedAt: NOW.toISOString(), turnsSinceRefresh: 0 });
    const revision = memoryScopeRevision(db, scope);
    const job = enqueue(db, { conversationId: CB, userText: '胃镜' });
    let plannedTargets: string[] = [];
    const result = await processMemoryJobs(db, { now: () => NOW, limit: 1, organizer: { async organize(input) {
      plannedTargets = input.existingMemories.map(memory => memory.id);
      return { operations: [{ action: 'DELETE', memoryId: evidence.id, reason: '合成删除' },
        { action: nextAction, memoryId: inferred.id, text: '用户胃镜时需要耐心安慰', reason: '合成冲突' }],
      relationshipSnapshot: { emotionalTone: '不应提交的关系状态' } };
    } } });
    assert.deepEqual(new Set(plannedTargets), new Set([evidence.id, inferred.id]), 'one queued task must still recall both mutation targets');
    assert.equal(result.completed, 0, `${nextAction} of a closure-deleted target must not complete`);
    assert.equal(result.failed, 1);
    assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(evidence.id), 'first deletion must roll back');
    assert.equal((db.prepare('SELECT content FROM memories WHERE id=?').get(inferred.id) as { content: string }).content, '用户胃镜时需要安慰');
    assert.equal(memoryScopeRevision(db, scope), revision);
    assert.ok(await createSqliteRecallSnapshotStore(db, scope).read(), 'snapshot invalidation must roll back');
    assert.equal(db.prepare('SELECT * FROM relationship_snapshots').get(), undefined);
    assert.equal((db.prepare('SELECT state,last_error FROM memory_jobs WHERE id=?').get(job.id) as { state: string }).state, 'queued');
    // A valid retry may submit the root deletion alone, once, from a fresh claim.
    const retried = await processMemoryJobs(db, { now: () => new Date(NOW.getTime() + 5000), limit: 1,
      organizer: { async organize() { return { operations: [{ action: 'DELETE', memoryId: evidence.id, reason: '合成重试' }] }; } } });
    assert.equal(retried.completed, 1);
    assert.equal((db.prepare('SELECT count(*) n FROM memories').get() as { n: number }).n, 0);
  }
});

test('OSS-027/029: queue batch limit does not reduce the organizer recall budget or weaken eligibility', async t => {
  const db = fixture(t); const eligible = new Set<string>();
  for (let i = 0; i < RECALL_LIMIT_DEFAULT + 5; i++) eligible.add((await add(db, `用户胃镜事实 ${i}`)).id!);
  const expired = await add(db, '用户胃镜过期事实', { valid_until: '2026-10-01T00:00:00Z' });
  const retired = await add(db, '用户胃镜退役事实', { status: 'retired' });
  const foreign = await add(db, '另一个伴侣的胃镜事实', { companion_id: B, source_conversation_id: 'conversation-other' });
  const baseline = await createMemoryService({ enabled: true, appId: APP, gateway: gateway(db), now: () => NOW,
    organizer: { async organize() { return { operations: [] }; } } }).recall({ visitorId: OWNER, companionId: A, query: '胃镜' });
  assert.equal(baseline.length, RECALL_LIMIT_DEFAULT);
  enqueue(db, { userText: '胃镜' }); enqueue(db, { userText: '胃镜' });
  let calls = 0; let observed: string[] = [];
  const outcome = await processMemoryJobs(db, { now: () => NOW, limit: 1, organizer: { async organize(input) {
    calls++; observed = input.existingMemories.map(memory => memory.id); return { operations: [] };
  } } });
  assert.equal(outcome.completed, 1); assert.equal(calls, 1, 'queue limit still caps claimed tasks');
  assert.equal((db.prepare("SELECT count(*) n FROM memory_jobs WHERE state='queued'").get() as { n: number }).n, 1);
  assert.equal(observed.length, RECALL_LIMIT_DEFAULT, 'one task must retain the normal memory recall budget');
  assert.deepEqual(new Set(observed), new Set(baseline.map(memory => memory.id)));
  assert.ok(observed.every(id => eligible.has(id)));
  assert.ok(!observed.includes(expired.id!) && !observed.includes(retired.id!) && !observed.includes(foreign.id!));
});

test('R2/OSS-029: expired or replaced organizer leases cannot commit a deletion closure or relationship effects', async t => {
  for (const fence of ['expired', 'replaced'] as const) {
    const db = fixture(t); const evidence = await add(db, '用户胃镜时紧张');
    const inferred = await add(db, '用户胃镜时需要安慰', { source_conversation_id: CB, confidence: 'inferred', evidence_memory_ids: [evidence.id] });
    const job = enqueue(db, { conversationId: CB, userText: '胃镜' });
    const scope = { visitorId: OWNER, companionId: A }; const revision = memoryScopeRevision(db, scope);
    let clock = NOW;
    const result = await processMemoryJobs(db, { now: () => clock, limit: 1, organizer: { async organize() {
      if (fence === 'expired') clock = new Date(NOW.getTime() + 120001);
      else db.prepare('UPDATE memory_jobs SET lease_token=? WHERE id=?').run('replacement-token', job.id);
      return { operations: [{ action: 'DELETE', memoryId: evidence.id, reason: '合成删除' }],
        relationshipSnapshot: { emotionalTone: '不应提交的关系状态' } };
    } } });
    assert.equal(result.completed, 0);
    assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(evidence.id));
    assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(inferred.id));
    assert.equal(memoryScopeRevision(db, scope), revision);
    assert.equal(db.prepare('SELECT * FROM relationship_snapshots').get(), undefined);
    assert.notEqual((db.prepare('SELECT state FROM memory_jobs WHERE id=?').get(job.id) as { state: string }).state, 'completed');
  }
});
