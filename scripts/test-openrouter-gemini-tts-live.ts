import {loadScriptEnv} from './lib/load-script-env';

import {
  OPENROUTER_GEMINI_TTS_MODEL,
  OpenRouterGeminiSpeechProvider,
} from '@/lib/ai/providers/openrouter-gemini-speech-provider';
import { getProviderConfig } from '@/lib/config/runtime';
import { percentile, requireLiveCanaryApproval } from './lib/live-canary-guard';

loadScriptEnv();

const EXPECTED_REQUESTS = 1;
const PEAK_COST_USD = 0.01;
const CANARY_TEXT = '晚安，做个好梦。';
const CANARY_VOICE = 'Chinese (Mandarin)_Gentle_Senior';

async function main() {
  const budget = requireLiveCanaryApproval(process.env, {
    expectedRequests: EXPECTED_REQUESTS,
    hardCostCeilingUsd: PEAK_COST_USD,
  });
  const config = getProviderConfig(process.env).speech;
  if (
    config.provider !== 'openrouter-gemini' ||
    config.model !== OPENROUTER_GEMINI_TTS_MODEL
  ) {
    throw new Error(
      'Gemini TTS live canary requires AI_TTS_PROVIDER=openrouter-gemini and google/gemini-3.1-flash-tts-preview',
    );
  }

  const startedAt = Date.now();
  // Deliberately bypasses the runtime fallback: this is exactly one Gemini
  // request; runtime fallback cannot generate a second paid request.
  const result = await new OpenRouterGeminiSpeechProvider(process.env).synthesize({
    text: CANARY_TEXT,
    voice: CANARY_VOICE,
    timeoutMs: 120_000,
  });
  const durationMs = Date.now() - startedAt;
  if (!result.bytes.length) throw new Error('Gemini TTS live canary returned empty audio');

  console.log(
    JSON.stringify({
      provider: 'openrouter',
      model: result.model,
      requests: EXPECTED_REQUESTS,
      success: true,
      durationMs,
      p50Ms: percentile([durationMs], 0.5),
      p95Ms: percentile([durationMs], 0.95),
      bytes: result.bytes.length,
      mediaType: result.mediaType,
      providerRequestId: result.providerRequestId,
      costCeilingUsd: budget.maxCostUsd,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    `OpenRouter Gemini TTS live canary failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
