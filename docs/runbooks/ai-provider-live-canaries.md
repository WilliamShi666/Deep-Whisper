# Personal edition AI live canaries

Optional paid probes only. Normal setup, doctor, unit tests and E2E do not call real providers. A probe requires a one-shot acknowledgement, its exact request allowance and declared cost threshold. Keep acknowledgements out of saved env files. Run on Node24/pnpm after the owner explicitly authorizes the account, cost and storage target.

Scripts use loadScriptEnv(): inherited shell wins, then .env.<NODE_ENV>.local, .env.local, .env.<NODE_ENV>, .env. Test omits .env.local. Collect keys and paired endpoints using docs/opensource/04-environment.md. Do not borrow the commercial project's credentials or live results.

| Probe | Doctor option | Maximum provider requests | Hard declared cost ceiling |
|---|---|---:|---:|
| DeepSeek text/structured/SSE/vision/safety | --provider deepseek | 5 | USD0.25 |
| OpenRouter reference images | --provider image | 8 | USD1.00 |
| Qwen TTS | --provider qwen-tts | 1 | USD0.01 |
| Gemini TTS | --provider gemini-tts | 1 | USD0.01 |

The ceiling is a guard, not a vendor price quote or billing guarantee. A failed/partial probe stops; do not rerun or change models to manufacture a pass. Reports omit prompts, media bytes, credentials and permanent URLs. These probes write no database rows.

## DeepSeek

Exactly five requests with retries disabled: text, structured JSON, SSE, image understanding and strict safety. Uses the project's pinned Vision-capable DeepSeek model. Token usage and a conservative estimate are reported; account/model errors fail the canary.

```sh
AI_PROVIDER_LIVE_CANARY=I_UNDERSTAND_THIS_IS_PAID \
AI_PROVIDER_LIVE_MAX_REQUESTS=5 AI_PROVIDER_LIVE_MAX_COST_USD=0.05 \
pnpm run doctor --live --provider deepseek
```

## OpenRouter image and selected storage

One request per **eight** current character presets, using normal-proportion PNG references with correct image/png MIME. The actual configured AI_IMAGE_MODEL defaults to openai/gpt-image-2. Adapter parameters match the selected model (GPT quality/aspect_ratio; Gemini resolution/n). No fallback or retry.

Local private storage is the default in every APP_ENV. Objects under canary/ai-provider-migration/<run-id>/ are retained and read back for byte equality. Explicit R2 with all five variables instead verifies objects with HEAD. Cloud bucket/public URL policy is the owner's responsibility. Paid-run objects remain retained.

```sh
AI_PROVIDER_LIVE_CANARY=I_UNDERSTAND_THIS_IS_PAID \
AI_PROVIDER_LIVE_MAX_REQUESTS=8 AI_PROVIDER_LIVE_MAX_COST_USD=0.50 \
pnpm run doctor --live --provider image
```

Per-request and total cost are checked when returned; missing or over-budget cost stops further generation. Offline tests cover eight real PNG references, configured-model selection, local storage and dispatch/count boundaries. They do not prove live images.

## Qwen TTS

One synthesis POST through the actual adapter plus its temporary OSS download, retries disabled. Returns nonempty bytes, never the temporary URL. MaaS endpoint/key/model must match your platform.

```sh
AI_TTS_PROVIDER=qwen-audio AI_TTS_MODEL=qwen-audio-3.1-tts-flash \
AI_PROVIDER_LIVE_CANARY=I_UNDERSTAND_THIS_IS_PAID \
AI_PROVIDER_LIVE_MAX_REQUESTS=1 AI_PROVIDER_LIVE_MAX_COST_USD=0.01 \
pnpm run doctor --live --provider qwen-tts
```

## Gemini TTS

One direct OpenRouter adapter /audio/speech call with the matching model, historical voice alias and PCM-to-WAV checks. Bypasses runtime fallback: at most one paid synthesis request.

```sh
AI_TTS_PROVIDER=openrouter-gemini \
AI_TTS_MODEL=google/gemini-3.1-flash-tts-preview \
AI_PROVIDER_LIVE_CANARY=I_UNDERSTAND_THIS_IS_PAID \
AI_PROVIDER_LIVE_MAX_REQUESTS=1 AI_PROVIDER_LIVE_MAX_COST_USD=0.01 \
pnpm run doctor --live --provider gemini-tts
```

## Optional bulk voice audition

pnpm tts:audition:qwen is a separate explicitly approved paid batch. Cold-cache plan:249 slots (53 Chinese-only voices ×3,15 English voices ×6), existing files skip synthesis. Only after batch authorization set the acknowledgement, MAX_REQUESTS=249 and MAX_COST_USD=1.00. Output is gitignored public/tts-preview/qwen-audition/; the read-only experimental /qwen-voices page is not linked from the product. Sample redistribution needs separate rights review.

Canaries establish wire format and persistence only. Actual voice listening, account entitlement, image fidelity, and native Windows/Linux execution require observed acceptance. This checkout has no live-canary result; commercial-project history is not acceptance evidence.
