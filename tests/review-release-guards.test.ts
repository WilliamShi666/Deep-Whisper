import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readResponseBytes, readResponseJson } from '../src/lib/ai/limited-response';
import { creationRowId } from '../src/lib/creation-reference';
import { encodeCursor, decodeCursor, beforeCursor } from '../src/lib/pagination-cursor';
import { readApprovedUpload } from '../src/lib/storage/approved-upload';

const ID = '00000000-0000-4000-8000-000000000001';
const AT = '2026-10-02T10:00:00.123456+00:00';

test('upstream byte limits bound chunked bodies with missing or misleading lengths', async () => {
  for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); },
      cancel() { cancelled = true; },
    });
    await assert.rejects(readResponseBytes(new Response(body, { headers }), 5), /size limit/);
    assert.equal(cancelled, true);
  }
});

test('oversized declared responses are cancelled before consuming a chunk', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readResponseBytes(new Response(body, { headers: { 'content-length': '6' } }), 5), /size limit/);
  assert.equal(cancelled, true);
});

test('bounded JSON reads preserve valid payloads and reject malformed ones', async () => {
  assert.deepEqual(await readResponseJson(Response.json({ ok: true }), 32), { ok: true });
  await assert.rejects(readResponseJson(new Response('{'), 32), SyntaxError);
});

test('creation retries are deterministic and isolated by visitor and operation', () => {
  const id = creationRowId('visitor-a', 'companion', ID);
  assert.equal(id, creationRowId('visitor-a', 'companion', ID));
  assert.match(id!, /^[0-9a-f-]{36}$/);
  assert.notEqual(id, creationRowId('visitor-b', 'companion', ID));
  assert.notEqual(id, creationRowId('visitor-a', 'conversation', ID));
  assert.equal(creationRowId('visitor-a', 'companion', undefined), undefined);
  for (const value of [null, 3, '', 'forged-id']) assert.throws(() => creationRowId('a', 'b', value));
});

test('pagination keeps microseconds and a UUID tie breaker without accepting filter injection', () => {
  const cursor = decodeCursor(encodeCursor(AT, ID))!;
  assert.deepEqual(cursor, { at: AT, id: ID });
  assert.equal(beforeCursor('created_at', cursor), `created_at.lt.${AT},and(created_at.eq.${AT},id.lt.${ID})`);
  assert.equal(decodeCursor(null), null);
  for (const value of ['!', 'a'.repeat(257), encodeCursor(`${AT},id.gt.0`, ID), encodeCursor(AT, `${ID})`)]) {
    assert.throws(() => decodeCursor(value));
  }
});

test('unapproved image references fail before any network request', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network must stay unused'); };
  try {
    for (const reference of ['https://evil.test/image.png', 'file:///etc/passwd', 'x'.repeat(4097)]) {
      await assert.rejects(readApprovedUpload(reference, ID), /approval|reference/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test('shared runtime configuration imports values without importing server adapters', () => {
  const runtime = readFileSync(new URL('../src/lib/config/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /from '@\/lib\/ai\/model-defaults'/);
  assert.doesNotMatch(runtime, /from ['"][^'"]*\/providers\//);
});
