import { createHash } from 'node:crypto';
import type { ProviderConfig } from '@/lib/config/runtime';

/** Persist an opaque vector-space ID, never a credential or an endpoint URL. */
export function getEmbeddingNamespace(config: ProviderConfig['embedding']): string {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  // Preserve existing vectors from the unchanged native endpoint/1024 profile,
  // including previously configured models. Custom endpoints cannot share it.
  if (config.provider === 'dashscope'
    && baseUrl === 'https://maas.qianwenaiapi.com/compatible-mode/v1'
    && config.dimensions === 1024) return config.model;
  const identity = JSON.stringify([config.provider, baseUrl, config.model, config.dimensions]);
  return `embedding:v1:${createHash('sha256').update(identity).digest('hex')}`;
}
