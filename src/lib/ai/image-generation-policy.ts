import { ProviderError } from './contracts';

/** Retry a requested scene once only when the image provider rejects its policy. */
export function shouldRetryWithSafePhotoScene(error: unknown, usedLlmScene: boolean): boolean {
  return usedLlmScene && error instanceof ProviderError && error.code === 'policy_rejected';
}
