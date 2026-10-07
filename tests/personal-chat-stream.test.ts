import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/storage/database/db';
import { createCoreRepository } from '../src/lib/personal/core-repository';
import { createPersonalChatStream } from '../src/lib/personal/chat-stream';

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'dw-stream-'));
  const db = openDatabase({ dataDir: dir });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const owner = (db.prepare('SELECT id FROM visitors').get() as { id: string }).id;
  const repo = createCoreRepository(db);
  const companion = repo.createCompanion(owner, {
    character_key: 'gentle-senior',
    name: 'A',
    persona: null,
    occupation: null,
    user_title: 'you',
    voice_id: null,
    appearance_style: 'chibi',
    theme_id: null,
  });
  const conversation = repo.createConversation(owner, companion.id, { title: 'new' });
  const user = repo.insertMessage(owner, conversation.id, { role: 'user', content: 'hi' });
  return { db, repo, owner, companion, conversation, user };
}
test('OSS-011 stream keeps exact user_message/chunk/done events and suppresses partial photo markers', async (t) => {
  const f = fixture(t);
  const response = createPersonalChatStream({
    userMessage: f.user,
    photoEnabled: true,
    timeoutMs: 5000,
    stream: async function* () {
      yield 'hello [PH';
      yield 'OTO:park]';
    },
    finishReply: (text) =>
      f.repo.finishReply({
        visitorId: f.owner,
        companionId: f.companion.id,
        conversationId: f.conversation.id,
        userMessageId: f.user.id,
        userText: 'hi',
        assistantText: text,
        observedAt: new Date().toISOString(),
      }),
  });
  const events = (await response.text())
    .split('\n\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
  assert.deepEqual(
    events.map((e) => e.type),
    ['user_message', 'chunk', 'done'],
  );
  assert.equal(events[1].text, 'hello ');
  assert.equal(events[2].message.content, 'hello');
  assert.deepEqual(Object.keys(events[2]).sort(), [
    'message',
    'photo_request',
    'photo_scene',
    'type',
  ]);
  assert.equal(events[2].photo_request, true);
  assert.equal(events[2].photo_scene, 'park');
  assert.equal((f.db.prepare('SELECT count(*) n FROM memory_jobs').get() as { n: number }).n, 1);
});
test('OSS-011 client cancellation still persists one assistant and organizer job atomically', async (t) => {
  const f = fixture(t);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let next!: () => void;
  const resume = new Promise<void>((resolve) => {
    next = resolve;
  });
  const response = createPersonalChatStream({
    userMessage: f.user,
    photoEnabled: false,
    timeoutMs: 5000,
    stream: async function* () {
      yield 'one';
      await resume;
      yield ' two';
    },
    finishReply: (text) => {
      const reply = f.repo.finishReply({
        visitorId: f.owner,
        companionId: f.companion.id,
        conversationId: f.conversation.id,
        userMessageId: f.user.id,
        userText: 'hi',
        assistantText: text,
        observedAt: new Date().toISOString(),
      });
      finish();
      return reply;
    },
  });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  next();
  await finished;
  assert.equal(
    (
      f.db
        .prepare("SELECT count(*) n FROM messages WHERE role='assistant' AND content='one two'")
        .get() as { n: number }
    ).n,
    1,
  );
  assert.equal((f.db.prepare('SELECT count(*) n FROM memory_jobs').get() as { n: number }).n, 1);
});
test('OSS-011 provider failure emits stable error after the saved user, without partial assistant/job', async (t) => {
  const f = fixture(t);
  const response = createPersonalChatStream({
    userMessage: f.user,
    photoEnabled: false,
    timeoutMs: 5000,
    stream: async function* () {
      yield 'partial';
      throw new Error('fixture provider secret');
    },
    finishReply: (text) => {
      throw new Error(`should not persist ${text}`);
    },
  });
  const body = await response.text();
  assert.ok(body.includes('"type":"user_message"'));
  assert.ok(body.includes('"code":"CHAT_REPLY_FAILED"'));
  assert.ok(!body.includes('fixture provider secret'));
  assert.equal(
    (f.db.prepare("SELECT count(*) n FROM messages WHERE role='assistant'").get() as { n: number })
      .n,
    0,
  );
});
test(
  'OSS-011 the server deadline terminates a stalled adapter independently of browser cancellation',
  { timeout: 250 },
  async (t) => {
    const f = fixture(t);
    let released = false;
    const response = createPersonalChatStream({
      userMessage: f.user,
      photoEnabled: false,
      timeoutMs: 20,
      stream: async function* () {
        await new Promise<void>(() => {});
        yield 'unreachable';
      },
      finishReply: () => {
        throw new Error('must not persist');
      },
      onFinish: async () => {
        released = true;
      },
    });
    const body = await response.text();
    assert.ok(body.includes('"code":"CHAT_REPLY_FAILED"'));
    assert.equal(released, true);
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM messages WHERE role='assistant'").get() as {
          n: number;
        }
      ).n,
      0,
    );
  },
);
