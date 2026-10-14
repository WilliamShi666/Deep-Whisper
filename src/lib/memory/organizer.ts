import { z } from 'zod';

import {
  MAX_EXPLICIT_FEEDBACK,
  MAX_FEEDBACK_LENGTH,
} from '@/lib/profile/communication-prefs';
import type { AiMessage } from '@/lib/ai/types';
import { getChatProvider } from '@/lib/ai/chat-provider';
import {
  MEMORY_TYPE_VALUES,
  type MemoryOrganizer,
  type MemoryOrganizerInput,
  type MemoryPlan,
  type RelationshipSnapshotUpdate,
} from './service';

const memoryLayerSchema = z.enum(['L2', 'L3']);
const memoryBucketSchema = z.enum([
  'long_term_impression',
  'relationship_event',
  'key_detail',
]);
const memoryDomainValueSchema = z.enum([
  'relationship',
  'identity',
  'preference',
  'emotion',
  'support',
  'communication',
  'routine',
  'goal',
  'event',
  'commitment',
  'other',
]);
const memoryDomainSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return value;
    return memoryDomainValueSchema.safeParse(value).success ? value : undefined;
  },
  memoryDomainValueSchema.nullable().optional(),
);
const memoryConfidenceSchema = z.enum(['explicit', 'inferred']);
const memoryTemporalStatusSchema = z.enum([
  'timeless',
  'upcoming',
  'ongoing',
  'resolved',
]);
const memoryTimePrecisionSchema = z.enum(['exact', 'day', 'approximate']);
const memoryTypeSchema = z.enum(MEMORY_TYPE_VALUES);

const operationSchema = z
  .object({
    action: z.enum(['ADD', 'UPDATE', 'DELETE', 'NONE']),
    memoryId: z.string().min(1).nullable().optional(),
    text: z.string().min(2).max(500).nullable().optional(),
    layer: memoryLayerSchema.nullable().optional(),
    bucket: memoryBucketSchema.nullable().optional(),
    domain: memoryDomainSchema.nullable().optional(),
    memoryType: memoryTypeSchema.nullable().optional(),
    importance: z.number().min(0).max(1).nullable().optional(),
    confidence: memoryConfidenceSchema.nullable().optional(),
    evidenceMemoryIds: z.array(z.string().min(1)).max(12).nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
    timePrecision: memoryTimePrecisionSchema.nullable().optional(),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
    temporalStatus: memoryTemporalStatusSchema.nullable().optional(),
    // A model may omit this explanatory field even when the
    // lifecycle operation itself is complete. A missing explanation must not
    // discard the entire memory plan and silently turn a valid ADD into no-op.
    reason: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .catch('模型未提供整理原因'),
  })
  .superRefine((operation, context) => {
    if (
      (operation.action === 'UPDATE' || operation.action === 'DELETE') &&
      !operation.memoryId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['memoryId'],
        message: `${operation.action} requires memoryId`,
      });
    }
    if (
      (operation.action === 'ADD' || operation.action === 'UPDATE') &&
      (!operation.text || !operation.layer || !operation.memoryType)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${operation.action} requires text, layer, and memoryType`,
      });
    }
    if (
      operation.layer &&
      operation.bucket &&
      ((operation.layer === 'L3' && operation.bucket !== 'key_detail') ||
        (operation.layer === 'L2' && operation.bucket === 'key_detail'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bucket'],
        message: `${operation.bucket} is not valid for ${operation.layer}`,
      });
    }
  });

/** T-19 / AC-12：可选的关系快照更新；relationship_stage 是 varchar(32)，上限取 32。 */
const relationshipSnapshotSchema = z.object({
  relationshipStage: z.string().min(1).max(32).nullable().optional(),
  emotionalTone: z.string().min(1).max(64).nullable().optional(),
  dynamicSummary: z.string().min(1).max(400).nullable().optional(),
  keyMilestones: z.array(z.string().min(1)).max(12).nullable().optional(),
});

/**
 * T-18 写入侧：整理器对「用户希望被怎样对待」的识别结果。
 *
 * 上界与 src/lib/profile/communication-prefs.ts 对齐（条数与单条长度），
 * 否则超出上界的条目会在落库时被静默截断或丢弃，而模型以为已经记住。
 * 这里刻意不对空串做硬校验：一份带格式噪声的计划不应该因此丢掉整批真正
 * 有价值的记忆操作（与 operation.reason 的 .catch 同一条容错原则）。
 */
const communicationPrefsFeedbackSchema = z
  .array(z.string().max(MAX_FEEDBACK_LENGTH))
  .max(MAX_EXPLICIT_FEEDBACK);

const memoryPlanSchema = z.object({
  operations: z.array(operationSchema).max(6),
  communicationPrefsFeedback: communicationPrefsFeedbackSchema.optional(),
  relationshipSnapshot: relationshipSnapshotSchema.optional(),
});

/**
 * T-19：剔除 undefined 字段后返回；整块没有任何有效字段时返回 undefined，
 * 而不是 null 或 {}，这样调用方可以按“字段缺失”处理普通闲聊。
 */
function normalizeRelationshipSnapshot(
  snapshot: z.infer<typeof relationshipSnapshotSchema> | undefined,
): RelationshipSnapshotUpdate | undefined {
  if (!snapshot) return undefined;
  const normalized: RelationshipSnapshotUpdate = {};
  if (snapshot.relationshipStage !== undefined) {
    normalized.relationshipStage = snapshot.relationshipStage;
  }
  if (snapshot.emotionalTone !== undefined) {
    normalized.emotionalTone = snapshot.emotionalTone;
  }
  if (snapshot.dynamicSummary !== undefined) {
    normalized.dynamicSummary = snapshot.dynamicSummary;
  }
  if (snapshot.keyMilestones !== undefined && snapshot.keyMilestones !== null) {
    normalized.keyMilestones = snapshot.keyMilestones;
  }
  const hasValue = Object.values(normalized).some((value) => value !== undefined);
  return hasValue ? normalized : undefined;
}

export function parseMemoryPlan(input: unknown): MemoryPlan {
  const parsed = memoryPlanSchema.parse(input);
  const relationshipSnapshot = normalizeRelationshipSnapshot(parsed.relationshipSnapshot);
  const plan: MemoryPlan = {
    operations: parsed.operations
      .filter((operation) => operation.action !== 'NONE')
      .map((operation) => ({
        action: operation.action as 'ADD' | 'UPDATE' | 'DELETE',
        memoryId: operation.memoryId ?? undefined,
        text: operation.text ?? undefined,
        layer: operation.layer ?? undefined,
        bucket: operation.bucket ?? undefined,
        domain: operation.domain ?? undefined,
        memoryType: operation.memoryType ?? undefined,
        importance: operation.importance ?? undefined,
        confidence: operation.confidence ?? undefined,
        evidenceMemoryIds: operation.evidenceMemoryIds ?? undefined,
        occurredAt: operation.occurredAt ?? null,
        timePrecision: operation.timePrecision ?? null,
        validUntil: operation.validUntil ?? null,
        temporalStatus: operation.temporalStatus ?? undefined,
        reason: operation.reason,
      })),
  };
  if (relationshipSnapshot) {
    plan.relationshipSnapshot = relationshipSnapshot;
  }
  // T-18：空串在落库侧会被去重逻辑丢掉，这里先行归一到「没有反馈」，
  // 让 service 的 `?.length` 判断与真实写入结果保持一致。
  const feedback = (parsed.communicationPrefsFeedback ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (feedback.length > 0) {
    plan.communicationPrefsFeedback = feedback;
  }
  return plan;
}

/**
 * T-11 / AC-07：把最近几轮前文渲染成带说话人标注的成对文本（旧→新）。
 * 未提供（undefined）或为空数组时返回空字符串，既有提示词因此逐字节不变。
 */
function buildRecentTurnsSection(input: MemoryOrganizerInput): string {
  const turns = input.recentTurns;
  if (!turns || turns.length === 0) return '';
  const rendered = turns
    .map((turn) => `用户：${turn.userText}\n角色：${turn.assistantText}`)
    .join('\n');
  return `\n【最近几轮前文（按时间顺序，旧→新）】\n${rendered}\n\n以上前文只用于解析指代与确认语境，不得据此新建事实；其中「角色」说过的话不是用户事实，绝不能当成用户的表述、偏好或想法。前文只用于读懂【新对话】，不能替代【新对话】里的本轮内容。\n`;
}

export function buildOrganizerPrompt(input: MemoryOrganizerInput): string {
  const existing = input.existingMemories.length
    ? input.existingMemories
        .map(
          (memory) =>
            `- id=${memory.id}; layer=${memory.layer}; bucket=${memory.bucket}; ` +
            `domain=${memory.domain}; type=${memory.memoryType}; importance=${memory.importance}; ` +
            `confidence=${memory.confidence}; evidence=${memory.evidenceMemoryIds.join(',') || 'none'}; ` +
            `temporalStatus=${memory.temporalStatus}; occurredAt=${memory.occurredAt ?? 'none'}; ` +
            `timePrecision=${memory.timePrecision ?? 'none'}; ` +
            `validUntil=${memory.validUntil ?? 'none'}; text=${memory.text}`,
        )
        .join('\n')
    : '- none';

  return `你是 AI 陪伴产品的长期记忆整理器。当前时间：${input.nowIso}。

你的任务不是回复用户，而是把刚完成的一轮对话和已有记忆比较，输出最少且明确的记忆生命周期操作。

【已有的、仍有效的相关记忆】
${existing}

【新对话】
用户：${input.userText}
角色：${input.assistantText}
${buildRecentTurnsSection(input)}
【三类记忆】
- long_term_impression（L2）：可修订的长期印象，包括偏好总结、情绪模式、有效支持策略、沟通方式、持续目标、日常规律、个人印象和关系印象。
- relationship_event（L2）：重要共同经历，包括里程碑、和好、信任变化，以及真正影响双方关系的事件。
- key_detail（L3）：独特且以后能复用的具体细节，例如偏好称呼、明确食物偏好、礼物、事件原因或有期限的承诺。
- shared_quote（L3）：两人共同留下的一句话。只在用户明确希望被记住某句话、或双方在对话中共同约定留下时才写入，并且必须逐字保留用户原话，不得改写、缩写、润色或替用户总结。角色自己的措辞、角色的表态、角色先说的句子都不得写入该类型。
- L1 姓名、职业、生日、家庭等核心画像由 SQL 管理。不要创建 L1；必要时可标记为 L3 personal_fact。
- 同一轮同时出现“关系结果”和“造成结果的具体物品/原因”时必须拆成两条：关系结果写 L2，具体细节写 L3，不能只保留其中一层。
- 例如用户解释迟到是为了取一张唱片，角色接受道歉并和好：L2 记录“二人化解误会并和好”；L3 记录“迟到原因和唱片名称/来源”。

【操作规则】
1. 只有跨会话仍有价值的信息才记。路过看见某个普通物品、随口描述天气、无后续价值的一次性动作、寒暄、重复和角色自己的编造内容都属于低价值琐事，必须输出 NONE。
   但“只发生一次”不等于“不值得记”：面试/考试/求职结果待定、重要约会或出行、本人或家人的身体不适、近期截止日期等，虽然是短期事件，却具有明确的恋人回访价值，必须写成 L3 event / temporary_state / time_bounded_commitment，并设置合理 validUntil，过期后不再使用。
   - “刚面试完，结果还不知道”应记录“用户刚完成面试且结果待定”，让角色之后询问结果。
   - “吃外卖后拉肚子”应记录短期身体状态，便于下一次聊天先确认是否好转；不得由此推断长期体质。
   - “我有个 Agent 开发面试”应保留面试方向这个关键细节；时间不明确时不要编造具体日期。
2. 新事实用 ADD。用户明确修正旧事实时必须 UPDATE 对应 id，不得同时保留互相冲突的新旧值。
3. 三态分离，不要混用：三种都必须保留原记忆，不得因此 DELETE 用户说过的事（d 撤销边界时只删边界本身）。
   a) 「已经结束了 / 有结果了」：这只是事情结束，不是要忘掉——结束不等于遗忘。必须 UPDATE 对应 id，把 temporalStatus 设为 resolved，保留这条记忆。
      - 例：用户说“面试已经结束了，通过了”→ UPDATE 那条面试记忆，temporalStatus=resolved，保留记录，不得 DELETE。
      - 标为 resolved 之后，不得再追问此事的结果，也不得再把它当成待办。
   b) 「不需要提醒我 / 别提醒我了」：保留记录但立即失效。对该记忆做 UPDATE，把 validUntil 设为不晚于【当前时间】的时刻（例如直接写【当前时间】本身），使 validUntil 早于或等于当前时间，这条记忆立刻过期；不得 DELETE。这类记忆之后不得再被主动提起。
      - 例：用户说“这件事别提醒我了”→ UPDATE 该记忆的 validUntil 使其立即过期，保留记录，不得 DELETE。
   c) 「忘掉它 / 别提了 / 不要再提 / 删掉这条 / 不要再记」：像人一样，听到了就不会真的忘，但从此不再主动提起。
      原记忆保留不动；ADD 一条 memoryType=avoid_topic、layer=L2、bucket=long_term_impression、confidence=explicit 的边界，
      text 写成「用户不希望再被提起：<具体的事>」，temporalStatus=timeless，validUntil=null。
      - 例：用户说“去青岛这件事，你忘掉它吧”→ ADD「用户不希望再被提起：去青岛旅行的计划」，不得 DELETE 青岛那条记忆。
      - 已有同一件事的 avoid_topic 时不要重复 ADD。
   d) 撤销边界：用户明确说「可以聊 X 了 / 其实可以提」时，DELETE 对应的 avoid_topic 那一条（只能删 avoid_topic，不能删别的记忆）。
4. 时间型记忆必须把“事件发生时间”和“系统获知时间”区分开：
   - occurredAt 是事件实际发生或计划发生的绝对时间。把“今天、明天、下周二”等结合【当前时间】换算成带时区的 ISO 时间；时区以【当前时间】自带的时区偏移为准，只有当用户在对话里明确给出其它时区或地点时，才改用用户给出的时区。
   - timePrecision：知道具体时刻用 exact；只知道日期时把 occurredAt 写成该地当天 00:00 并用 day；只有大致时段用 approximate。不得编造具体时刻。
   - temporalStatus：无明确时间用 timeless；尚未发生用 upcoming；正在持续用 ongoing；已经得到结果或明确结束用 resolved。
   - validUntil 是这条事实最晚仍适合被使用的时间，不是事件开始时间。需要在事件后追问结果的计划，validUntil 必须晚于 occurredAt；无法可靠判断有效期时可为 null，不要猜造日期。
   - 用户取消、改期或完成计划时，必须 UPDATE 或 DELETE 原记忆，禁止新旧计划同时有效。
5. UPDATE/DELETE 只能使用上面已有记忆的 id。不要依据角色回复创造用户事实。
6. 每轮最多 6 个操作；没有值得记录的内容输出一个 NONE。
7. 记忆文本用第三人称、独立可读、保留关键 What/When；不要保留整段聊天原文。把陪伴角色称为“角色”或直接使用角色名字，绝不写“AI”。
8. 新说法永远优先于旧说法。
9. long_term_impression 不能由一条偶然细节臆测而来。只有满足以下任一条件才可 ADD/UPDATE：
   a) 至少两条彼此相关的 L3 记忆共同支持该稳定模式，并把这些 id 写入 evidenceMemoryIds；
   b) 用户在本轮直接、明确地把它表达为长期稳定的模式、偏好或有效策略，此时 confidence 必须为 explicit，并在 reason 中说明直接证据。
   判断 b 时只能依据“用户”原话，不能把“角色”的责备、建议、猜测或反应当成用户画像。一次迟到、一次忘记说明、一次争吵都只能形成事件或关键细节，绝不能据此生成“用户倾向于……”“用户习惯于……”等 communication_style / personal_impression。
10. importance 是 0~1，表示未来陪伴价值，不代表层级高低。L3 可以非常重要：偏好称呼、用户名、独特礼物、具体承诺和能制造“你居然还记得”体验的细节应给较高 importance。只有足够独特、以后可复用的 L3 才应达到 0.6；低于 0.6 的候选不要写入，直接 NONE。confidence 只能是 explicit（用户直接表达）或 inferred（从多条证据归纳）。
11. ADD/UPDATE 必须选择匹配的 bucket、domain、importance、confidence；evidenceMemoryIds 无证据时用空数组。bucket 与 layer 必须匹配：两个 L2 bucket 只能用 L2，key_detail 只能用 L3。
12. relationshipSnapshot 是可选字段，只有在真实关系变化时才允许输出 relationshipSnapshot（关系阶段变化、情绪基调变化、动态概要变化，或新增关键里程碑）；普通闲聊、日常问候、无关系含义的琐事必须完全不输出 relationshipSnapshot。
   - keyMilestones 只写新增的里程碑，不要重写全部历史。
   - 无法判断时不要输出 relationshipSnapshot。
13. communicationPrefsFeedback 是可选字段，只记录用户本轮**直接、明确**提出的相处方式要求或更正，例如「别每次都逗我」「有事直接说」「别用那种称呼」。逐条保留用户原话，不要替用户改写、缩写或总结，最多 3 条。
   - 只有用户自己说出口的才算；角色主动提出的建议、角色猜测的偏好、角色对用户的期待，都不是用户的相处方式要求。
   - 判断来源只看【新对话】里以「用户：」开头的那一行（以及【最近几轮前文】里同样以「用户：」开头的行）。以「角色：」开头的内容——包括角色的自我介绍、表态、觉察、自我检讨、道歉和承诺——一律不得作为来源，哪怕它读起来很像一条要求。
   - 用户只是在追问、询问或复述角色说过的话（例如"我什么时候跟你说过这个？"）时，不算用户提出了要求。
   - 每条都必须能在用户那一行里逐字找到；你自己概括、改写或拼接出来的句子，不要输出。
   - 普通闲聊、日常问候、单纯的情绪宣泄必须完全不输出 communicationPrefsFeedback。
   - 这是「用户希望被怎样对待」，不是对用户性格的推断：不得据此生成「用户倾向于……」「用户习惯于……」这类长期画像，那类内容必须走第 9 条的 evidenceMemoryIds 证据门槛。
   - 与 operations 相互独立：这一轮即使没有值得长期记住的事实，也可以只输出 communicationPrefsFeedback；反之亦然。

【唯一允许的输出格式】
只输出一个 JSON 对象，不要 Markdown 代码块、解释或额外文字：
{"operations":[{"action":"ADD|UPDATE|DELETE|NONE","memoryId":"已有id或null","text":"记忆文本或null","layer":"L2|L3或null","bucket":"long_term_impression|relationship_event|key_detail或null","domain":"relationship|identity|preference|emotion|support|communication|routine|goal|event|commitment|other或null","memoryType":"${MEMORY_TYPE_VALUES.join('|')}或null","importance":0到1或null,"confidence":"explicit|inferred或null","evidenceMemoryIds":["已有记忆id"],"occurredAt":"带时区的ISO时间或null","timePrecision":"exact|day|approximate或null","validUntil":"带时区的ISO时间或null","temporalStatus":"timeless|upcoming|ongoing|resolved或null","reason":"简短理由"}],"communicationPrefsFeedback":["用户原话"]（本轮没有相处方式要求时省略 communicationPrefsFeedback）,"relationshipSnapshot":{"relationshipStage":"新的关系阶段或null","emotionalTone":"新的情绪基调或null","dynamicSummary":"新的动态概要或null","keyMilestones":["仅新增的里程碑"]}（没有真实关系变化时省略 relationshipSnapshot）}`;
}

function parseOrganizerJson(content: string): MemoryPlan {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return parseMemoryPlan(JSON.parse(normalized) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Memory organizer returned malformed JSON');
    }
    throw error;
  }
}

export function createProviderMemoryOrganizer(): MemoryOrganizer {
  return {
    async organize(input) {
      const messages: AiMessage[] = [
        {
          role: 'system',
          content: '只执行记忆整理任务，并严格返回指定 JSON Schema。',
        },
        { role: 'user', content: buildOrganizerPrompt(input) },
      ];
      // 2026-09-27：整理器显式开启思考（强度 low）。
      // 它要判断"这句话是谁说的、算不算一条要求"这类源归属问题，比闲聊更吃细致推理；
      // 而它跑在回复之后的 after() 后台任务里，多花几秒不影响用户，成本也可接受。
      // 注意供应商侧默认 effort 是 high，这里必须显式压到 low。
      const completion = await getChatProvider().complete({
        messages,
        thinking: 'enabled',
        reasoningEffort: 'low',
        timeoutMs: 60_000,
        maxAttempts: 2,
      });
      return parseOrganizerJson(completion.content);
    },
  };
}

// Transitional export for existing scripts. Runtime provider selection is now
// handled by getChatProvider.
