import crypto from 'node:crypto';

import { getSpeechProvider } from '@/lib/ai/speech-provider';
import { getObjectStore } from '@/lib/storage/object-store';
import { buildTtsObjectKey } from './tts-voice-key';

/**
 * 语音服务：把一段文本交给当前 SpeechProvider 合成，并写入对象存储。
 *
 * 历史背景：这里曾经有 assertPaidSpeechDisabled()，它在 APP_SPEECH_MODE=web 时无条件抛错，
 * 让整条付费语音链路（连同两个 /api/tts* 路由的 409）完全不可达。产品语音已改为云端 Gemini TTS，
 * 该闸门已移除；鉴权、额度与长度上限现在由路由层（/api/tts、/api/tts-preview）负责。
 */
export interface SynthesizeOptions {
  /**
   * **公开音色代号**：写进对象 key，于是 `audio_url` 自带音色且**不含上游参数**。
   * 前端靠它做「旧音色」比对，所以这里必须是客户端也能看到的那一层标识。
   */
  voiceId: string;
  /** Historical callers may supply this field; adapters now map the public voice themselves. */
  providerVoiceId?: string;
  text: string;
  speed?: number;
  emotion?: string;
}

export interface SynthesizeResult {
  audioUrl: string;
  durationMs: number;
}

function extensionForAudio(mediaType: string): string {
  if (mediaType === 'audio/wav' || mediaType === 'audio/x-wav') return 'wav';
  if (mediaType === 'audio/ogg') return 'ogg';
  return 'mp3';
}

export async function synthesizeToObjectStore(
  input: SynthesizeOptions,
  subdir = 'tts',
): Promise<SynthesizeResult> {
  const generated = await getSpeechProvider().synthesize({
    text: input.text,
    voice: input.voiceId,
    speed: input.speed,
    emotion: input.emotion,
  });
  const extension = extensionForAudio(generated.mediaType);
  const stored = await getObjectStore().put({
    key: buildTtsObjectKey({
      subdir,
      voiceId: input.voiceId,
      id: crypto.randomUUID(),
      extension,
    }),
    bytes: generated.bytes,
    mediaType: generated.mediaType,
  });
  return {
    audioUrl: stored.url,
    durationMs: generated.durationMs ?? 0,
  };
}
