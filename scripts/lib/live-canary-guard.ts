type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_IS_PAID';

interface CanaryLimits {
  expectedRequests: number;
  hardCostCeilingUsd: number;
}

export interface ApprovedCanaryBudget {
  maxRequests: number;
  maxCostUsd: number;
}

function finitePositiveNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
  return parsed;
}

export function requireLiveCanaryApproval(
  env: RuntimeEnvironment,
  limits: CanaryLimits,
): ApprovedCanaryBudget {
  if (env.AI_PROVIDER_LIVE_CANARY !== ACKNOWLEDGEMENT) {
    throw new Error(
      `Set AI_PROVIDER_LIVE_CANARY=${ACKNOWLEDGEMENT} to acknowledge a paid live test`,
    );
  }
  const maxRequests = finitePositiveNumber(
    env.AI_PROVIDER_LIVE_MAX_REQUESTS,
    'AI_PROVIDER_LIVE_MAX_REQUESTS',
  );
  if (!Number.isInteger(maxRequests) || maxRequests !== limits.expectedRequests) {
    throw new Error(
      `AI_PROVIDER_LIVE_MAX_REQUESTS must be exactly ${limits.expectedRequests}`,
    );
  }
  const maxCostUsd = finitePositiveNumber(
    env.AI_PROVIDER_LIVE_MAX_COST_USD,
    'AI_PROVIDER_LIVE_MAX_COST_USD',
  );
  if (maxCostUsd > limits.hardCostCeilingUsd) {
    throw new Error(
      `AI_PROVIDER_LIVE_MAX_COST_USD must be at most ${limits.hardCostCeilingUsd}`,
    );
  }
  return { maxRequests, maxCostUsd };
}

export function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(Math.min(1, Math.max(0, quantile)) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}
