/**
 * 把「TA 希望被怎样对待」记成**伴侣专属**的长期记忆（2026-09-27，方案 B）。
 *
 * 为什么不再写 visitor 级的 `communication_prefs.explicit_feedback`：那条通道每个伴侣、
 * 每次对话都会读到并渲染成「TA 提出的要求（必须遵守）」，一次误写就会让**之后新建的伴侣**
 * 继承一段它没经历过的历史（实测：澜汐编的"小蓝珠子"就是这么泄漏给新建的星寻的）。
 * 改记进 mem0 之后，偏好只随这位伴侣走，并复用既有的召回、时效与遗忘链路。
 *
 * 有意接受的代价：偏好从"每轮无条件注入"变成"按相关性召回"，某轮没召回到就不会出现。
 *
 * 单独成文件（而不是放在 index.ts）是为了断开依赖环：
 * `exchange-persistence → index → exchange-persistence`（eslint import/no-cycle 会报错）。
 *
 * 失败只记日志、返回 false：记忆是加分项，不能让整理器的副作用拖垮对话。
 */
import { getMemoryDependencies } from './dependencies';

export async function rememberCommunicationPreference(input: {
  visitorId: string;
  companionId: string;
  conversationId: string;
  text: string;
  observedAt: string;
}): Promise<boolean> {
  const deps = getMemoryDependencies();
  if (!deps) return false;
  const text = input.text.trim();
  if (!text) return false;
  try {
    await deps.gateway.add(`TA 明确提出过相处方式上的要求：${text}（照此调整表达；TA 后来说的新说法优先）`, {
      userId: input.visitorId,
      appId: deps.appId,
      metadata: {
        visitor_id: input.visitorId,
        companion_id: input.companionId,
        layer: 'L2',
        bucket: 'long_term_impression',
        domain: 'communication',
        memory_type: 'communication_style',
        importance: 0.75,
        confidence: 'explicit',
        evidence_memory_ids: [],
        status: 'active',
        observed_at: input.observedAt,
        occurred_at: input.observedAt,
        time_precision: 'exact',
        valid_until: null,
        temporal_status: 'timeless',
        source_conversation_id: input.conversationId,
        source: 'communication_preference',
      },
    });
    return true;
  } catch (error) {
    console.error('[memory:preference]', error);
    return false;
  }
}
