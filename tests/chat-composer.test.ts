import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPOSER_BORDER_PX,
  COMPOSER_FONT_SIZE_PX,
  COMPOSER_LINE_COUNT_MAX,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_LINE_HEIGHT_RATIO,
  COMPOSER_MAX_VIEWPORT_RATIO,
  COMPOSER_MIN_HEIGHT_PX,
  composerMaxHeight,
  resolveComposerHeight,
  shouldSendOnEnter,
} from '../src/lib/chat-composer';

/**
 * 公式层：聊天输入框高度与键盘判定的纯函数。
 *
 * 覆盖规格 `docs/specs/2026-09-27-chat-ux-sidebar-and-composer.md` §5.2 的 7 条，并额外钉住
 * 「结果四舍五入到最近 0.5px」这条防亚像素抖动的要求（§5.1 的 resolveComposerHeight 契约）。
 *
 * 零 mock、零 DOM：DOM 只提供 scrollHeight 与 window.innerHeight 两个观测量，
 * 所有算术都必须能在 node 里判定。
 */

/** 五个原始信号的最小合法输入（keyCode 13 = Enter，非组词）。 */
const PLAIN_ENTER = {
  key: 'Enter',
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
  composing: false,
} as const;

test('the viewport cap follows min of ten lines and forty-five percent', () => {
  // 操作数 A：10 行 × 22.5px = 225px。断言用两个导出常量相乘，任何人改行数上限或行高都会立刻红。
  assert.equal(composerMaxHeight(1600), COMPOSER_LINE_COUNT_MAX * COMPOSER_LINE_HEIGHT);
  // 1600px 高的视口里 45vh = 720px，绝不能接管（否则「10 行」形同虚设）
  assert.notEqual(composerMaxHeight(1600), COMPOSER_MAX_VIEWPORT_RATIO * 1600);

  // 操作数 B：0.45 × 视口高。400px 高的视口：180px < 225px，由比例项接管。
  assert.equal(composerMaxHeight(400), COMPOSER_MAX_VIEWPORT_RATIO * 400);
  assert.ok(composerMaxHeight(400) < COMPOSER_LINE_COUNT_MAX * COMPOSER_LINE_HEIGHT);

  // 45vh 恰好等于 10 行时取等（0.45 × 500 === 225，两边都不独占）
  assert.equal(composerMaxHeight(500), COMPOSER_LINE_COUNT_MAX * COMPOSER_LINE_HEIGHT);
  // 两个 e2e 视口：桌面 720px 与 Pixel 7 的 839px，都是行数上限更小
  assert.equal(composerMaxHeight(720), COMPOSER_LINE_COUNT_MAX * COMPOSER_LINE_HEIGHT);
  assert.equal(composerMaxHeight(839), COMPOSER_LINE_COUNT_MAX * COMPOSER_LINE_HEIGHT);
  // 视口不可用（无法读 window.innerHeight）时退回行数上限，绝不返回 NaN
  assert.equal(composerMaxHeight(Number.NaN), COMPOSER_LINE_COUNT_MAX * COMPOSER_LINE_HEIGHT);
});

test('line height constant stays consistent with its two inputs', () => {
  // 22.5px = text-[15px] × Tailwind preflight 的 html{line-height:1.5}。
  // 字号或行高比例漂移时立刻可见——`chat-composer.ts` 是上限的单一事实来源，不能靠人记。
  assert.equal(COMPOSER_LINE_HEIGHT, COMPOSER_FONT_SIZE_PX * COMPOSER_LINE_HEIGHT_RATIO);
  assert.equal(COMPOSER_LINE_HEIGHT, 22.5);
  // 上限常量本身也要与 textarea 的 min-h-10 对得上
  assert.equal(COMPOSER_MIN_HEIGHT_PX, 40);
  assert.equal(COMPOSER_BORDER_PX, 2);
});

test('height is clamped at both ends', () => {
  // 底限：一行的自然内容高 24.5 + border 2 = 26.5 < min-h-10(40) → 先被最小高度抬起来
  const single = resolveComposerHeight({ scrollHeight: 24.5, maxHeightPx: 225 });
  assert.equal(single.height, 40);
  assert.equal(single.height, COMPOSER_MIN_HEIGHT_PX);
  assert.equal(single.capped, false);
  assert.equal(single.minHeightPx, COMPOSER_MIN_HEIGHT_PX);

  // 线性区：4 行内容 = 24.5 + 22.5 × 3 = 92 → 92 + 2 = 94 < 225
  const fourLines = resolveComposerHeight({ scrollHeight: 92, maxHeightPx: 225 });
  assert.equal(fourLines.height, 94);
  assert.equal(fourLines.capped, false);

  // 上限：内容远超上限 → 恰好落在上限并标记 capped（消费方据此出现内部滚动）
  const overflow = resolveComposerHeight({ scrollHeight: 9999, maxHeightPx: 225 });
  assert.equal(overflow.height, 225);
  assert.equal(overflow.capped, true);

  // 退化的上限（0 / 负数）不得把高度算成 0 或负数：最小高度优先，但仍标记 capped。
  // 两种内容高都断言：小内容时「raw 未超过上限」也不得让 capped 变 false——
  // 上限本身已被最小高度接管，这正是 capped 要报告的状态。
  for (const scrollHeight of [500, 24.5]) {
    const degenerate = resolveComposerHeight({ scrollHeight, maxHeightPx: 0 });
    assert.equal(degenerate.height, COMPOSER_MIN_HEIGHT_PX, `maxHeightPx=0 时高度必须是 minHeight（scrollHeight=${scrollHeight}）`);
    assert.equal(degenerate.capped, true, `maxHeightPx=0 必须标记 capped（scrollHeight=${scrollHeight}）`);
  }
});

test('border box arithmetic is scrollHeight plus borders', () => {
  // 线性区（min 与 max 都没夹住）：scrollHeight 已含 padding，故 border-box 高只多两条 border
  const linear = resolveComposerHeight({ scrollHeight: 92, maxHeightPx: 225 });
  assert.equal(linear.height - 92, COMPOSER_BORDER_PX);

  // 封顶：高度等于上限本身，且 capped 为真
  const capped = resolveComposerHeight({ scrollHeight: 9999, maxHeightPx: 225 });
  assert.equal(capped.height, 225);
  assert.equal(capped.capped, true);

  // 上限由纯函数算出：接线层拿到的 maxHeightPx 就等于 composerMaxHeight 的结果
  const maxHeightPx = composerMaxHeight(1600);
  const atCap = resolveComposerHeight({ scrollHeight: maxHeightPx * 4, maxHeightPx });
  assert.equal(atCap.height, maxHeightPx);
});

test('non finite input never produces a NaN height', () => {
  const cases: Array<{ scrollHeight: number; expected: number }> = [
    { scrollHeight: Number.NaN, expected: COMPOSER_MIN_HEIGHT_PX },
    { scrollHeight: -1, expected: COMPOSER_MIN_HEIGHT_PX },
  ];
  for (const { scrollHeight, expected } of cases) {
    const resolved = resolveComposerHeight({ scrollHeight, maxHeightPx: 225 });
    assert.ok(Number.isFinite(resolved.height), `高度必须是有限数（scrollHeight=${scrollHeight}）`);
    assert.equal(resolved.height, expected);
    assert.equal(resolved.capped, false);
  }

  const infinite = resolveComposerHeight({ scrollHeight: Number.POSITIVE_INFINITY, maxHeightPx: 225 });
  assert.ok(Number.isFinite(infinite.height));
  assert.equal(infinite.height, 225);
  assert.equal(infinite.capped, true);
});

test('the real one-line resting height is the natural box, not the CSS floor', () => {
  // 实测（Chrome，与 message-input 等价的类名 min-h-10 px-4 py-2.5 text-[15px] border）：
  // 一行内容的 scrollHeight = 43px（22.5 行高 + 上下 padding 20px），加 2px border → 45px。
  // 它高于 min-h-10(40px)：一行内容加 padding 本身就超过 40px，所以 min-h-10 只是「首帧 JS
  // 未跑」的底限，而不是一行的静止高度（42.5 的 scrollHeight 被浏览器向上取整成 43）。
  const resting = resolveComposerHeight({ scrollHeight: 43, maxHeightPx: 225 });
  assert.equal(resting.height, 45);
  assert.equal(resting.capped, false);
  // 底限确实存在：内容真的比一行还矮（≤ 38px 的 scrollHeight）时才被 min-h-10 抬起来
  assert.equal(resolveComposerHeight({ scrollHeight: 36, maxHeightPx: 225 }).height, 40);
});

test('height is rounded to the nearest half pixel to stop sub-pixel churn', () => {
  // 94.3 → 最近的 0.5px 是 94.5；写 style 前必须归一，否则亚像素抖动会反复触发 effect
  assert.equal(resolveComposerHeight({ scrollHeight: 92.3, maxHeightPx: 225 }).height, 94.5);
  // 93.7 + 2 = 95.7 → 最近的 0.5px 是 95.5
  assert.equal(resolveComposerHeight({ scrollHeight: 93.7, maxHeightPx: 225 }).height, 95.5);
  // 整数结果保持整数（不能被归一成 94.5 这类值）
  assert.equal(resolveComposerHeight({ scrollHeight: 92, maxHeightPx: 225 }).height, 94);
});

test('composition Enter never sends', () => {
  // 三条真实世界的等价信号，任一成立即不得发送
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, isComposing: true }), false, 'nativeEvent.isComposing');
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, keyCode: 229 }), false, 'keyCode 229（旧 WebKit）');
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, composing: true }), false, 'compositionstart…end 的 ref 兜底');
  // 既有的 Shift+Enter 换行与非 Enter 键行为不变
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, shiftKey: true }), false);
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, key: 'Escape' }), false);
});

test('plain Enter sends after composition ends', () => {
  assert.equal(shouldSendOnEnter(PLAIN_ENTER), true);
  // 逐个把信号打开：任何一条变真都必须立刻退回不发送
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, key: 'a' }), false);
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, keyCode: 229 }), false);
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, composing: true }), false);
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, isComposing: true }), false);
  assert.equal(shouldSendOnEnter({ ...PLAIN_ENTER, shiftKey: true }), false);
});
