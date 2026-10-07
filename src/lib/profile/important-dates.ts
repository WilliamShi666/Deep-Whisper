import type { ImportantDate } from '@/lib/types';
import type { Locale } from '@/lib/i18n/locale';

/**
 * 重要日期的类型表与派生逻辑（纯函数，无网络、无 React）。
 *
 * 为什么单独成模块：这份类型表原先散在四个文件里（UI 的 DATE_TYPES、服务端的
 * allowed 白名单、注入 AI 的 DATE_TYPE_LABEL、以及 types.ts 的联合类型），
 * 漏改任一处就会出现「界面能选、服务端静默降级成 other」。抽成纯模块后
 * 既能被组件 import，也能被单测直接断言，不需要经过 React 渲染。
 *
 * 关于「生日」：它是**用户自己的**生日，走 user_profiles.birthday 独立列，
 * 由组件里的「我的生日」专用输入负责，因此**不出现在下面的类型选择器里** ——
 * 两处都能填会造成同一条记录被写两次，或用户在下拉里加的生日被当作"自己的生日"。
 * 家人朋友的生日用「纪念日」或「其他」记录。
 */
export const DATE_TYPES: Array<{ value: ImportantDate['type']; label: string }> = [
  { value: 'anniversary', label: '纪念日' },
  { value: 'memorial', label: '怀念的日子' },
  { value: 'exam', label: '考试/面试' },
  { value: 'other', label: '其他' },
];

/** 界面不提供、但历史上可能已存在的类型：只读回显，不让重新选。 */
const LEGACY_TYPE_LABEL: Record<string, string> = {
  birthday: '生日',
  medical: '复诊（历史）',
};

/** 类型 → 中文标签。未知类型原样返回，避免显示成空白。 */
export function typeLabel(type: string): string {
  return DATE_TYPES.find((t) => t.value === type)?.label ?? LEGACY_TYPE_LABEL[type] ?? type;
}

/**
 * 生日条目的固定描述（**历史哨兵**）。
 *
 * 存量行里，用户自己的生日那条派生条目只能靠这个中文字符串识别。现在写入侧同时打
 * `kind: 'birthday'`（语言无关），读取侧**两种都认**（`isCanonicalBirthday`）——
 * 于是英文态不必依赖汉字，而存量数据一行都不用改（零回填零 UPDATE）。
 */
export const BIRTHDAY_DESCRIPTION = '我的生日';

/**
 * 是否是「由 birthday 列派生」的那条规范生日条目。
 *
 * 判据有两条，**取并集**（零迁移的关键）：
 *   1. 新写入带 `kind: 'birthday'`（语言无关，英文态不必依赖汉字）；
 *   2. 存量数据的旧中文哨兵：描述逐字符等于 BIRTHDAY_DESCRIPTION。
 *
 * `birthday` 这个类型在本产品里专指用户自己的生日，所以历史数据或手工 API 写入
 * 的其它 birthday 条目（例如「妈妈的生日」）不属于派生条目 —— 它们不该被隐藏、
 * 也不该被丢弃，必须先降级成「纪念日」再正常展示。
 */
export function isCanonicalBirthday(entry: ImportantDate): boolean {
  if (entry.kind === 'birthday') return true;
  return entry.type === 'birthday' && entry.description === BIRTHDAY_DESCRIPTION;
}

/**
 * 给规范生日条目补上语言无关的 `kind` 标记（**写入前**调用）。
 *
 * 为什么必须在服务端补：`PUT /api/profile` 会先过 `normalizeImportantDates` 的白名单重建
 * （只保留 date/type/description/recurring），客户端带来的 `kind` 会被丢掉；而写入路径不止一条
 * （onboarding 的合并语义、设置页的替换语义、以及将来的任何客户端）。所以标记只在一个地方打：
 * `resolveImportantDatesWrite` —— 所有写入都经过它，且**只加字段、不改描述**（中文态逐字符不变）。
 */
export function withBirthdayKind(dates: readonly ImportantDate[]): ImportantDate[] {
  return dates.map((entry) => (
    isCanonicalBirthday(entry) && entry.kind !== 'birthday' ? { ...entry, kind: 'birthday' } : entry
  ));
}

/**
 * 重要日期在**提示词 / 信件正文**里的描述。
 *
 * zh-CN：逐字符返回存库原文（既有行为不变，H4）。
 * en：把固定的中文哨兵映射成 `birthday` —— 英文信里不能出现「我的生日」这四个汉字。
 */
export function importantDatePromptDescription(entry: ImportantDate, locale: Locale): string {
  if (locale !== 'en') return entry.description;
  return isCanonicalBirthday(entry) ? 'birthday' : entry.description;
}

/** 合并时的去重键：同类型 + 同日期 + 同描述视为同一条。 */
function entryKey(entry: ImportantDate): string {
  return `${entry.type}|${entry.date}|${entry.description}`;
}

/**
 * 把「我的生日」列与重要日期列表合成真正要写库的 important_dates。
 *
 * 为什么必须把生日同步成一条 important_dates 条目：来信调度只读这一列
 * （scheduler.ts 的 readImportantDate），只写 birthday 列的话生日当天不会有任何来信。
 *
 * 生日条目**始终由 birthday 字段派生**，因此：
 *   - 填了生日 → 用规范条目替换旧的派生条目（幂等，重复保存不会累积）
 *   - 清空生日 → 该条目随之消失（这就是"删除生日"的语义）
 *
 * 关于"别人"的生日条目：`birthday` 这个类型在本产品里**专指用户自己的生日**，
 * 因此任何描述不是 BIRTHDAY_DESCRIPTION 的 birthday 条目都不是派生条目 ——
 * 它可能是历史数据或手工写入的 API 请求。这类条目**不得静默丢弃**
 * （审查发现旧实现会把它们连同生日一起抹掉，还提示保存成功），
 * 而是降级成「纪念日」：日期、描述、每年重复全部保留，且重新出现在列表里
 * 让用户看得见。信息一条不丢，类型语义也不再含糊。
 */
export function buildImportantDatesPayload(
  birthday: string,
  dates: readonly ImportantDate[],
): ImportantDate[] {
  const preserved = dates.map((entry) =>
    entry.type === 'birthday' && !isCanonicalBirthday(entry)
      ? { ...entry, type: 'anniversary' as const }
      : entry,
  );
  const others = preserved.filter((entry) => !isCanonicalBirthday(entry));

  const trimmed = birthday.trim();
  if (!trimmed) return withBirthdayKind(others);
  return withBirthdayKind([
    { date: trimmed, type: 'birthday', description: BIRTHDAY_DESCRIPTION, recurring: true, kind: 'birthday' },
    ...others,
  ]);
}

/**
 * 从已存的 important_dates 里取回生日。
 *
 * 只认规范描述的那条：历史/手工写入的 birthday 条目描述不同，
 * 取错了会把别人的生日填进「我的生日」输入框。
 */
export function extractBirthday(dates: readonly ImportantDate[] | null | undefined): string {
  return dates?.find(isCanonicalBirthday)?.date ?? '';
}

/**
 * 列表里要展示的条目：**只隐藏派生出来的那条规范生日条目**（由专用输入负责，
 * 不重复出现）。非规范的 birthday 条目（如历史数据里「妈妈的生日」）必须继续
 * 展示 —— 隐藏它等于让用户看不到自己录入的东西。
 */
export function visibleImportantDates(dates: readonly ImportantDate[]): ImportantDate[] {
  return dates.filter((entry) => !isCanonicalBirthday(entry));
}

/**
 * 把本次提交的条目**并入**已存条目，而不是整体替换。
 *
 * 为什么需要它：`PUT /api/profile` 对 `important_dates` 是整列替换语义
 * （聊天设置里的编辑器会先读全量、再写全量，删除某条必须能生效，所以替换语义
 * 本身是对的）。但「创建角色 / 重新遇见 TA」里的编辑器是**从空列表起步**的：
 * 用户在那里只填了「我的生日」，若按替换语义提交，此前保存的纪念日、考试等
 * 会被静默清空。该入口的语义是「补充」，因此必须显式合并。
 *
 * 规则：
 *   - 已存条目全部保留；本次提交的条目按「类型|日期|描述」覆盖同键条目
 *   - 规范的生日条目**至多一条**：本次提交了生日就用新的，否则沿用已存的
 *     （本次没填生日 ≠ 要删生日；「清空生日」只在设置页由专用字段显式表达）
 *   - 生日条目排在首位，与 buildImportantDatesPayload 的顺序一致
 */
export function mergeImportantDates(
  existing: readonly ImportantDate[] | null | undefined,
  incoming: readonly ImportantDate[],
): ImportantDate[] {
  const stored = existing ?? [];
  const birthday =
    incoming.find(isCanonicalBirthday) ?? stored.find(isCanonicalBirthday) ?? null;

  const merged = new Map<string, ImportantDate>();
  // Map 保留首次插入位置：覆盖同键条目时不会把已存条目挪到末尾，用户看到的顺序稳定
  for (const entry of stored) {
    if (!isCanonicalBirthday(entry)) merged.set(entryKey(entry), entry);
  }
  for (const entry of incoming) {
    if (!isCanonicalBirthday(entry)) merged.set(entryKey(entry), entry);
  }

  const rest = [...merged.values()];
  return birthday ? [birthday, ...rest] : rest;
}

/**
 * 写入语义的取值。
 *
 * 客户端与服务端**共用这个常量**：请求体里的字段名无法被 TypeScript 校验，
 * 两边各写一份字面量时改一边就会静默退回替换语义（正是 F-1 那类数据丢失的成因）。
 */
export const IMPORTANT_DATES_REPLACE_MODE = 'replace';
export const IMPORTANT_DATES_MERGE_MODE = 'merge';

export type ImportantDatesWriteMode = typeof IMPORTANT_DATES_REPLACE_MODE | typeof IMPORTANT_DATES_MERGE_MODE;

/**
 * 解析请求体里的写入语义。未知值一律退回 replace —— 这是设置页的既有语义，
 * 不能因为客户端拼错一个字符串就把「合并」意外变成默认行为。
 */
export function parseImportantDatesWriteMode(value: unknown): ImportantDatesWriteMode {
  return value === IMPORTANT_DATES_MERGE_MODE ? IMPORTANT_DATES_MERGE_MODE : IMPORTANT_DATES_REPLACE_MODE;
}

/**
 * 决定本次要写入 `important_dates` 的最终值。
 *
 * 单独抽出来的原因：这是「会不会清空用户数据」的唯一判据，必须在纯函数层被测试钉住，
 * 而不是散在 route handler 的 if 分支里（那里没有数据库就跑不起来，也就没人测）。
 */
export function resolveImportantDatesWrite(
  mode: ImportantDatesWriteMode,
  existing: readonly ImportantDate[] | null | undefined,
  incoming: readonly ImportantDate[],
): ImportantDate[] {
  const resolved = mode === IMPORTANT_DATES_MERGE_MODE ? mergeImportantDates(existing, incoming) : [...incoming];
  // 唯一的写入决策点：在这里给规范生日条目打上语言无关的 kind（见 withBirthdayKind 的说明）。
  return withBirthdayKind(resolved);
}
