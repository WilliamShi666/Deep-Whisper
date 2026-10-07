import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOwnerSession } from '../src/lib/personal/owner-client';
test('OSS-005 a failed session probe remains retryable and never becomes a password rejection', async () => {
  assert.equal(
    (await loadOwnerSession(async () => new Response('unavailable', { status: 500 }))).status,
    'error',
  );
  assert.equal(
    (
      await loadOwnerSession(async () => {
        throw new Error('network');
      })
    ).status,
    'error',
  );
  assert.equal(
    (
      await loadOwnerSession(async () =>
        Response.json({ authenticated: true, accessMode: 'local' }),
      )
    ).status,
    'authed',
  );
  assert.equal(
    (
      await loadOwnerSession(async () =>
        Response.json({ authenticated: false, accessMode: 'password' }),
      )
    ).status,
    'guest',
  );
  assert.equal(
    (
      await loadOwnerSession(async () =>
        Response.json({ authenticated: 'yes', accessMode: 'local' }),
      )
    ).status,
    'error',
  );
});
