/** Personal letters: station copy and external transport state are independent. */
export const lettersMigrationSql = `
CREATE TABLE IF NOT EXISTS letter_preferences (
 visitor_id TEXT PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE,
 in_app_enabled INTEGER NOT NULL DEFAULT 0 CHECK(in_app_enabled IN (0,1)),
 email_enabled INTEGER NOT NULL DEFAULT 0 CHECK(email_enabled IN (0,1)),
 email_address TEXT,
 email_status TEXT NOT NULL DEFAULT 'paused' CHECK(email_status IN ('enabled','paused','unsubscribed','suppressed')),
 timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
 window_started_at INTEGER, last_interaction_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS letter_jobs (
 id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
 companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 local_date TEXT NOT NULL, trigger_key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
 lease_token TEXT, lease_expires_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL,
 UNIQUE(visitor_id,local_date), UNIQUE(visitor_id,trigger_key)
);
CREATE TABLE IF NOT EXISTS letters (
 id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
 companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
 conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
 companion_name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('L0','L1','L2')), local_date TEXT NOT NULL,
 trigger_key TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER,
 UNIQUE(visitor_id,local_date), UNIQUE(visitor_id,trigger_key)
);
CREATE INDEX IF NOT EXISTS letters_owner_created ON letters(visitor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS letter_outbox (
 id TEXT PRIMARY KEY, letter_id TEXT NOT NULL UNIQUE REFERENCES letters(id) ON DELETE CASCADE,
 visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('smtp','resend')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','delivered','bounced','complained','failed','unknown','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
 lease_token TEXT, lease_expires_at INTEGER, provider_message_id TEXT,
 last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS letter_outbox_provider_message ON letter_outbox(provider,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS letter_webhook_events (
 id TEXT PRIMARY KEY, provider_message_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('delivered','bounced','complained')),
 created_at INTEGER NOT NULL, processed_at INTEGER
);
`;
