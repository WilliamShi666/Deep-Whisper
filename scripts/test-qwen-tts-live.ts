import {loadScriptEnv} from './lib/load-script-env';

import {
  QWEN_AUDIO_TTS_MODEL,
  QwenAudioSpeechProvider,
} from '@/lib/ai/providers/qwen-audio-speech-provider';
import { getProviderConfig } from '@/lib/config/runtime';
import { percentile, requireLiveCanaryApproval } from './lib/live-canary-guard';

// 共用 Next 优先级加载器；命令行环境优先，test 不读 .env.local。
loadScriptEnv();

/**
 * qwen-audio-3.1-tts-flash 的真实链路 canary（付费，需显式确认）。
 *
 * 走的是**真实适配器**而不是裸 curl：它证明两跳链路（合成 → 下载临时 URL → 拿到 bytes）
 * 在真实上游上成立，而且返回值里不含临时 URL。固定 1 次请求，绝不重试。
 */
const EXPECTED_REQUESTS = 1;
const PEAK_COST_USD = 0.01;
const CANARY_TEXT = '晚安，做个好梦。';
// 用女声默认音色，让 canary 同时覆盖产品下拉里的那一个。
const CANARY_VOICE = 'longanlingxin_v3.1';

async function main() {
  const budget = requireLiveCanaryApproval(process.env, {
    expectedRequests: EXPECTED_REQUESTS,
    hardCostCeilingUsd: PEAK_COST_USD,
  });
  const config = getProviderConfig(process.env).speech;
  if (config.provider !== 'qwen-audio' || config.model !== QWEN_AUDIO_TTS_MODEL) {
    throw new Error(
      'Qwen TTS live canary requires AI_TTS_PROVIDER=qwen-audio and ' + QWEN_AUDIO_TTS_MODEL,
    );
  }

  const startedAt = Date.now();
  const result = await new QwenAudioSpeechProvider(process.env).synthesize({
    text: CANARY_TEXT,
    voice: CANARY_VOICE,
    timeoutMs: 120_000,
  });
  const durationMs = Date.now() - startedAt;
  if (!result.bytes.length) throw new Error('Qwen TTS live canary returned empty audio');
  // 契约：provider 不得把上游临时 URL 交给调用方。
  if (JSON.stringify(result).includes('aliyuncs.com')) {
    throw new Error('Qwen TTS live canary leaked an upstream temporary url');
  }

  console.log(
    JSON.stringify({
      provider: 'qwen-audio',
      model: result.model,
      voice: CANARY_VOICE,
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
    'Qwen TTS live canary failed: ' + (error instanceof Error ? error.message : 'unknown error'),
  );
  process.exitCode = 1;
});
