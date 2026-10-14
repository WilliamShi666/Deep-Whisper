/** SQLite memory DDL. Executed only by the versioned application migrator. */
export const memoryMigrationSql = `
CREATE TABLE memories (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
  search_tokens TEXT NOT NULL,
  layer TEXT NOT NULL CHECK(layer IN ('L2','L3')),
  bucket TEXT NOT NULL CHECK(bucket IN ('long_term_impression','relationship_event','key_detail')),
  domain TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  importance REAL NOT NULL CHECK(importance BETWEEN 0 AND 1),
  confidence TEXT NOT NULL CHECK(confidence IN ('explicit','inferred')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  temporal_status TEXT CHECK(temporal_status IN ('timeless','upcoming','ongoing','resolved')),
  occurred_at INTEGER,
  observed_at INTEGER NOT NULL,
  time_precision TEXT CHECK(time_precision IN ('exact','day','approximate')),
  valid_until INTEGER,
  evidence_memory_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_memory_ids) AND json_type(evidence_memory_ids) = 'array'),
  source_user_message_id TEXT,
  source_assistant_message_id TEXT,
  organizer_model TEXT,
  organizer_reason TEXT,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version > 0),
  embedding BLOB,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  embedding_content_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX memories_owner_idx ON memories(visitor_id,companion_id,status,valid_until);
CREATE INDEX memories_bucket_idx ON memories(visitor_id,companion_id,bucket) WHERE status = 'active';
CREATE TABLE memory_sources (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  PRIMARY KEY(memory_id,conversation_id)
);
CREATE INDEX memory_sources_conversation_idx ON memory_sources(conversation_id,memory_id);
CREATE VIRTUAL TABLE memories_fts USING fts5(search_tokens, content='memories', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, search_tokens) VALUES (new.rowid,new.search_tokens);
END;
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,search_tokens) VALUES ('delete',old.rowid,old.search_tokens);
END;
CREATE TRIGGER memories_fts_update AFTER UPDATE OF search_tokens ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,search_tokens) VALUES ('delete',old.rowid,old.search_tokens);
  INSERT INTO memories_fts(rowid,search_tokens) VALUES (new.rowid,new.search_tokens);
END;
CREATE TABLE memory_scope_versions (
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  PRIMARY KEY(visitor_id,companion_id)
);
CREATE TABLE memory_recall_snapshots (
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'array'),
  refreshed_at INTEGER NOT NULL,
  turns_since_refresh INTEGER NOT NULL DEFAULT 0 CHECK(turns_since_refresh >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(visitor_id,companion_id)
);
CREATE TABLE memory_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('organize','embedding')),
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  assistant_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  content_version INTEGER,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','cancelled','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  scope_revision INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX memory_jobs_exchange_idx ON memory_jobs(assistant_message_id) WHERE kind = 'organize';
CREATE UNIQUE INDEX memory_jobs_embedding_idx ON memory_jobs(memory_id,content_version) WHERE kind = 'embedding';
CREATE INDEX memory_jobs_claim_idx ON memory_jobs(state,next_attempt_at,lease_expires_at);
`;
