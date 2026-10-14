import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
import { getPersonalConfig } from '@/lib/config/runtime';
import { getSqlite } from '@/storage/database/db';
import { synthesizeToObjectStore } from '@/lib/ai/speech-service';
import { prepareTtsText } from '@/lib/ai/tts-text';
import { resolveVoiceId, getCharacter } from '@/lib/characters';
import {
  acquireOperationLease,
  releaseOperationLease,
  type OperationLease,
} from '@/lib/operation-lease';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function POST(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    let lease: OperationLease | null = null;
    try {
      const body = await readCoreBody(request);
      if (typeof body.message_id !== 'string' || !body.message_id)
        return coreError(400, 'MISSING_MESSAGE');
      const message = repo.getOwnedMessage(owner, body.message_id);
      if (!message) return coreError(404, 'MESSAGE_NOT_FOUND');
      if (message.role !== 'assistant' || message.content_type !== 'text')
        return coreError(400, 'MESSAGE_NOT_TTS_CAPABLE');
      const conversation = repo.getConversation(owner, message.conversation_id)!;
      const companion = repo.getCompanion(owner, conversation.companion_id);
      if (!companion) return coreError(404, 'COMPANION_MISSING');
      if (!getPersonalConfig(process.env,{strict:false}).capabilities.speech.enabled)
        return coreError(503, 'FEATURE_NOT_CONFIGURED');
      if (message.audio_url && !body.regenerate)
        return NextResponse.json({ audio_url: message.audio_url });
      const text = prepareTtsText(message.content ?? '');
      if (!text) return coreError(400, 'TTS_CONTENT_UNSUITABLE');
      lease = await acquireOperationLease(`tts:${message.id}`);
      if (!lease) return coreError(409, 'TTS_BUSY');
      const fresh = repo.getOwnedMessage(owner, message.id);
      if (!fresh) return coreError(404, 'MESSAGE_NOT_FOUND');
      if (fresh.audio_url && (!body.regenerate || fresh.audio_url !== message.audio_url))
        return NextResponse.json({ audio_url: fresh.audio_url });
      const voiceId = resolveVoiceId(
        companion.voice_id,
        getCharacter(companion.character_key)?.gender,
      );
      const { audioUrl } = await synthesizeToObjectStore({ text, voiceId }, 'tts');
      const db = getSqlite();
      const held = lease;
      db.transaction(() => {
        if (
          !db
            .prepare(
              'SELECT resource_key FROM operation_leases WHERE resource_key=? AND token=? AND expires_at>?',
            )
            .get(held.key, held.token, Date.now())
        )
          throw new Error('Operation expired');
        if (!repo.updateMessage(owner, message.id, { audio_url: audioUrl }))
          throw new Error('Message removed');
      })();
      return NextResponse.json({ audio_url: audioUrl });
    } catch (error) {
      if (error instanceof SyntaxError) return coreError(400, 'INVALID_JSON');
      console.error('[personal:tts]', error instanceof Error ? error.name : 'unknown');
      return coreError(500, 'TTS_FAILED');
    } finally {
      if (lease) await releaseOperationLease(lease);
    }
  });
}
