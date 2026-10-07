import fs from 'node:fs/promises';
import path from 'node:path';

import {loadScriptEnv} from './lib/load-script-env';

import {personalImageCanaryCases,IMAGE_CANARY_REQUESTS} from './lib/image-canary-plan';
import {getProviderConfig} from '@/lib/config/runtime';
import {getObjectStore} from '@/lib/storage/object-store';
import {readPrivateMedia} from '@/lib/storage/local-object-store';
import {
  OpenRouterImageProvider,
} from '@/lib/ai/providers/openrouter-image-provider';
import {
  percentile,
  requireLiveCanaryApproval,
} from './lib/live-canary-guard';

loadScriptEnv();

const EXPECTED_REQUESTS = IMAGE_CANARY_REQUESTS;

function extension(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/webp') return 'webp';
  return 'png';
}

async function main() {
  const budget = requireLiveCanaryApproval(process.env, {
    expectedRequests: EXPECTED_REQUESTS,
    hardCostCeilingUsd: 1,
  });
  const cases=personalImageCanaryCases();
  const config=getProviderConfig();
  const provider = new OpenRouterImageProvider({
    model: config.image.model,
    env: process.env,
  });
  const objectStore = getObjectStore();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const durations: number[] = [];
  const roles: Array<Record<string, unknown>> = [];
  let totalCostUsd = 0;

  for (const character of cases) {
    const avatarPath = path.join(
      process.cwd(),
      'public',
      character.referencePath.replace(/^\//, ''),
    );
    const referenceBytes = new Uint8Array(await fs.readFile(avatarPath));
    const generated = await provider.generate({
      prompt:character.prompt,
      referenceImages: [{ bytes: referenceBytes, mediaType:character.mediaType }],
      size: '1K',
      aspectRatio: '1:1',
      maxAttempts: 1,
      timeoutMs: 180_000,
    });
    if (typeof generated.costUsd !== 'number') {
      throw new Error('OpenRouter image canary did not return usage.cost');
    }
    totalCostUsd += generated.costUsd;
    if (totalCostUsd > budget.maxCostUsd) {
      throw new Error('OpenRouter image canary reached its declared cost budget');
    }
    const stored = await objectStore.put({
      key: `canary/ai-provider-migration/${runId}/${character.characterKey}.${extension(generated.mediaType)}`,
      bytes: generated.bytes,
      mediaType: generated.mediaType,
      cacheControl: 'private, max-age=0, no-store',
    });
    let persistenceStatus=200;
    if(config.objectStorage.provider==='local'){
      const saved=await readPrivateMedia(stored.key);
      if(!Buffer.from(generated.bytes).equals(saved.bytes))throw new Error('Local persistence verification failed');
    }else{
      const response=await fetch(stored.url,{method:'HEAD',signal:AbortSignal.timeout(30_000)});
      if(!response.ok)throw new Error(`Configured object persistence verification failed (${response.status})`);
      persistenceStatus=response.status;
    }
    durations.push(generated.durationMs ?? 0);
    roles.push({
      characterKey: character.characterKey,
      success: true,
      durationMs: generated.durationMs,
      costUsd: generated.costUsd,
      bytes: generated.bytes.length,
      mediaType: generated.mediaType,
      providerRequestId: generated.providerRequestId,
      persistenceStatus,
    });
  }

  if (roles.length !== budget.maxRequests) {
    throw new Error('OpenRouter image canary request count drifted from its declared cap');
  }
  console.log(
    JSON.stringify({
      provider: 'openrouter',
      model: config.image.model,
      requests: roles.length,
      success: true,
      totalCostUsd: Number(totalCostUsd.toFixed(8)),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      roles,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    `OpenRouter image live canary failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
