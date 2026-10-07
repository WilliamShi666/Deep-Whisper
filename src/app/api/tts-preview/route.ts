import { NextRequest, NextResponse } from 'next/server';
import { VOICE_OPTIONS } from '@/lib/characters';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
import { getPersonalConfig } from '@/lib/config/runtime';
import { synthesizeToObjectStore } from '@/lib/ai/speech-service';
import { prepareTtsText } from '@/lib/ai/tts-text';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 音色试听的文本上限：试听是付费合成，且不需要长文本 */
const PREVIEW_TEXT_LIMIT = 120;

// POST: 音色试听（不落库、不写 messages）
export async function POST(request: NextRequest) {
  return ownerRoute(request, async () => {
    try {
      if (!getPersonalConfig(process.env,{strict:false}).capabilities.speech.enabled)
        return coreError(503, 'FEATURE_NOT_CONFIGURED');
      const body = (await readCoreBody(request)) as { voice_id?: string; text?: string };
      const voice = VOICE_OPTIONS.find((v) => v.id === body.voice_id);
      if (!voice) {
        return apiError(400, 'VOICE_NOT_FOUND', '音色不存在');
      }
      const text = prepareTtsText(body.text?.trim() || voice.preview, PREVIEW_TEXT_LIMIT);
      if (!text) {
        return apiError(400, 'TTS_TEXT_EMPTY', '试听文本为空');
      }

      const { audioUrl } = await synthesizeToObjectStore(
        {
          text,
          // 试听的对象 key 也用公开代号：audio_url 里不含上游参数。
          voiceId: voice.id,
        },
        'tts-preview',
      );

      return NextResponse.json({ audio_url: audioUrl });
    } catch (err) {
      console.error('[tts-preview:POST]', err instanceof Error ? err.name : 'unknown');
      return apiError(500, 'TTS_PREVIEW_FAILED', '试听生成失败，请稍后再试');
    }
  });
}
