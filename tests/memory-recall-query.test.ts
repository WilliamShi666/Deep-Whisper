import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecallQuery,
  buildSupplementalRecallQueries,
  RECALL_IMAGE_SUBJECT,
  RECALL_SUPPLEMENTAL_IMAGE_SUBJECT,
} from '../src/lib/memory/recall-query';
import { recallQueries } from '../src/lib/memory/service';

/**
 * 召回查询串的唯一来源。
 *
 * 提取理由（spec 评审 C2）：影子对账脚本原先拿**原始用户消息**当查询，
 * 而 `/api/chat` 下发的是这里的长指令句 —— 报告因此测的不是线上路径，
 * 「关键词腿能命中」的结论也就不成立。收成一处之后，route 与度量工具
 * 按构造共用同一形态。下面几条同时钉住「形态」与「谁在用同一个函数」。
 */
test('the deployed query wraps the user message in the instruction sentence', () => {
  const query = buildRecallQuery({ opening: false, content: '我下周三要去做胃镜' });

  assert.ok(query.includes('我下周三要去做胃镜'), '用户消息必须在里头');
  assert.ok(query.length > 60, '线上下发的是长指令句，不是原始消息本身');
  assert.match(query, /当前消息：/);
});

test('the image placeholder differs between the main and supplemental queries', () => {
  // 这是既有线上文案：两处措辞本就不同。原样保留 —— 要统一请当成一次有意的行为变更，
  // 而不是顺手抹平（抹平会同时改变关键词腿的检索词条）。
  const main = buildRecallQuery({ opening: false, content: '' });
  const supplemental = buildSupplementalRecallQueries({ opening: false, content: '' });

  assert.ok(main.includes(RECALL_IMAGE_SUBJECT));
  assert.ok(supplemental[0]!.includes(RECALL_SUPPLEMENTAL_IMAGE_SUBJECT));
  assert.notEqual(RECALL_IMAGE_SUBJECT, RECALL_SUPPLEMENTAL_IMAGE_SUBJECT);
});

test('the opening round asks for what continues a new chat, and needs no current message', () => {
  const query = buildRecallQuery({ opening: true, content: '' });
  const supplemental = buildSupplementalRecallQueries({ opening: true, content: '' });

  assert.ok(!query.includes('当前消息：'), '开场白没有「当前消息」');
  assert.equal(supplemental.length, 2);
  assert.ok(!supplemental.join('').includes('当前消息：'));
});

test('the fan-out the cost metric reports equals the number of queries actually sent', () => {
  // 成本数字之所以不可漂移，是因为它与实际下发的查询集合同源。
  const nonOpening = buildSupplementalRecallQueries({ opening: false, content: 'x' });
  assert.equal(1 + nonOpening.length, 3, '主查询 + 两条补充 = 3 次扇出');

  assert.equal(
    recallQueries({ query: buildRecallQuery({ opening: false, content: 'x' }), supplementalQueries: nonOpening }).length,
    3,
  );
});
