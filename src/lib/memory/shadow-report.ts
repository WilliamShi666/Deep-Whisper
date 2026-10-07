/**
 * 库内两路（pgvector 向量腿 ↔ pgroonga 关键词腿）的影子对账与报告。
 *
 * 为什么是纯函数：对账的**判断**（谁兜住了谁、哪条查询两路都没答上来）与**取数据**
 * （查真库、算 embedding）必须分开。分开之后，判断部分可以离线断言，
 * 真库部分只剩「把两串 id 灌进来」这一层 IO（见 scripts/memory-shadow-report.ts）。
 *
 * 为什么不再与 Mem0 对比：创始人已停付 Mem0，「外部第二条腿」这个前提已经不存在了。
 * 现在要回答的问题是「**这两条腿能不能互相兜住**」，所以对账对象是两路自己的差集。
 *
 * 变异检验（说清删掉实现后哪条测试会红）：
 * - 把 `onlyKeywordIds` 换成「两路都有的」→ `the comparison separates shared hits...` 红；
 * - 把 `keywordContributionQueries` 恒置 0 → `the summary counts how often each leg was the only one that answered` 红；
 * - 去掉去重 → `duplicate ids inside one leg never double-count` 红。
 */

export interface BranchSample {
  query: string;
  /** 向量腿单独跑出来的记忆 id（顺序即该腿的相关度顺序）。 */
  vectorIds: string[];
  /** 关键词腿单独跑出来的记忆 id。 */
  keywordIds: string[];
}

export interface BranchComparison {
  query: string;
  vectorCount: number;
  keywordCount: number;
  /** 两路都召回：稳妥命中。 */
  overlapIds: string[];
  /** 只有向量腿召回 —— 关键词腿漏掉的（字面不重合的语义相近记忆）。 */
  onlyVectorIds: string[];
  /** 只有关键词腿召回 —— 向量腿漏掉的（人名/药名/日期的字面命中）。**兜底价值就在这里。** */
  onlyKeywordIds: string[];
  /**
   * 两路都没命中。
   *
   * 与「两路都有但零重合」必须分开：前者是「这条查询我们完全没有记忆」，
   * 后者是「两路各说各话」，要修的地方完全不同。混成一个 0 会让报告读不出该修哪边。
   */
  empty: boolean;
}

export interface ShadowSummary {
  queries: number;
  emptyQueries: number;
  /** 有多少条查询是「关键词腿一条都没答上来」——向量腿在独撑。 */
  vectorContributionQueries: number;
  /** 有多少条查询是「向量腿一条都没答上来」——关键词腿在独撑。 */
  keywordContributionQueries: number;
  /** 两路都有独有命中的查询数：真正的「互相兜底」。 */
  mutualContributionQueries: number;
  /** 所有查询合计的重合率 |∩| / |∪|；并集总量为 0 时为 0（不做除零）。 */
  overlapRatio: number;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function compareBranches(sample: BranchSample): BranchComparison {
  const vectorIds = unique(sample.vectorIds);
  const keywordIds = unique(sample.keywordIds);
  const keywordSet = new Set(keywordIds);
  const vectorSet = new Set(vectorIds);

  const overlapIds = vectorIds.filter((id) => keywordSet.has(id));
  const onlyVectorIds = vectorIds.filter((id) => !keywordSet.has(id));
  const onlyKeywordIds = keywordIds.filter((id) => !vectorSet.has(id));

  return {
    query: sample.query,
    vectorCount: vectorIds.length,
    keywordCount: keywordIds.length,
    overlapIds,
    onlyVectorIds,
    onlyKeywordIds,
    empty: overlapIds.length === 0 && onlyVectorIds.length === 0 && onlyKeywordIds.length === 0,
  };
}

export function summarizeBranchComparisons(comparisons: readonly BranchComparison[]): ShadowSummary {
  let overlapTotal = 0;
  let unionTotal = 0;
  let emptyQueries = 0;
  let vectorContributionQueries = 0;
  let keywordContributionQueries = 0;
  let mutualContributionQueries = 0;

  for (const comparison of comparisons) {
    const overlap = comparison.overlapIds.length;
    const onlyVector = comparison.onlyVectorIds.length;
    const onlyKeyword = comparison.onlyKeywordIds.length;
    overlapTotal += overlap;
    unionTotal += overlap + onlyVector + onlyKeyword;
    if (comparison.empty) emptyQueries += 1;
    // 「某条腿独撑」= **另一条腿一条都没给出**。
    // 注意不能写成「另一条腿没有独有命中」：两路给出同一批结果时对方明明答上来了，
    // 只是没有增量，那种情况不算独撑（第一版就写错成后者，被用例抓出来）。
    const vectorAnswered = overlap + onlyVector > 0;
    const keywordAnswered = overlap + onlyKeyword > 0;
    if (vectorAnswered && !keywordAnswered) vectorContributionQueries += 1;
    if (keywordAnswered && !vectorAnswered) keywordContributionQueries += 1;
    if (onlyVector > 0 && onlyKeyword > 0) mutualContributionQueries += 1;
  }

  return {
    queries: comparisons.length,
    emptyQueries,
    vectorContributionQueries,
    keywordContributionQueries,
    mutualContributionQueries,
    overlapRatio: unionTotal === 0 ? 0 : overlapTotal / unionTotal,
  };
}

function ids(ids: readonly string[]): string {
  return ids.length === 0 ? '—' : ids.map((id) => `\`${id.slice(0, 8)}\``).join(' ');
}

/**
 * 渲染可复核报告。
 *
 * 「可复核」的三个最低要求：写明**生成时间**（这份报告对应哪一次运行）、
 * 写明**每一条查询**的两路结果（不是只给一个总数）、
 * 并把**两路都没命中**的查询单独列出来（那是检索覆盖的真空，不是「重合率为 0」）。
 */
export function renderShadowReport(input: {
  comparisons: readonly BranchComparison[];
  summary: ShadowSummary;
  generatedAt: string;
  /** 可选上下文，例如查询来源与嵌入模型。 */
  notes?: readonly string[];
}): string {
  const { comparisons, summary, generatedAt } = input;
  const lines: string[] = [];

  lines.push('# 长期记忆 · 库内两路影子对账报告');
  lines.push('');
  lines.push(`生成时间：\`${generatedAt}\``);
  lines.push('');
  lines.push('对账对象：**pgvector 向量腿** ↔ **pgroonga 关键词腿**（不再与 Mem0 对比 —— 创始人已停付）。');
  lines.push('');
  if (input.notes?.length) {
    for (const note of input.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push('## 汇总');
  lines.push('');
  lines.push('| 指标 | 值 | 说明 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| 查询条数 | ${summary.queries} | — |`);
  lines.push(`| 重合率 \\|∩\\|/\\|∪\\| | ${summary.overlapRatio.toFixed(3)} | 1.000 = 两路完全一致 |`);
  lines.push(`| 向量腿独撑（关键词腿零贡献） | ${summary.vectorContributionQueries} | 关键词腿一条都没给出（含完全没命中） |`);
  lines.push(`| 关键词腿独撑（向量腿零贡献） | ${summary.keywordContributionQueries} | 向量腿一条都没给出 |`);
  lines.push(`| 两路各有独有命中 | ${summary.mutualContributionQueries} | 真正的「互相兜底」 |`);
  lines.push(`| 两路都没命中 | ${summary.emptyQueries} | 检索真空，需单独看 |`);
  lines.push('');

  const vacuum = comparisons.filter((comparison) => comparison.empty);
  if (vacuum.length > 0) {
    lines.push('## 两路都没命中的查询');
    lines.push('');
    for (const comparison of vacuum) lines.push(`- ${comparison.query}`);
    lines.push('');
  }

  lines.push('## 逐条明细');
  lines.push('');
  lines.push('| 查询 | 向量腿 | 关键词腿 | 重合 | 仅向量 | 仅关键词 |');
  lines.push('| --- | ---: | ---: | ---: | --- | --- |');
  for (const comparison of comparisons) {
    lines.push(
      `| ${comparison.query} | ${comparison.vectorCount} | ${comparison.keywordCount} `
      + `| ${comparison.overlapIds.length} | ${ids(comparison.onlyVectorIds)} | ${ids(comparison.onlyKeywordIds)} |`,
    );
  }
  lines.push('');

  lines.push('## 怎么读这份报告');
  lines.push('');
  lines.push('- 关键词腿已改为「相邻 2 字滑窗 OR」（整句交给 `&@` 会恒不命中，见 `extractKeywordTerms`），');
  lines.push('  所以 `关键词腿` 列恒为 0 才是需要查的异常，而不是常态。');
  lines.push('- `重合率` 高且 `两路各独有命中` 为 0 时，**先看上面的 ⚠️ 提示**：');
  lines.push('  向量腿没有相似度下限，记忆条数少于召回上限时它会返回全部记忆，');
  lines.push('  于是关键词腿的命中必然是它的子集 —— 那种数据规模下量不出差集，也不该据此下结论。');
  lines.push('- `两路都没命中` 的查询要逐条看：那是记忆覆盖的真空，不是排序问题。');
  lines.push('');

  return lines.join('\n');
}
