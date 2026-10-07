/**
 * 召回查询串的**单一来源**。
 *
 * 为什么要单独成文件（spec 评审 C2）：影子对比脚本原先取的是**原始用户消息**当查询，
 * 而 `/api/chat` 实际下发的是下面这些**长指令句** —— 于是那份报告测的不是线上路径，
 * 「关键词腿能不能命中」的结论也就不成立。把拼装收成一处之后，度量工具与 route
 * 按构造共用同一形态，不可能再各自漂移。
 *
 * 改动这里等于改动线上召回语义：两句指令句里的关键词就是关键词腿的检索词条。
 */

/** 主查询里「用户只发了图」时的占位。 */
export const RECALL_IMAGE_SUBJECT = '用户刚发送了一张图片';
/**
 * 补充查询里的占位。
 *
 * ⚠️ 与 `RECALL_IMAGE_SUBJECT` 措辞**故意不同**（这里是「发送了一张图片」，
 * 上面是「刚发送了一张图片」）—— 这是既有线上文案，提取时原样保留。
 * 要统一请当成一次有意的行为变更来做，而不是顺手抹平。
 */
export const RECALL_SUPPLEMENTAL_IMAGE_SUBJECT = '用户发送了一张图片';

/** 开场白那一轮的主查询：没有「当前消息」，召回的是适合自然续聊的东西。 */
const OPENING_RECALL_QUERY =
  '为恋人开启一次新的聊天：召回适合此刻自然续聊的长期信息，尤其是近期计划、未完成事项、情绪与支持需求、关系变化、承诺、稳定偏好和有意义的关键细节';

/** 主查询（每轮一次）。 */
export function buildRecallQuery(input: { opening: boolean; content?: string | null }): string {
  if (input.opening) return OPENING_RECALL_QUERY;
  return `围绕当前消息召回所有有助于理解和回应的长期信息，包括长期印象、共同经历、稳定偏好、支持方式与关键细节。当前消息：${input.content || RECALL_IMAGE_SUBJECT}`;
}

/** 补充查询（与主查询一起构成一轮的扇出次数，见 `recallQueries`）。 */
export function buildSupplementalRecallQueries(input: {
  opening: boolean;
  content?: string | null;
}): string[] {
  if (input.opening) {
    return [
      '需要主动回访的近期计划、约定、待办，以及刚刚结束后值得询问结果的重要事件',
      '用户最需要的情绪支持方式，以及恋人关系中值得自然延续的共同经历和关键细节',
    ];
  }
  const subject = input.content || RECALL_SUPPLEMENTAL_IMAGE_SUBJECT;
  return [
    `与当前消息有关的用户稳定偏好、长期印象、沟通方式和支持需求：${subject}`,
    `与当前消息有关的共同经历、承诺、近期事件、未完成事项和关键细节：${subject}`,
  ];
}
