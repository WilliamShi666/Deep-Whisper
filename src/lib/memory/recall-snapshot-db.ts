import type Database from 'better-sqlite3';
import { getSqlite } from '@/storage/database/db';
import { createSqliteRecallSnapshotStore } from './sqlite-snapshot';
import { invalidateSqliteMemorySnapshot } from './sqlite-gateway';
import type { RecalledMemory } from './service';

export const MEMORY_RECALL_SNAPSHOTS_TABLE = 'memory_recall_snapshots';
export function createRecallSnapshotStore(visitorId: string, companionId: string, db: Database.Database = getSqlite()) {
  return createSqliteRecallSnapshotStore(db, { visitorId, companionId });
}
export function withoutConversationSource(memories: readonly RecalledMemory[], conversationId: string): RecalledMemory[] {
  return memories.filter(memory => !memory.sourceConversationIds.includes(conversationId));
}
export async function forgetConversationSnapshot(input: { visitorId: string; companionId: string; conversationId: string },
  db: Database.Database = getSqlite()): Promise<boolean> {
  try {
    db.transaction(() => invalidateSqliteMemorySnapshot(db, input)).immediate();
    return true;
  } catch {
    console.error('[memory:recall-snapshot] invalidation failed');
    return false;
  }
}
