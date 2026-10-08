import path from 'node:path';
import { DEEPSEEK_VISION_MODEL, OPENROUTER_IMAGE_MODEL } from '@/lib/ai/model-defaults';
export type AppEnv = 'development' | 'test' | 'preview' | 'production';
export type ChatProviderId = 'deepseek' | 'openai-compatible';
export type VisionProviderId = 'deepseek' | 'openai-compatible';
export type ImageProviderId = 'openrouter' | 'openai-compatible';
export type SpeechProviderId = 'qwen-audio' | 'openrouter-gemini' | 'openai-compatible';
export type ObjectStorageProviderId = 'local' | 'r2';
export type EmailProviderId = 'none' | 'smtp' | 'resend';
export type EmbeddingProviderId = 'dashscope' | 'openai-compatible';
export type SpeechMode = 'web';
export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export interface AiConnection { model: string; baseUrl: string; apiKey?: string }
export interface ProviderConfig {
  chat: AiConnection & {provider: ChatProviderId};
  visionSafety: AiConnection & {provider: VisionProviderId};
  image: AiConnection & {provider: ImageProviderId};
  speech: AiConnection & {provider: SpeechProviderId; voiceFemale: string; voiceMale: string};
  embedding: AiConnection & {provider: EmbeddingProviderId; dimensions: number; sendDimensions: boolean};
  objectStorage: {provider: ObjectStorageProviderId};
  email: {provider: EmailProviderId; fromAddress: string; replyTo?: string; smtp?: {host: string; port: number; user: string; password: string}};
}
export interface RuntimeConfig {appEnv: AppEnv; appBaseUrl: string; speechMode: SpeechMode; providers: ProviderConfig}
export interface Capability {enabled: boolean; reason?: string}
export interface PersonalConfig extends RuntimeConfig {
  host: string; port: number; dataDir: string; accessMode: 'local' | 'password';
  memoryRetrievalMode: 'keyword' | 'hybrid'; letterDelivery: 'in-app' | 'both' | 'email';
  capabilities: Record<'chat' | 'image' | 'upload' | 'speech' | 'embedding' | 'email', Capability>;
  configurationErrors: string[];
}
export const REAL_PROVIDER_CREDENTIAL_ENV_NAMES = ['AI_CHAT_API_KEY','AI_VISION_API_KEY','AI_IMAGE_API_KEY','AI_TTS_API_KEY','AI_EMBEDDING_API_KEY','DEEPSEEK_API_KEY','OPENROUTER_API_KEY','DASHSCOPE_API_KEY','RESEND_API_KEY','SMTP_PASSWORD','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'] as const;
export function readConfiguredValue(env: RuntimeEnvironment, name: string): string | undefined {
  const v=env[name]?.trim();
  return !v || /^(?:your[-_ ]|replace[-_ ]|changeme|placeholder|<)/i.test(v) ? undefined : v;
}
function enumValue<T extends string>(env: RuntimeEnvironment, name: string, values: readonly T[], fallback: T): T {
  const v=readConfiguredValue(env,name);
  if(!v) return fallback;
  if(!values.includes(v as T)) throw new Error(`${name} must be one of: ${values.join(', ')}`);
  return v as T;
}
export function isLoopback(host: string): boolean {return ['127.0.0.1','localhost','::1','[::1]'].includes(host.toLowerCase());}
export function getAppEnv(env: RuntimeEnvironment=process.env): AppEnv {
  return enumValue(env,'APP_ENV',['development','test','preview','production'] as const, env.NODE_ENV==='production'?'production':env.NODE_ENV==='test'?'test':'development');
}
function portValue(env: RuntimeEnvironment, name: string, fallback: number): number {
  const v=readConfiguredValue(env,name); const n=v?Number(v):fallback;
  if(!Number.isInteger(n)||n<1||n>65535) throw new Error(`${name} must be an integer from 1 to 65535`);
  return n;
}
export function getAppBaseUrl(env: RuntimeEnvironment=process.env, _appEnv=getAppEnv(env)): string {
  const port=portValue(env,'PORT',5000);
  const url=new URL(readConfiguredValue(env,'APP_BASE_URL')||`http://127.0.0.1:${port}`);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash) throw new Error('APP_BASE_URL must be an http(s) origin without credentials, path or query');
  return url.origin;
}
export function getLetterPublicBaseUrl(env: RuntimeEnvironment=process.env, appEnv=getAppEnv(env)): string {
  const base=getAppBaseUrl(env,appEnv); const explicit=readConfiguredValue(env,'LETTER_PUBLIC_BASE_URL');
  if(!explicit) return base;
  const url=new URL(explicit);
  if(url.protocol!=='https:'||isLoopback(url.hostname)||url.origin!==base||url.pathname!=='/'||url.search||url.hash||url.username||url.password) throw new Error('LETTER_PUBLIC_BASE_URL must be the same public HTTPS origin as APP_BASE_URL');
  return url.origin;
}
export function getSpeechMode(_env: RuntimeEnvironment=process.env): SpeechMode {return 'web';}
/** Model IDs are provider configuration, not a hard-coded availability catalogue. */
export function readModelId(value: string, name: string): string {
  if (!value || value.length > 200 || /\s|[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be a model ID without whitespace (maximum 200 characters)`);
  }
  return value;
}
function modelValue(env: RuntimeEnvironment, name: string, fallback: string): string {
  return readModelId(readConfiguredValue(env, name) || fallback, name);
}
/** API roots retain an optional path prefix; errors never echo configured URLs. */
export function normalizeAiBaseUrl(value: string, name: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error(`${name} must be an http(s) API root without credentials, query or fragment`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an http(s) API root without credentials, query or fragment`);
  }
  return url.toString().replace(/\/+$/, '');
}
function aiConnection(env: RuntimeEnvironment, prefix: string, provider: string,
  defaults: { model: string; baseUrl: string; legacyBase: string; legacyKey: string }, inherited?: AiConnection): AiConnection {
  const urlName = `AI_${prefix}_BASE_URL`;
  const modelName = `AI_${prefix}_MODEL`;
  const keyName = `AI_${prefix}_API_KEY`;
  const generic = provider === 'openai-compatible';
  const configuredBase = readConfiguredValue(env, urlName);
  const rawBase = configuredBase || inherited?.baseUrl || (generic ? undefined : readConfiguredValue(env, defaults.legacyBase) || defaults.baseUrl);
  if (!rawBase) throw new Error(`${urlName} is required for openai-compatible`);
  const baseUrl = normalizeAiBaseUrl(rawBase, urlName);
  const rawModel = readConfiguredValue(env, modelName) || inherited?.model || (generic ? undefined : defaults.model);
  if (!rawModel) throw new Error(`${modelName} is required for openai-compatible`);
  const apiKey = readConfiguredValue(env, keyName) || (generic
    ? inherited && baseUrl === inherited.baseUrl ? inherited.apiKey : undefined
    : readConfiguredValue(env, defaults.legacyKey));
  return { model: readModelId(rawModel, modelName), baseUrl, apiKey };
}
function embeddingDimensions(env: RuntimeEnvironment): number {
  const value = Number(readConfiguredValue(env, 'AI_EMBEDDING_DIMENSIONS') || '1024');
  if (!Number.isInteger(value) || value < 1 || value > 65536) throw new Error('AI_EMBEDDING_DIMENSIONS must be an integer from 1 to 65536');
  return value;
}
export function getProviderConfig(env: RuntimeEnvironment=process.env): ProviderConfig {
  const deepseek = { model: DEEPSEEK_VISION_MODEL, baseUrl: 'https://api.deepseek.com', legacyBase: 'DEEPSEEK_BASE_URL', legacyKey: 'DEEPSEEK_API_KEY' };
  const openrouter = { model: OPENROUTER_IMAGE_MODEL, baseUrl: 'https://openrouter.ai/api/v1', legacyBase: 'OPENROUTER_BASE_URL', legacyKey: 'OPENROUTER_API_KEY' };
  const chatProvider = enumValue(env, 'AI_CHAT_PROVIDER', ['deepseek', 'openai-compatible'] as const, 'deepseek');
  const chat = { provider: chatProvider, ...aiConnection(env, 'CHAT', chatProvider, deepseek) };
  const visionSelection = readConfiguredValue(env, 'AI_VISION_PROVIDER');
  const inheritVision = chatProvider === 'openai-compatible' && (!visionSelection || visionSelection === 'openai-compatible');
  const visionProvider = enumValue(env, 'AI_VISION_PROVIDER', ['deepseek', 'openai-compatible'] as const, inheritVision ? 'openai-compatible' : 'deepseek');
  const speechProvider = enumValue(env, 'AI_TTS_PROVIDER', ['qwen-audio', 'openrouter-gemini', 'openai-compatible'] as const,
    readConfiguredValue(env, 'AI_TTS_API_KEY') || readConfiguredValue(env, 'DASHSCOPE_API_KEY') ? 'qwen-audio' : readConfiguredValue(env, 'OPENROUTER_API_KEY') ? 'openrouter-gemini' : 'qwen-audio');
  const imageProvider = enumValue(env, 'AI_IMAGE_PROVIDER', ['openrouter', 'openai-compatible'] as const, 'openrouter');
  const embeddingProvider = enumValue(env, 'AI_EMBEDDING_PROVIDER', ['dashscope', 'openai-compatible'] as const, 'dashscope');
  const emailProvider = enumValue(env, 'EMAIL_PROVIDER', ['none', 'smtp', 'resend'] as const, 'none');
  return {
    chat,
    visionSafety: { provider: visionProvider, ...aiConnection(env, 'VISION', visionProvider, deepseek, inheritVision ? chat : undefined) },
    image: { provider: imageProvider, ...aiConnection(env, 'IMAGE', imageProvider, openrouter) },
    speech: { provider: speechProvider, ...aiConnection(env, 'TTS', speechProvider, speechProvider === 'openrouter-gemini'
      ? { ...openrouter, model: 'google/gemini-3.1-flash-tts-preview' }
      : { model: 'qwen-audio-3.1-tts-flash', baseUrl: 'https://maas.qianwenaiapi.com/api/v1', legacyBase: 'DASHSCOPE_TTS_BASE_URL', legacyKey: 'DASHSCOPE_API_KEY' }),
      voiceFemale: modelValue(env, 'AI_TTS_VOICE_FEMALE', 'alloy'), voiceMale: modelValue(env, 'AI_TTS_VOICE_MALE', 'onyx') },
    embedding: { provider: embeddingProvider, ...aiConnection(env, 'EMBEDDING', embeddingProvider,
      { model: 'text-embedding-v4', baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1', legacyBase: 'DASHSCOPE_EMBEDDING_BASE_URL', legacyKey: 'DASHSCOPE_API_KEY' }),
      dimensions: embeddingDimensions(env), sendDimensions: enumValue(env, 'AI_EMBEDDING_SEND_DIMENSIONS', ['true', 'false'] as const, 'true') === 'true' },
    objectStorage: {provider:enumValue(env,'OBJECT_STORAGE_PROVIDER',['local','r2'] as const,'local')},
    email:{provider:emailProvider,fromAddress:readConfiguredValue(env,'EMAIL_FROM')||'',replyTo:readConfiguredValue(env,'EMAIL_REPLY_TO')||readConfiguredValue(env,'EMAIL_FROM'),...(emailProvider==='smtp'?{smtp:{host:readConfiguredValue(env,'SMTP_HOST')||'',port:portValue(env,'SMTP_PORT',587),user:readConfiguredValue(env,'SMTP_USER')||'',password:readConfiguredValue(env,'SMTP_PASSWORD')||''}}:{})},
  };
}
export function getSpeechModelFor(provider: SpeechProviderId, env: RuntimeEnvironment=process.env): string {
  const config=getProviderConfig(env).speech;
  return config.provider===provider?config.model:provider==='qwen-audio'?'qwen-audio-3.1-tts-flash':'google/gemini-3.1-flash-tts-preview';
}
export function getLetterDelivery(env: RuntimeEnvironment=process.env): PersonalConfig['letterDelivery'] {return enumValue(env,'LETTER_DELIVERY',['in-app','both','email'] as const,'in-app');}
export function isE2EMockProviderMode(env: RuntimeEnvironment=process.env): boolean {
  if(env.E2E_MOCK_PROVIDERS!=='1') return false;
  if(getAppEnv(env)!=='test') throw new Error('E2E mock providers require APP_ENV=test');
  if(REAL_PROVIDER_CREDENTIAL_ENV_NAMES.some(name=>readConfiguredValue(env,name))) throw new Error('E2E mock providers refuse real provider credentials');
  return true;
}
export function getPersonalConfig(env: RuntimeEnvironment=process.env, options: {strict?: boolean}={}): PersonalConfig {
  const host=readConfiguredValue(env,'HOST')||'127.0.0.1'; const port=portValue(env,'PORT',5000);
  const accessMode=enumValue(env,'APP_ACCESS_MODE',['local','password'] as const,'local');
  const appBaseUrl=getAppBaseUrl(env); const origin=new URL(appBaseUrl);
  if(accessMode==='local'&&(!isLoopback(host)||!isLoopback(origin.hostname))) throw new Error('local access mode requires loopback HOST and APP_BASE_URL');
  if(accessMode==='local'&&Number(origin.port||(origin.protocol==='https:'?443:80))!==port) throw new Error('APP_BASE_URL port must match PORT in local mode');
  if(accessMode==='password') {
    if((readConfiguredValue(env,'OWNER_PASSWORD')?.length||0)<12) throw new Error('OWNER_PASSWORD must contain at least 12 characters');
    if(origin.protocol!=='https:'&&!isLoopback(origin.hostname)) throw new Error('Remote password mode requires HTTPS APP_BASE_URL');
  }
  const providers=getProviderConfig(env); const configurationErrors: string[]=[];
  const mock=isE2EMockProviderMode(env);
  if(env.AI_TTS_PROVIDER&&!mock&&providers.speech.provider!=='openai-compatible'&&!providers.speech.apiKey) throw new Error(`AI_TTS_PROVIDER=${providers.speech.provider} requires ${providers.speech.provider==='qwen-audio'?'DASHSCOPE_API_KEY':'OPENROUTER_API_KEY'} or AI_TTS_API_KEY`);
  const mode=enumValue(env,'MEMORY_RETRIEVAL_MODE',['auto','keyword','hybrid'] as const,'auto');
  const embeddingConfigured=providers.embedding.provider==='openai-compatible'||!!providers.embedding.apiKey||(mock&&mode==='hybrid');
  if(mode==='hybrid'&&!embeddingConfigured) throw new Error('MEMORY_RETRIEVAL_MODE=hybrid requires AI_EMBEDDING_API_KEY or DASHSCOPE_API_KEY for dashscope; alternatively configure an openai-compatible embedding service');
  const letterDelivery=getLetterDelivery(env);
  if(readConfiguredValue(env,'LETTER_PUBLIC_BASE_URL'))try{getLetterPublicBaseUrl(env);}catch{configurationErrors.push('LETTER_PUBLIC_BASE_URL must match APP_BASE_URL and use a public HTTPS origin');}
  if(letterDelivery!=='in-app'&&providers.email.provider==='none') configurationErrors.push('LETTER_DELIVERY=email/both requires EMAIL_PROVIDER=smtp or resend; use in-app for station letters');
  if(providers.email.provider!=='none') {
    if(!providers.email.fromAddress) configurationErrors.push('EMAIL_FROM is required for external email');
    if(providers.email.provider==='resend'&&!readConfiguredValue(env,'RESEND_API_KEY')) configurationErrors.push('EMAIL_PROVIDER=resend requires RESEND_API_KEY');
    if(providers.email.provider==='smtp') {
      for(const name of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD']) if(!readConfiguredValue(env,name)) configurationErrors.push(`${name} is required for SMTP`);
      if(![465,587].includes(providers.email.smtp!.port)) configurationErrors.push('SMTP_PORT must be 465 (TLS) or 587 (STARTTLS)');
    }
  }
  if(options.strict!==false&&configurationErrors.length) throw new Error(configurationErrors.join('; '));
  const capability=(enabled:boolean,reason:string):Capability=>enabled?{enabled:true}:{enabled:false,reason};
  return {host,port,accessMode,dataDir:path.resolve(readConfiguredValue(env,'APP_DATA_DIR')||'./data'),appEnv:getAppEnv(env),appBaseUrl,speechMode:'web',providers,letterDelivery,memoryRetrievalMode:mode==='keyword'||!embeddingConfigured?'keyword':'hybrid',configurationErrors,
    capabilities:{chat:capability(mock||providers.chat.provider==='openai-compatible'||!!providers.chat.apiKey,'Chat is not configured: set AI_CHAT_API_KEY or DEEPSEEK_API_KEY'),upload:capability(mock||providers.visionSafety.provider==='openai-compatible'||!!providers.visionSafety.apiKey,'Vision safety is not configured: set AI_VISION_API_KEY or DEEPSEEK_API_KEY'),image:capability(mock||providers.image.provider==='openai-compatible'||!!providers.image.apiKey,'Image generation is not configured: set AI_IMAGE_API_KEY or OPENROUTER_API_KEY'),speech:capability(mock||providers.speech.provider==='openai-compatible'||!!providers.speech.apiKey,'Speech provider is not configured'),embedding:capability(embeddingConfigured,'Embedding is not configured; keyword retrieval is active'),email:capability(providers.email.provider!=='none'&&!configurationErrors.length,'External email is not configured')},
  };
}
export function getRuntimeConfig(env: RuntimeEnvironment=process.env): RuntimeConfig {return {appEnv:getAppEnv(env),appBaseUrl:getAppBaseUrl(env),speechMode:'web',providers:getProviderConfig(env)};}
