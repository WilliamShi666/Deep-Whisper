import { FROZEN_ZH_LITERALS } from './i18n-frozen-zh';
import type { CjkNode } from './i18n-cjk';

/**
 * 覆盖门禁的**白名单**（U1 / t5，契约 §7.2 的 R1–R5）。
 *
 * 只有三种豁免，**没有第四种**，也**不允许**用「按数量豁免」「跳过所有含 CJK 的文件」
 * 「整目录塞进来」这类空转手段：
 *
 *   ① `WHOLE_FILE_ALLOWLIST` —— **整文件豁免**。只给「文件目的本身就是中文」或
 *      「整块出界面」的文件（zh 字典、zh 内容源、角色/壁纸中文档案、管理端、试听页、非产品面）。
 *      每条都写明理由。
 *
 *   ② `NODE_ALLOWLIST` —— **内容条件豁免**。文件主体是代码、只按设计携带少量中文字面量；
 *      豁免条件是**对节点内容/位置的谓词**，不是豁免整个文件。每条都写明谓词与理由。
 *      - `src/lib/i18n/locale.ts`：只放行语言**自称**那两个字面量（`中文`）—— 语言名必须用它
 *        自己的文字写；
 *      - internal-log 的 8 个服务端文件：只放行 `throw new *Error(...)` / `console.*(...)`
 *        实参内的中文（纯内部日志按契约 §6.1 保持中文不翻），**不按数量豁免**。
 *
 *   ③ `FROZEN_ZH_LITERALS`（见 `./i18n-frozen-zh`）—— **逐字面量冻结快照**，不是整文件豁免：
 *      门禁落地那一刻 src/ 里仍存在大量合法中文（界面文案待各任务搬进字典；服务端响应兜底
 *      按契约 §6.2 逐字符保留）。这些文件里：
 *        - 命中快照的字符串 → 通过；
 *        - **新的**中文字面量 → **违规**（所以「往 src/components 里塞一个中文字面量」必然变红）。
 *      各 area 的所有者替换完文案后，从快照里删掉该文件（连同 `PENDING_OWNERS` 的记录）。
 */

export interface WholeFileEntry {
  /** 路径规则（对工作区相对 POSIX 路径取 test）。 */
  pattern: RegExp;
  /** 为什么这份文件的中文属于合法保留。 */
  reason: string;
}

export const WHOLE_FILE_ALLOWLIST: readonly WholeFileEntry[] = [
  {
    pattern: /^src\/lib\/i18n\/messages\/zh-CN\//,
    reason: '中文字典本体：这个文件的存在目的就是中文文案（en 侧由 Record<keyof typeof zh, string> 约束）',
  },
  {
    // U7 / t8 拆分完成后的复核：`src/lib/prompts.ts` 已是**纯转出的薄 barrel**（零中文字面量），
    // 因此不再需要豁免它 —— 收紧到只豁免 zh 侧（中文提示词的合法归宿）。
    pattern: /^src\/lib\/prompts\/zh\.ts$/,
    reason: '中文提示词：模型可见、用户不可见；barrel 与 en 侧都不得出现中文字面量',
  },
  {
    pattern: /^src\/lib\/characters\.ts$/,
    reason: '中文角色档案：英文在 nameRoman / en.*，顶层中文字段按用户硬约束一字不改',
  },
  {
    pattern: /^src\/lib\/chat-themes\.ts$/,
    reason: '中文壁纸名 / UI 色调名：英文名在 en 字段（t3 已加），中文名是中文态的既有取值',
  },
  {
    pattern: /^src\/lib\/landing-content(\.zh)?\.ts$/,
    reason: '落地页中文文案源：U6 拆分为 landing-content.{zh,en}.ts 后本条目指向 .zh',
  },
  {
    pattern: /^src\/lib\/legal-content(\.zh)?\.ts$/,
    reason: '隐私政策 / 服务条款中文文本源：U6 拆分后本条目指向 .zh',
  },
  {
    pattern: /^src\/lib\/letters\/(writer|policy)\.ts$/,
    reason: '中文信件正文与领属前缀：U7/U8 按语言拆分支，中文分支按用户硬约束保留',
  },
  {
    pattern: /^src\/lib\/profile\/important-dates\.ts$/,
    reason: '存量数据哨兵（BIRTHDAY_DESCRIPTION = 我的生日 等）：零迁移零回填，只能兼容读',
  },
  { pattern: /^src\/app\/admin\//, reason: '管理端不翻（用户硬约束 D8）' },
  { pattern: /^src\/app\/api\/admin\//, reason: '管理端 API 不翻（D8）' },
  { pattern: /^src\/app\/qwen-voices\//, reason: '千问音色试听页不翻（用户硬约束 D7）' },
  { pattern: /^src\/lib\/ai\/qwen-voices\.ts$/, reason: '上游 68 音色目录：D7 出界，仅服务端试听页使用' },
  { pattern: /^src\/lib\/feedback\/admin-query\.ts$/, reason: '仅服务管理端（随 D8 出界）' },
  { pattern: /^src\/app\/api\/(webhooks|cron|e2e)\//, reason: '非产品面（签名通知 / 定时任务 / E2E 探针），不进界面' },
  {
    pattern: /^src\/app\/api\/(auth-providers|supabase-config)\//,
    reason: '非产品面（服务端探测 / 配置下发）：文案已是英文且不上屏',
  },
  {
    pattern: /^src\/app\/api\/billing\/(dev-market|local-return)\//,
    reason: '非产品面（开发 / 本地回跳专用端点）',
  },
];

export interface NodeEntry {
  pattern: RegExp;
  reason: string;
  /** 谓词：这个中文节点是否被合法放行。 */
  allows: (node: CjkNode) => boolean;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * internal-log 的服务端文件：中文只允许出现在 `throw new *Error(...)` / `console.*(...)` 实参内。
 *
 * `src/app/api/chat/route.ts`（U7 / t8 新增）：该文件里会上屏的文案已全部走 `apiError(...)`
 * 并进入字典；本次**只新增**了一条「迁移 0021 未应用 → 读取降级」的 `console.warn` 留痕，
 * 属于契约 §6.1 的「服务端内部日志保持中文」。谓词不变（只放行实参内的日志中文），
 * 所以该文件里**新加**一条上屏中文仍然会红。
 * `src/lib/i18n/visitor-locale.ts`（U7 / t8 新建）：服务端读 `visitors.locale` 的降级留痕，
 * 同上 —— 只有 `console.warn` 实参内的中文被放行。
 * `src/app/api/letters/unsubscribe/route.ts`（退订页重做）：两条 `console.warn` 降级留痕 ——
 * 「读这一页要用的数据失败 → 渲染通用页」与「写退订状态失败 → 渲染重试页」。用户可见文案
 * 已全部住字典 `server.letters.*`；谓词只放行实参内的日志中文，所以往这个文件里加一条上屏中文仍然会红。
 */
const INTERNAL_LOG_FILES = [
  'src/app/api/chat/route.ts',
  'src/lib/i18n/visitor-locale.ts',
  'src/lib/letters/scheduler.ts',
  'src/lib/letters/recovery.ts',
  'src/app/api/letters/unsubscribe/route.ts',
  'src/lib/visitor.ts',
  'src/lib/memory/recall-snapshot-db.ts',
  'src/lib/memory/relationship-snapshot.ts',
  'src/lib/memory/local-gateway.ts',
  'src/lib/memory/time-zone-resolver.ts',
  'src/lib/persona-enhancement-limit.ts',
];

export const NODE_ALLOWLIST: readonly NodeEntry[] = [
  {
    pattern: /^src\/lib\/i18n\/locale\.ts$/,
    reason:
      '纯层唯一允许的中文：语言**自称**字面量。语言名必须用它自己的文字写（localeSelfName / localeBadge 的 ' +
      '中文 → 中文），这正是给中文用户看的那一个词；其余任何中文字面量都不放行。',
    allows: (node) => node.text === '中文',
  },
  {
    pattern: new RegExp(`^(${INTERNAL_LOG_FILES.map(escapeRegExp).join('|')})$`),
    reason:
      '内部日志：这些是服务端模块里的 throw new *Error(...) / console.*(...) 文案，' +
      '按契约 §6.1 保持中文不翻（只进日志，不上屏）。谓词只放行**位置**在实参内的节点，不放行整个文件：' +
      '往这些文件里加一句会返回给客户端的 `error:` 中文，必须变红。',
    allows: (node) => node.internalLog,
  },
];

/** 重新导出快照，便于测试与后续任务只 import 一个模块。 */
export { FROZEN_ZH_LITERALS };

/** 冻结快照里是否有这个文件（便于排查「这个文件为什么没被拦」）。 */
export function isFrozenFile(file: string): boolean {
  return Object.prototype.hasOwnProperty.call(FROZEN_ZH_LITERALS, file);
}

/** 命中快照的某条字面量？（归一化空白后逐字符比较） */
export function isFrozenLiteral(file: string, text: string): boolean {
  const frozen = FROZEN_ZH_LITERALS[file];
  return Array.isArray(frozen) && frozen.includes(text);
}

/** 判定一个中文节点是否被白名单放行；返回放行理由（未放行 → `null`）。 */
export function allowReason(node: CjkNode): string | null {
  const whole = WHOLE_FILE_ALLOWLIST.find((entry) => entry.pattern.test(node.file));
  if (whole) return `①整文件豁免：${whole.reason}`;
  const conditional = NODE_ALLOWLIST.find((entry) => entry.pattern.test(node.file));
  if (conditional?.allows(node)) return `②内容条件豁免：${conditional.reason}`;
  if (isFrozenLiteral(node.file, node.text)) return '③快照冻结：门禁落地时已存在的合法中文';
  return null;
}
