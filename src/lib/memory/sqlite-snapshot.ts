import type Database from 'better-sqlite3';
import type { RecallSnapshotStore } from './recall-snapshot-store';
import type { RecallSnapshot } from './recall-snapshot';
import type { RecalledMemory } from './service';
import { memoryScopeRevision, assertSqliteMemoryScope, deleteSqliteMemoryEvidenceClosure, type SqliteMemoryScope } from './sqlite-gateway';

function parseSnapshot(value: string): RecalledMemory[] {
  const result: unknown = JSON.parse(value);
  if (!Array.isArray(result) || result.some((item) => !item || typeof item !== 'object'
    || typeof item.id !== 'string' || typeof item.text !== 'string' || !Array.isArray(item.sourceConversationIds))) {
    throw new Error('Invalid memory recall snapshot payload');
  }
  return result as RecalledMemory[];
}
export function createSqliteRecallSnapshotStore(db: Database.Database, scope: SqliteMemoryScope,
  now: () => Date = () => new Date()): RecallSnapshotStore {
  let revision: number | null = null;
  return {
    async read() {
      return db.transaction(() => {
        revision = memoryScopeRevision(db, scope);
        const row = db.prepare(`SELECT payload,refreshed_at,turns_since_refresh FROM memory_recall_snapshots
          WHERE visitor_id=? AND companion_id=? AND revision=?`).get(scope.visitorId, scope.companionId, revision) as
          { payload: string; refreshed_at: number; turns_since_refresh: number } | undefined;
        if (!row) return null;
        if (!Number.isFinite(row.refreshed_at) || !Number.isInteger(row.turns_since_refresh)) throw new Error('Invalid recall snapshot metadata');
        const memories = parseSnapshot(row.payload).filter((memory) => !memory.validUntil || Date.parse(memory.validUntil) > now().getTime());
        return { memories, refreshedAt: new Date(row.refreshed_at).toISOString(), turnsSinceRefresh: row.turns_since_refresh };
      }).immediate();
    },
    async write(snapshot: RecallSnapshot) {
      if (revision === null) throw new Error('Snapshot write requires a versioned read');
      const refreshed = Date.parse(snapshot.refreshedAt);
      if (!Number.isFinite(refreshed) || !Number.isInteger(snapshot.turnsSinceRefresh) || snapshot.turnsSinceRefresh < 0) throw new Error('Invalid recall snapshot');
      const payload = JSON.stringify(snapshot.memories.slice(0, 40));
      parseSnapshot(payload);
      db.transaction(() => {
        if (memoryScopeRevision(db, scope) !== revision) throw new Error('Snapshot invalidated during write');
        db.prepare(`INSERT INTO memory_recall_snapshots(visitor_id,companion_id,revision,payload,refreshed_at,turns_since_refresh,updated_at)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(visitor_id,companion_id) DO UPDATE SET revision=excluded.revision,
          payload=excluded.payload,refreshed_at=excluded.refreshed_at,turns_since_refresh=excluded.turns_since_refresh,updated_at=excluded.updated_at`)
          .run(scope.visitorId, scope.companionId, revision, payload, refreshed, snapshot.turnsSinceRefresh, now().getTime());
      }).immediate();
    },
  };
}

/** Caller must invoke this before deleting conversation/source rows in the same transaction. */
export function forgetSqliteConversationMemories(db: Database.Database, scope: SqliteMemoryScope & { conversationId: string }) {
  return db.transaction(() => {
    assertSqliteMemoryScope(db, scope);
    const source = db.prepare('SELECT id FROM conversations WHERE id=? AND visitor_id=? AND companion_id=?')
      .get(scope.conversationId, scope.visitorId, scope.companionId);
    if (!source) throw new Error('Conversation is not owned or no longer exists');
    // A derived memory may live in another conversation. Forget the full reverse
    // evidence closure inside this scope before foreign keys remove any source.
    const seeds = db.prepare(`SELECT m.id FROM memories m JOIN memory_sources s ON s.memory_id=m.id
      WHERE m.visitor_id=? AND m.companion_id=? AND s.conversation_id=?`)
      .all(scope.visitorId, scope.companionId, scope.conversationId) as Array<{ id: string }>;
    const { deleted, revision } = deleteSqliteMemoryEvidenceClosure(db, scope, seeds.map(row => row.id));
    db.prepare('DELETE FROM memory_jobs WHERE visitor_id=? AND companion_id=? AND conversation_id=?')
      .run(scope.visitorId, scope.companionId, scope.conversationId);
    const unattributable = (db.prepare(`SELECT count(*) n FROM memories m WHERE visitor_id=? AND companion_id=?
      AND NOT EXISTS(SELECT 1 FROM memory_sources s WHERE s.memory_id=m.id)`).get(scope.visitorId, scope.companionId) as { n: number }).n;
    return { deleted, revision, exhaustive: true, remaining: 0, unattributable, snapshotCleared: true };
  }).immediate();
}
