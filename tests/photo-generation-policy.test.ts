import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderError } from '../src/lib/ai/contracts';
import { shouldRetryWithSafePhotoScene } from '../src/lib/ai/image-generation-policy';

test('safe-scene fallback is allowed only for an LLM scene and a policy rejection', () => {
  assert.equal(
    shouldRetryWithSafePhotoScene(
      new ProviderError('policy rejected', 'policy_rejected', false),
      true,
    ),
    true,
  );
  assert.equal(
    shouldRetryWithSafePhotoScene(
      new ProviderError('rate limited', 'rate_limited', true),
      true,
    ),
    false,
  );
  assert.equal(
    shouldRetryWithSafePhotoScene(
      new ProviderError('bad request', 'bad_request', false),
      true,
    ),
    false,
  );
  assert.equal(
    shouldRetryWithSafePhotoScene(
      new ProviderError('policy rejected', 'policy_rejected', false),
      false,
    ),
    false,
  );
  assert.equal(shouldRetryWithSafePhotoScene(new Error('unknown'), true), false);
});

test('transient image failures do not spend a second safe-scene request', () => {
  for (const code of ['network', 'timeout', 'upstream_unavailable', 'rate_limited'] as const) {
    assert.equal(shouldRetryWithSafePhotoScene(new ProviderError(code, code, true), true), false);
  }
});
