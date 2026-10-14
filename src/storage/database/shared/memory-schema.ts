import { sql } from 'drizzle-orm';
import { blob, check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { visitors, companions, conversations, messages } from './schema';

// FTS5 virtual table and synchronization triggers are reviewed in 0002-memory.ts:
// Drizzle does not represent virtual tables. Ordinary memory tables are defined here.
const scope = () => ({
  visitorId: text('visitor_id').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  companionId: text('companion_id').notNull().references(() => companions.id, { onDelete: 'cascade' }),
});
export const memories = sqliteTable('memories', {
  rowid: integer('rowid').primaryKey(), id: text('id').notNull().unique(), ...scope(),
  content: text('content').notNull(), searchTokens: text('search_tokens').notNull(),
  layer: text('layer').notNull(), bucket: text('bucket').notNull(), domain: text('domain').notNull(),
  memoryType: text('memory_type').notNull(), importance: real('importance').notNull(), confidence: text('confidence').notNull(),
  status: text('status').notNull().default('active'), temporalStatus: text('temporal_status'),
  occurredAt: integer('occurred_at'), observedAt: integer('observed_at').notNull(), timePrecision: text('time_precision'),
  validUntil: integer('valid_until'), evidenceMemoryIds: text('evidence_memory_ids').notNull().default('[]'),
  sourceUserMessageId: text('source_user_message_id'), sourceAssistantMessageId: text('source_assistant_message_id'),
  organizerModel: text('organizer_model'), organizerReason: text('organizer_reason'),
  contentVersion: integer('content_version').notNull().default(1), embedding: blob('embedding', { mode: 'buffer' }),
  embeddingModel: text('embedding_model'), embeddingDimensions: integer('embedding_dimensions'),
  embeddingContentVersion: integer('embedding_content_version'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [
  index('memories_owner_idx').on(t.visitorId, t.companionId, t.status, t.validUntil),
  index('memories_bucket_idx').on(t.visitorId, t.companionId, t.bucket).where(sql`${t.status}='active'`),
  check('memory_content', sql`length(${t.content}) BETWEEN 1 AND 2000`),
  check('memory_layer', sql`${t.layer} IN ('L2','L3')`),
  check('memory_bucket', sql`${t.bucket} IN ('long_term_impression','relationship_event','key_detail')`),
  check('memory_importance', sql`${t.importance} BETWEEN 0 AND 1`),
  check('memory_confidence', sql`${t.confidence} IN ('explicit','inferred')`),
  check('memory_status', sql`${t.status} IN ('active','retired')`),
  check('memory_temporal_status', sql`${t.temporalStatus} IN ('timeless','upcoming','ongoing','resolved')`),
  check('memory_time_precision', sql`${t.timePrecision} IN ('exact','day','approximate')`),
  check('memory_evidence_json', sql`json_valid(${t.evidenceMemoryIds}) AND json_type(${t.evidenceMemoryIds})='array'`),
  check('memory_content_version', sql`${t.contentVersion}>0`),
]);
export const memorySources = sqliteTable('memory_sources', {
  memoryId: text('memory_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.memoryId, t.conversationId] }), index('memory_sources_conversation_idx').on(t.conversationId, t.memoryId)]);
export const memoryScopeVersions = sqliteTable('memory_scope_versions', {
  ...scope(), revision: integer('revision').notNull().default(0),
}, t => [primaryKey({ columns: [t.visitorId, t.companionId] }), check('memory_revision', sql`${t.revision}>=0`)]);
export const memoryRecallSnapshots = sqliteTable('memory_recall_snapshots', {
  ...scope(), revision: integer('revision').notNull(), payload: text('payload').notNull(),
  refreshedAt: integer('refreshed_at').notNull(), turnsSinceRefresh: integer('turns_since_refresh').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.visitorId, t.companionId] }),
  check('memory_snapshot_json', sql`json_valid(${t.payload}) AND json_type(${t.payload})='array'`),
  check('memory_snapshot_turns', sql`${t.turnsSinceRefresh}>=0`)]);
export const memoryJobs = sqliteTable('memory_jobs', {
  id: text('id').primaryKey().notNull(), kind: text('kind').notNull(), ...scope(),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  assistantMessageId: text('assistant_message_id').references(() => messages.id, { onDelete: 'cascade' }),
  memoryId: text('memory_id').references(() => memories.id, { onDelete: 'cascade' }), contentVersion: integer('content_version'),
  payload: text('payload').notNull(), state: text('state').notNull().default('queued'),
  attemptCount: integer('attempt_count').notNull().default(0), nextAttemptAt: integer('next_attempt_at').notNull(),
  leaseToken: text('lease_token'), leaseExpiresAt: integer('lease_expires_at'), scopeRevision: integer('scope_revision').notNull(),
  lastError: text('last_error'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [
  uniqueIndex('memory_jobs_exchange_idx').on(t.assistantMessageId).where(sql`${t.kind}='organize'`),
  uniqueIndex('memory_jobs_embedding_idx').on(t.memoryId, t.contentVersion).where(sql`${t.kind}='embedding'`),
  index('memory_jobs_claim_idx').on(t.state, t.nextAttemptAt, t.leaseExpiresAt),
  check('memory_job_kind', sql`${t.kind} IN ('organize','embedding')`),
  check('memory_job_payload', sql`json_valid(${t.payload})`),
  check('memory_job_state', sql`${t.state} IN ('queued','running','completed','cancelled','failed')`),
]);
