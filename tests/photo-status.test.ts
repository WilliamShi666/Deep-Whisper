import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  PHOTO_FAILED,
  PHOTO_PENDING,
  PHOTO_PENDING_STALE_MS,
  isPhotoFailure,
  isPhotoStatusType,
  photoNoteForModel,
} from '../src/lib/photo-status';

/*
 * 2026-10-01：TA 说「等我一下，就拍一张」，生图失败后什么都没留下，下一轮 TA 说「那张照片我还留着」。
 * 现在每次拍照都落一条状态：pending → image / photo_failed；失败要在下一轮明确告诉 TA。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const now = new Date('2026-10-01T20:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

test('SQLite message types include durable photo status rows',()=>{
 const schema=read('src/storage/database/shared/schema.ts');
 assert.match(schema,/photo_pending/);
 assert.match(schema,/photo_failed/);
 assert.match(schema,/contentType:text\('content_type'\)/);
});

test('a failed photo tells the model plainly that nothing was delivered', () => {
  const note = photoNoteForModel(PHOTO_FAILED, ago(1000), now);
  assert.ok(note);
  assert.match(note, /没有发出去/);
  assert.match(note, /不要说照片已经发了/);
});

test('a pending photo is "not yet delivered"; a stuck one counts as failed', () => {
  assert.equal(isPhotoFailure(PHOTO_PENDING, ago(60_000), now), false);
  assert.match(photoNoteForModel(PHOTO_PENDING, ago(60_000), now) ?? '', /还在生成中/);
  assert.equal(isPhotoFailure(PHOTO_PENDING, ago(PHOTO_PENDING_STALE_MS + 1), now), true);
  assert.match(photoNoteForModel(PHOTO_PENDING, ago(PHOTO_PENDING_STALE_MS + 1), now) ?? '', /没有发出去/);
  // 时间戳读不出来时宁可当失败：比让 TA 以为照片发了更安全
  assert.equal(isPhotoFailure(PHOTO_PENDING, 'not-a-date', now), true);
});

test('text and image messages keep their existing handling', () => {
  for (const type of ['text', 'image', null, undefined]) {
    assert.equal(isPhotoStatusType(type), false);
    assert.equal(photoNoteForModel(type, ago(0), now), null);
  }
});

test('photo generation persists pending before calling the provider and records its outcome',()=>{
 const route=read('src/app/api/photo/route.ts');
 const pending=route.indexOf('content_type: PHOTO_PENDING');
 const generate=route.indexOf('generated = await generate(scene)');
 assert.ok(pending>0&&generate>pending);
 assert.match(route,/content_type: 'image'/);
 assert.match(route,/content_type: PHOTO_FAILED/);
 assert.doesNotMatch(route,/error: err instanceof Error \? err\.message/);
});

test('chat context preserves failed/pending photo notes and excludes failed episode delivery',()=>{
 const route=read('src/app/api/chat/route.ts');
 assert.match(route,/isPhotoStatusType\(message\.content_type\)/);
 assert.match(route,/photoNoteForModel\(message\.content_type, message\.created_at/);
 assert.match(route,/isPhotoFailure\(row\.content_type, row\.created_at/);
});

test('the chat UI never renders a photo status row as an empty bubble', () => {
  const shell = read('src/components/chat/chat-shell.tsx');
  assert.match(shell, /isPhotoStatusType\(m\.content_type\) \?/);
  assert.match(shell, /data-testid="photo-failed-notice"/);
});
