/** Personal memory wiring: SQLite owns persistence; no Mem0/Supabase configuration. */
import { getPersonalConfig, getProviderConfig, type RuntimeEnvironment } from '@/lib/config/runtime';
import { getEmbeddingProvider } from '@/lib/ai/embedding-provider';
import { getEmbeddingNamespace } from '@/lib/ai/embedding-namespace';
import { getSqlite } from '@/storage/database/db';
import { createProviderMemoryOrganizer } from './organizer';
import { createMemoryService } from './service';
import { createSqliteMemoryGateway, PERSONAL_MEMORY_APP_ID } from './sqlite-gateway';
import { resolveUserTimeZone } from './time-source';

export type MemoryBackend = 'local';
export function resolveMemoryBackend(env?: RuntimeEnvironment): MemoryBackend { void env; return 'local'; }
export function isMemoryEnabled(env?: RuntimeEnvironment): boolean { void env; return true; }
export function isLongTermMemoryEnabled(): boolean { return true; }
export function getMemoryDependencies(env: RuntimeEnvironment = process.env, db: ReturnType<typeof getSqlite> = getSqlite()) {
  const config = getPersonalConfig(env, { strict: false });
  const provider = config.memoryRetrievalMode === 'hybrid' ? getEmbeddingProvider({ ...env }) : undefined;
  return { appId: PERSONAL_MEMORY_APP_ID, gateway: createSqliteMemoryGateway(db, {
    retrievalMode: config.memoryRetrievalMode,
    embeddingModel: getEmbeddingNamespace(config.providers.embedding),
    embeddingDimensions: config.providers.embedding.dimensions,
    embed: provider ? request => provider.embed(request) : undefined,
  }) };
}
/** The supervised worker uses the same resolved mode and provider namespace as chat. */
export function getMemoryWorkerOptions(env: RuntimeEnvironment = process.env) {
  const config = getPersonalConfig(env, { strict: false });
  const embeddingModel = getEmbeddingNamespace(config.providers.embedding);
  const provider = config.memoryRetrievalMode === 'hybrid' ? getEmbeddingProvider({ ...env }) : undefined;
  return {
    appId: PERSONAL_MEMORY_APP_ID,
    retrievalMode: config.memoryRetrievalMode,
    embeddingModel,
    embeddingDimensions: config.providers.embedding.dimensions,
    isEmbeddingTargetCurrent: () => getEmbeddingNamespace(getProviderConfig(env).embedding) === embeddingModel,
    organizer: createProviderMemoryOrganizer(),
    organizerModel: getProviderConfig(env).chat.model,
    embed: config.memoryRetrievalMode === 'hybrid'
      ? (request: Parameters<ReturnType<typeof getEmbeddingProvider>['embed']>[0]) => provider!.embed(request)
      : undefined,
  };
}
export function getMemoryService() {
  const deps = getMemoryDependencies();
  return createMemoryService({ enabled: true, appId: deps.appId, gateway: deps.gateway,
    organizer: createProviderMemoryOrganizer(), organizerModel: getProviderConfig().chat.model,
    resolveTimeZone: async (visitorId) => {
      const row = getSqlite().prepare('SELECT timezone FROM user_profiles WHERE visitor_id=?').get(visitorId) as { timezone?: string } | undefined;
      return resolveUserTimeZone(row?.timezone);
    },
  });
}
