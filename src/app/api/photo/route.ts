import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratedImage } from '@/lib/ai';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
import { getPersonalConfig } from '@/lib/config/runtime';
import { getSqlite } from '@/storage/database/db';
import {
  acquireOperationLease,
  releaseOperationLease,
  type OperationLease,
} from '@/lib/operation-lease';
import {
  buildPhotoPromptFromSnapshot,
  createPhotoIdentitySnapshot,
  isAppearanceStyle,
  normalizeAppearanceStyle,
  resolveCharacterAppearance,
} from '@/lib/character-appearance';
import { getImageProvider } from '@/lib/ai/image-provider';
import { shouldRetryWithSafePhotoScene } from '@/lib/ai/image-generation-policy';
import { buildPhotoObjectKey } from '@/lib/ai/photo-object-key';
import { getObjectStore } from '@/lib/storage/object-store';
import { PHOTO_FAILED, PHOTO_FAILED_USER_COPY, PHOTO_PENDING } from '@/lib/photo-status';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
// 照片场景池（以参考图为准做图生图，保证同一张脸）
const PHOTO_SCENES: Record<string, string[]> = {
  female: [
    '穿着日常家居服坐在洒满阳光的窗边，手拿一杯热饮，温柔地看向镜头微笑，生活感自拍视角',
    '在温馨的咖啡馆里，手托腮看向镜头，浅浅的微笑，桌上有一杯拉花咖啡，写真质感',
    '傍晚在街边散步时回头对镜头微笑，暖色路灯氛围，头发被微风轻轻吹起，生活感抓拍',
    '对镜自拍，穿着柔软的毛衣，表情自然带一点害羞的微笑，居家温馨氛围',
  ],
  male: [
    '穿着休闲外套在街角咖啡店门口，自然地看向镜头微笑，生活感抓拍',
    '傍晚天台看向镜头，金色夕阳光线勾勒轮廓，自信微笑，胶片质感',
    '居家靠在沙发上看书，抬头看向镜头，表情温柔放松，暖光氛围',
    '运动后坐在公园长椅上，手拿矿泉水，对镜头爽朗微笑，阳光自然',
  ],
};

function imageMediaType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function imageExtension(mediaType: string): string {
  if (mediaType.includes('jpeg') || mediaType.includes('jpg')) return 'jpg';
  if (mediaType.includes('webp')) return 'webp';
  return 'png';
}

export function POST(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    let lease: OperationLease | null = null;
    let pendingId: string | null = null;
    try {
      const body = await readCoreBody(request);
      if (typeof body.conversation_id !== 'string' || !body.conversation_id)
        return coreError(400, 'MISSING_CONVERSATION');
      const conversation = repo.getConversation(owner, body.conversation_id);
      if (!conversation) return coreError(404, 'CONVERSATION_NOT_FOUND');
      const companion = repo.getCompanion(owner, conversation.companion_id);
      if (!companion) return coreError(404, 'COMPANION_NOT_FOUND');
      if (!isAppearanceStyle(body.appearance_style))
        return coreError(400, 'INVALID_APPEARANCE_STYLE');
      const savedStyle = normalizeAppearanceStyle(companion.appearance_style);
      if (body.appearance_style !== savedStyle) return coreError(409, 'STALE_APPEARANCE');
      let appearance;
      try {
        appearance = resolveCharacterAppearance(companion.character_key, savedStyle);
      } catch {
        return coreError(409, 'UNKNOWN_CHARACTER');
      }
      if (!getPersonalConfig(process.env,{strict:false}).capabilities.image.enabled)
        return coreError(503, 'FEATURE_NOT_CONFIGURED');
      lease = await acquireOperationLease(`photo:${companion.id}`);
      if (!lease) return coreError(409, 'PHOTO_BUSY');
      const referencePath = path.join(
        process.cwd(),
        'public',
        appearance.referenceImage.replace(/^\//, ''),
      );
      const snapshot = createPhotoIdentitySnapshot(
        appearance,
        await readFile(referencePath),
        imageMediaType(referencePath),
      );
      const llmScene =
        typeof body.photo_scene === 'string' ? body.photo_scene.trim().slice(0, 200) : '';
      const usedLlmScene = llmScene.length >= 4;
      const scenes = appearance.character.photoScenes.length
        ? appearance.character.photoScenes
        : PHOTO_SCENES[appearance.character.gender];
      const scene = usedLlmScene ? llmScene : scenes[Math.floor(Math.random() * scenes.length)];
      const provider = getImageProvider();
      const generate = (scene: string) =>
        provider.generate({
          prompt: buildPhotoPromptFromSnapshot(snapshot, scene),
          referenceImages: [{ bytes: snapshot.referenceBytes, mediaType: snapshot.mediaType }],
          size: '1K',
          aspectRatio: '1:1',
        });
      const pending = repo.insertMessage(owner, conversation.id, {
        role: 'assistant',
        content: '',
        content_type: PHOTO_PENDING,
      });
      pendingId = pending.id;
      let generated: GeneratedImage;
      let fallback = false;
      try {
        generated = await generate(scene);
      } catch (error) {
        if (!shouldRetryWithSafePhotoScene(error, usedLlmScene)) throw error;
        generated = await generate(scenes[Math.floor(Math.random() * scenes.length)]);
        fallback = true;
      }
      const stored = await getObjectStore().put({
        key: buildPhotoObjectKey({
          id: randomUUID(),
          extension: imageExtension(generated.mediaType),
          fallback,
        }),
        bytes: generated.bytes,
        mediaType: generated.mediaType,
      });
      const db = getSqlite();
      const held = lease;
      const message = db.transaction(() => {
        if (
          !db
            .prepare(
              'SELECT resource_key FROM operation_leases WHERE resource_key=? AND token=? AND expires_at>?',
            )
            .get(held.key, held.token, Date.now())
        )
          throw new Error('Operation expired');
        const fresh = repo.getCompanion(owner, companion.id);
        if (
          !fresh ||
          fresh.character_key !== companion.character_key ||
          fresh.appearance_style !== savedStyle
        )
          throw new Error('STALE_APPEARANCE');
        const updated = repo.updateMessage(owner, pending.id, {
          content:
            repo.getVisitor(owner)?.locale === 'en' ? 'Sent you a photo' : '给你发了一张照片',
          content_type: 'image',
          image_url: stored.url,
        });
        if (!updated) throw new Error('Conversation removed');
        db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND visitor_id=?').run(
          Date.now(),
          conversation.id,
          owner,
        );
        return updated;
      })();
      pendingId = null;
      return NextResponse.json({ message });
    } catch (error) {
      if (pendingId)
        repo.updateMessage(owner, pendingId, {
          content_type: PHOTO_FAILED,
          content: PHOTO_FAILED_USER_COPY,
        });
      if (error instanceof SyntaxError) return coreError(400, 'INVALID_JSON');
      if (error instanceof Error && error.message === 'STALE_APPEARANCE')
        return coreError(409, 'STALE_APPEARANCE');
      console.error('[personal:photo]', error instanceof Error ? error.name : 'unknown');
      return coreError(500, 'PHOTO_FAILED', PHOTO_FAILED_USER_COPY);
    } finally {
      if (lease) await releaseOperationLease(lease);
    }
  });
}
