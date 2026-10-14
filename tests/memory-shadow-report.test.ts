import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareBranches,
  renderShadowReport,
  summarizeBranchComparisons,
  type BranchSample,
} from '../src/lib/memory/shadow-report';

/**
 * 库内两路（pgvector 向量腿 ↔ pgroonga 关键词腿）的影子对账。
 *
 * 为什么需要它：创始人已停付 Mem0，「互相兜底」不再有外部第二条腿。
 * 于是「这两条腿到底谁兜住了谁」必须变成**可以拿出来复核的数字**，
 * 而不是靠读日志猜。这一层刻意做成纯函数：输入两路的 id 列表，输出对账与报告文本，
 * 不碰数据库、不碰网络 —— 真库数据由 scripts/memory-shadow-report.ts 灌进来。
 *
 * 变异检验：把 `onlyKeywordIds` 改成「两路都有的」（即丢掉差集语义），
 * 或把 `keywordContributionQueries` 恒置 0，对应用例立刻变红。
 */

const sample = (overrides: Partial<BranchSample> = {}): BranchSample => ({
  query: 'q',
  vectorIds: [],
  keywordIds: [],
  ...overrides,
});

test('the comparison separates shared hits from each leg’s exclusive hits', () => {
  const comparison = compareBranches(sample({
    query: '你还记得团子吗',
    vectorIds: ['a', 'b', 'c'],
    keywordIds: ['b', 'd'],
  }));

  assert.deepEqual(comparison.overlapIds, ['b']);
  assert.deepEqual(comparison.onlyVectorIds, ['a', 'c'], '向量腿独有 = 关键词腿漏掉的');
  assert.deepEqual(comparison.onlyKeywordIds, ['d'], '关键词腿独有 = 向量腿漏掉的，这正是兜底价值');
  assert.equal(comparison.empty, false);
});

test('duplicate ids inside one leg never double-count', () => {
  const comparison = compareBranches(sample({
    vectorIds: ['a', 'a', 'b'],
    keywordIds: ['b', 'b'],
  }));

  assert.deepEqual(comparison.overlapIds, ['b']);
  assert.deepEqual(comparison.onlyVectorIds, ['a']);
  assert.deepEqual(comparison.onlyKeywordIds, []);
  assert.equal(comparison.vectorCount, 2, '同一 id 在一个分支里出现两次只能算一条');
  assert.equal(comparison.keywordCount, 1);
});

test('a query that neither leg can answer is flagged as empty, not as zero overlap', () => {
  // 「两路都没命中」与「两路都命中但完全不重合」是完全不同的故障，
  // 混成一个 0 会让报告读不出该修哪一边。
  const nothing = compareBranches(sample({ vectorIds: [], keywordIds: [] }));
  assert.equal(nothing.empty, true);
  const disjoint = compareBranches(sample({ vectorIds: ['a'], keywordIds: ['b'] }));
  assert.equal(disjoint.empty, false);
});

test('the summary counts how often each leg was the only one that answered', () => {
  const comparisons = [
    compareBranches(sample({ query: 'q1', vectorIds: ['a'], keywordIds: ['a'] })),
    compareBranches(sample({ query: 'q2', vectorIds: ['b'], keywordIds: [] })),
    compareBranches(sample({ query: 'q3', vectorIds: [], keywordIds: ['c'] })),
    compareBranches(sample({ query: 'q4', vectorIds: [], keywordIds: [] })),
  ];
  const summary = summarizeBranchComparisons(comparisons);

  assert.equal(summary.queries, 4);
  assert.equal(summary.emptyQueries, 1);
  assert.equal(summary.vectorContributionQueries, 1, '只有 q2 是「关键词腿一条都没答上来」');
  assert.equal(summary.keywordContributionQueries, 1, '只有 q3 是「向量腿一条都没答上来」');
  // q1 两边给出同一批结果 ⇒ 谁都没有「独撑」，不该记进任何一侧。
  // 重合率按总量算：交集 1；并集 q1=1、q2=1、q3=1、q4=0 ⇒ 3 ⇒ 1/3。
  assert.equal(summary.mutualContributionQueries, 0, 'q1 不是「各有独有命中」');
  assert.equal(summary.overlapRatio, 1 / 3);
});

test('an all-empty run reports overlap 0 without dividing by zero', () => {
  const summary = summarizeBranchComparisons([compareBranches(sample({}))]);
  assert.equal(summary.overlapRatio, 0);
  assert.equal(summary.emptyQueries, 1);
});

test('the report is markdown a human can actually review', () => {
  const comparisons = [
    compareBranches(sample({ query: '团子术后恢复得如何', vectorIds: ['m1', 'm2'], keywordIds: ['m2'] })),
    compareBranches(sample({ query: '你还记得我那只猫叫什么名字吗', vectorIds: [], keywordIds: [] })),
  ];
  const report = renderShadowReport({
    comparisons,
    summary: summarizeBranchComparisons(comparisons),
    generatedAt: '2026-09-30T12:00:00.000Z',
  });

  assert.match(report, /^# /m, '要有标题');
  assert.match(report, /2026-09-30T12:00:00\.000Z/, '要写明生成时间（报告要可复核到某一次运行）');
  assert.match(report, /团子术后恢复得如何/, '逐条列出查询');
  assert.match(report, /\| *查询 *\|/, '要有明细表');
  assert.match(report, /两路都没命中/, '空命中的查询必须在报告里显式标出，不能被 0 掩盖');
});
