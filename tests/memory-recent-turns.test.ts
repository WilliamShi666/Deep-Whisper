import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecentTurns, MAX_RECENT_TURNS } from '../src/lib/memory/recent-turns';

type HistoryRow = {
  id: string;
  role: string;
  content: string | null;
  content_type: string | null;
};

function row(
  id: string,
  role: 'user' | 'assistant',
  content: string | null,
  content_type = 'text',
): HistoryRow {
  return { id, role, content, content_type };
}

test('T-10 route side: only the most recent paired turns survive, in chronological order', () => {
  const history = [
    row('u1', 'user', '早上好'),
    row('a1', 'assistant', '早呀'),
    row('u2', 'user', '那家店还不错'),
    row('a2', 'assistant', '下次我们再去'),
    row('u3', 'user', '就周三吧'),
    row('a3', 'assistant', '好，我记下了'),
    row('u4', 'user', '顺便买点花'),
    row('a4', 'assistant', '好呀，买你喜欢的'),
  ];

  const turns = buildRecentTurns(history);

  assert.equal(turns.length, MAX_RECENT_TURNS);
  assert.deepEqual(
    turns.map((turn) => turn.userText),
    ['早上好', '那家店还不错', '就周三吧', '顺便买点花'],
  );
  assert.deepEqual(turns[turns.length - 1], {
    userText: '顺便买点花',
    assistantText: '好呀，买你喜欢的',
  });
});

test('T-10 route side: the current exchange is excluded so the organizer never reads it twice', () => {
  const history = [
    row('u1', 'user', '那家店还不错'),
    row('a1', 'assistant', '下次我们再去'),
    row('u2', 'user', '我到纽约了'),
  ];

  const turns = buildRecentTurns(history, { excludeMessageId: 'u2' });

  assert.deepEqual(turns, [
    { userText: '那家店还不错', assistantText: '下次我们再去' },
  ]);
});

test('T-10 route side: an unmatched trailing user message never becomes a turn', () => {
  const history = [
    row('u1', 'user', '那家店还不错'),
    row('a1', 'assistant', '下次我们再去'),
    row('u2', 'user', '我到纽约了'),
  ];

  const turns = buildRecentTurns(history);

  assert.deepEqual(turns, [
    { userText: '那家店还不错', assistantText: '下次我们再去' },
  ]);
});

test('T-10 route side: image and blank rows are skipped without breaking pairing', () => {
  const history = [
    row('u1', 'user', '那家店还不错'),
    row('i1', 'user', '[图片]', 'image'),
    row('a1', 'assistant', '下次我们再去'),
    row('b1', 'assistant', '   '),
    row('u2', 'user', '就周三吧'),
    row('a2', 'assistant', '好，我记下了'),
  ];

  const turns = buildRecentTurns(history);

  assert.deepEqual(turns, [
    { userText: '那家店还不错', assistantText: '下次我们再去' },
    { userText: '就周三吧', assistantText: '好，我记下了' },
  ]);
});

test('T-10 route side: nothing pairable yields an empty list, never a fabricated turn', () => {
  assert.deepEqual(buildRecentTurns([]), []);
  assert.deepEqual(buildRecentTurns([row('u1', 'user', '只有一句')]), []);
  assert.deepEqual(
    buildRecentTurns([row('u1', 'user', '只有一句'), row('a1', 'assistant', '  ')]),
    [],
  );
});

test('T-10 route side: the limit is honoured and never exceeds MAX_RECENT_TURNS', () => {
  const history: HistoryRow[] = [];
  for (let index = 0; index < 10; index += 1) {
    history.push(row('u' + String(index), 'user', 'user-' + String(index)));
    history.push(row('a' + String(index), 'assistant', 'assistant-' + String(index)));
  }

  const turns = buildRecentTurns(history);
  assert.equal(turns.length, MAX_RECENT_TURNS);
  assert.equal(turns[turns.length - 1].userText, 'user-9');

  const narrowed = buildRecentTurns(history, { limit: 2 });
  assert.deepEqual(
    narrowed.map((turn) => turn.userText),
    ['user-8', 'user-9'],
  );
});
