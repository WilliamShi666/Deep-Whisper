import type { MemoryGateway, ProviderMemory } from './service';

// 级联遗忘：删除会话时，清理「来源为该会话」的长期记忆。
//
// 设计约束（对应 T-24 / T-25 / AC-15）：
// - 不新增表、列或迁移。候选来源是既有 memory metadata 里的
//   source_conversation_id（service.ts 在 ADD 时写入当前会话，在 UPDATE 时
//   只追加、不覆盖，因此该字段可能是单个字符串或字符串数组，两种都要认得）。
// - 复用既有精确实体检索契约（user_id + app_id + metadata.companion_id），
//   并在本地对每个候选做二次隔离校验，避免 provider 返回越界候选时误删。
// - 单条删除失败不中断其余清理；检索失败不抛出，改为在返回值里如实报告，
//   使调用方（会话删除接口）永远不会因为记忆问题而失败。
// - 恒等式：scanned = skipped + deleted + failed。

export interface ForgetConversationInput {
  gateway: MemoryGateway;
  appId: string;
  visitorId: string;
  companionId: string;
  conversationId: string;
}

export interface ForgetConversationResult {
  /** provider 返回的候选总数（未经隔离过滤）。 */
  scanned: number;
  /** 已成功删除的记忆条数。 */
  deleted: number;
  /** 被隔离校验挡下、未触碰的候选条数。 */
  skipped: number;
  /** 失败次数：检索失败计 1，单条删除失败各计 1。 */
  failed: number;
  /** 人类可读的失败说明，带 [memory:forget] 前缀。 */
  errors: string[];
  /**
   * 候选列举是否**穷尽**（后端实现了按来源会话的列举能力）。
   *
   * 为什么它决定能不能报「已清理」：`search()` 会被检索上限截断，截断后
   * 「没找到」与「不存在」无法区分 —— 那种情况下任何 `cleared` 都是**未经证明的断言**。
   */
  exhaustive: boolean;
  /**
   * 删除**之后**再列举一次，仍然看得见的条数。
   *
   * 这是本类的根因对策：原先 `deleted` 计的是「`gateway.delete` 返回了」，
   * 而不是「那行真的没了」。现在以**删除后的实际状态**为准 —— 删了却还在的，一条都不许算成功。
   */
  remaining: number;
  /**
   * 该伴侣名下**看不出归属**的行数（`source_conversation_ids` 为空）。
   *
   * 这类行列不出来（不是被截断，是根本无从归属），所以「删会话」永远清不掉它们。
   * 数出来才能如实说「无法确认完整性」，而不是报 cleared。本机开发库当前有 4 行。
   */
  unattributable: number;
}

/** 仅用于**回退路径**（后端没有穷尽列举能力时）的检索式。 */
const FORGET_QUERY = '这段对话里发生过的共同经历';

function readMetadata(memory: ProviderMemory): Record<string, unknown> {
  const metadata = memory.metadata;
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 读取候选记忆的来源会话集合。
 * ADD 写入单个字符串，历史数据同样是字符串；P2-4 之后被多个会话先后改写过的记忆
 * 是字符串数组——来源是一个集合，删掉其中任一来源会话都必须认得这条记忆。
 * 只认字符串形态会让列表化之后的记忆统统变成「无来源」而漏删。
 */
function sourceConversationIds(memory: ProviderMemory): string[] {
  const value = readMetadata(memory).source_conversation_id;
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item && !ids.includes(item)) ids.push(item);
  }
  return ids;
}

/**
 * 只有同时满足以下四点的候选才允许删除：
 * 来源会话集合包含被删会话、伴侣 = 被删会话的伴侣、访客与 app 也一致。
 * 只要 metadata 缺失任一字段，就一律保守跳过（宁可留下也不误删）。
 */
function isSourcedFromConversation(
  input: ForgetConversationInput,
  memory: ProviderMemory,
): boolean {
  const metadata = readMetadata(memory);
  return (
    sourceConversationIds(memory).includes(input.conversationId) &&
    metadata.companion_id === input.companionId &&
    metadata.visitor_id === input.visitorId &&
    metadata.app_id === input.appId
  );
}

export async function forgetConversationMemories(
  input: ForgetConversationInput,
): Promise<ForgetConversationResult> {
  const result: ForgetConversationResult = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    // ⚠️ 两项能力**都**要有，完整性才可证明 —— 这是 t9 抓到的最后一处同类毛病：
    // 只有 lister ⇒ 能找候选，但「看不见的行」（无来源）无从知晓，缺失的 counter 被静默当成 0
    // ⇒ 报 cleared 而库里仍有 2 行无来源记忆；只有 counter ⇒ 候选不全。
    // 缺任何一项 ⇒ `exhaustive = false` ⇒ 汇总只能说 partial。
    exhaustive: Boolean(input.gateway.listBySourceConversation)
      && Boolean(input.gateway.countUnattributableMemories),
    remaining: 0,
    unattributable: 0,
  };

  let candidates: ProviderMemory[];
  try {
    // 优先用「按来源会话穷尽列举」：遗忘要的是**列举**，不是检索。
    // 走 search() 会让候选被检索上限截断（本地网关每腿 48、最终 30），
    // 于是一个伴侣超过 30 条记忆时，第 31 条起永远扫不到 —— **删掉会话，它们却留在库里**。
    // 后端没实现这个可选能力时，才退回旧路径（并有上面那条上限的代价）。
    candidates = input.gateway.listBySourceConversation
      ? await input.gateway.listBySourceConversation({
          visitorId: input.visitorId,
          companionId: input.companionId,
          conversationId: input.conversationId,
          appId: input.appId,
        })
      : await input.gateway.search(FORGET_QUERY, {
          AND: [
            { user_id: input.visitorId },
            { app_id: input.appId },
            { metadata: { companion_id: input.companionId } },
          ],
        });
  } catch (error) {
    result.failed += 1;
    result.errors.push(
      `[memory:forget] 检索失败 conversation=${input.conversationId}: ${errorMessage(error)}`,
    );
    return result;
  }

  result.scanned = candidates.length;

  for (const candidate of candidates) {
    if (!isSourcedFromConversation(input, candidate)) {
      result.skipped += 1;
      continue;
    }
    try {
      await input.gateway.delete(candidate.id);
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        `[memory:forget] 清理失败 memory=${candidate.id}: ${errorMessage(error)}`,
      );
    }
  }

  // ── 以**删除后的实际状态**收口，而不是以「我们叫过删除」收口 ──────────────
  if (input.gateway.listBySourceConversation) {
    try {
      const stillThere = await input.gateway.listBySourceConversation({
        visitorId: input.visitorId,
        companionId: input.companionId,
        conversationId: input.conversationId,
        appId: input.appId,
      });
      result.remaining = stillThere.length;
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        `[memory:forget] 删除后复核失败 conversation=${input.conversationId}: ${errorMessage(error)}`,
      );
    }
  }

  if (input.gateway.countUnattributableMemories) {
    try {
      result.unattributable = await input.gateway.countUnattributableMemories({
        visitorId: input.visitorId,
        companionId: input.companionId,
      });
    } catch (error) {
      // 数不出来 = 无法证明完整性：计失败，别让它悄悄变成 cleared。
      result.failed += 1;
      result.errors.push(
        `[memory:forget] 无法统计无来源行 companion=${input.companionId}: ${errorMessage(error)}`,
      );
    }
  }

  return result;
}