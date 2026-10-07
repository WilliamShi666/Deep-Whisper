import { communicationFeedbackMemoryText } from '@/lib/prompts/zh';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { maintenanceActive } from '@/lib/personal/maintenance';
import { assertInstanceOwnership, InstanceOwnershipLost } from '@/lib/personal/instance-lock';
import { createMemoryService, type MemoryGateway, type MemoryOrganizer, type MemoryOrganizerTurn, type RelationshipSnapshotUpdate } from './service';
import { persistSqliteRelationshipSnapshot, normalizeSnapshotUpdate } from './relationship-snapshot';
import { filterFeedbackBySource } from './feedback-source';
import { toLocalIso, resolveUserTimeZone } from './time-source';
import { createSqliteMemoryGateway, memoryScopeRevision, persistSqliteMemory, updateSqliteMemory,
  setSqliteMemoryEmbedding, deleteSqliteMemoryEvidenceClosure, PERSONAL_MEMORY_APP_ID, type SqliteMemoryOptions } from './sqlite-gateway';
import { enqueueSqliteMemoryEmbedding } from './sqlite-gateway';
export interface OrganizerJobInput {
  visitorId: string; companionId: string; conversationId: string;
  userMessageId: string; userText: string; assistantMessageId: string; assistantText: string;
  observedAt: string; recentTurns?: MemoryOrganizerTurn[];
}
export function enqueueOrganizerJob(db: Database.Database, input: OrganizerJobInput): string {
  if (!Number.isFinite(Date.parse(input.observedAt)) || !input.userText.trim()) throw new Error('Invalid organizer exchange');
  const source = db.prepare('SELECT id FROM conversations WHERE id=? AND visitor_id=? AND companion_id=?')
    .get(input.conversationId, input.visitorId, input.companionId);
  const assistant = db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=? AND role='assistant'")
    .get(input.assistantMessageId, input.conversationId);
  const user = db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=? AND role='user'")
    .get(input.userMessageId, input.conversationId);
  if (!source || !assistant || !user) throw new Error('Organizer source must be an owned persisted exchange');
  const id = randomUUID();
  const at = Date.parse(input.observedAt);
  db.prepare(`INSERT INTO memory_jobs(id,kind,visitor_id,companion_id,conversation_id,assistant_message_id,payload,state,
    next_attempt_at,scope_revision,created_at,updated_at) VALUES (?,'organize',?,?,?,?,?,'queued',?,?,?,?) ON CONFLICT DO NOTHING`)
    .run(id, input.visitorId, input.companionId, input.conversationId, input.assistantMessageId,
      JSON.stringify(input), at, memoryScopeRevision(db, input), at, at);
  return (db.prepare("SELECT id FROM memory_jobs WHERE kind='organize' AND assistant_message_id=?").get(input.assistantMessageId) as { id: string }).id;
}

export interface ClaimedMemoryJob {
  id: string; kind: 'organize' | 'embedding'; visitor_id: string; companion_id: string;
  conversation_id: string | null; assistant_message_id: string | null; memory_id: string | null;
  content_version: number | null; payload: string; scope_revision: number; lease_token: string;
  lease_expires_at: number; attempt_count: number;
}
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 4;
/** Durable claim; no provider IO and no process-local mutex. */
export function claimMemoryJob(db: Database.Database, options: { now?: Date; allowEmbedding?: boolean } = {}): ClaimedMemoryJob | null {
  const at = (options.now ?? new Date()).getTime();
  return db.transaction(() => {
    db.prepare("UPDATE memory_jobs SET state='failed',lease_token=NULL,lease_expires_at=NULL,last_error='lease-expired',updated_at=? WHERE state='running' AND lease_expires_at<=? AND attempt_count>=?")
      .run(at, at, MAX_ATTEMPTS);
    const candidate = db.prepare(`SELECT j.* FROM memory_jobs j WHERE (j.state='queued' AND j.next_attempt_at<=?
      OR j.state='running' AND j.lease_expires_at<=?) AND j.attempt_count<? ${options.allowEmbedding ? '' : "AND j.kind='organize'"}
      AND NOT EXISTS(SELECT 1 FROM memory_jobs active WHERE active.visitor_id=j.visitor_id AND active.companion_id=j.companion_id
        AND active.state='running' AND active.lease_expires_at>?) ORDER BY j.created_at,j.id LIMIT 1`)
      .get(at, at, MAX_ATTEMPTS, at) as ClaimedMemoryJob | undefined;
    if (!candidate) return null;
    const revision = memoryScopeRevision(db, { visitorId: candidate.visitor_id, companionId: candidate.companion_id });
    const token = randomUUID();
    db.prepare("UPDATE memory_jobs SET state='running',attempt_count=attempt_count+1,lease_token=?,lease_expires_at=?,scope_revision=?,updated_at=? WHERE id=?")
      .run(token, at + LEASE_MS, revision, at, candidate.id);
    return { ...candidate, lease_token: token, lease_expires_at: at + LEASE_MS, scope_revision: revision, attempt_count: candidate.attempt_count + 1 };
  }).immediate();
}
class JobStateChanged extends Error {}
function assertClaim(db: Database.Database, job: ClaimedMemoryJob, now: number): void {
  assertInstanceOwnership(dirname(db.name));
  const row = db.prepare("SELECT id FROM memory_jobs WHERE id=? AND state='running' AND lease_token=? AND lease_expires_at>?")
    .get(job.id, job.lease_token, now);
  if (!row) throw new JobStateChanged('Memory job lease is no longer current');
  if (memoryScopeRevision(db, { visitorId: job.visitor_id, companionId: job.companion_id }) !== job.scope_revision) throw new JobStateChanged('Memory scope changed while processing');
  if (job.conversation_id && !db.prepare('SELECT id FROM conversations WHERE id=? AND visitor_id=? AND companion_id=?')
    .get(job.conversation_id, job.visitor_id, job.companion_id)) throw new JobStateChanged('Memory source was deleted');
}
/** No stale token, expired lease, changed scope or deleted source can extend a claim. */
export function renewMemoryJobLease(db: Database.Database, job: ClaimedMemoryJob, now: Date = new Date()): boolean {
  try {
    return db.transaction(() => {
      assertClaim(db, job, now.getTime());
      return db.prepare("UPDATE memory_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND state='running' AND lease_token=?")
        .run(now.getTime() + LEASE_MS, now.getTime(), job.id, job.lease_token).changes === 1;
    }).immediate();
  } catch { return false; }
}
function complete(db: Database.Database, job: ClaimedMemoryJob, now: number) {
  db.prepare("UPDATE memory_jobs SET state='completed',lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND lease_token=?")
    .run(now, job.id, job.lease_token);
}
type AddWrite = Parameters<MemoryGateway['add']>[1];
type Mutation = { kind: 'add'; id: string; text: string; options: AddWrite }
  | { kind: 'update'; id: string; update: Parameters<MemoryGateway['update']>[1]; version: number }
  | { kind: 'delete'; id: string; version: number };
function persistRelationship(db: Database.Database, input: OrganizerJobInput, update: RelationshipSnapshotUpdate | undefined) {
  const fields = normalizeSnapshotUpdate(update);
  if (fields) persistSqliteRelationshipSnapshot(db, { ...input, fields });
}
function embeddingTarget(payload: string) {
  const value = JSON.parse(payload) as { embeddingModel?: string; embeddingDimensions?: number } | null;
  // Historical jobs used the fixed v4/1024 space and an empty object payload.
  return { embeddingModel: value?.embeddingModel ?? 'text-embedding-v4', embeddingDimensions: value?.embeddingDimensions ?? 1024 };
}
function selectedEmbeddingTarget(options: SqliteMemoryOptions) {
  return { embeddingModel: options.embeddingModel ?? 'text-embedding-v4', embeddingDimensions: options.embeddingDimensions ?? 1024 };
}
/** Bounded catch-up when a formerly keyword-only personal instance enables hybrid. */
export function enqueueMissingEmbeddingJobs(db: Database.Database, at: Date, options: SqliteMemoryOptions): number {
  const { embeddingModel: model, embeddingDimensions: dimensions } = selectedEmbeddingTarget(options);
  const payload = JSON.stringify({ embeddingModel: model, embeddingDimensions: dimensions });
  return db.transaction(() => {
    const rows = db.prepare(`SELECT m.id,m.visitor_id,m.companion_id,m.content_version FROM memories m
      LEFT JOIN memory_jobs j ON j.kind='embedding' AND j.memory_id=m.id AND j.content_version=m.content_version
      WHERE m.status='active' AND (m.valid_until IS NULL OR m.valid_until>?)
      AND (m.embedding IS NULL OR m.embedding_content_version IS NULL OR m.embedding_content_version<>m.content_version
        OR m.embedding_model IS NULL OR m.embedding_model<>? OR m.embedding_dimensions IS NULL OR m.embedding_dimensions<>?)
      AND (j.id IS NULL OR (
        NOT (j.state='running' AND COALESCE(j.lease_expires_at,0)>?)
        AND (j.state IN ('completed','cancelled')
          OR COALESCE(json_extract(j.payload,'$.embeddingModel'),'text-embedding-v4')<>?
          OR COALESCE(json_extract(j.payload,'$.embeddingDimensions'),1024)<>?)))
      ORDER BY m.created_at,m.id LIMIT 50`).all(at.getTime(),model,dimensions,at.getTime(),model,dimensions) as
      Array<{ id: string; visitor_id: string; companion_id: string; content_version: number }>;
    for (const row of rows) {
      const scope = { visitorId: row.visitor_id, companionId: row.companion_id };
      enqueueSqliteMemoryEmbedding(db, { id: row.id, ...scope, version: row.content_version }, at.getTime());
      // Reuse the content-version unique row. A model switch starts a new bounded
      // retry budget, while same-model queued/failed jobs were excluded above.
      db.prepare(`UPDATE memory_jobs SET payload=?,state='queued',attempt_count=0,next_attempt_at=?,lease_token=NULL,
        lease_expires_at=NULL,last_error=NULL,scope_revision=?,updated_at=?
        WHERE kind='embedding' AND memory_id=? AND content_version=? AND visitor_id=? AND companion_id=?`)
        .run(payload, at.getTime(), memoryScopeRevision(db, scope), at.getTime(), row.id, row.content_version, row.visitor_id, row.companion_id);
    }
    return rows.length;
  }).immediate();
}

export async function processMemoryJobs(db: Database.Database, options: Omit<SqliteMemoryOptions, 'limit'> & {
  organizer: MemoryOrganizer; limit?: number;
}): Promise<{ completed: number; failed: number; cancelled: number }> {
  const now = options.now ?? (() => new Date());
  const outcome = { completed: 0, failed: 0, cancelled: 0 };
  const appId = options.appId ?? PERSONAL_MEMORY_APP_ID;
  const needsEmbedding = options.retrievalMode === 'hybrid' && !!options.embed;
  assertInstanceOwnership(dirname(db.name));
  if (needsEmbedding && !maintenanceActive(dirname(db.name))) enqueueMissingEmbeddingJobs(db, now(), options);
  for (let index = 0; index < (options.limit ?? 4); index++) {
    assertInstanceOwnership(dirname(db.name));
    if (maintenanceActive(dirname(db.name))) break;
    const job = claimMemoryJob(db, { now: now(), allowEmbedding: needsEmbedding });
    if (!job) break;
    const heartbeat = setInterval(() => {
      if (!renewMemoryJobLease(db, job, now())) clearInterval(heartbeat);
    }, 30_000);
    heartbeat.unref();
    try {
      if (job.kind === 'embedding') {
        const row = db.prepare('SELECT content,content_version FROM memories WHERE id=? AND visitor_id=? AND companion_id=?')
          .get(job.memory_id, job.visitor_id, job.companion_id) as { content: string; content_version: number } | undefined;
        if (!row || row.content_version !== job.content_version) {
          db.prepare("UPDATE memory_jobs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_token=?")
            .run(now().getTime(), job.id, job.lease_token);
          outcome.cancelled++; continue;
        }
        const target = selectedEmbeddingTarget(options);
        db.transaction(() => {
          assertClaim(db, job, now().getTime());
          const previous = embeddingTarget(job.payload);
          if (previous.embeddingModel !== target.embeddingModel || previous.embeddingDimensions !== target.embeddingDimensions) job.attempt_count = 1;
          job.payload = JSON.stringify(target);
          db.prepare("UPDATE memory_jobs SET payload=?,attempt_count=? WHERE id=? AND state='running' AND lease_token=?")
            .run(job.payload, job.attempt_count, job.id, job.lease_token);
        }).immediate();
        const [vector] = await options.embed!({ texts: [row.content] });
        if (!vector) throw new Error('Embedding returned no vector');
        db.transaction(() => {
          assertClaim(db, job, now().getTime());
          if (!setSqliteMemoryEmbedding(db, { id: job.memory_id!, contentVersion: job.content_version!, vector,
            model: target.embeddingModel, dimensions: target.embeddingDimensions })) throw new JobStateChanged('Memory content changed');
          complete(db, job, now().getTime());
        }).immediate();
      } else {
        const input = JSON.parse(job.payload) as OrganizerJobInput;
        if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('Invalid job observation time');
        // Queue batch size must not override the gateway/domain recall budget.
        const gateway = createSqliteMemoryGateway(db, { appId, retrievalMode: options.retrievalMode,
          embed: options.embed, embeddingModel: options.embeddingModel, embeddingDimensions: options.embeddingDimensions,
          organizerModel: options.organizerModel, now });
        const service = createMemoryService({ enabled: true, appId, gateway, organizer: options.organizer, organizerModel: options.organizerModel, now });
        // Failed recall must throw; it cannot masquerade as a trusted empty set.
        const existing = await service.recall({ visitorId: input.visitorId, companionId: input.companionId, query: input.userText });
        assertInstanceOwnership(dirname(db.name));
        const profile = db.prepare('SELECT timezone FROM user_profiles WHERE visitor_id=?').get(input.visitorId) as { timezone?: string } | undefined;
        const timeZone = resolveUserTimeZone(profile?.timezone);
        const plan = await options.organizer.organize({ nowIso: toLocalIso(new Date(input.observedAt), timeZone),
          visitorId: input.visitorId, companionId: input.companionId, userText: input.userText,
          assistantText: input.assistantText, existingMemories: existing, recentTurns: input.recentTurns });
        const mutations: Mutation[] = [];
        const currentVersion = (id: string) => {
          const row = db.prepare('SELECT content_version FROM memories WHERE id=? AND visitor_id=? AND companion_id=?')
            .get(id, input.visitorId, input.companionId) as { content_version: number } | undefined;
          if (!row) throw new JobStateChanged('Memory was removed');
          return row.content_version;
        };
        const staged: MemoryGateway = {
          search: gateway.search,
          async add(text, write) { const id = randomUUID(); mutations.push({ kind: 'add', id, text, options: write }); return { id, memory: text, metadata: write.metadata }; },
          async update(id, update) { mutations.push({ kind: 'update', id, update, version: currentVersion(id) }); },
          async delete(id) { mutations.push({ kind: 'delete', id, version: currentVersion(id) }); },
        };
        // Reuse existing classification, per-turn budget, source union and evidence guards.
        const domain = createMemoryService({ enabled: true, appId, gateway: staged, organizer: { async organize() { return plan; } },
          organizerModel: options.organizerModel, now: () => new Date(input.observedAt), resolveTimeZone: async () => timeZone });
        const result = await domain.rememberExchange({ ...input, existingMemories: existing });
        const feedback = filterFeedbackBySource(result.feedback, {
          userTexts: [input.userText, ...(input.recentTurns ?? []).map((turn) => turn.userText)], assistantText: input.assistantText });
        db.transaction(() => {
          assertClaim(db, job, now().getTime());
          for (const mutation of mutations) {
            if (mutation.kind !== 'add' && currentVersion(mutation.id) !== mutation.version) throw new JobStateChanged('Memory content changed during organization');
            if (mutation.kind === 'add') persistSqliteMemory(db, mutation.text, mutation.options, { id: mutation.id, now: now(), enqueueEmbedding: needsEmbedding });
            else if (mutation.kind === 'update') updateSqliteMemory(db, mutation.id, mutation.update, { now: now(), enqueueEmbedding: needsEmbedding });
            else deleteSqliteMemoryEvidenceClosure(db, input, [mutation.id]);
          }
          for (const text of [...new Set(feedback.kept)]) {
            const content = communicationFeedbackMemoryText(text);
            const duplicate = db.prepare("SELECT id FROM memories WHERE visitor_id=? AND companion_id=? AND memory_type='communication_style' AND content=? AND status='active'")
              .get(input.visitorId, input.companionId, content) as { id: string } | undefined;
            if (duplicate) updateSqliteMemory(db, duplicate.id, { metadata: { source_conversation_id: input.conversationId } }, { now: now() });
            else persistSqliteMemory(db, content, { userId: input.visitorId, appId, metadata: {
              visitor_id: input.visitorId, companion_id: input.companionId, layer: 'L2', bucket: 'long_term_impression',
              domain: 'communication', memory_type: 'communication_style', importance: 0.75, confidence: 'explicit',
              observed_at: input.observedAt, occurred_at: input.observedAt, temporal_status: 'timeless', time_precision: 'exact',
              source_conversation_id: input.conversationId, status: 'active' } }, { now: now(), enqueueEmbedding: needsEmbedding });
          }
          persistRelationship(db, input, result.relationshipSnapshot);
          complete(db, job, now().getTime());
        }).immediate();
      }
      outcome.completed++;
    } catch (error) {
      if (error instanceof InstanceOwnershipLost) throw error;
      assertInstanceOwnership(dirname(db.name));
      const at = now().getTime();
      const state = db.prepare("SELECT state FROM memory_jobs WHERE id=? AND lease_token=? AND state='running'").get(job.id, job.lease_token);
      if (!state) { outcome.cancelled++; continue; }
      // Never write provider text or private exchange content into persisted/log errors.
      const reason = error instanceof JobStateChanged ? 'state-changed' : 'processing-failed';
      db.prepare(`UPDATE memory_jobs SET state=?,lease_token=NULL,lease_expires_at=NULL,last_error=?,next_attempt_at=?,updated_at=?
        WHERE id=? AND lease_token=?`).run(job.attempt_count >= MAX_ATTEMPTS ? 'failed' : 'queued', reason,
          at + Math.min(60_000, 1000 * 2 ** job.attempt_count), at, job.id, job.lease_token);
      console.warn('[memory:job]', { id: job.id, kind: job.kind, reason, attempt: job.attempt_count });
      outcome.failed++;
    } finally { clearInterval(heartbeat); }
  }
  return outcome;
}
