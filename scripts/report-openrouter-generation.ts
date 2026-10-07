import {loadScriptEnv} from './lib/load-script-env';

loadScriptEnv();

async function main() {
  const generationId = process.argv[2]?.trim();
  if (!generationId || !/^gen-[A-Za-z\d_-]+$/.test(generationId)) {
    throw new Error('Provide one OpenRouter generation ID');
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing required environment variable: OPENROUTER_API_KEY');

  const response = await fetch(
    `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) throw new Error(`OpenRouter generation metadata failed (${response.status})`);

  const payload = (await response.json()) as {
    data?: {
      model?: string;
      provider_name?: string;
      total_cost?: number;
      tokens_prompt?: number;
      tokens_completion?: number;
      generation_time?: number;
    };
  };
  const data = payload.data;
  console.log(
    JSON.stringify({
      model: data?.model,
      provider: data?.provider_name,
      totalCostUsd: data?.total_cost,
      inputTokens: data?.tokens_prompt,
      outputTokens: data?.tokens_completion,
      generationTimeMs: data?.generation_time,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown generation metadata error');
  process.exitCode = 1;
});
