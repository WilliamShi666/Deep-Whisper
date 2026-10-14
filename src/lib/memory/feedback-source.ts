/**
 * 归一化：去掉空白、标点与符号，只留字母/数字/汉字，英文转小写。
 *
 * 目的是让"逐字保留用户原话"的比对不受引号、省略号、破折号等排版差异影响。
 */
export function normalizeFeedbackSource(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

export interface FeedbackSourceCheck {
  kept: string[];
  dropped: Array<{ text: string; reason: 'assistant-echo' | 'unverifiable' }>;
}

/**
 * 反馈来源校验（2026-09-27，实测事故后的确定性护栏）。
 *
 * 事故复盘：整理器把**角色自己的台词**当成"用户提出的相处方式要求"输出，落进了
 * visitor 级的 communication_prefs.explicit_feedback。这条通道每个伴侣、每次对话都会
 * 读进去并渲染成「TA 提出的相处方式要求（必须遵守）」，于是一次误写就让**之后新建的
 * 伴侣**开口就"记得"一件它没经历过的事（澜汐编的"小蓝珠子"泄漏给新建的星寻）。
 *
 * 判据是确定性的、不依赖模型自觉：候选条目必须在**用户自己说过的话**里找到
 * （归一化后为子串）。找不到就不写——宁可少记一条偏好，也不让角色的台词变成用户的要求。
 *
 * 刻意**不**放进 recordCommunicationFeedback：界面上手动追加偏好（/api/profile）走的是
 * 同一个写入函数，那条路径上用户手写的内容本来就不在任何聊天记录里，放进去会被误删。
 */
export function filterFeedbackBySource(
  feedback: string[] | null | undefined,
  sources: { userTexts?: string[] | null; assistantText?: string | null },
): FeedbackSourceCheck {
  const userCorpus = (sources.userTexts ?? [])
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .map(normalizeFeedbackSource)
    .join('\u0000');
  const assistantCorpus =
    typeof sources.assistantText === 'string' && sources.assistantText.trim().length > 0
      ? normalizeFeedbackSource(sources.assistantText)
      : '';

  const kept: string[] = [];
  const dropped: FeedbackSourceCheck['dropped'] = [];

  for (const raw of feedback ?? []) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text) continue;
    const normalized = normalizeFeedbackSource(text);
    if (normalized && userCorpus.includes(normalized)) {
      kept.push(text);
      continue;
    }
    dropped.push({
      text,
      reason: normalized && assistantCorpus.includes(normalized) ? 'assistant-echo' : 'unverifiable',
    });
  }

  return { kept, dropped };
}
