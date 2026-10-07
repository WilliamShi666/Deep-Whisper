import assert from 'node:assert/strict';
import test from 'node:test';

import {
  percentile,
  requireLiveCanaryApproval,
} from '../scripts/lib/live-canary-guard';

test('live canary requires explicit paid-test acknowledgement', () => {
  assert.throws(
    () =>
      requireLiveCanaryApproval(
        { AI_PROVIDER_LIVE_MAX_REQUESTS: '5', AI_PROVIDER_LIVE_MAX_COST_USD: '0.25' },
        { expectedRequests: 5, hardCostCeilingUsd: 0.25 },
      ),
    /AI_PROVIDER_LIVE_CANARY/,
  );
});

test('live canary requires the exact request count and a finite hard cost ceiling', () => {
  const approved = {
    AI_PROVIDER_LIVE_CANARY: 'I_UNDERSTAND_THIS_IS_PAID',
    AI_PROVIDER_LIVE_MAX_REQUESTS: '5',
    AI_PROVIDER_LIVE_MAX_COST_USD: '0.20',
  };
  assert.deepEqual(
    requireLiveCanaryApproval(approved, {
      expectedRequests: 5,
      hardCostCeilingUsd: 0.25,
    }),
    { maxRequests: 5, maxCostUsd: 0.2 },
  );
  assert.throws(
    () =>
      requireLiveCanaryApproval(
        { ...approved, AI_PROVIDER_LIVE_MAX_REQUESTS: '6' },
        { expectedRequests: 5, hardCostCeilingUsd: 0.25 },
      ),
    /exactly 5/,
  );
  assert.throws(
    () =>
      requireLiveCanaryApproval(
        { ...approved, AI_PROVIDER_LIVE_MAX_COST_USD: '0.26' },
        { expectedRequests: 5, hardCostCeilingUsd: 0.25 },
      ),
    /at most 0.25/,
  );
});

test('percentile reports deterministic p50 and p95 values', () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
  assert.equal(percentile([], 0.95), 0);
});
