/**
 * T-14（消费侧）：用户时区的唯一读入口。
 *
 * 记忆写入会同时产生两类带时间的落库：整理器的 nowIso（模型据此解释
 * 「今天/明天」）与关系快照的 observedAt（先发后到的陈旧性守卫）。
 * 两者必须是同一个时区，否则「相对日期」与「谁更新」会各算各的。
 * 本模块把这个来源收敛成一个函数：user_profiles.timezone → Asia/Shanghai。
 *
 * 契约：
 * - 读不到、读到空白、读到无法解析的时区名 → 一律回退 DEFAULT_TIME_ZONE；
 * - 读库失败也只是回退 + 记日志，绝不抛出：时区解析失败不该让对话失败。
 * - 默认源惰性构造，单测导入本模块不需要任何数据库配置。
 */

import { getSqlite } from '@/storage/database/db';
import type Database from 'better-sqlite3';
import { DEFAULT_TIME_ZONE, resolveUserTimeZone } from './time-source';

export interface ProfileTimeZoneSource {
  load(visitorId: string): Promise<string | null>;
}

export function createSqliteProfileTimeZoneSource(db?: Database.Database): ProfileTimeZoneSource {
  return {
    async load(visitorId) {
      const row = (db ?? getSqlite()).prepare('SELECT timezone FROM user_profiles WHERE visitor_id=?').get(visitorId) as
        { timezone: string | null } | undefined;
      return row?.timezone ?? null;
    },
  };
}

/**
 * 返回 (visitorId) => Promise<timeZone> 的解析器。
 * 传 source 是为了单测可注入；不传则使用 SQLite 画像表。
 */
export function createProfileTimeZoneResolver(
  source?: ProfileTimeZoneSource,
): (visitorId: string) => Promise<string> {
  return async (visitorId: string): Promise<string> => {
    try {
      const resolved = source ?? createSqliteProfileTimeZoneSource();
      return resolveUserTimeZone(await resolved.load(visitorId));
    } catch (error) {
      console.error('[memory:timezone]', error);
      return DEFAULT_TIME_ZONE;
    }
  };
}
