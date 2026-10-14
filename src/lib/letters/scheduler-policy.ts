/**
 * 调度器的纯决策部分。
 *
 * 这些规则原本散在 runCompanionLetterCron 的副作用之间，只有跑真实数据库才能验证；
 * 抽出来以后，「什么时候该熔断、什么时候能重试、游标该走到哪」可以离线断言。
 */

import type { LetterSkipReason } from './policy';

/**
 * 每轮真实发出的上限（熔断）的默认值：**500**。
 *
 * 这个数字的职责已经变了。它过去是「守住 Resend 免费额度」的闸门（曾取 90，严格低于
 * 免费档 100 封/UTC 自然日）；产品决策已明确**上游配额不是约束**（会升级到高配额套餐），
 * 目标是「按代码逻辑该收到信的用户都要收到，不被实现细节延迟」。于是上限的职责收窄为
 * 一件事：**挡住代码 bug 导致的失控发送**（死循环、重复遍历、熔断自身失效）。
 *
 * 为什么是 500：
 *   - 每轮批次是 `CANDIDATE_BATCH_SIZE = 120` 人（`scheduler.ts`）。上限 ≥ 数倍批次大小，
 *     单轮就能覆盖完整批次，熔断不会再成为「谁先谁后」的排序因素。
 *   - 同时它仍是**有限的**：500 封/轮对一个每天只跑一次的 Cron 而言远超正常量级
 *     （单个访客每日最多 1 封），真打到 500 一定是 bug 而不是业务量，值得立刻停下。
 *   - 刻意不设成「无上限」：`0` 或缺失表示没有闸门，失控发送会一直跑到 Cron 超时。
 *
 * 调整套餐或改批次大小时设 `LETTER_MAX_ACCEPTED_SENDS_PER_RUN` 覆盖即可，不必改代码部署。
 *
 * ⚠️ 已知交互（改动此值前必读）：本上限**必须**与调度器的游标语义一起看。
 * 批次是 120 人，上限若小于批次大小，熔断会在一批**中途**触发；此时调度器会把游标推进到
 * 「最后一个已处理访客」（`scheduler.ts` 末尾），于是下一轮从那个人之后继续 ——
 * 被挡下的访客仍然会被轮到，不会被跳过，也不会被排到批次末尾去。
 */
export const DEFAULT_MAX_ACCEPTED_SENDS_PER_RUN = 500;

/**
 * 解析本轮实际生效的熔断上限。默认 500（防代码 bug 失控发送，而不是守上游配额）。
 *
 * 做成可配置而不是写死：这个数字的依据是「批次大小 / 业务量级 / 上游套餐」，换任何一个
 * 都该能改，而不必改代码重新部署。非法值一律 fail closed（抛错 → 本轮不发信），
 * 与 `config/runtime.ts` 的 `readEnum` 同口径：宁可静默不发，也不能把写错的额度
 * 当成「无上限」而失控发送。
 */
export function resolveMaxAcceptedSendsPerRun(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.LETTER_MAX_ACCEPTED_SENDS_PER_RUN?.trim();
  if (!raw) return DEFAULT_MAX_ACCEPTED_SENDS_PER_RUN;
  // 只接受纯十进制数字：`Number()` 会把 "1e3" 读成 1000、"0x10" 读成 16，
  // 于是一个手滑的指数写法会静默变成一个更大的上限 —— 对一个「防打爆配额」的
  // 闸门来说，宁可让运维把它写清楚，也不猜他想写多少。
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error('LETTER_MAX_ACCEPTED_SENDS_PER_RUN must be a positive integer');
  }
  return Number(raw);
}

/**
 * 每个 UTC 自然日真实发出的上限（**全局**，跨轮累计）的默认值：**1500**。
 *
 * 为什么需要它：每轮熔断（`resolveMaxAcceptedSendsPerRun`）只约束**一轮**。Cron 从每天 1 次
 * 提到每 10 分钟 1 次（144 轮/天）之后，理论上限是 144 × 500 = **72,000 封/天** ——
 * 这会在两天内打爆 Resend 月配额（Pro 档 50,000/月），并触发它的 5× 超额硬上限（真实费用）。
 * 所以轮级熔断挡不住高频调度带来的总量放大，必须有一道**按天**的闸门。
 *
 * 为什么是 1500：Resend Pro 月配额 50,000 ÷ 31 天 ≈ 1,613。取 1500 ⇒ 1500 × 31 = 46,500
 * **小于 50,000**，于是任何月份都不会撞月配额，也就不会走进付费超额区。
 * 这道闸门的职责是「让配额成为限流器」，不是「守住一个省钱的数字」——产品决策是
 * 该收到信的用户都要收到，所以默认值刻意贴着月配额的下界留一点余量。
 *
 * 与轮级熔断同一口径（非法值 fail closed，不静默变「无上限」）：宁可本轮不发信，
 * 也不能把写错的额度当成没有闸门。
 *
 * ⚠️ 已知交互：日上限若**低于**单轮批次（`CANDIDATE_BATCH_SIZE`），单轮会在中途停住，
 * 游标推进到「本轮最后一个已处理的访客」，下一轮从它之后继续 —— 配合每 10 分钟一轮，
 * 剩余的人很快会被轮到，不会饿死。这与轮级熔断的游标语义是同一套，见 `resolveCursorAfterRun`。
 */
export const DEFAULT_MAX_ACCEPTED_SENDS_PER_DAY = 1500;

/**
 * 解析本日实际生效的上限。默认 1500（贴近 Resend Pro 月配额 ÷ 31，见常量注释）。
 *
 * 与 `resolveMaxAcceptedSendsPerRun` 同形（可注入 env、只接受纯十进制、非法值抛错），
 * 理由也相同：这是防打爆下游配额的闸门，写错时宁可让运维写清楚。
 */
export function resolveMaxAcceptedSendsPerDay(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.LETTER_MAX_ACCEPTED_SENDS_PER_DAY?.trim();
  if (!raw) return DEFAULT_MAX_ACCEPTED_SENDS_PER_DAY;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error('LETTER_MAX_ACCEPTED_SENDS_PER_DAY must be a positive integer');
  }
  return Number(raw);
}

/**
 * 本日还剩多少发放额度。
 *
 * **必须夹到 0**：`sentToday` 可能因为「日上限被调低」而大于上限，相减得到负数。
 * 负数返回给调用方会让「今日是否还有额度」的判断取决于符号而不是语义，所以这里
 * 收敛成一个非负的剩余量，调用方只需判断 `=== 0`。
 */
export function remainingDailyCapacity(sentToday: number, maxPerDay: number): number {
  return Math.max(0, maxPerDay - sentToday);
}

/** pre-send 临时失败的最大尝试次数；超过就不再重试，让稳定 trigger_key 释放。 */
export const MAX_SEND_ATTEMPTS = 3;

const RETRY_BASE_MS = 30 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * 是否允许重试一次失败的投递。
 *
 * 唯一的硬约束：**provider 已经接受的投递绝不重试**。那种情况下信已经躺在用户邮箱里，
 * 重试就是给他发第二封——比漏发严重得多。
 */
export function shouldRetryFailedDelivery(input: {
  attemptCount: number;
  providerAccepted: boolean;
  now: Date;
}): boolean {
  if (input.providerAccepted) return false;
  return input.attemptCount < MAX_SEND_ATTEMPTS;
}

/** 指数退避但有上界：Cron 每天才跑一次，退避超过一天就永远等不到下一次。 */
export function nextRetryAt(attemptCount: number, now: Date): string {
  const exponent = Math.max(0, Math.min(attemptCount, 8) - 1);
  const delay = Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
  return new Date(now.getTime() + delay).toISOString();
}

/**
 * 这个错误是不是「账号已不存在」。
 *
 * 账号被删而 visitor 行还在时，读邮箱永远失败，重试不会改变结果。把它归为 failed
 * 会污染熔断与告警口径，让真正的故障淹没在噪声里，所以必须按「跳过」处理。
 * 匹配刻意保守：只认明确的 not-found 措辞，宁可漏判（退化成普通失败）
 * 也不能把「数据库超时」这类真故障误当成已删除账号而静默跳过。
 */
export function isDeletedAccountError(message: string): boolean {
  return /user[_\s-]*not[_\s-]*found|not found/i.test(message);
}

/**
 * Webhook 对账扫描的时间下界：只看最近这么久之内到达的事件。
 *
 * 为什么需要下界：这个 Resend 账号是**共用**的（同账号下还有 worddream.io 等产品），
 * 别家的事件也会打到我们同一条 webhook。`applyResendEvent()` 刻意「先把事件记下来、
 * 再去匹配投递行」（早到事件必须能自愈），匹配不到就留 pending。问题出在对账端：
 * `reconcilePendingWebhookEvents()` 每轮只取**最旧的一批** pending，对匹配不到投递行的
 * 直接跳过而**不淘汰**。于是外来事件会永久占住这个有界窗口的队首——实测 14 行
 * pending 全部来自别家的每日摘要——积满 limit 之后，真正早到的信件事件再也轮不到
 * 对账，`email.bounced` / `email.complained` 就可能漏做抑制。
 *
 * 7 天是极宽的余量：早到事件与投递行的间隔是**秒级**（投递行在 provider 接受后立刻写入），
 * 正常事件一定落在窗口内，而永远不会匹配上的外来事件会自然滑出。
 *
 * **不要**改成「只记录能匹配到投递行的事件」——那会拆掉早到自愈本身，因为这个下界的
 * 存在前提正是「事件可以先于投递行到达」。
 */
export const WEBHOOK_RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 对账扫描的下界时间戳（ISO）：`now` 减去 `WEBHOOK_RECONCILE_WINDOW_MS`。 */
export function webhookReconcileSince(now: Date): string {
  return new Date(now.getTime() - WEBHOOK_RECONCILE_WINDOW_MS).toISOString();
}

export interface CronBatch<T> {
  batch: T[];
  nextCursor: string | null;
}

/**
 * 从持久游标处切出本轮要处理的一批候选人。
 *
 * 为什么需要游标：Vercel 的每日 Cron 只能在函数时长内处理有界的一批，
 * 而「每轮都从头开始 + 批上限」会让第 201 个之后的用户永远轮不到。
 * 游标在一轮结束时前进并持久化，于是所有候选人在若干天内被均匀轮转。
 *
 * 游标指向的访客可能已被删除，此时从列表头部继续——宁可重扫一遍，
 * 也不能因为一个消失的 id 就卡死在原地。
 */
export function planCronBatches<T extends string>(input: {
  candidates: readonly T[];
  cursor: string | null;
  batchSize: number;
}): CronBatch<T> {
  const { candidates, cursor, batchSize } = input;
  if (candidates.length === 0) return { batch: [], nextCursor: null };

  const startIndex = cursor ? candidates.findIndex((candidate) => candidate === cursor) : -1;
  const from = startIndex >= 0 ? startIndex + 1 : 0;
  const batch = candidates.slice(from, from + batchSize);

  // 取满一批且还有剩余 → 游标停在最后一个已处理的访客上，下一轮从它之后继续。
  if (batch.length === batchSize && from + batchSize < candidates.length) {
    return { batch, nextCursor: batch[batch.length - 1] };
  }
  // 走到尾部（或本轮已覆盖到末尾）→ 游标归零，下次从头开始新一轮轮转。
  return { batch, nextCursor: null };
}

export interface CronCursorUpdate {
  /** false = 本轮不动游标（一个候选人都没处理，凭空推进会吞掉一批人）。 */
  shouldWrite: boolean;
  /** `shouldWrite` 为 true 时要写入的值；null = 归零，下一轮从列表头部重新轮转。 */
  cursor: string | null;
}

/**
 * 一轮结束后游标该走到哪。
 *
 * 关键在熔断：`planCronBatches` 给的 `nextCursor` 是**整批的最后一个**（批次 120 人），
 * 而熔断可能在一批中途触发（上限小于批次大小，或 provider 出错提前收工）。此时：
 *
 *   - 直接写 `nextCursor` → 被熔断挡下的那批人（第 91–120 人）被**跳过**，永远收不到信；
 *   - 完全不写（旧行为）→ 下一轮从同一批开头重扫，排在后面的人要等前面那批人的 3 天窗口
 *     关闭后才轮到，**延迟数天**。
 *
 * 正确做法是推进到「本轮最后一个已处理的访客」：下一轮从它之后继续，被挡下的人既不会被
 * 跳过，也不会被重复扫描，更不会被排到批次末尾去等几天。
 *
 * 注意「整批处理完」与「nextCursor 为 null」不是一回事：`planCronBatches` 在切到列表尾部
 * （批次不足）时也会给 null。若熔断正好在**最后那个短批**里触发，用 nextCursor（null）会把
 * 游标归零、剩下的尾巴这一轮永远轮不到 —— 所以要按「这批人是否全部处理完」分岔，
 * 而不是按 nextCursor 是否为 null。
 *
 * 「已处理」包含被 `continue` 跳过的人：调度器里的跳过都是终态判定（账号已删除、没有邮箱、
 * 没有可写信的伴侣/锚点、今日已发、偏好已关闭、撞每日唯一索引），重扫同一个人不会改变结论，
 * 只会占掉批次名额把后面的人挤出去。
 */
export function resolveCursorAfterRun(input: {
  /** 本轮实际切到的候选人（`planCronBatches` 的 `batch`）。 */
  batch: readonly string[];
  /** `planCronBatches` 给的下一批起点；走到列表尾部时为 null。 */
  nextCursor: string | null;
  /** 本轮最后一个已处理的访客；一个都没处理时为 null。 */
  lastProcessedVisitorId: string | null;
}): CronCursorUpdate {
  // 没切到候选人 = 上一轮已经处理到列表尾部，游标该归零、开启新一轮轮转。
  // 这里必须写（而不是「不写」）：游标停在最后一个候选人上时，planCronBatches 会一直切出
  // 空批次，轮转再也回不到列表头部。
  if (input.batch.length === 0) return { shouldWrite: true, cursor: input.nextCursor };
  // 切到了人却一个都没处理：只可能是熔断上限为 0。保持原游标，别吞掉这批人。
  if (input.lastProcessedVisitorId === null) return { shouldWrite: false, cursor: null };
  // 熔断中途退出（最后一人没处理到）→ 推进到最后一个已处理访客，剩下的下一轮继续。
  if (input.lastProcessedVisitorId !== input.batch[input.batch.length - 1]) {
    return { shouldWrite: true, cursor: input.lastProcessedVisitorId };
  }
  // 整批处理完 → 与旧行为完全一致：用 planCronBatches 的 nextCursor（可能为 null = 归零）。
  return { shouldWrite: true, cursor: input.nextCursor };
}

/**
 * 由「这次互动日」和「已有的投递本地日」算出窗口起点。
 *
 * 关键：必须取**最早**一个 ≥ 互动日的投递日，而不是最后一个。
 * 用最后一个会让窗口跟着最后一封不断往前滑 ——
 * 「连发 3 天然后停」会变成「天天发、永不停止」。
 *
 * 若还没有任何投递落在互动日之后，说明这次互动还没被任何一轮 Cron 看到，
 * 窗口起点 = today（第一次看到它的那次 Cron）。
 */
export function computeWindowStart(input: {
  interactionDay: string;
  deliveredDays: readonly string[];
  today: string;
}): string {
  const after = input.deliveredDays
    .filter((day) => day >= input.interactionDay)
    .sort();
  return after[0] ?? input.today;
}

export interface LetterTarget {
  companionId: string;
  conversationId: string;
  /** 该伴侣**所有会话**里最后一条用户消息的时间。 */
  lastUserMessageAt: string;
}

/**
 * 挑出「该给哪个伴侣写信」，以及这个伴侣的最后互动时间。
 *
 * 两个都必须按**伴侣**聚合，不能按单个会话：
 *
 * 1. 同一伴侣可以有多个会话（用户新开一个继续聊）。只看其中一个会漏掉
 *    用户在另一个会话里说的话 —— 于是窗口判成 no_interaction，信永远发不出去。
 * 2. 也不能用 conversations.updated_at 挑会话：只有助手消息的会话（例如刚生成过
 *    开场白、用户还没开口）也会把 updated_at 推高，于是挑到一个没有用户互动的会话。
 *
 * 输入按时间倒序即可（查询已排序）；同一伴侣取最新一条，再在所有伴侣里取最新的那个。
 */
export function pickLetterTarget(
  rows: ReadonlyArray<{ companion_id: string; conversation_id: string; created_at: string }>,
): LetterTarget | null {
  let best: LetterTarget | null = null;
  for (const row of rows) {
    // rows 已按 created_at 倒序，因此每个伴侣第一次出现就是它的最新一条。
    if (best && best.companionId === row.companion_id) continue;
    if (best && row.created_at <= best.lastUserMessageAt) continue;
    best = {
      companionId: row.companion_id,
      conversationId: row.conversation_id,
      lastUserMessageAt: row.created_at,
    };
  }
  return best;
}

/**
 * 信件路径**唯一**的召回 query。
 *
 * 曾经这里是 1 个主 query + 2 个补充角度 = 3 次 SEARCH，每个候选人每天一轮。
 * 但写信只需要「一条合格的锚点」，不需要三个角度各自成榜 ——
 * 于是每封信的成本从 3 次检索降到 1 次（省下的两次纯属重复）。
 */
export const LETTER_RECALL_QUERY = '需要主动关心、跟进或纪念的明确事实';

/**
 * 「要不要为这个候选人去翻记忆」的结论。
 *
 * 刻意做成三支的可辨识联合（而不是「needed: false + 可选 letterKind」）：
 * 后者会允许 `skipReason: null` 又不带 `letterKind` 这种**含义不明**的组合 ——
 * 「不需要跳过、但也不需要召回」，到底是漏发还是要发？调用方只能猜。
 * 现在 `needed: false` 且 `skipReason === null` 时，`letterKind` 是**必需**字段，
 * switch 上它会强制调用方正面处理「今天就是那件事的日子」这一支。
 */
export type LetterRecallPlan =
  | { needed: true }
  /** 本地数据就能定论「这一轮不发信」，因此根本不必召回。 */
  | { needed: false; skipReason: LetterSkipReason }
  /**
   * 今天命中重要日期：信件内容已经由这条日期决定，不需要任何记忆锚点 ——
   * 但它**要发**，所以不能记成 skip，也不该被任何 `skipReason` 逻辑顺手跳过。
   */
  | { needed: false; skipReason: null; letterKind: 'important-date' };

/**
 * 要不要为这个候选人去翻记忆。
 *
 * 为什么值得先算：`decideLetterEligibility` 的顺序是
 * 「偏好 → 当日已发 → 重要日期 → 锚点 → 窗口」——
 * 前三道门槛**全部只依赖本地数据库**，却都在召回之后才判断。
 * 在每天扫一整批候选人的 cron 里，这是纯粹的浪费。
 *
 * ⚠️ 只前置可以安全前置的门槛。**窗口是否关闭不能作为跳过召回的借口**：
 * L0 锚点（今天就是那件事的日子）本来就豁免窗口，提前跳过会造成漏发。
 */
export function planLetterRecall(input: {
  preferenceStatus: string | null;
  hasLetterToday: boolean;
  hasImportantDateToday: boolean;
}): LetterRecallPlan {
  if (input.preferenceStatus && input.preferenceStatus !== 'enabled') {
    return { needed: false, skipReason: 'preference_disabled' };
  }
  if (input.hasLetterToday) return { needed: false, skipReason: 'daily_limit' };
  if (input.hasImportantDateToday) {
    return { needed: false, skipReason: null, letterKind: 'important-date' };
  }
  return { needed: true };
}
