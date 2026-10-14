import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeFeedbackInput } from '../src/lib/feedback/validate';

/** 成功用例的便捷断言：失败时把中文原因带出来，便于定位。 */
function ok(raw: unknown) {
  const result = normalizeFeedbackInput(raw);
  assert.equal(result.ok, true, result.ok ? '' : `expected success, got: ${result.error}`);
  return result.ok ? result.value : (undefined as never);
}

/** 只关心 upsert 分支的用例用这个，省掉每个断言里的类型收窄。 */
function okUpsert(raw: unknown): { action: 'upsert'; message_id: string; rating: 1 | -1; comment: string | null } {
  const value = ok(raw);
  assert.equal(value.action, 'upsert', 'expected an upsert, got a delete');
  return value as { action: 'upsert'; message_id: string; rating: 1 | -1; comment: string | null };
}

function err(raw: unknown) {
  const result = normalizeFeedbackInput(raw);
  assert.equal(result.ok, false, 'expected a validation failure');
  return result.ok ? '' : result.error;
}

const MESSAGE_ID = '11111111-1111-1111-1111-111111111111';

test('a thumbs up with no comment is an upsert with a null comment', () => {
  assert.deepEqual(ok({ message_id: MESSAGE_ID, rating: 1 }), {
    action: 'upsert',
    message_id: MESSAGE_ID,
    rating: 1,
    comment: null,
  });
});

test('a thumbs down is representable and keeps its comment', () => {
  assert.deepEqual(ok({ message_id: MESSAGE_ID, rating: -1, comment: '答非所问' }), {
    action: 'upsert',
    message_id: MESSAGE_ID,
    rating: -1,
    comment: '答非所问',
  });
});

test('a null rating with no comment withdraws the feedback', () => {
  assert.deepEqual(ok({ message_id: MESSAGE_ID, rating: null }), { action: 'delete', message_id: MESSAGE_ID });
  assert.deepEqual(ok({ message_id: MESSAGE_ID, rating: null, comment: null }), {
    action: 'delete',
    message_id: MESSAGE_ID,
  });
});

test('a null rating with a comment is rejected: a comment cannot stand alone', () => {
  assert.notEqual(err({ message_id: MESSAGE_ID, rating: null, comment: '想说点什么' }), '');
});

test('ratings outside thumbs up / thumbs down are rejected', () => {
  for (const rating of [0, 2, -2, 5, 1.5, '1', '-1', true, undefined]) {
    assert.notEqual(err({ message_id: MESSAGE_ID, rating }), '', `rating ${String(rating)} must be rejected`);
  }
});

test('a missing or unusable message_id is rejected', () => {
  for (const message_id of [undefined, null, '', '   ', 42, {}, [], 'x'.repeat(37)]) {
    assert.notEqual(err({ message_id, rating: 1 }), '', `message_id ${JSON.stringify(message_id)} must be rejected`);
  }
});

test('the message_id is trimmed and a 36 character id is accepted', () => {
  const padded = `  ${MESSAGE_ID}  `;
  assert.deepEqual(ok({ message_id: padded, rating: 1 }), {
    action: 'upsert',
    message_id: MESSAGE_ID,
    rating: 1,
    comment: null,
  });
});

test('comments are trimmed and blank comments collapse to null', () => {
  assert.equal(okUpsert({ message_id: MESSAGE_ID, rating: 1, comment: '  很好  ' }).comment, '很好');
  assert.equal(okUpsert({ message_id: MESSAGE_ID, rating: 1, comment: '' }).comment, null);
  assert.equal(okUpsert({ message_id: MESSAGE_ID, rating: 1, comment: '   ' }).comment, null);
  assert.equal(okUpsert({ message_id: MESSAGE_ID, rating: 1, comment: undefined }).comment, null);
});

test('the comment length boundary is 500 characters after trimming', () => {
  assert.equal(okUpsert({ message_id: MESSAGE_ID, rating: 1, comment: 'a'.repeat(500) }).comment?.length, 500);
  assert.notEqual(err({ message_id: MESSAGE_ID, rating: 1, comment: 'a'.repeat(501) }), '');
  // 前后空白在长度判定之前就被裁掉，所以 500 个字符加空白仍然合法。
  assert.equal(okUpsert({ message_id: MESSAGE_ID, rating: 1, comment: `  ${'a'.repeat(500)}  ` }).comment?.length, 500);
});

test('non-string comments are rejected rather than coerced', () => {
  for (const comment of [42, true, {}, []]) {
    assert.notEqual(err({ message_id: MESSAGE_ID, rating: 1, comment }), '', `comment ${JSON.stringify(comment)} must be rejected`);
  }
});

test('a non-object payload is rejected instead of throwing', () => {
  for (const raw of [undefined, null, 'string', 42, true, []]) {
    assert.notEqual(err(raw), '', `payload ${JSON.stringify(raw)} must be rejected`);
  }
});
