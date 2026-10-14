import { toPublicVoiceId } from '@/lib/ai/qwen-voice-map';

/**
 * 把要返回给客户端的 companion 行里的 `voice_id` 归一化成**公开代号**。
 *
 * 为什么必须在服务端做：库里可能还存着本轮之前写入的上游参数，或更早的别名。
 * 客户端只该看到代号 —— 否则「界面不出现上游原名」在 DevTools / 页面数据里就是假的，
 * 而且 `resolveVoiceId` 在客户端没有、也不该有上游对照表。
 *
 * 未知值保持原样（老数据可以合法地不认识，交给客户端 `resolveVoiceId` 兜底到默认音色）。
 */
export function withPublicVoiceId<T extends { voice_id: string | null }>(companion: T): T {
  return { ...companion, voice_id: toPublicVoiceId(companion.voice_id) ?? companion.voice_id };
}