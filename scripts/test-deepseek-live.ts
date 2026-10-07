import fs from 'node:fs/promises';
import path from 'node:path';

import {loadScriptEnv} from './lib/load-script-env';

import { ChatVisionSafetyProvider } from '@/lib/ai/providers/chat-vision-safety-provider';
import {
  DEEPSEEK_VISION_MODEL,
  DeepSeekChatProvider,
} from '@/lib/ai/providers/deepseek-chat-provider';
import {
  percentile,
  requireLiveCanaryApproval,
} from './lib/live-canary-guard';

loadScriptEnv();

const EXPECTED_REQUESTS = 5;
const PEAK_INPUT_USD_PER_MILLION = 0.44;
const PEAK_OUTPUT_USD_PER_MILLION = 1.32;

function parseBooleanResult(value: unknown): { ok: boolean } {
  if (!value || typeof value !== 'object' || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    throw new Error('DeepSeek structured canary returned an invalid result');
  }
  return { ok: (value as { ok: boolean }).ok };
}

function estimatedPeakCost(inputTokens = 0, outputTokens = 0): number {
  return (
    (inputTokens * PEAK_INPUT_USD_PER_MILLION +
      outputTokens * PEAK_OUTPUT_USD_PER_MILLION) /
    1_000_000
  );
}

async function main() {
  const budget = requireLiveCanaryApproval(process.env, {
    expectedRequests: EXPECTED_REQUESTS,
    hardCostCeilingUsd: 0.25,
  });
  const provider = new DeepSeekChatProvider({
    model: DEEPSEEK_VISION_MODEL,
    env: process.env,
  });
  const safety = new ChatVisionSafetyProvider(provider);
  const imageBytes = new Uint8Array(
    await fs.readFile(path.join(process.cwd(), 'public/characters/deepseek/deepseek_f_01-normal.png')),
  );
  const imageDataUri = `data:image/png;base64,${Buffer.from(imageBytes).toString('base64')}`;
  const durations: number[] = [];
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenMs = 0;

  const trackUsage = (usage?: { inputTokens?: number; outputTokens?: number }) => {
    inputTokens += usage?.inputTokens ?? 0;
    outputTokens += usage?.outputTokens ?? 0;
    const estimatedCostUsd = estimatedPeakCost(inputTokens, outputTokens);
    if (estimatedCostUsd > budget.maxCostUsd) {
      throw new Error('DeepSeek canary reached its declared cost budget');
    }
  };

  let startedAt = Date.now();
  const text = await provider.complete({
    messages: [{ role: 'user', content: '只回复两个字：晚安' }],
    temperature: 0,
    maxAttempts: 1,
    timeoutMs: 120_000,
  });
  requests += 1;
  durations.push(Date.now() - startedAt);
  trackUsage(text.usage);

  startedAt = Date.now();
  const structured = await provider.completeStructured({
    messages: [{ role: 'user', content: '返回 ok 为 true。' }],
    temperature: 0,
    maxAttempts: 1,
    timeoutMs: 120_000,
    outputSchema: {
      name: 'canary_result',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
    },
    parse: parseBooleanResult,
  });
  if (!structured.data.ok) throw new Error('DeepSeek structured canary returned false');
  requests += 1;
  durations.push(Date.now() - startedAt);
  trackUsage(structured.usage);

  startedAt = Date.now();
  let streamedCharacters = 0;
  for await (const chunk of provider.stream({
    messages: [{ role: 'user', content: '用一句很短的话道晚安。' }],
    temperature: 0,
    maxAttempts: 1,
    timeoutMs: 120_000,
  })) {
    if (!firstTokenMs) firstTokenMs = Date.now() - startedAt;
    streamedCharacters += chunk.length;
  }
  if (!streamedCharacters) throw new Error('DeepSeek SSE canary returned no text');
  requests += 1;
  durations.push(Date.now() - startedAt);

  startedAt = Date.now();
  const vision = await provider.complete({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '用不超过十个字描述图片主体。' },
          { type: 'image_url', image_url: { url: imageDataUri, detail: 'low' } },
        ],
      },
    ],
    temperature: 0,
    maxAttempts: 1,
    timeoutMs: 120_000,
  });
  requests += 1;
  durations.push(Date.now() - startedAt);
  trackUsage(vision.usage);

  startedAt = Date.now();
  const inspection = await safety.inspect({
    image: { bytes: imageBytes, mediaType: 'image/jpeg' },
    timeoutMs: 120_000,
  });
  requests += 1;
  durations.push(Date.now() - startedAt);

  if (requests !== budget.maxRequests) {
    throw new Error('DeepSeek canary request count drifted from its declared cap');
  }
  console.log(
    JSON.stringify({
      provider: 'deepseek-official',
      model: DEEPSEEK_VISION_MODEL,
      requests,
      success: true,
      structuredJson: true,
      sseFirstTokenMs: firstTokenMs,
      imageUnderstanding: Boolean(vision.content),
      imageSafetyResult: inspection.safe ? 'safe' : 'unsafe',
      inputTokens,
      outputTokens,
      estimatedPeakCostUsd: Number(estimatedPeakCost(inputTokens, outputTokens).toFixed(8)),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    `DeepSeek live canary failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
