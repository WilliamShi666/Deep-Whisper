/** Shared values only. Browser-facing runtime configuration must not import adapters. */
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash' as const;

export const OPENROUTER_GEMINI_IMAGE_MODEL =
  'google/gemini-3.1-flash-lite-image' as const;
export const OPENROUTER_GPT_IMAGE_MODEL = 'openai/gpt-image-2' as const;

export type OpenRouterImageModel =
  | typeof OPENROUTER_GEMINI_IMAGE_MODEL
  | typeof OPENROUTER_GPT_IMAGE_MODEL;

export const OPENROUTER_IMAGE_MODELS = [
  OPENROUTER_GEMINI_IMAGE_MODEL,
  OPENROUTER_GPT_IMAGE_MODEL,
] as const satisfies readonly OpenRouterImageModel[];

/** 默认模型：GPT Image 2（画质更可靠）。改回 Gemini 只需改这一个常量。 */
export const OPENROUTER_IMAGE_MODEL: OpenRouterImageModel =
  OPENROUTER_GPT_IMAGE_MODEL;
