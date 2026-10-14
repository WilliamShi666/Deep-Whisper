import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { assertInstanceOwnership } from './instance-lock';
import type Database from 'better-sqlite3';
import type {
  CompanionDTO,
  ConversationWithCompanionDTO,
  MessageDTO,
  MessageFeedbackDTO,
  RelationshipSnapshotDTO,
  UserProfileDTO,
  VisitorDTO,
} from '@/lib/types';
import { getCharacterAvatar, normalizeAppearanceStyle } from '@/lib/character-appearance';
import { resolveVoiceId } from '@/lib/characters';
import { getCharacter } from '@/lib/characters';
import {
  resolveImportantDatesWrite,
  type ImportantDatesWriteMode,
} from '@/lib/profile/important-dates';
import { enqueueOrganizerJob, type OrganizerJobInput } from '@/lib/memory/sqlite-jobs';
import { forgetSqliteConversationMemories } from '@/lib/memory/sqlite-snapshot';

type Row = Record<string, unknown>;
const jsonFields = new Set([
  'family_members',
  'important_dates',
  'lifestyle',
  'communication_prefs',
  'key_milestones',
]);
function dto<T>(value: unknown): T | null {
  if (!value) return null;
  const row = { ...(value as Row) };
  for (const key of ['created_at', 'updated_at'])
    if (typeof row[key] === 'number') row[key] = new Date(row[key] as number).toISOString();
  for (const key of jsonFields)
    if (typeof row[key] === 'string') row[key] = JSON.parse(row[key] as string);
  return row as T;
}
function bind(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return JSON.stringify(value);
}
function cursorPage(rows: Row[], timestamp: 'created_at' | 'updated_at') {
  const page = rows.slice(0, 100);
  const last = page.at(-1);
  return {
    page,
    next_cursor:
      rows.length > 100 && last
        ? Buffer.from(
            JSON.stringify({ at: new Date(last[timestamp] as number).toISOString(), id: last.id }),
          ).toString('base64url')
        : null,
  };
}
function decodeCursor(value?: string | null): { at: number; id: string } | null {
  if (!value) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_PAGE_CURSOR');
  const item = JSON.parse(Buffer.from(value, 'base64url').toString()) as { at: string; id: string };
  if (
    typeof item.at !== 'string' ||
    !Number.isFinite(Date.parse(item.at)) ||
    typeof item.id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(item.id)
  )
    throw new Error('INVALID_PAGE_CURSOR');
  return { at: Date.parse(item.at), id: item.id };
}
export type CompanionCreate = Omit<
  CompanionDTO,
  'id' | 'visitor_id' | 'avatar' | 'created_at' | 'updated_at'
> & { id?: string };
export type CompanionPatch = Partial<
  Pick<
    CompanionDTO,
    'name' | 'persona' | 'occupation' | 'user_title' | 'voice_id' | 'appearance_style' | 'theme_id'
  >
>;
export type ProfilePatch = Partial<
  Omit<UserProfileDTO, 'id' | 'visitor_id' | 'created_at' | 'updated_at'>
>;

/** Domain operations over real SQLite. Every read/write uses the authenticated owner scope. */
export function createCoreRepository(db: Database.Database) {
  function getCompanion(visitorId: string, id: string) {
    const row = dto<CompanionDTO>(
      db.prepare('SELECT * FROM companions WHERE id=? AND visitor_id=?').get(id, visitorId),
    );
    if (!row) return null;
    return {
      ...row,
      appearance_style: normalizeAppearanceStyle(row.appearance_style),
      voice_id: resolveVoiceId(row.voice_id, getCharacter(row.character_key)?.gender),
      avatar: getCharacterAvatar(row.character_key, row.appearance_style),
    };
  }
  function getConversation(visitorId: string, id: string) {
    const row = db
      .prepare(
        `SELECT c.*, p.name companion_name, p.character_key companion_character_key,
      p.appearance_style companion_appearance_style, p.theme_id companion_theme_id
      FROM conversations c JOIN companions p ON p.id=c.companion_id
      WHERE c.id=? AND c.visitor_id=? AND p.visitor_id=?`,
      )
      .get(id, visitorId, visitorId) as Row | undefined;
    return conversationDto(row);
  }
  function conversationDto(row: Row | undefined) {
    const out = dto<ConversationWithCompanionDTO>(row);
    return out
      ? {
          ...out,
          companion_appearance_style: normalizeAppearanceStyle(out.companion_appearance_style),
          companion_avatar: getCharacterAvatar(
            out.companion_character_key,
            out.companion_appearance_style,
          ),
        }
      : null;
  }
  function insertMessage(
    visitorId: string,
    conversationId: string,
    input: Partial<MessageDTO> & { role: MessageDTO['role'] },
  ) {
    assertInstanceOwnership(dirname(db.name));
    if (!getConversation(visitorId, conversationId)) throw new Error('CONVERSATION_NOT_FOUND');
    const id = input.id ?? randomUUID();
    const now = input.created_at ? Date.parse(input.created_at) : Date.now();
    db.prepare(
      'INSERT INTO messages(id,conversation_id,role,content_type,content,image_url,audio_url,created_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      id,
      conversationId,
      input.role,
      input.content_type ?? 'text',
      input.content ?? null,
      input.image_url ?? null,
      input.audio_url ?? null,
      now,
    );
    return dto<MessageDTO>(db.prepare('SELECT * FROM messages WHERE id=?').get(id))!;
  }
  function getProfile(visitorId: string) {
    return dto<UserProfileDTO>(
      db.prepare('SELECT * FROM user_profiles WHERE visitor_id=?').get(visitorId),
    );
  }
  function patch(
    table: string,
    allowed: readonly string[],
    input: Row,
    where: string,
    args: Array<string | number>,
  ) {
    assertInstanceOwnership(dirname(db.name));
    const entries = Object.entries(input).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    );
    if (!entries.length) return;
    db.prepare(
      `UPDATE ${table} SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE ${where}`,
    ).run(...entries.map(([, value]) => bind(value)), ...args);
  }
  const repository = {
    getVisitor(visitorId: string) {
      const row = dto<VisitorDTO>(
        db.prepare('SELECT * FROM visitors WHERE id=? AND owner_slot=1').get(visitorId),
      );
      return row ? { ...row, auth_user_id: null } : null;
    },
    updateVisitor(
      visitorId: string,
      input: Partial<
        Pick<VisitorDTO, 'gender' | 'orientation' | 'nickname' | 'ui_theme' | 'palette' | 'locale'>
      >,
    ) {
      patch(
        'visitors',
        ['gender', 'orientation', 'nickname', 'ui_theme', 'palette', 'locale', 'updated_at'],
        { ...input, updated_at: Date.now() },
        'id=? AND owner_slot=1',
        [visitorId],
      );
      return repository.getVisitor(visitorId);
    },
    getCompanion,
    latestCompanion(visitorId: string) {
      const row = db
        .prepare(
          'SELECT id FROM companions WHERE visitor_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
        )
        .get(visitorId) as { id: string } | undefined;
      return row ? getCompanion(visitorId, row.id) : null;
    },
    createCompanion(visitorId: string, input: CompanionCreate) {
      const id = input.id ?? randomUUID();
      const existing = getCompanion(visitorId, id);
      if (existing) return existing;
      const now = Date.now();
      db.prepare(
        'INSERT INTO companions(id,visitor_id,character_key,name,persona,occupation,user_title,voice_id,appearance_style,theme_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        visitorId,
        input.character_key,
        input.name,
        input.persona,
        input.occupation,
        input.user_title,
        input.voice_id,
        input.appearance_style,
        input.theme_id,
        now,
        now,
      );
      return getCompanion(visitorId, id)!;
    },
    updateCompanion(visitorId: string, id: string, input: CompanionPatch) {
      if (!getCompanion(visitorId, id)) return null;
      patch(
        'companions',
        [
          'name',
          'persona',
          'occupation',
          'user_title',
          'voice_id',
          'appearance_style',
          'theme_id',
          'updated_at',
        ],
        { ...input, updated_at: Date.now() },
        'id=? AND visitor_id=?',
        [id, visitorId],
      );
      return getCompanion(visitorId, id);
    },
    getConversation,
    listConversations(visitorId: string, before?: string | null) {
      const cursor = decodeCursor(before);
      const rows = db
        .prepare(
          `SELECT c.*,p.name companion_name,p.character_key companion_character_key,p.appearance_style companion_appearance_style,p.theme_id companion_theme_id
        FROM conversations c JOIN companions p ON p.id=c.companion_id WHERE c.visitor_id=? AND p.visitor_id=?
        ${cursor ? 'AND (c.updated_at<? OR (c.updated_at=? AND c.id<?))' : ''} ORDER BY c.updated_at DESC,c.id DESC LIMIT 101`,
        )
        .all(visitorId, visitorId, ...(cursor ? [cursor.at, cursor.at, cursor.id] : [])) as Row[];
      const { page, next_cursor } = cursorPage(rows, 'updated_at');
      return { conversations: page.map((row) => conversationDto(row)!), next_cursor };
    },
    createConversation(
      visitorId: string,
      companionId: string,
      input: { id?: string; title: string },
    ) {
      if (!getCompanion(visitorId, companionId)) throw new Error('COMPANION_NOT_FOUND');
      const id = input.id ?? randomUUID();
      const existing = getConversation(visitorId, id);
      if (existing) {
        if (existing.companion_id !== companionId) throw new Error('CREATION_CONFLICT');
        return existing;
      }
      const now = Date.now();
      db.prepare(
        'INSERT INTO conversations(id,visitor_id,companion_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      ).run(id, visitorId, companionId, input.title, now, now);
      return getConversation(visitorId, id)!;
    },
    updateConversation(visitorId: string, id: string, title: string) {
      if (!getConversation(visitorId, id)) return null;
      db.prepare('UPDATE conversations SET title=?,updated_at=? WHERE id=? AND visitor_id=?').run(
        title,
        Date.now(),
        id,
        visitorId,
      );
      return getConversation(visitorId, id);
    },
    deleteConversation(visitorId: string, id: string) {
      const conversation = getConversation(visitorId, id);
      if (!conversation) return null;
      return db.transaction(() => {
        const forgotten = forgetSqliteConversationMemories(db, {
          visitorId,
          companionId: conversation.companion_id,
          conversationId: id,
        });
        db.prepare('DELETE FROM conversations WHERE id=? AND visitor_id=?').run(id, visitorId);
        return {
          ok: true,
          forget: {
            status: forgotten.exhaustive && forgotten.remaining === 0 && forgotten.unattributable === 0 && forgotten.snapshotCleared
              ? 'cleared' as const : 'partial' as const,
            deleted: forgotten.deleted, failed: 0,
          },
        };
      })();
    },
    insertMessage,
    getOwnedMessage(visitorId: string, id: string) {
      const row = db
        .prepare(
          'SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN companions p ON p.id=c.companion_id WHERE m.id=? AND c.visitor_id=? AND p.visitor_id=?',
        )
        .get(id, visitorId, visitorId);
      return dto<MessageDTO>(row);
    },
    updateMessage(
      visitorId: string,
      id: string,
      input: Partial<Pick<MessageDTO, 'content_type' | 'content' | 'image_url' | 'audio_url'>>,
    ) {
      if (!repository.getOwnedMessage(visitorId, id)) return null;
      patch('messages', ['content_type', 'content', 'image_url', 'audio_url'], input, 'id=?', [id]);
      return repository.getOwnedMessage(visitorId, id);
    },
    listMessages(visitorId: string, conversationId: string, before?: string | null) {
      if (!getConversation(visitorId, conversationId)) return null;
      const cursor = decodeCursor(before);
      const rows = db
        .prepare(
          `SELECT * FROM messages WHERE conversation_id=? ${cursor ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT 101`,
        )
        .all(conversationId, ...(cursor ? [cursor.at, cursor.at, cursor.id] : [])) as Row[];
      const { page, next_cursor } = cursorPage(rows, 'created_at');
      return { messages: page.reverse().map((row) => dto<MessageDTO>(row)!), next_cursor };
    },
    recentMessages(visitorId: string, conversationId: string, limit = 40) {
      if (!getConversation(visitorId, conversationId)) return [];
      return (
        db
          .prepare(
            "SELECT * FROM messages WHERE conversation_id=? AND content_type IN ('text','image') ORDER BY created_at DESC,id DESC LIMIT ?",
          )
          .all(conversationId, limit) as Row[]
      )
        .reverse()
        .map((row) => dto<MessageDTO>(row)!);
    },
    getProfile,
    saveProfile(
      visitorId: string,
      input: ProfilePatch,
      options: {
        importantDatesMode?: ImportantDatesWriteMode;
        expectedVersion?: string | null;
      } = {},
    ) {
      return db.transaction(() => {
        const existing = getProfile(visitorId);
        if (
          options.expectedVersion !== undefined &&
          (existing?.updated_at ?? null) !== options.expectedVersion
        )
          throw new Error('PROFILE_CONFLICT');
        const now = Math.max(Date.now(), existing ? Date.parse(existing.updated_at) + 1 : 0);
        const update: Row = { ...input, updated_at: now };
        if (input.important_dates !== undefined)
          update.important_dates = resolveImportantDatesWrite(
            options.importantDatesMode ?? 'replace',
            existing?.important_dates,
            input.important_dates ?? [],
          );
        if (!existing)
          db.prepare(
            'INSERT INTO user_profiles(id,visitor_id,created_at,updated_at) VALUES(?,?,?,?)',
          ).run(randomUUID(), visitorId, now, now);
        patch(
          'user_profiles',
          [
            'display_name',
            'birthday',
            'occupation',
            'city',
            'timezone',
            ...jsonFields,
            'updated_at',
          ],
          update,
          'visitor_id=?',
          [visitorId],
        );
        return getProfile(visitorId)!;
      })();
    },
    getRelationship(visitorId: string, companionId: string) {
      if (!getCompanion(visitorId, companionId)) return null;
      return dto<RelationshipSnapshotDTO>(
        db
          .prepare('SELECT * FROM relationship_snapshots WHERE visitor_id=? AND companion_id=?')
          .get(visitorId, companionId),
      );
    },
    saveRelationship(
      visitorId: string,
      companionId: string,
      input: Partial<
        Pick<
          RelationshipSnapshotDTO,
          'relationship_stage' | 'emotional_tone' | 'dynamic_summary' | 'key_milestones'
        >
      >,
    ) {
      if (!getCompanion(visitorId, companionId)) return null;
      return db.transaction(() => {
        const now = Date.now();
        db.prepare(
          'INSERT INTO relationship_snapshots(id,visitor_id,companion_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(visitor_id,companion_id) DO NOTHING',
        ).run(randomUUID(), visitorId, companionId, now, now);
        patch(
          'relationship_snapshots',
          [
            'relationship_stage',
            'emotional_tone',
            'dynamic_summary',
            'key_milestones',
            'updated_at',
          ],
          { ...input, updated_at: now },
          'visitor_id=? AND companion_id=?',
          [visitorId, companionId],
        );
        return repository.getRelationship(visitorId, companionId);
      })();
    },
    listFeedback(visitorId: string, conversationId: string) {
      if (!getConversation(visitorId, conversationId)) return null;
      return (
        db
          .prepare(
            'SELECT message_id,rating,comment,updated_at FROM message_feedback WHERE visitor_id=? AND conversation_id=?',
          )
          .all(visitorId, conversationId) as Row[]
      ).map((row) => dto<MessageFeedbackDTO>(row)!);
    },
    saveFeedback(
      visitorId: string,
      messageId: string,
      input: { rating: 1 | -1 | null; comment: string | null },
    ) {
      const message = repository.getOwnedMessage(visitorId, messageId);
      if (!message || message.role !== 'assistant') return null;
      if (input.rating === null) {
        db.prepare('DELETE FROM message_feedback WHERE visitor_id=? AND message_id=?').run(
          visitorId,
          messageId,
        );
        return null;
      }
      const conversation = getConversation(visitorId, message.conversation_id)!;
      const now = Date.now();
      db.prepare(
        `INSERT INTO message_feedback(id,message_id,visitor_id,conversation_id,companion_id,rating,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(message_id,visitor_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,updated_at=excluded.updated_at`,
      ).run(
        randomUUID(),
        messageId,
        visitorId,
        conversation.id,
        conversation.companion_id,
        input.rating,
        input.comment,
        now,
        now,
      );
      return dto<MessageFeedbackDTO>(
        db
          .prepare(
            'SELECT message_id,rating,comment,updated_at FROM message_feedback WHERE visitor_id=? AND message_id=?',
          )
          .get(visitorId, messageId),
      );
    },
    finishReply(
      input: Omit<OrganizerJobInput, 'assistantMessageId' | 'assistantText'> & {
        assistantText: string;
        title?: string;
      },
    ) {
      return db.transaction(() => {
        assertInstanceOwnership(dirname(db.name));
        const conversation = getConversation(input.visitorId, input.conversationId);
        if (!conversation || conversation.companion_id !== input.companionId)
          throw new Error('CONVERSATION_NOT_FOUND');
        const message = insertMessage(input.visitorId, input.conversationId, {
          role: 'assistant',
          content: input.assistantText,
          created_at: input.observedAt,
        });
        // Opening prompts and image-only turns contain no user-authored text.
        // Preserve the reply without inventing a source for the text organizer.
        if (input.userMessageId && input.userText.trim())
          enqueueOrganizerJob(db, { ...input, assistantMessageId: message.id });
        db.prepare(
          'UPDATE conversations SET updated_at=?,title=COALESCE(?,title) WHERE id=? AND visitor_id=?',
        ).run(
          Date.parse(input.observedAt),
          input.title ?? null,
          input.conversationId,
          input.visitorId,
        );
        return message;
      })();
    },
  };
  return repository;
}
