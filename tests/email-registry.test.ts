import assert from 'node:assert/strict';
import test from 'node:test';

import { getEmailProvider } from '../src/lib/email/registry';
import { E2EMockEmailProvider } from '../src/lib/email/providers/e2e-mock-email-provider';
import { ResendEmailProvider } from '../src/lib/email/providers/resend-email-provider';
import { getE2EMockTrace, resetE2EMockTrace } from '../src/lib/ai/providers/e2e-mock-trace';

function mockModeEnv(): Record<string, string> {
  return {
    APP_ENV: 'test', EMAIL_PROVIDER: 'resend',
    E2E_MOCK_PROVIDERS: '1',
  };
}

test('explicit Resend selects the Resend provider', () => {
  const provider = getEmailProvider({ APP_ENV: 'development', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'fixture-key', EMAIL_FROM: 'owner@example.test' });
  assert.ok(provider instanceof ResendEmailProvider);
});

test('E2E mode swaps in the mock provider', () => {
  const provider = getEmailProvider(mockModeEnv());
  assert.ok(provider instanceof E2EMockEmailProvider);
});

test('E2E mode refuses to run with a real Resend credential present', () => {
  assert.throws(
    () => getEmailProvider({ ...mockModeEnv(), RESEND_API_KEY: 're_real_looking_key' }),
    /refuse real provider credentials/,
  );
});

test('the E2E mock records the letter instead of sending it', async () => {
  resetE2EMockTrace();
  await getEmailProvider(mockModeEnv()).send({
    to: 'reader@example.com',
    from: { address: 'letters@whoole.io', name: '晚 · Deep Whisper' },
    subject: '今天路过那家店',
    text: '正文',
    html: '<p>正文</p>',
    idempotencyKey: 'letter:delivery-1',
  });

  const calls = getE2EMockTrace().emailCalls;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'reader@example.com');
  assert.equal(calls[0].from, '晚 · Deep Whisper <letters@whoole.io>');
  assert.equal(calls[0].subject, '今天路过那家店');
  assert.equal(calls[0].idempotencyKey, 'letter:delivery-1');
  resetE2EMockTrace();
});

test('default personal edition does not send external email', async () => {
  await assert.rejects(getEmailProvider({APP_ENV:'test'}).send({to:'owner@example.test',from:{address:'sender@example.test',name:'Deep Whisper'},subject:'test',text:'test',html:'test',idempotencyKey:'test'}), /not configured/);
});
