import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareChatContext } from '../src/lib/chat/prepare-context';

test('context failure never saves a user message', async () => {
  let saves = 0;
  await assert.rejects(prepareChatContext(Promise.reject(new Error('context unavailable')),
    Promise.resolve([{ id: 'older' }]), async () => { saves++; return { id: 'new' }; }), /context unavailable/);
  assert.equal(saves, 0);
});

test('history failure never saves a user message', async () => {
  let saves = 0;
  await assert.rejects(prepareChatContext(Promise.resolve('memory'),
    Promise.reject(new Error('history unavailable')), async () => { saves++; return { id: 'new' }; }), /history unavailable/);
  assert.equal(saves, 0);
});

test('save occurs after required reads and appends newest message', async () => {
  const events: string[] = [];
  const prepared = await prepareChatContext(Promise.resolve('memory'),
    Promise.resolve([{ id: 'older' }]), async () => {
      events.push('save');
      return { id: 'new' };
    });
  assert.deepEqual(events, ['save']);
  assert.deepEqual(prepared.history.map((message) => message.id), ['older', 'new']);
  assert.equal(prepared.memory, 'memory');
});

test('a failed save rejects without constructing a history containing an unsaved message', async () => {
  await assert.rejects(prepareChatContext(Promise.resolve('memory'),
    Promise.resolve([{ id: 'older' }]), async () => { throw new Error('insert failed'); }), /insert failed/);
});
