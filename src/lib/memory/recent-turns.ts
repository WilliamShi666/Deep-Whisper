/**
 * T-10（route 侧）：整理器可见的最近成对前文。
 *
 * 整理器需要上下文才能解析指代（「那家店」「就周三吧」指什么），但把整段
 * 历史塞进去既贵、又会让它越权改写更早的记忆。这里只取最近的若干轮
 * 「用户→助手」配对，作为**语境**（context）而不是新的记忆来源。
 *
 * 边界：
 * - 只保留最近的 MAX_RECENT_TURNS 轮，按时间正序（早的在前）输出；
 * - 未配对的尾部用户消息不成轮：一轮的定义是「一问一答」；
 * - 图片消息与空白文本跳过，且不打断配对（图片不该充当某一轮的正文）；
 * - excludeMessageId 用来排除当前这一轮的用户消息，避免同一句话被整理两次。
 */

import type { MemoryOrganizerTurn } from './service';

export type { MemoryOrganizerTurn };

/** 整理器可见的最近轮数上限。 */
export const MAX_RECENT_TURNS = 4;

/** 只取本模块真正读取的字段，因此 route 的 MessageRow 可直接传入。 */
export interface RecentTurnRow {
  id: string;
  role: string;
  content: string | null;
  content_type: string | null;
}

export interface BuildRecentTurnsOptions {
  /** 当前这一轮的用户消息 id：整条跳过，不参与配对。 */
  excludeMessageId?: string | null;
  /** 收窄可见轮数；超过 MAX_RECENT_TURNS 的部分会被裁掉。 */
  limit?: number;
}

/** 取出可用于配对的正文：图片与纯空白一律视为「没有内容」。 */
function usableText(row: RecentTurnRow): string | null {
  // 图片与拍照状态行（photo_pending / photo_failed）都不是用户事实，整理器不看。
  if (row.content_type === 'image' || row.content_type === 'photo_pending' || row.content_type === 'photo_failed') return null;
  if (typeof row.content !== 'string') return null;
  const trimmed = row.content.trim();
  return trimmed ? trimmed : null;
}

/**
 * 把按时间正序排列的历史行压成最近的成对轮次。
 * 输入为空、或完全没有配成对时返回空数组，绝不凭空造出一轮。
 */
export function buildRecentTurns(
  history: readonly RecentTurnRow[],
  options: BuildRecentTurnsOptions = {},
): MemoryOrganizerTurn[] {
  const requested = options.limit ?? MAX_RECENT_TURNS;
  const limit = Math.min(Math.max(requested, 0), MAX_RECENT_TURNS);
  if (limit === 0) return [];

  const excluded = options.excludeMessageId ?? null;
  const turns: MemoryOrganizerTurn[] = [];
  let pendingUserText: string | null = null;

  for (const row of history) {
    if (excluded !== null && row.id === excluded) {
      pendingUserText = null;
      continue;
    }

    const text = usableText(row);
    if (!text) continue;

    if (row.role === 'user') {
      pendingUserText = text;
      continue;
    }

    if (row.role === 'assistant' && pendingUserText !== null) {
      turns.push({ userText: pendingUserText, assistantText: text });
      pendingUserText = null;
    }
  }

  return turns.slice(Math.max(turns.length - limit, 0));
}
