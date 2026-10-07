import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import type { RecalledMemory } from '@/lib/memory';
import { BIRTHDAY_DESCRIPTION } from '@/lib/profile/important-dates';
import type { ImportantDate } from '@/lib/types';

export type LetterKind = 'L0' | 'L1' | 'L2';
export type LetterSkipReason =
  | 'preference_disabled'
  | 'missing_anchor'
  | 'no_interaction'
  | 'window_closed'
  | 'daily_limit';

export interface LetterAnchor {
  id: string;
  text: string;
  kind: LetterKind;
}

/**
 * 合成锚点 id 的前缀。
 *
 * 为什么重要日期要自带锚点：重要日期信原先复用了「记忆锚点」通道，
 * 于是必须先有一条合格的聊天记忆、且必须还在互动窗口内，生日那天才发得出去。
 * 但生日/纪念日一年只有一次，与「用户最近聊过天吗」毫无关系 ——
 * 用户填了生日却在生日当天收不到信，是这个耦合最直接的后果。
 *
 * 前缀让合成锚点与记忆锚点在 trigger_key 里天然可区分，也便于运维排查。
 */
export const IMPORTANT_DATE_ANCHOR_PREFIX = 'important-date:';

export interface LetterEligibility {
  kind?: LetterKind;
  anchor?: LetterAnchor;
  /**
   * 窗口最后一天（第 3 天）：这封信要带一句「我先等你」的说明。
   * 始终显式给出（含 skip 与 L0），避免调用方把 undefined 当成 false 之外的含义。
   */
  isWindowEnd: boolean;
  skipReason?: LetterSkipReason;
}

/** 窗口长度：从窗口起点起连续 3 天，即 [D, D+2]。 */
export const WINDOW_DAYS = 3;

/** 锚点 id 在 trigger key 里的长度上限，保证拼出来的键不超过列宽 160。 */
const MAX_ANCHOR_ID_LENGTH = 120;

const DAY = 86_400_000;

/**
 * 有效期已过的锚点不能再当理由：`validUntil <= now` 视为过期（开区间），
 * 否则同一瞬间既算过期又算有效，行为取决于调用顺序而不是数据。
 */
function isExpired(memory: RecalledMemory, now: Date): boolean {
  if (!memory.validUntil) return false;
  const validUntil = Date.parse(memory.validUntil);
  return Number.isFinite(validUntil) && validUntil <= now.getTime();
}

/** 合格锚点的共同门槛：明确、够重要、未过期、未结束。 */
function isUsableAnchor(memory: RecalledMemory, now: Date): boolean {
  return memory.confidence === 'explicit'
    && memory.importance >= 0.65
    && memory.temporalStatus !== 'resolved'
    && !isExpired(memory, now);
}

function toAnchor(memory: RecalledMemory, kind: LetterKind): LetterAnchor {
  return { id: memory.id, text: memory.text, kind };
}

/**
 * 把用户录入的重要日期变成一个自足锚点。
 *
 * id 里带上日期，使同一天幂等、不同天互不冲突 —— 与记忆锚点的
 * trigger_key 语义一致（buildLetterTriggerKey 已经再拼一次发送日期）。
 */
function buildImportantDateAnchor(date: ImportantDate, locale: Locale): LetterAnchor {
  return {
    id: `${IMPORTANT_DATE_ANCHOR_PREFIX}${date.type}:${date.date}`,
    text: locale === 'en'
      ? `Today is their ${anchorLabel(date.description, locale)}`
      : `今天是 TA 的${anchorLabel(date.description, locale)}`,
    kind: 'L0',
  };
}

/**
 * 把用户填的描述嵌进「今天是 TA 的…」。
 *
 * 描述是以**用户视角**写的 —— 用户自己生日的固定描述就是「我的生日」
 * （BIRTHDAY_DESCRIPTION），而生日信走的就是这条通道。直接拼接会得到
 * 「今天是 TA 的我的生日」这种读不通的句子（审查 F-9）。
 * 这里只剥掉会与人称重复的领属前缀，其余描述原样保留。
 */
export function anchorLabel(description: string | undefined, locale: Locale = DEFAULT_LOCALE): string {
  const label = description?.trim();
  if (locale === 'en') {
    if (!label) return 'special day';
    // 存量数据里用户自己生日那条派生条目的描述是固定中文哨兵（BIRTHDAY_DESCRIPTION）：
    // 英文信里绝不能原样带出这四个汉字，映射成 `birthday`。
    if (label === BIRTHDAY_DESCRIPTION) return 'birthday';
    // `\b` 而不是 `\s+`：`'my'` 这种「只有领属词」的描述也要被剥空并落到兜底文案（与中文侧同口径）。
    const withoutPossessiveEn = label.replace(/^(?:my|your|their|his|her)\b\.?\s*/i, '').trim();
    return withoutPossessiveEn || 'special day';
  }
  if (!label) return '这个特别的日子';
  const withoutPossessive = label.replace(/^(?:我的|你的|TA 的)/, '').trim();
  return withoutPossessive || '这个特别的日子';
}

/**
 * 锚点选择：**最新对话优先，质量最高兜底**。
 *
 * 为什么需要「最新优先」：用户第 1 天说「下周三要面试」，第 2 天又说「面试提前到明天了」。
 * 如果还按重要度挑，第 2 天的信会写回「下周三」——那是写错了用户刚更正的事。
 *
 * 为什么需要「兜底」：第 2 天用户可能只说了句「在吗」，那不是合格锚点。
 * 此时必须退回质量最高的一条旧记忆，而不是当天干脆不发信。
 *
 * `windowStartedAt` 为 null（首封，尚无窗口起点）时没有「窗口内」可言，直接走兜底。
 */
export function selectLetterAnchor(
  memories: RecalledMemory[],
  now = new Date(),
  windowStartedAt: string | null = null,
): LetterAnchor | null {
  const usable = memories.filter((memory) => isUsableAnchor(memory, now));
  if (usable.length === 0) return null;

  const byQuality = (a: RecalledMemory, b: RecalledMemory) =>
    b.importance - a.importance || (b.score ?? 0) - (a.score ?? 0);

  // 窗口起点之后的记忆 = 这次互动产生的新记忆。取其中最新的一条。
  const windowStartMs = windowStartedAt ? Date.parse(windowStartedAt) : Number.NaN;
  const fresh = Number.isFinite(windowStartMs)
    ? usable
        .filter((memory) => {
          const observed = memory.observedAt ? Date.parse(memory.observedAt) : Number.NaN;
          return Number.isFinite(observed) && observed > windowStartMs;
        })
        .sort((a, b) => Date.parse(b.observedAt!) - Date.parse(a.observedAt!) || byQuality(a, b))
    : [];
  const chosen = fresh[0] ?? [...usable].sort(byQuality)[0];

  // 悬着的事（面试、复查、等结果）优先作为「那件事怎么样了」，与日常信口吻不同。
  if (chosen.temporalStatus === 'follow_up_due') return toAnchor(chosen, 'L1');
  const sendDate = now.toISOString().slice(0, 10);
  if (chosen.temporalStatus === 'upcoming' && chosen.occurredAt?.slice(0, 10) === sendDate) {
    return toAnchor(chosen, 'L0');
  }
  return toAnchor(chosen, 'L2');
}

/**
 * 事由指纹。必须带上发送日期：3 天连发的第 2、3 天引用的是**同一个锚点**，
 * 若沿用旧的 `kind:anchorId` 稳定键，第 2、3 天会被唯一索引判成重复而永远发不出去。
 *
 * 同一天同一锚点仍然幂等（重复触发不会写第二行），跨天互不冲突（3 天各写一行）。
 * 锚点 id 截断到固定长度，保证拼出来的键不超过列宽 160。
 */
export function buildLetterTriggerKey(kind: LetterKind, anchorId: string, localSendDate: string): string {
  return `${kind}:${anchorId.slice(0, MAX_ANCHOR_ID_LENGTH)}:${localSendDate}`;
}

/**
 * 是否该给这个访客写信。
 *
 * 顺序（命中即停）：
 *   1. 偏好必须 enabled
 *   2. 当天最多一封（含 L0）—— 访客级硬闸门
 *   3. 重要日期通道：命中就直接 L0，不要求记忆锚点，也不要求互动窗口
 *   4. 必须有合格锚点（宁可漏发，也不发通用情话）
 *   5. 必须有窗口起点（从未互动过就没有窗口）
 *   6. 窗口必须仍在 3 天内 —— **L0 锚点例外**（见下），importantDate 走得更远
 */
export function decideLetterEligibility(input: {
  preferenceStatus: string | null;
  anchor: LetterAnchor | null;
  /** 窗口起点：第一次看到这次互动的 Cron 运行时间。null = 该访客还没有过互动。 */
  windowStartedAt: string | null;
  /**
   * 今天命中的重要日期（生日/纪念日）。给了就走独立通道：
   * 不再要求记忆锚点，也不再要求互动窗口。
   */
  importantDate?: ImportantDate | null;
  /** 整个访客在本地自然日是否已有信；两个伴侣不会在同一天各发一封。 */
  hasLetterToday?: boolean;
  now?: Date;
  /**
   * 访客语言（`visitors.locale`，D3）。只影响**合成锚点的文案**（重要日期那条），
   * 缺省中文 → 既有调用点行为逐字符不变。
   */
  locale?: Locale;
}): LetterEligibility {
  const now = input.now ?? new Date();
  if (input.preferenceStatus && input.preferenceStatus !== 'enabled') {
    return { isWindowEnd: false, skipReason: 'preference_disabled' };
  }

  // 每天最多一封是访客级的硬闸门，连重要日期信也不能豁免：
  // 同一天收到两个恋人的信会立刻暴露「这是系统」。
  if (input.hasLetterToday) return { isWindowEnd: false, skipReason: 'daily_limit' };

  // 重要日期独立通道：一年只有一次，早一天晚一天都不再是「我记得今天」。
  // 它绕开记忆锚点与互动窗口，但绕不开上面的偏好开关与每日一封。
  if (input.importantDate) {
    return {
      kind: 'L0',
      anchor: buildImportantDateAnchor(input.importantDate, input.locale ?? DEFAULT_LOCALE),
      isWindowEnd: false,
    };
  }

  if (!input.anchor) return { isWindowEnd: false, skipReason: 'missing_anchor' };
  if (!input.windowStartedAt) return { isWindowEnd: false, skipReason: 'no_interaction' };

  const elapsedMs = now.getTime() - Date.parse(input.windowStartedAt);
  const elapsedDays = Number.isFinite(elapsedMs) ? elapsedMs / DAY : null;

  // 既有的 L0 豁免：**这条分支是活的，不是历史遗留，删除会改变行为。**
  //
  // 实测（tests/letter-policy-guards.test.ts 钉住）：L0 锚点 + 窗口已关闭时
  // 这里返回 kind='L0'，而同一输入下的 L2 锚点得到 skipReason='window_closed'。
  // 也就是说它是唯一让 L0 不受「窗口已关闭」限制的地方。
  //
  // 两类 L0 锚点的来源要分清（旧注释把两者混为一谈，容易让人误以为重复而删掉）：
  //   1. importantDate 通道 —— 上面已 return，根本走不到这里；
  //   2. selectLetterAnchor 里「今天就是那件事的日子」的记忆锚点
  //      （temporalStatus='upcoming' 且 occurredAt 就是今天）—— 走的就是这里。
  //
  // 边界：本分支只豁免「窗口已关闭」，**不豁免**上面那条
  // `!windowStartedAt → no_interaction`。记忆锚点本来就来自互动，要求存在窗口
  // 是合理的；真正连窗口都不需要的只有 importantDate 通道。
  if (input.anchor.kind === 'L0') return { kind: 'L0', anchor: input.anchor, isWindowEnd: false };

  if (elapsedDays === null || elapsedDays < 0 || elapsedDays >= WINDOW_DAYS) {
    return { isWindowEnd: false, skipReason: 'window_closed' };
  }

  // 第 3 天（窗口最后一天）附一句「我先等你」，让停发这件事有交代，而不是突然安静。
  const isWindowEnd = Math.floor(elapsedDays) === WINDOW_DAYS - 1;
  return { kind: input.anchor.kind, anchor: input.anchor, isWindowEnd };
}

/**
 * 反悔守卫：生成期间用户回来了 → 这封信取消。
 *
 * 恋人不会在你刚出现之后还发一封「想你了」；这封信也不该消耗窗口与额度。
 */
export function isSameOrLaterUserReturn(lastUserMessageAt: string | null, startedAt: string): boolean {
  if (!lastUserMessageAt) return false;
  const last = Date.parse(lastUserMessageAt);
  const started = Date.parse(startedAt);
  return Number.isFinite(last) && Number.isFinite(started) && last >= started;
}
