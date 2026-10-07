/**
 * 聊天输入框高度与键盘判定的**唯一算术入口**。
 *
 * DOM 只提供两个观测量：`element.scrollHeight` 与 `window.innerHeight`。其余（上限公式、
 * 底限、border-box 换算、四舍五入、IME 判定）全部落在这里的纯函数里，便于在 node 里判定，
 * 也让 `message-input.tsx` 只剩测量与写 style。
 *
 * 上限的单一事实来源（规格 §5.1.1）：CSS 侧**不得**再出现 `max-h-*` / `45vh` 之类的第二上限，
 * 否则会有一个比这里更小的值静默接管（表现为「写了 10 行、4 行就滚」）。
 */

/** 来自 textarea 的 text-[15px] */
export const COMPOSER_FONT_SIZE_PX = 15;
/** 来自 Tailwind preflight 的 html{line-height:1.5} */
export const COMPOSER_LINE_HEIGHT_RATIO = 1.5;
/** = 15 × 1.5；上限公式的操作数 A 的单位 */
export const COMPOSER_LINE_HEIGHT = 22.5;
/** 上限的操作数 A：最多 10 行 → 225px */
export const COMPOSER_LINE_COUNT_MAX = 10;
/** 上限的操作数 B：最多 45% 视口高 */
export const COMPOSER_MAX_VIEWPORT_RATIO = 0.45;
/** 上下 border 各 1px；scrollHeight 含 padding 不含 border */
export const COMPOSER_BORDER_PX = 2;
/** = Tailwind min-h-10，首帧 JS 未跑时的兜底 */
export const COMPOSER_MIN_HEIGHT_PX = 40;

/**
 * 上限 = min(10 行, 45vh) 的像素值。
 *
 * @param viewportHeight 视口高（`window.innerHeight`）；非有限数（视口不可用）时返回行数上限。
 * @param lineHeight 行高；默认取常量，接线层在实测漂移时传入实测值。
 * @param maxLines 行数上限；默认 10。
 * @param maxRatio 视口比例上限；默认 0.45。
 */
export function composerMaxHeight(
  viewportHeight: number,
  lineHeight: number = COMPOSER_LINE_HEIGHT,
  maxLines: number = COMPOSER_LINE_COUNT_MAX,
  maxRatio: number = COMPOSER_MAX_VIEWPORT_RATIO,
): number {
  const lineCap = lineHeight * maxLines;
  // 视口高度不可用时退回行数上限，绝不把 NaN 往上传
  if (!Number.isFinite(viewportHeight)) return lineCap;
  return Math.min(lineCap, maxRatio * viewportHeight);
}

/**
 * 由 DOM 量到的 scrollHeight 算出应写入的 border-box 高度。入参/出参单位一律为 px（含小数）。
 *
 * - height = min(max(scrollHeight + COMPOSER_BORDER_PX, COMPOSER_MIN_HEIGHT_PX), maxHeightPx)
 * - capped=true 表示已到上限、应出现内部滚动
 * - scrollHeight 为 NaN 或负数时按 minHeight 处理（防御，绝不写入 NaN 高度）；
 *   `+Infinity` 是「内容无限长」的合法极端值，交给上限夹住（规格 §5.2 的判定面）
 * - 结果四舍五入到最近的 0.5px，避免亚像素抖动导致反复写 style
 * - maxHeightPx 退化（0 / 非有限）时底限优先：宁可停在 minHeight，也不写 0 或负数高度
 */
export function resolveComposerHeight(input: {
  scrollHeight: number;
  maxHeightPx: number;
}): { height: number; capped: boolean; minHeightPx: number } {
  const minHeightPx = COMPOSER_MIN_HEIGHT_PX;
  const { scrollHeight, maxHeightPx } = input;

  // scrollHeight 已含 padding，故 border-box 高只多两条 border。
  // NaN / 负数（坏测量）按底限处理；+Infinity 保留原值，最终由上限夹住。
  const raw = Number.isNaN(scrollHeight) || scrollHeight < 0
    ? minHeightPx
    : scrollHeight + COMPOSER_BORDER_PX;

  // 上限必须大于底限才有效；否则（0 / 负数 / NaN）由底限接管，避免算出 0 或 NaN 高度
  const cap = Number.isFinite(maxHeightPx) && maxHeightPx > minHeightPx ? maxHeightPx : minHeightPx;
  const height = Math.round(Math.min(Math.max(raw, minHeightPx), cap) * 2) / 2;

  // capped 的语义是「上限这条约束是否已经生效」：即使上限本身退化成底限，也要如实报告，
  // 让消费方能在 maxHeightPx=0 这类坏输入下仍然知道「已经到顶了」。
  const capped = !Number.isFinite(maxHeightPx) || raw > maxHeightPx;
  return { height, capped, minHeightPx };
}

/**
 * 行为⑤：只在**真的要发送**时返回 true。
 *
 * 组词期间按 Enter 不得发送，也不得 `preventDefault`（Enter 交给 IME 消费）。判定覆盖三条
 * 真实世界的等价信号，需要组件把五个原始值都传进来：
 *   1. `event.nativeEvent.isComposing`（标准）；
 *   2. `event.keyCode === 229`（部分 IME / 旧 WebKit）；
 *   3. `onCompositionStart`…`onCompositionEnd` 之间维护的 ref（React 在个别浏览器会把
 *      `isComposing` 重置为 false，需要这个兜底）。
 *
 * 明确禁止防抖 / 超时 /「组词结束后 X ms 内忽略 Enter」这类时间窗：无法判定，且会吃掉正常回车。
 */
export function shouldSendOnEnter(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  composing: boolean;
}): boolean {
  if (input.key !== 'Enter') return false;
  if (input.shiftKey) return false;
  if (input.isComposing || input.composing) return false;
  if (input.keyCode === 229) return false;
  return true;
}
