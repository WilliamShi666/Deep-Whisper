/**
 * 关系快照写入守卫（先发后到不得覆盖新状态）。
 *
 * 背景：长期记忆整理器由 Next.js `after()` 以「发后不管」的方式异步触发，
 * 于是轮次 A 的写入可能落在轮次 B 的写入之后，把更新的状态覆盖回旧值。
 * 本模块是这个竞态的唯一判定点：调用方传三件事——观察时刻 observedAt、
 * 待写入字段 update、以及（可注入的）store——由模块决定「写 / 不写 / 失败」。
 *
 * 设计约束：
 * - 纯判定与编排分离：normalizeSnapshotUpdate / isSnapshotWriteAllowed 是
 *   可单测的纯函数；persistRelationshipSnapshot 只做编排，永不抛出。
 * - 时间语义是「观察时刻」（observedAt，轮次结束那一刻），不是「写入时刻」。
 *   只有 observedAt 严格晚于库里的 updated_at 才允许落库；相等也不允许，
 *   因为同一轮次的重复写入没有新信息。
 * - 守卫分两层：纯函数 isSnapshotWriteAllowed 是预检（省掉无谓的写），
 *   store.write 内部同语句的 updated_at < observedAt 条件才是原子保证。
 *   预检通过但 write 返回 changed = 0，说明写入时输掉了竞争，按 stale-update 拒绝。
 * - 不在这里打日志、不在这里计数：调用方负责观测与上报，本模块只返回结构化结果。
 * - 不导入 ./service，避免与记忆服务形成导入环（eslint import/no-cycle）。
 * - 默认 store 惰性构造：只有真正要读库时才解析数据库环境变量，
 *   因此单测导入本模块不需要任何数据库配置。
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getSqlite } from '@/storage/database/db';

/** 整理器给出的候选更新；任何字段都可能是空白或缺失。 */
export interface RelationshipSnapshotUpdate {
  relationshipStage?: string | null;
  emotionalTone?: string | null;
  dynamicSummary?: string | null;
  keyMilestones?: string[];
}

/** 归一化后的可写入字段：只会包含「确实有内容」的键。 */
export interface RelationshipSnapshotFields {
  relationshipStage?: string;
  emotionalTone?: string;
  dynamicSummary?: string;
  keyMilestones?: string[];
}

/** 库中现存的单行关系快照（per visitor × companion）。 */
export interface RelationshipSnapshotRecord {
  relationshipStage: string | null;
  emotionalTone: string | null;
  dynamicSummary: string | null;
  keyMilestones: string[];
  updatedAt: string | null;
}

export interface RelationshipSnapshotStore {
  load(input: { visitorId: string; companionId: string }): Promise<RelationshipSnapshotRecord | null>;
  // 必须原子地执行陈旧性守卫：仅当库里的 updated_at 严格早于 observedAt、
  // 或该行尚不存在时才落库。返回真正被改动的行数（0 表示守卫拒绝了本次写入）。
  write(input: {
    visitorId: string;
    companionId: string;
    observedAt: string;
    fields: RelationshipSnapshotFields;
  }): Promise<{ changed: number }>;
}

export type RelationshipSnapshotOutcome =
  | { status: 'skipped'; reason: 'no-update' | 'empty-update' }
  | { status: 'written'; fields: string[] }
  | { status: 'rejected'; reason: 'stale-update' }
  | { status: 'failed'; reason: 'load-failed' | 'write-failed'; error?: unknown };

/** 取字符串字段：非字符串或纯空白一律视为「没有内容」。 */
function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** 里程碑：只保留非空字符串，去重且保持首次出现的顺序（不是数组则视为空）。 */
function readMilestones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const milestones: string[] = [];
  for (const entry of value) {
    const text = readText(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    milestones.push(text);
  }
  return milestones;
}

/** 裁剪字符串、丢弃空白/非字符串值、裁剪并去重里程碑、丢弃空白项；全空时返回 null。 */
export function normalizeSnapshotUpdate(
  update: RelationshipSnapshotUpdate | null | undefined,
): RelationshipSnapshotFields | null {
  if (!update || typeof update !== 'object') return null;

  const fields: RelationshipSnapshotFields = {};

  const relationshipStage = readText(update.relationshipStage);
  if (relationshipStage) fields.relationshipStage = relationshipStage;

  const emotionalTone = readText(update.emotionalTone);
  if (emotionalTone) fields.emotionalTone = emotionalTone;

  const dynamicSummary = readText(update.dynamicSummary);
  if (dynamicSummary) fields.dynamicSummary = dynamicSummary;

  const keyMilestones = readMilestones(update.keyMilestones);
  if (keyMilestones.length > 0) fields.keyMilestones = keyMilestones;

  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * 纯守卫谓词：这次写入允许落库吗？
 * - current 为 null（还没有行）→ 允许（首写）。
 * - 时间戳无法解析（含 null / 空串 / 脏数据）→ 允许：宁可写入也不要因为
 *   脏数据永久卡死记忆链路；解析绝不抛错。
 * - 否则仅在「库里的 updated_at 严格早于 observedAt」时允许。
 */
export function isSnapshotWriteAllowed(
  current: RelationshipSnapshotRecord | null,
  observedAt: string,
): boolean {
  if (!current) return true;

  const storedAt = typeof current.updatedAt === 'string' ? Date.parse(current.updatedAt) : Number.NaN;
  const observed = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(storedAt) || !Number.isFinite(observed)) return true;

  return storedAt < observed;
}

export function createSqliteRelationshipSnapshotStore(db?: Database.Database): RelationshipSnapshotStore {
  return {
    async load(input) {
      const row = (db ?? getSqlite()).prepare('SELECT * FROM relationship_snapshots WHERE visitor_id=? AND companion_id=?')
        .get(input.visitorId, input.companionId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return { relationshipStage: readText(row.relationship_stage), emotionalTone: readText(row.emotional_tone),
        dynamicSummary: readText(row.dynamic_summary), keyMilestones: readMilestones(JSON.parse(String(row.key_milestones))),
        updatedAt: new Date(Number(row.updated_at)).toISOString() };
    },
    async write(input) {
      return { changed: persistSqliteRelationshipSnapshot(db ?? getSqlite(), input) };
    },
  };
}

/** Synchronous effects writer also used inside the durable job finalization transaction. */
export function persistSqliteRelationshipSnapshot(db: Database.Database, input: {
  visitorId: string; companionId: string; observedAt: string; fields: RelationshipSnapshotFields;
}): number {
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed)) throw new Error('Invalid relationship observation');
  const fields = normalizeSnapshotUpdate(input.fields);
  if (!fields) return 0;
  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM companions WHERE id=? AND visitor_id=?').get(input.companionId, input.visitorId)) {
      throw new Error('Relationship scope is not owned');
    }
    const previous = db.prepare('SELECT * FROM relationship_snapshots WHERE visitor_id=? AND companion_id=?')
      .get(input.visitorId, input.companionId) as Record<string, unknown> | undefined;
    if (previous && Number(previous.updated_at) >= observed) return 0;
    const stage = fields.relationshipStage?.slice(0,32) ?? previous?.relationship_stage ?? null;
    const tone = fields.emotionalTone?.slice(0,64) ?? previous?.emotional_tone ?? null;
    const summary = fields.dynamicSummary?.slice(0,400) ?? previous?.dynamic_summary ?? null;
    const milestones = [...new Set([...(previous ? readMilestones(JSON.parse(String(previous.key_milestones))) : []),
      ...fields.keyMilestones ?? []])].slice(-12);
    if (previous) {
      return db.prepare('UPDATE relationship_snapshots SET relationship_stage=?,emotional_tone=?,dynamic_summary=?,key_milestones=?,observed_at=?,updated_at=? WHERE visitor_id=? AND companion_id=? AND updated_at<?')
        .run(stage,tone,summary,JSON.stringify(milestones),observed,observed,input.visitorId,input.companionId,observed).changes;
    }
    return db.prepare('INSERT INTO relationship_snapshots(id,visitor_id,companion_id,relationship_stage,emotional_tone,dynamic_summary,key_milestones,observed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),input.visitorId,input.companionId,stage,tone,summary,JSON.stringify(milestones),observed,observed,observed).changes;
  }).immediate();
}

/**
 * 编排：归一化 → 读当前状态 → 纯守卫预检 → 写（store 自己再原子校验一次）。
 * 任何异常都转成结构化结果返回，绝不抛给调用方：对话主链路不能因为
 * 关系快照写入失败而失败。
 */
export async function persistRelationshipSnapshot(input: {
  visitorId: string;
  companionId: string;
  observedAt: string;
  update: RelationshipSnapshotUpdate | null | undefined;
  store?: RelationshipSnapshotStore;
}): Promise<RelationshipSnapshotOutcome> {
  if (input.update === null || input.update === undefined) {
    return { status: 'skipped', reason: 'no-update' };
  }

  const fields = normalizeSnapshotUpdate(input.update);
  if (!fields) {
    // 十轮寒暄可能一个可写字段都没有：此时连读库都不做。
    return { status: 'skipped', reason: 'empty-update' };
  }

  let store: RelationshipSnapshotStore;
  let current: RelationshipSnapshotRecord | null;
  try {
    store = input.store ?? createSqliteRelationshipSnapshotStore();
    current = await store.load({ visitorId: input.visitorId, companionId: input.companionId });
  } catch (error) {
    // 默认 store 构造失败（缺环境变量等）也归入 load-failed：都在读库之前。
    return { status: 'failed', reason: 'load-failed', error };
  }

  if (!isSnapshotWriteAllowed(current, input.observedAt)) {
    return { status: 'rejected', reason: 'stale-update' };
  }

  try {
    const result = await store.write({
      visitorId: input.visitorId,
      companionId: input.companionId,
      observedAt: input.observedAt,
      fields,
    });

    if (!result || result.changed < 1) {
      return { status: 'rejected', reason: 'stale-update' };
    }

    return { status: 'written', fields: Object.keys(fields).sort() };
  } catch (error) {
    return { status: 'failed', reason: 'write-failed', error };
  }
}