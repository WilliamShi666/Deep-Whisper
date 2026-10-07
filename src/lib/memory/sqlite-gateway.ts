import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { assertInstanceOwnership } from '@/lib/personal/instance-lock';
import type Database from 'better-sqlite3';
import type { MemoryGateway, ProviderMemory } from './service';

export const PERSONAL_MEMORY_APP_ID = 'deep-whisper:personal:v1';
export type MemoryEmbed = (request: { texts: readonly string[] }) => Promise<number[][]>;
export interface SqliteMemoryOptions {
  appId?: string;
  retrievalMode?: 'keyword' | 'hybrid';
  embed?: MemoryEmbed;
  embeddingModel?: string;
  embeddingDimensions?: number;
  organizerModel?: string;
  now?: () => Date;
  limit?: number;
}
export interface SqliteMemoryScope { visitorId: string; companionId: string; appId?: string }

/** Shared index/query tokenization. Index repetitions are intentionally retained. */
export function memoryTokens(text: string): string[] {
  const runs = text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
  return runs.flatMap((run) => {
    if (/^[a-z0-9]+$/.test(run)) return [run];
    const chars = [...run];
    return chars.length === 1 ? chars : chars.slice(0, -1).map((char, i) => char + chars[i + 1]);
  });
}
export function indexMemoryTokens(text: string): string { return memoryTokens(text).join(' '); }
export function memoryMatchQuery(text: string): string | null {
  const terms = [...new Set(memoryTokens(text))].slice(-128);
  return terms.length ? terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ') : null;
}

interface MemoryRow {
  id: string; visitor_id: string; companion_id: string; content: string; layer: string;
  bucket: string; domain: string; memory_type: string; importance: number; confidence: string;
  status: string; temporal_status: string | null; occurred_at: number | null; observed_at: number;
  time_precision: string | null; valid_until: number | null; evidence_memory_ids: string;
  source_user_message_id: string | null; source_assistant_message_id: string | null;
  organizer_model: string | null; organizer_reason: string | null; created_at: number; updated_at: number;
  content_version: number; embedding: Buffer | null; embedding_model: string | null;
  embedding_dimensions: number | null; embedding_content_version: number | null;
  sources: string; score?: number;
}
const ROW_SELECT = `m.*, (SELECT json_group_array(s.conversation_id) FROM memory_sources s WHERE s.memory_id=m.id) AS sources`;
const iso = (value: number | null) => value === null ? null : new Date(value).toISOString();
function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === 'string' && !!x.trim()))] : [];
}
function time(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error('Memory timestamp must be valid');
  return parsed;
}
function jsonArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) throw new Error('Invalid memory array');
  return parsed;
}
function providerRow(row: MemoryRow, appId: string): ProviderMemory {
  const sources = jsonArray(row.sources);
  return { id: row.id, memory: row.content, score: row.score, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    metadata: { app_id: appId, visitor_id: row.visitor_id, companion_id: row.companion_id,
      layer: row.layer, bucket: row.bucket, domain: row.domain, memory_type: row.memory_type,
      importance: row.importance, confidence: row.confidence, status: row.status,
      temporal_status: row.temporal_status, occurred_at: iso(row.occurred_at), observed_at: iso(row.observed_at),
      time_precision: row.time_precision, valid_until: iso(row.valid_until), evidence_memory_ids: jsonArray(row.evidence_memory_ids),
      source_conversation_id: sources.length === 1 ? sources[0] : sources,
      source_user_message_id: row.source_user_message_id, source_assistant_message_id: row.source_assistant_message_id,
      organizer_model: row.organizer_model, organizer_reason: row.organizer_reason } };
}
export function assertSqliteMemoryScope(db: Database.Database, scope: SqliteMemoryScope): void {
  assertInstanceOwnership(dirname(db.name));
  if (!scope.visitorId || !scope.companionId || !db.prepare('SELECT id FROM companions WHERE id=? AND visitor_id=?').get(scope.companionId, scope.visitorId)) {
    throw new Error('Memory requires an owned visitor and companion scope');
  }
}
function evidenceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim())) {
    throw new Error('Memory evidence must be an array of nonempty exact IDs');
  }
  return [...new Set(value)] as string[];
}
/** Read the whole scope once: deletion is independent of retrieval top-K, status and expiry. */
function evidenceGraph(db: Database.Database, scope: SqliteMemoryScope) {
  const rows = db.prepare('SELECT id,evidence_memory_ids FROM memories WHERE visitor_id=? AND companion_id=?')
    .all(scope.visitorId, scope.companionId) as Array<{ id: string; evidence_memory_ids: string }>;
  return new Map(rows.map(row => [row.id, evidenceIds(JSON.parse(row.evidence_memory_ids))]));
}
/** Transitive reverse-evidence closure; a visited set also handles existing cycles. */
export function sqliteMemoryEvidenceDeletionClosure(db: Database.Database, scope: SqliteMemoryScope, seeds: readonly string[]): string[] {
  const graph = evidenceGraph(db, scope);
  const children = new Map<string, string[]>();
  for (const [child, parents] of graph) for (const parent of parents) {
    const list = children.get(parent) ?? []; list.push(child); children.set(parent, list);
  }
  const found = new Set(seeds.filter(id => graph.has(id)));
  const queue = [...found];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
    if (!found.has(child)) { found.add(child); queue.push(child); }
  }
  return [...found];
}
function validateMemoryEvidence(db: Database.Database, scope: SqliteMemoryScope, id: string, metadata: {
  evidence_memory_ids?: unknown; confidence?: unknown; bucket?: unknown;
}): string[] {
  const ids = evidenceIds(metadata.evidence_memory_ids === undefined ? [] : metadata.evidence_memory_ids);
  if (metadata.confidence === 'inferred' && metadata.bucket === 'long_term_impression' && !ids.length) {
    throw new Error('Inferred impression requires memory evidence');
  }
  if (!ids.length) return ids;
  const owned = db.prepare(`SELECT id FROM memories WHERE visitor_id=? AND companion_id=? AND id IN (SELECT value FROM json_each(?))`)
    .all(scope.visitorId, scope.companionId, JSON.stringify(ids)) as Array<{ id: string }>;
  if (owned.length !== ids.length || ids.includes(id)) throw new Error('Memory evidence is missing, self-referencing or outside scope');
  // Proposed row -> parents must not reach the row again. Walk ancestors once,
  // even if old imported rows already contain a cycle unrelated to this update.
  const graph = evidenceGraph(db, scope);
  const visited = new Set<string>(); const queue = [...ids];
  for (let i = 0; i < queue.length; i++) {
    const parent = queue[i];
    if (parent === id) throw new Error('Memory evidence cycle is not allowed');
    if (visited.has(parent)) continue;
    visited.add(parent); queue.push(...graph.get(parent) ?? []);
  }
  return ids;
}
export function memoryScopeRevision(db: Database.Database, scope: SqliteMemoryScope): number {
  assertSqliteMemoryScope(db, scope);
  db.prepare('INSERT INTO memory_scope_versions(visitor_id,companion_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(scope.visitorId, scope.companionId);
  return (db.prepare('SELECT revision FROM memory_scope_versions WHERE visitor_id=? AND companion_id=?').get(scope.visitorId, scope.companionId) as { revision: number }).revision;
}
export function invalidateSqliteMemorySnapshot(db: Database.Database, scope: SqliteMemoryScope): void {
  memoryScopeRevision(db, scope);
  db.prepare('UPDATE memory_scope_versions SET revision=revision+1 WHERE visitor_id=? AND companion_id=?').run(scope.visitorId, scope.companionId);
  db.prepare('DELETE FROM memory_recall_snapshots WHERE visitor_id=? AND companion_id=?').run(scope.visitorId, scope.companionId);
}
/**
 * Every deletion entry point shares this scoped, exhaustive evidence closure.
 * Nested callers retain their enclosing transaction: FTS/source/embedding-job
 * cascades and the epoch change roll back with any later mutation conflict.
 * Empty seeds still fence pending work when a source conversation is forgotten.
 */
export function deleteSqliteMemoryEvidenceClosure(db: Database.Database, scope: SqliteMemoryScope, seeds: readonly string[]) {
  return db.transaction(() => {
    assertSqliteMemoryScope(db, scope);
    const exactSeeds = evidenceIds([...seeds]);
    const owned = db.prepare(`SELECT id FROM memories WHERE visitor_id=? AND companion_id=?
      AND id IN (SELECT value FROM json_each(?))`).all(scope.visitorId, scope.companionId, JSON.stringify(exactSeeds));
    if (owned.length !== exactSeeds.length) throw new Error('Memory deletion target is missing or outside scope');
    const ids = sqliteMemoryEvidenceDeletionClosure(db, scope, exactSeeds);
    const deleted = db.prepare(`DELETE FROM memories WHERE visitor_id=? AND companion_id=?
      AND id IN (SELECT value FROM json_each(?))`).run(scope.visitorId, scope.companionId, JSON.stringify(ids)).changes;
    const revision = memoryScopeRevision(db, scope) + 1;
    invalidateSqliteMemorySnapshot(db, scope);
    return { deleted, ids, revision };
  }).immediate();
}
function sourceIds(db: Database.Database, id: string, scope: SqliteMemoryScope, sources: unknown): void {
  for (const source of stringArray(sources)) {
    if (!db.prepare('SELECT id FROM conversations WHERE id=? AND visitor_id=? AND companion_id=?').get(source, scope.visitorId, scope.companionId)) throw new Error('Memory source conversation is not owned or no longer exists');
    db.prepare('INSERT INTO memory_sources(memory_id,conversation_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(id, source);
  }
}
export function enqueueSqliteMemoryEmbedding(db: Database.Database, row: { id: string; visitorId: string; companionId: string; version: number }, now: number): void {
  db.prepare(`INSERT INTO memory_jobs(id,kind,visitor_id,companion_id,memory_id,content_version,payload,state,next_attempt_at,scope_revision,created_at,updated_at)
    VALUES (?,'embedding',?,?,?,?,'{}','queued',?,?,?,?) ON CONFLICT DO NOTHING`)
    .run(randomUUID(), row.visitorId, row.companionId, row.id, row.version, now,
      memoryScopeRevision(db, row), now, now);
}
export function persistSqliteMemory(db: Database.Database, text: string, options: {
  userId: string; appId: string; metadata: Record<string, unknown>; expirationDate?: string;
}, settings: { id?: string; now?: Date; enqueueEmbedding?: boolean } = {}): ProviderMemory {
  const metadata = options.metadata;
  if (metadata.visitor_id !== undefined && metadata.visitor_id !== options.userId) throw new Error('Memory owner scope mismatch');
  const scope = { visitorId: typeof metadata.visitor_id === 'string' ? metadata.visitor_id : options.userId,
    companionId: typeof metadata.companion_id === 'string' ? metadata.companion_id : '' };
  const id = settings.id ?? randomUUID();
  const now = (settings.now ?? new Date()).getTime();
  return db.transaction(() => {
    assertSqliteMemoryScope(db, scope);
    const evidence = validateMemoryEvidence(db, scope, id, metadata);
    db.prepare(`INSERT INTO memories(id,visitor_id,companion_id,content,search_tokens,layer,bucket,domain,memory_type,importance,
      confidence,status,temporal_status,occurred_at,observed_at,time_precision,valid_until,evidence_memory_ids,
      source_user_message_id,source_assistant_message_id,organizer_model,organizer_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, scope.visitorId, scope.companionId,
      text, indexMemoryTokens(text), metadata.layer, metadata.bucket, metadata.domain, metadata.memory_type,
      metadata.importance, metadata.confidence, metadata.status ?? 'active', metadata.temporal_status ?? 'timeless',
      time(metadata.occurred_at), time(metadata.observed_at, now), metadata.time_precision ?? null,
      time(options.expirationDate ?? metadata.valid_until), JSON.stringify(evidence),
      metadata.source_user_message_id ?? null, metadata.source_assistant_message_id ?? null,
      metadata.organizer_model ?? null, metadata.organizer_reason ?? null, now, now);
    sourceIds(db, id, scope, metadata.source_conversation_id);
    invalidateSqliteMemorySnapshot(db, scope);
    if (settings.enqueueEmbedding) enqueueSqliteMemoryEmbedding(db, { id, ...scope, version: 1 }, now);
    return providerRow(db.prepare(`SELECT ${ROW_SELECT} FROM memories m WHERE id=?`).get(id) as MemoryRow, options.appId);
  }).immediate();
}

export function updateSqliteMemory(db: Database.Database, id: string, update: { text?: string; metadata?: Record<string, unknown>; expirationDate?: string | null },
  settings: { now?: Date; enqueueEmbedding?: boolean } = {}): void {
  db.transaction(() => {
    const row = db.prepare('SELECT * FROM memories WHERE id=?').get(id) as MemoryRow | undefined;
    if (!row) throw new Error('Memory no longer exists');
    const metadata = update.metadata ?? {};
    const evidence = validateMemoryEvidence(db, { visitorId: row.visitor_id, companionId: row.companion_id }, id, {
      evidence_memory_ids: metadata.evidence_memory_ids === undefined ? JSON.parse(row.evidence_memory_ids) : metadata.evidence_memory_ids,
      confidence: metadata.confidence ?? row.confidence, bucket: metadata.bucket ?? row.bucket,
    });
    const assignments: string[] = [];
    const values: unknown[] = [];
    const set = (key: string, value: unknown) => { assignments.push(`${key}=?`); values.push(value); };
    const now = (settings.now ?? new Date()).getTime();
    if (update.text !== undefined) {
      set('content', update.text); set('search_tokens', indexMemoryTokens(update.text));
      assignments.push('content_version=content_version+1', 'embedding=NULL', 'embedding_model=NULL',
        'embedding_dimensions=NULL', 'embedding_content_version=NULL');
      db.prepare("UPDATE memory_jobs SET state='cancelled',updated_at=? WHERE memory_id=? AND kind='embedding' AND state IN ('queued','running','failed')").run(now, id);
    }
    for (const key of ['layer','bucket','domain','memory_type','importance','confidence','status','temporal_status','time_precision',
      'source_user_message_id','source_assistant_message_id','organizer_model','organizer_reason']) {
      if (metadata[key] !== undefined) set(key, metadata[key]);
    }
    for (const key of ['occurred_at', 'observed_at']) if (metadata[key] !== undefined) set(key, time(metadata[key]));
    const until = update.expirationDate !== undefined ? update.expirationDate : metadata.valid_until;
    if (until !== undefined) set('valid_until', time(until));
    if (metadata.evidence_memory_ids !== undefined) set('evidence_memory_ids', JSON.stringify(evidence));
    set('updated_at', now);
    db.prepare(`UPDATE memories SET ${assignments.join(',')} WHERE id=?`).run(...values, id);
    sourceIds(db, id, { visitorId: row.visitor_id, companionId: row.companion_id }, metadata.source_conversation_id);
    invalidateSqliteMemorySnapshot(db, { visitorId: row.visitor_id, companionId: row.companion_id });
    if (update.text !== undefined && settings.enqueueEmbedding) enqueueSqliteMemoryEmbedding(db, { id, visitorId: row.visitor_id, companionId: row.companion_id, version: row.content_version + 1 }, now);
  }).immediate();
}
export function setSqliteMemoryEmbedding(db: Database.Database, input: { id: string; contentVersion: number; vector: readonly number[]; model: string; dimensions: number }): boolean {
  if (input.vector.length !== input.dimensions || input.dimensions < 1 || input.vector.some((x) => !Number.isFinite(Math.fround(x)))
    || !input.vector.some((x) => Math.fround(x) !== 0)) throw new Error('Invalid embedding vector');
  const vector = Buffer.alloc(input.dimensions * 4);
  input.vector.forEach((x, i) => vector.writeFloatLE(x, i * 4));
  return db.prepare(`UPDATE memories SET embedding=?,embedding_model=?,embedding_dimensions=?,embedding_content_version=?
    WHERE id=? AND content_version=?`).run(vector, input.model, input.dimensions, input.contentVersion, input.id, input.contentVersion).changes === 1;
}
function cosine(blob: Buffer, query: readonly number[]): number | null {
  if (blob.length !== query.length * 4) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < query.length; i++) {
    const value = blob.readFloatLE(i * 4);
    if (!Number.isFinite(value) || !Number.isFinite(query[i])) return null;
    dot += value * query[i]; aa += value * value; bb += query[i] * query[i];
  }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : null;
}
export function createSqliteMemoryGateway(db: Database.Database, options: SqliteMemoryOptions = {}): MemoryGateway {
  const appId = options.appId ?? PERSONAL_MEMORY_APP_ID;
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 30;
  const model = options.embeddingModel ?? 'text-embedding-v4';
  const dimensions = options.embeddingDimensions ?? 1024;
  const needsEmbedding = options.retrievalMode === 'hybrid' && !!options.embed;
  function scope(filters: Record<string, unknown>): SqliteMemoryScope {
    const clauses = Array.isArray(filters.AND) ? filters.AND : [filters];
    let visitorId = '', companionId = '', namespace = '';
    for (const item of clauses) {
      if (!item || typeof item !== 'object') continue;
      const clause = item as Record<string, unknown>;
      if (typeof clause.user_id === 'string') visitorId = clause.user_id;
      if (typeof clause.app_id === 'string') namespace = clause.app_id;
      if (clause.metadata && typeof clause.metadata === 'object') {
        const companion = (clause.metadata as Record<string, unknown>).companion_id;
        if (typeof companion === 'string') companionId = companion;
      }
    }
    if (!visitorId || !companionId || namespace !== appId) throw new Error('Memory search requires exact visitor, companion and app scope');
    assertSqliteMemoryScope(db, { visitorId, companionId });
    return { visitorId, companionId, appId: namespace };
  }
  function list(request: SqliteMemoryScope, condition: string, params: unknown[] = [], suffix = ''): ProviderMemory[] {
    assertSqliteMemoryScope(db, request);
    if (request.appId && request.appId !== appId) throw new Error('Memory namespace mismatch');
    return (db.prepare(`SELECT ${ROW_SELECT} FROM memories m WHERE visitor_id=? AND companion_id=? ${condition} ${suffix}`)
      .all(request.visitorId, request.companionId, ...params) as MemoryRow[]).map((row) => providerRow(row, appId));
  }
  return {
    async search(query, filters) {
      const owner = scope(filters);
      const match = memoryMatchQuery(query);
      let queryVector: number[] | null = null;
      if (needsEmbedding) {
        try {
          const [vector] = await options.embed!({ texts: [query] });
          if (!vector || vector.length !== dimensions || vector.some((x) => !Number.isFinite(x)) || !vector.some((x) => x !== 0)) throw new Error('Invalid query embedding');
          queryVector = vector;
        } catch { console.warn('[memory:embedding] query unavailable; using keyword retrieval'); }
      }
      const at = now().getTime();
      // CROSS JOIN keeps FTS MATCH as the outer scan. An owner-index-first plan
      // repeats the virtual-table scan for every memory and grows quadratically.
      const keyword = match ? db.prepare(`SELECT ${ROW_SELECT},bm25(memories_fts) AS keyword_rank FROM memories_fts
        CROSS JOIN memories m ON m.rowid=memories_fts.rowid WHERE memories_fts MATCH ? AND visitor_id=? AND companion_id=?
        AND status='active' AND (valid_until IS NULL OR valid_until>?) ORDER BY bm25(memories_fts),m.id LIMIT 48`)
        .all(match, owner.visitorId, owner.companionId, at) as MemoryRow[] : [];
      const vectors = queryVector ? (db.prepare(`SELECT ${ROW_SELECT} FROM memories m WHERE visitor_id=? AND companion_id=?
        AND status='active' AND (valid_until IS NULL OR valid_until>?) AND embedding_model=? AND embedding_dimensions=?
        AND embedding_content_version=content_version AND embedding IS NOT NULL`)
        .all(owner.visitorId, owner.companionId, at, model, dimensions) as MemoryRow[])
        .flatMap((row) => { const score = cosine(row.embedding!, queryVector!); return score === null ? [] : [{ ...row, score }]; })
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 48) : [];
      const candidates = new Map<string, { row: MemoryRow; fused: number }>();
      vectors.forEach((row, i) => candidates.set(row.id, { row, fused: 1 / (61 + i) }));
      keyword.forEach((row, i) => {
        const old = candidates.get(row.id);
        candidates.set(row.id, { row: old?.row ?? row, fused: (old?.fused ?? 0) + 1 / (61 + i) });
      });
      return [...candidates.values()].sort((a, b) => b.fused - a.fused || a.row.id.localeCompare(b.row.id))
        .slice(0, limit).map(({ row }) => providerRow(row, appId));
    },
    async add(text, write) {
      if (write.appId !== appId) throw new Error('Memory namespace mismatch');
      return persistSqliteMemory(db, text, write, { now: now(), enqueueEmbedding: needsEmbedding });
    },
    async update(id, update) { updateSqliteMemory(db, id, update, { now: now(), enqueueEmbedding: needsEmbedding }); },
    async delete(id) {
      db.transaction(() => {
        const row = db.prepare('SELECT visitor_id,companion_id FROM memories WHERE id=?').get(id) as { visitor_id: string; companion_id: string } | undefined;
        if (row) {
          deleteSqliteMemoryEvidenceClosure(db, { visitorId: row.visitor_id, companionId: row.companion_id }, [id]);
        }
      }).immediate();
    },
    async getById(id, request) { return list(request, "AND id=? AND status='active' AND (valid_until IS NULL OR valid_until>?)", [id, now().getTime()])[0] ?? null; },
    async listBySourceConversation(request) { return list(request, 'AND EXISTS(SELECT 1 FROM memory_sources s WHERE s.memory_id=m.id AND s.conversation_id=?)', [request.conversationId]); },
    async countUnattributableMemories(request) {
      assertSqliteMemoryScope(db, request);
      return (db.prepare(`SELECT count(*) n FROM memories m WHERE visitor_id=? AND companion_id=? AND NOT EXISTS(SELECT 1 FROM memory_sources s WHERE s.memory_id=m.id)`)
        .get(request.visitorId, request.companionId) as { n: number }).n;
    },
    async listAvoidTopics(request) { return list(request, "AND status='active' AND memory_type='avoid_topic' AND (valid_until IS NULL OR valid_until>?)", [now().getTime()], 'ORDER BY observed_at,id'); },
    async listCommunicationPreferences(request) {
      const memories = list(request, "AND status='active' AND memory_type='communication_style' AND (valid_until IS NULL OR valid_until>?) AND (? IS NULL OR id>?)",
        [now().getTime(), request.cursor ?? null, request.cursor ?? null], 'ORDER BY id LIMIT 51');
      return { memories: memories.slice(0, 50), nextCursor: memories.length > 50 ? memories[49].id : null };
    },
  };
}
