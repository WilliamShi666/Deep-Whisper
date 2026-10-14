import { getSqlite } from '@/storage/database/db';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
import { createPersonalChatStream } from '@/lib/personal/chat-stream';
import { getPersonalConfig } from '@/lib/config/runtime';
import {
  acquireOperationLease,
  releaseOperationLease,
  type OperationLease,
} from '@/lib/operation-lease';
import { getCharacter } from '@/lib/characters';
import { buildSystemPrompt, buildOpeningPrompt, PHOTO_UNAVAILABLE_NOTICE } from '@/lib/prompts';
import { isDefaultConversationTitle } from '@/lib/conversation-title';
import { IMAGE_PLACEHOLDER, isImagePlaceholder } from '@/lib/chat/image-placeholder';
import { readApprovedUpload } from '@/lib/storage/approved-upload';
import { getChatProvider } from '@/lib/ai/chat-provider';
import type { AiMessage, ContentPart } from '@/lib/ai/types';
import type { MemoryContext } from '@/lib/types';
import { getMemoryService } from '@/lib/memory/dependencies';
import { createSqliteRecallSnapshotStore } from '@/lib/memory/sqlite-snapshot';
import { recallWithSnapshot } from '@/lib/memory/recall-snapshot-store';
import { buildRecallQuery, buildSupplementalRecallQueries } from '@/lib/memory/recall-query';
import { buildRecentTurns } from '@/lib/memory/recent-turns';
import { prepareChatContext } from '@/lib/chat/prepare-context';
import { LETTER_RECALL_LIMIT } from '@/lib/letters/recall';
import {
  PHOTO_FAILED_EPISODE_NOTE,
  isPhotoFailure,
  isPhotoStatusType,
  photoNoteForModel,
} from '@/lib/photo-status';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const GENERATION_BUDGET_MS = 180_000;

export function POST(request: Request) {
  return ownerRoute(request, async (visitorId, repo) => {
    const started = performance.now();
    const capabilities = getPersonalConfig(process.env,{strict:false}).capabilities;
    if (!capabilities.chat.enabled) return coreError(503, 'FEATURE_NOT_CONFIGURED');
    const body = await readCoreBody(request);
    const conversationId = body.conversation_id;
    const opening = body.opening === true;
    if (typeof conversationId !== 'string' || !conversationId)
      return coreError(400, 'MISSING_CONVERSATION');
    if (body.content !== undefined && typeof body.content !== 'string')
      return coreError(400, 'MISSING_MESSAGE_CONTENT');
    const content = (body.content ?? '').trim();
    if (content.length > 10000) return coreError(400, 'MESSAGE_TOO_LONG');
    if (!opening && !content && !body.image_path) return coreError(400, 'MISSING_MESSAGE_CONTENT');
    const conversation = repo.getConversation(visitorId, conversationId);
    if (!conversation) return coreError(404, 'CONVERSATION_NOT_FOUND');
    const companion = repo.getCompanion(visitorId, conversation.companion_id);
    const visitor = repo.getVisitor(visitorId);
    const character = companion && getCharacter(companion.character_key);
    if (!companion || !visitor || !character) return coreError(409, 'UNKNOWN_CHARACTER');
    const locale = visitor.locale === 'en' ? 'en' : 'zh-CN';
    const db = getSqlite();
    let approvedImage: Awaited<ReturnType<typeof readApprovedUpload>> | null = null;
    if (body.image_path) {
      if (!capabilities.upload.enabled) return coreError(503, 'FEATURE_NOT_CONFIGURED');
      try {
        if (typeof body.image_path !== 'string' || opening) throw new Error('invalid image');
        approvedImage = await readApprovedUpload(body.image_path, visitorId);
      } catch {
        return coreError(400, 'INVALID_UPLOAD_REFERENCE');
      }
    }
    let lease: OperationLease | null = await acquireOperationLease(`chat:${conversationId}`);
    if (!lease) return coreError(409, 'conversation_busy', '该会话正在生成回复，请稍后再试');
    try {
      const history = repo.recentMessages(visitorId, conversationId, opening ? 40 : 39);
      if (opening && history.length) {
        await releaseOperationLease(lease);
        lease = null;
        return coreError(409, 'opening_exists', '该会话已有消息，不能再次生成开场白');
      }
      const profile = repo.getProfile(visitorId);
      const snapshot = repo.getRelationship(visitorId, companion.id);
      const service = getMemoryService();
      const recall = service
        ? recallWithSnapshot({
            store: createSqliteRecallSnapshotStore(db, { visitorId, companionId: companion.id }),
            recall: (input) => service.recall(input),
            visitorId,
            companionId: companion.id,
            query: buildRecallQuery({ opening, content }),
            supplementalQueries: buildSupplementalRecallQueries({ opening, content }),
            messageText: content,
          })
            .then((outcome) => outcome.memories)
            .catch(() => [])
        : Promise.resolve([]);
      const avoid = service
        ? service.listAvoidTopics({ visitorId, companionId: companion.id }).catch(() => [])
        : Promise.resolve([]);
      const priorRows = db
        .prepare(
          `SELECT m.role,m.content,m.content_type,m.created_at FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.visitor_id=? AND c.companion_id=? AND c.id<>? ORDER BY m.created_at DESC,m.id DESC LIMIT 12`,
        )
        .all(visitorId, companion.id, conversationId) as Array<{
        role: 'user' | 'assistant';
        content: string | null;
        content_type: string;
        created_at: number;
      }>;
      const recentEpisodes = priorRows
        .map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString() }))
        .map((row) =>
          row.role === 'assistant' && isPhotoFailure(row.content_type, row.created_at, new Date())
            ? { ...row, content_type: 'text', content: PHOTO_FAILED_EPISODE_NOTE }
            : row,
        )
        .filter(
          (row) =>
            row.content_type === 'text' &&
            row.content?.trim() &&
            Date.parse(row.created_at) >= Date.now() - 72 * 60 * 60 * 1000,
        )
        .slice(0, 8)
        .reverse()
        .map((row) => ({
          role: row.role,
          content: row.content!.trim(),
          createdAt: row.created_at,
        }));
      const recentLetters = (
        db
          .prepare(
            'SELECT subject,body,created_at FROM letters WHERE visitor_id=? AND companion_id=? ORDER BY created_at DESC,id DESC LIMIT ?',
          )
          .all(visitorId, companion.id, LETTER_RECALL_LIMIT) as Array<{
          subject: string;
          body: string;
          created_at: number;
        }>
      ).map((row) => ({
        sentAt: new Date(row.created_at).toISOString(),
        subject: row.subject,
        anchorText: row.body,
        status: 'sent',
      }));
      const prepared = await prepareChatContext(
        Promise.all([recall, avoid]),
        Promise.resolve(history),
        async () =>
          opening
            ? null
            : repo.insertMessage(visitorId, conversationId, {
                role: 'user',
                content: content || (approvedImage ? IMAGE_PLACEHOLDER : ''),
                content_type: approvedImage ? 'image' : 'text',
                image_url: approvedImage?.url ?? null,
              }),
      );
      const [recalled, avoidTopics] = prepared.memory;
      const memory: MemoryContext | null =
        profile ||
        snapshot ||
        recalled.length ||
        avoidTopics.length ||
        recentEpisodes.length ||
        recentLetters.length
          ? { profile, snapshot, recalled, avoidTopics, recentEpisodes, recentLetters }
          : null;
      const messages: AiMessage[] = [
        {
          role: 'system',
          content:
            buildSystemPrompt(character, companion, visitor, memory, new Date(), locale) +
            (capabilities.image.enabled ? '' : PHOTO_UNAVAILABLE_NOTICE[locale]),
        },
      ];
      if (opening)
        messages.push({
          role: 'user',
          content: buildOpeningPrompt(
            companion.name,
            {
              hasPriorConversation: priorRows.length > 0,
              hasRecalledMemory: recalled.length > 0,
              hasRecentContext: recentEpisodes.length > 0,
            },
            locale,
          ),
        });
      else
        for (const message of prepared.history) {
          if (message.id === prepared.saved?.id && approvedImage) {
            const parts: ContentPart[] = [];
            if (content) parts.push({ type: 'text', text: content });
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${approvedImage.mediaType};base64,${approvedImage.bytes.toString('base64')}`,
                detail: 'high',
              },
            });
            messages.push({ role: 'user', content: parts });
          } else
            messages.push({
              role: message.role,
              content:
                message.content_type === 'image'
                  ? message.role === 'assistant'
                    ? locale === 'en'
                      ? '[sent you a photo]'
                      : '[给你发了一张照片]'
                    : isImagePlaceholder(message.content)
                      ? locale === 'en'
                        ? '[sent an image]'
                        : '[发送了一张图片]'
                      : (message.content ?? '')
                  : isPhotoStatusType(message.content_type)
                    ? (photoNoteForModel(message.content_type, message.created_at, new Date()) ??
                      '')
                    : (message.content ?? ''),
            });
        }
      const activeLease = lease;
      lease = null;
      return createPersonalChatStream({
        userMessage: prepared.saved,
        photoEnabled: capabilities.image.enabled,
        timeoutMs: GENERATION_BUDGET_MS - (performance.now() - started),
        stream: (signal) =>
          getChatProvider().stream({
            messages,
            temperature: 0.85,
            timeoutMs: GENERATION_BUDGET_MS - (performance.now() - started),
            signal,
          }),
        finishReply: (assistantText) =>
          repo.finishReply({
            visitorId,
            companionId: companion.id,
            conversationId,
            userMessageId: prepared.saved?.id ?? '',
            userText: content,
            assistantText,
            observedAt: new Date().toISOString(),
            recentTurns: buildRecentTurns(prepared.history, {
              excludeMessageId: prepared.saved?.id,
            }),
            ...(!opening &&
            content &&
            isDefaultConversationTitle(conversation.title, companion.name)
              ? { title: content.slice(0, 20) }
              : {}),
          }),
        onFinish: () => releaseOperationLease(activeLease),
      });
    } finally {
      if (lease) await releaseOperationLease(lease);
    }
  });
}
