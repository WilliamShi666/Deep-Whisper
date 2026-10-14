import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openDatabase } from '../src/storage/database/db';
import { createCoreRepository } from '../src/lib/personal/core-repository';
import { persistSqliteMemory, PERSONAL_MEMORY_APP_ID } from '../src/lib/memory/sqlite-gateway';

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'dw-core-'));
  const db = openDatabase({ dataDir: dir });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const owner = (db.prepare('SELECT id FROM visitors').get() as { id: string }).id;
  return { db, owner, repo: createCoreRepository(db) };
}
function companion(
  repo: ReturnType<typeof createCoreRepository>,
  owner: string,
  id = randomUUID(),
) {
  return repo.createCompanion(owner, {
    id,
    character_key: 'gentle-senior',
    name: 'A',
    persona: 'calm',
    occupation: null,
    user_title: 'you',
    voice_id: 'voice-zh-f-01',
    appearance_style: 'chibi',
    theme_id: null,
  });
}

test('OSS-008/009 owner persists before onboarding and retries keep one companion/conversation', (t) => {
  const { repo, owner, db } = fixture(t);
  assert.equal(repo.getVisitor(owner)?.gender, null);
  repo.updateVisitor(owner, { gender: 'other', orientation: 'female', locale: 'en' });
  const id = randomUUID();
  const a = companion(repo, owner, id);
  assert.equal(companion(repo, owner, id).id, a.id);
  const conversationId = randomUUID();
  const c = repo.createConversation(owner, a.id, { id: conversationId, title: 'new' });
  assert.equal(repo.createConversation(owner, a.id, { id: conversationId, title: 'new' }).id, c.id);
  assert.equal((db.prepare('SELECT count(*) n FROM companions').get() as { n: number }).n, 1);
  assert.match(a.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    typeof (db.prepare('SELECT created_at FROM companions').get() as { created_at: number })
      .created_at,
    'number',
  );
});

test('OSS-010/014 all row accesses are owner-scoped and retain the active companion', (t) => {
  const { repo, owner } = fixture(t);
  const a = companion(repo, owner);
  const b = companion(repo, owner);
  repo.updateCompanion(owner, b.id, { name: 'B', theme_id: 'b-theme' });
  const c = repo.createConversation(owner, a.id, { title: 'A' });
  assert.equal(repo.getConversation(owner, c.id)?.companion_name, 'A');
  assert.equal(repo.getCompanion('forged-owner', a.id), null);
  assert.equal(repo.getConversation('forged-owner', c.id), null);
  assert.equal(repo.updateCompanion('forged-owner', a.id, { name: 'stolen' }), null);
  assert.equal(repo.updateConversation('forged-owner', c.id, 'stolen'), null);
  assert.equal(repo.deleteConversation('forged-owner', c.id), null);
  assert.equal(repo.getCompanion(owner, a.id)?.name, 'A');
});

test('OSS-010 cursor pagination is stable for equal timestamps and messages are chronological', (t) => {
  const { repo, owner, db } = fixture(t);
  const a = companion(repo, owner);
  const c = repo.createConversation(owner, a.id, { title: 'A' });
  for (let i = 0; i < 105; i++)
    repo.insertMessage(owner, c.id, { role: 'user', content: String(i) });
  db.prepare('UPDATE messages SET created_at=?').run(Date.parse('2026-10-07T00:00:00Z'));
  const first = repo.listMessages(owner, c.id)!;
  assert.equal(first.messages.length, 100);
  assert.ok(first.next_cursor);
  const second = repo.listMessages(owner, c.id, first.next_cursor!)!;
  assert.equal(second.messages.length, 5);
  assert.equal(second.next_cursor, null);
  assert.equal(new Set([...first.messages, ...second.messages].map((m) => m.id)).size, 105);
  assert.deepEqual(
    first.messages.map((m) => m.id),
    [...first.messages.map((m) => m.id)].sort(),
  );
});

test('OSS-010 profile JSON roundtrips, version conflicts do not overwrite, date merge preserves earlier dates', (t) => {
  const { repo, owner } = fixture(t);
  const first = repo.saveProfile(owner, {
    display_name: 'Owner',
    important_dates: [{ date: '2026-12-01', type: 'exam', description: 'A' }],
  });
  const second = repo.saveProfile(
    owner,
    { important_dates: [{ date: '2026-12-02', type: 'other', description: 'B' }] },
    { importantDatesMode: 'merge', expectedVersion: first.updated_at },
  );
  assert.equal(second.important_dates?.length, 2);
  assert.throws(
    () => repo.saveProfile(owner, { display_name: 'old' }, { expectedVersion: first.updated_at }),
    /PROFILE_CONFLICT/,
  );
  assert.equal(repo.getProfile(owner)?.display_name, 'Owner');
  assert.deepEqual(repo.getProfile(owner)?.important_dates, second.important_dates);
});

test('OSS-014 feedback derives ownership from assistant message; user feedback and forged scope are rejected', (t) => {
  const { repo, owner } = fixture(t);
  const a = companion(repo, owner);
  const c = repo.createConversation(owner, a.id, { title: 'A' });
  const user = repo.insertMessage(owner, c.id, { role: 'user', content: 'hello' });
  const reply = repo.insertMessage(owner, c.id, { role: 'assistant', content: 'hi' });
  assert.equal(repo.saveFeedback(owner, user.id, { rating: 1, comment: null }), null);
  assert.equal(repo.saveFeedback('forged-owner', reply.id, { rating: 1, comment: null }), null);
  assert.equal(
    repo.saveFeedback(owner, reply.id, { rating: -1, comment: 'less formal' })?.rating,
    -1,
  );
  assert.equal(repo.listFeedback(owner, c.id)?.length, 1);
  repo.saveFeedback(owner, reply.id, { rating: null, comment: null });
  assert.equal(repo.listFeedback(owner, c.id)?.length, 0);
});

test('OSS-011/013 assistant and durable organizer job commit together; enqueue failure rolls back reply', (t) => {
  const { repo, owner, db } = fixture(t);
  const a = companion(repo, owner);
  const c = repo.createConversation(owner, a.id, { title: 'A' });
  const user = repo.insertMessage(owner, c.id, { role: 'user', content: 'I like tea' });
  const reply = repo.finishReply({
    visitorId: owner,
    companionId: a.id,
    conversationId: c.id,
    userMessageId: user.id,
    userText: user.content!,
    assistantText: 'I remember',
    observedAt: '2026-10-07T03:00:00.000Z',
  });
  assert.equal(
    (
      db.prepare('SELECT assistant_message_id FROM memory_jobs').get() as {
        assistant_message_id: string;
      }
    ).assistant_message_id,
    reply.id,
  );
  db.exec(
    "CREATE TRIGGER fail_job BEFORE INSERT ON memory_jobs BEGIN SELECT RAISE(ABORT,'fixture enqueue fail'); END;",
  );
  assert.throws(
    () =>
      repo.finishReply({
        visitorId: owner,
        companionId: a.id,
        conversationId: c.id,
        userMessageId: user.id,
        userText: 'tea',
        assistantText: 'rollback',
        observedAt: '2026-10-07T03:01:00.000Z',
      }),
    /fixture enqueue fail/,
  );
  assert.equal(
    (db.prepare("SELECT count(*) n FROM messages WHERE content='rollback'").get() as { n: number })
      .n,
    0,
  );
});

test('OSS-010/013 conversation deletion cascades feedback and queued jobs; companions and other conversations survive', (t) => {
  const { repo, owner, db } = fixture(t);
  const a = companion(repo, owner);
  const c = repo.createConversation(owner, a.id, { title: 'remove' });
  const other = repo.createConversation(owner, a.id, { title: 'keep' });
  const user = repo.insertMessage(owner, c.id, { role: 'user', content: 'hi' });
  const reply = repo.finishReply({
    visitorId: owner,
    companionId: a.id,
    conversationId: c.id,
    userMessageId: user.id,
    userText: 'hi',
    assistantText: 'hello',
    observedAt: new Date().toISOString(),
  });
  repo.saveFeedback(owner, reply.id, { rating: 1, comment: null });
  assert.equal(repo.deleteConversation(owner, c.id)?.forget.status, 'cleared');
  assert.equal(
    (
      db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').get(c.id) as {
        n: number;
      }
    ).n,
    0,
  );
  assert.equal((db.prepare('SELECT count(*) n FROM message_feedback').get() as { n: number }).n, 0);
  assert.equal(
    (
      db.prepare('SELECT count(*) n FROM memory_jobs WHERE conversation_id=?').get(c.id) as {
        n: number;
      }
    ).n,
    0,
  );
  assert.ok(repo.getConversation(owner, other.id));
  assert.ok(repo.getCompanion(owner, a.id));
});
test('OSS-011 an image-only turn persists its assistant without inventing a textual memory source', (t) => {
  const { repo, owner, db } = fixture(t);
  const a = companion(repo, owner);
  const c = repo.createConversation(owner, a.id, { title: 'image' });
  const user = repo.insertMessage(owner, c.id, {
    role: 'user',
    content: '[图片]',
    content_type: 'image',
    image_url: '/api/media/fixture.png',
  });
  const reply = repo.finishReply({
    visitorId: owner,
    companionId: a.id,
    conversationId: c.id,
    userMessageId: user.id,
    userText: '',
    assistantText: 'I see your picture',
    observedAt: new Date().toISOString(),
  });
  assert.equal(reply.content, 'I see your picture');
  assert.equal((db.prepare('SELECT count(*) n FROM memory_jobs').get() as { n: number }).n, 0);
});

test('OSS-028: conversation delete reports partial when unknown provenance survives and keeps unrelated memories', t => {
  const { repo, owner, db } = fixture(t); const a = companion(repo, owner);
  const removed = repo.createConversation(owner, a.id, { title: 'removed' });
  const kept = repo.createConversation(owner, a.id, { title: 'kept' });
  const write = (text: string, source?: string) => persistSqliteMemory(db, text, { userId: owner, appId: PERSONAL_MEMORY_APP_ID,
    metadata: { visitor_id: owner, companion_id: a.id, layer: 'L3', bucket: 'key_detail', domain: 'identity',
      memory_type: 'personal_fact', importance: .8, confidence: 'explicit', observed_at: new Date().toISOString(),
      ...(source ? { source_conversation_id: source } : {}) } });
  const related = write('related', removed.id); const unrelated = write('unrelated', kept.id); const unknown = write('unknown');
  const result = repo.deleteConversation(owner, removed.id)!;
  assert.equal(Reflect.get(result, 'ok'), true); assert.equal(result.forget.status, 'partial'); assert.equal(result.forget.deleted, 1);
  assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(related.id), undefined);
  assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(unrelated.id));
  assert.ok(db.prepare('SELECT id FROM memories WHERE id=?').get(unknown.id));
  assert.equal(repo.getConversation(owner, removed.id), null);
});
