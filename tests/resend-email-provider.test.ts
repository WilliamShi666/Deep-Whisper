import assert from 'node:assert/strict';
import test from 'node:test';

import type { EmailMessage } from '../src/lib/email/contracts';
import {
  ResendEmailProvider,
  ResendHttpError,
  formatSender,
} from '../src/lib/email/providers/resend-email-provider';

const ENV = {
  APP_ENV: 'test',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'letters@whoole.io',
};

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordingFetch(respond: () => Response, calls: RecordedCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function letterMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'reader@example.com',
    from: { address: 'letters@whoole.io', name: '晚 · Deep Whisper' },
    subject: '今天路过那家店',
    text: '正文',
    html: '<p>正文</p>',
    headers: {
      'List-Unsubscribe': '<https://app.example.com/api/letters/unsubscribe?token=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    idempotencyKey: 'letter:delivery-1',
    tags: [{ name: 'category', value: 'companion_letter' }],
    ...overrides,
  };
}

function provider(
  calls: RecordedCall[],
  respond: () => Response,
  env: Readonly<Record<string, string | undefined>> = ENV,
) {
  return new ResendEmailProvider(env, recordingFetch(respond, calls));
}

test('sends exactly one POST to the Resend emails endpoint with the configured sender', async () => {
  const calls: RecordedCall[] = [];
  await provider(calls, () => jsonResponse({ id: 'msg_1' })).send(letterMessage());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer re_test_key');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Idempotency-Key'], 'letter:delivery-1');

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.from, '晚 · Deep Whisper <letters@whoole.io>');
  assert.deepEqual(body.to, ['reader@example.com']);
  assert.equal(body.subject, '今天路过那家店');
  assert.equal(body.text, '正文');
  assert.equal(body.html, '<p>正文</p>');
  assert.deepEqual(body.tags, [{ name: 'category', value: 'companion_letter' }]);
});

test('returns the upstream message id as the receipt', async () => {
  const receipt = await provider([], () => jsonResponse({ id: 'msg_abc' })).send(letterMessage());
  assert.equal(receipt.provider, 'resend');
  assert.equal(receipt.providerMessageId, 'msg_abc');
  assert.equal(receipt.deliveryStatus, 'accepted');
});

test('passes the RFC 8058 unsubscribe headers through unchanged', async () => {
  const calls: RecordedCall[] = [];
  await provider(calls, () => jsonResponse({ id: 'msg_1' })).send(letterMessage());

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.deepEqual(body.headers, {
    'List-Unsubscribe': '<https://app.example.com/api/letters/unsubscribe?token=abc>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
});

test('uses the configured sender as the reply address fallback', async () => {
  const calls: RecordedCall[] = [];
  await provider(calls, () => jsonResponse({ id: 'msg_1' })).send(letterMessage());

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.reply_to, ENV.EMAIL_FROM);
});

test('includes reply_to when configured so a real human can read replies', async () => {
  const calls: RecordedCall[] = [];
  const env = { ...ENV, EMAIL_REPLY_TO: 'hi@whoole.io' };
  await provider(calls, () => jsonResponse({ id: 'msg_1' }), env).send(letterMessage());

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.reply_to, 'hi@whoole.io');
});

test('lets a message override the account-level reply address', async () => {
  const calls: RecordedCall[] = [];
  const env = { ...ENV, EMAIL_REPLY_TO: 'hi@whoole.io' };
  await provider(calls, () => jsonResponse({ id: 'msg_1' }), env).send(
    letterMessage({ replyTo: 'someone@whoole.io' }),
  );

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.reply_to, 'someone@whoole.io');
});

test('maps 401 to a non-retryable error and never leaks the upstream body', async () => {
  const error = await provider([], () =>
    jsonResponse(
      { name: 'validation_error', message: 'SECRET_UPSTREAM_DETAIL' },
      401,
    ),
  ).send(letterMessage()).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ResendHttpError);
  assert.equal(error.status, 401);
  assert.equal(error.retryable, false);
  assert.match(error.message, /validation_error/);
  assert.equal(error.message.includes('SECRET_UPSTREAM_DETAIL'), false);
});

test('shapes the upstream code instead of passing it through verbatim', async () => {
  const error = await provider([], () =>
    jsonResponse({ name: '<img src=x onerror=alert(1)>' }, 422),
  ).send(letterMessage()).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ResendHttpError);
  assert.equal(error.upstreamCode, undefined);
  assert.equal(error.message.includes('onerror'), false);
});

test('maps 429 to a retryable error', async () => {
  const error = await provider([], () => jsonResponse({ name: 'rate_limited' }, 429))
    .send(letterMessage())
    .then(
      () => null,
      (thrown: unknown) => thrown,
    );

  assert.ok(error instanceof ResendHttpError);
  assert.equal(error.retryable, true);
});

test('refuses to send from any address other than EMAIL_FROM', async () => {
  const calls: RecordedCall[] = [];
  await assert.rejects(
    () => provider(calls, () => jsonResponse({ id: 'msg_1' })).send(
      letterMessage({ from: { address: 'someone@other.example' } }),
    ),
    /configured EMAIL_FROM address/,
  );
  assert.equal(calls.length, 0);
});

test('refuses a display name that would break the From header', () => {
  assert.equal(formatSender({ address: 'a@b.co' }), 'a@b.co');
  assert.equal(formatSender({ address: 'a@b.co', name: ' 晚 ' }), '晚 <a@b.co>');
  for (const name of ['晚 <evil@example.com>', '晚"x', '晚\nBcc: x']) {
    assert.throws(() => formatSender({ address: 'a@b.co', name }), /display name/);
  }
});

test('refuses an empty subject', async () => {
  await assert.rejects(
    () => provider([], () => jsonResponse({ id: 'msg_1' })).send(letterMessage({ subject: '   ' })),
    /subject must not be empty/,
  );
});

test('refuses an oversized subject', async () => {
  await assert.rejects(
    () => provider([], () => jsonResponse({ id: 'msg_1' })).send(
      letterMessage({ subject: 'a'.repeat(201) }),
    ),
    /subject must not exceed/,
  );
});

test('refuses an invalid recipient', async () => {
  await assert.rejects(
    () => provider([], () => jsonResponse({ id: 'msg_1' })).send(letterMessage({ to: 'nope' })),
    /valid mailbox/,
  );
});

test('requires RESEND_API_KEY', async () => {
  const env = { APP_ENV: 'test', EMAIL_FROM: 'letters@whoole.io' };
  await assert.rejects(
    () => provider([], () => jsonResponse({ id: 'msg_1' }), env).send(letterMessage()),
    /RESEND_API_KEY/,
  );
});

test('requires EMAIL_FROM', async () => {
  const env = { APP_ENV: 'test', RESEND_API_KEY: 're_test_key' };
  await assert.rejects(
    () => provider([], () => jsonResponse({ id: 'msg_1' }), env).send(letterMessage()),
    /EMAIL_FROM/,
  );
});

test('fails when the upstream accepts the message without returning an id', async () => {
  await assert.rejects(
    () => provider([], () => jsonResponse({})).send(letterMessage()),
    /without returning a message id/,
  );
});

test('turns a network failure into a message that carries no credentials', async () => {
  const failing = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const error = await new ResendEmailProvider(ENV, failing).send(letterMessage()).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof Error);
  assert.match(error.message, /Resend network failure/);
  assert.equal(error.message.includes('re_test_key'), false);
});
