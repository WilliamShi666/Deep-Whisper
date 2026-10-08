import {
  getProviderConfig,
  isE2EMockProviderMode,
  type EmbeddingProviderId,
  type RuntimeEnvironment,
} from '@/lib/config/runtime';
import { E2EMockEmbeddingProvider } from './providers/e2e-mock-providers';
import { DashScopeEmbeddingProvider } from './providers/dashscope-embedding-provider';
import type { EmbeddingProvider } from './embedding-contracts';

/**
 * embedding provider 注册表。
 *
 * 与既有 registry 同一模式：**供应商选择只发生在这一处**，而「选哪一个」来自
 * `getProviderConfig(env).embedding.provider`（`runtime.ts` 是环境与 provider 选择的唯一入口）。
 * 业务代码只依赖 `EmbeddingProvider` 契约；E2E 由 mock 接管，绝不打真实 DashScope。
 *
 * 为什么不是硬编码：修前这里直接 `new DashScopeEmbeddingProvider(env)`，
 * 于是 `AI_EMBEDDING_PROVIDER` 这个变量**没有任何代码读取** —— 一个测试还在为它背书。
 */
const EMBEDDING_REGISTRY: Record<EmbeddingProviderId, (env: RuntimeEnvironment) => EmbeddingProvider> = {
  dashscope: (env) => new DashScopeEmbeddingProvider(env),
  'openai-compatible': (env) => new DashScopeEmbeddingProvider(env),
};

export function getEmbeddingProvider(
  env: RuntimeEnvironment = process.env,
): EmbeddingProvider {
  if (isE2EMockProviderMode(env)) return new E2EMockEmbeddingProvider(getProviderConfig(env).embedding.dimensions);
  return EMBEDDING_REGISTRY[getProviderConfig(env).embedding.provider](env);
}
