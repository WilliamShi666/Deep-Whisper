import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * AI 正文去胶囊 + 明暗两套呈现（契约 t37 / 队内 t23 的第五轮加法）：接线层的源码契约。
 *
 * 判据来源：`docs/specs/2026-09-27-chat-layout-dots-and-voice-upsell.md`
 * §4.1.2（判据 1–7）与 §5.6.2 F4。
 * **本文件只断言 message-bubble 这一侧**：流式段的接线归 t38（规格 §4.1.3），
 * 在它落地之前这里不跨文件比较两个消费点的表达式。
 * 零 mock、零 DOM。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const MESSAGE_BUBBLE = 'src/components/chat/message-bubble.tsx';

/**
 * 助手分支的外层容器 class 是 `tests/feedback-ui-contract.test.ts` 的字面量锚点，
 * 一旦改动 `indexOf` 会返回 −1（报错还不指向真因）——所以这里把它当成起点，顺带把守。
 */
const ASSISTANT_ANCHOR = 'className="anim-fade-in-up flex items-start gap-2.5"';

/** 助手分支源码片段（从外层锚点到 `TypingIndicator` 定义之前）。 */
function assistantBranch(source: string): string {
  const start = source.indexOf(ASSISTANT_ANCHOR);
  assert.ok(start >= 0, '助手分支外层容器 class 必须逐字符保持不变（feedback-ui-contract 的字面量锚点）');
  const end = source.indexOf('export function TypingIndicator', start);
  assert.ok(end > start, '助手分支必须仍以 TypingIndicator 之后为界');
  return source.slice(start, end);
}

test('the ai text body goes through the shared presentation function', () => {
  const bubble = read(MESSAGE_BUBBLE);
  const branch = assistantBranch(bubble);

  // 明暗两套的唯一入场：一个函数调用（dark/light 分支都在 chat-layout.ts 里）
  assert.match(branch, /aiTextPresentation\(theme\.theirBubble, /, 'AI 正文必须走共享呈现函数');
  // 本文件不再自带分支零件：裸的底膜与阴影常量只允许存在于 chat-layout.ts
  assert.doesNotMatch(bubble, /AI_TEXT_SHADOW/, 'message-bubble 不得直接引用阴影常量（改由函数提供）');
  assert.doesNotMatch(bubble, /aiMembraneBackground\(/, 'message-bubble 不得直接算底膜（改由函数提供）');

  // 文本分支仍是「底膜 + 注入的文字色 + 阴影」的组合，且两分支（text/image）差别保持不变
  assert.match(branch, /message\.content_type === 'image'/, '文本与图片分支的区分必须仍在');
  assert.match(branch, /backgroundColor: theme\.theirBubble, color: theme\.theirText/, '图片分支仍是实心胶囊底');

  // 不得自带颜色字面量
  assert.doesNotMatch(bubble, /#[0-9a-fA-F]{3,8}/, 'message-bubble.tsx 内不得出现任何 hex');
  assert.doesNotMatch(branch, /in oklab/, '底膜必须是 sRGB alpha 合成');
});

test('the text body fills the column while the image keeps its capsule', () => {
  const lines = assistantBranch(read(MESSAGE_BUBBLE)).split('\n');

  // 胶囊几何（圆角 / 行内 padding / 78% 宽度上限）只允许出现在图片分支的行上
  const capsuleTokens = ['rounded-2xl', 'rounded-tl-md', 'px-4', 'py-2.5', 'max-w-[78%]'];
  for (const line of lines) {
    if (!capsuleTokens.some((token) => line.includes(token))) continue;
    assert.ok(
      line.includes("message.content_type === 'image'"),
      `胶囊类名只能挂在图片分支上：${line.trim()}`,
    );
  }

  // 图片分支仍保留完整胶囊（照片需要圆角与内边距）
  assert.ok(
    lines.some((line) => line.includes("message.content_type === 'image'")
      && line.includes('rounded-2xl')
      && line.includes('rounded-tl-md')
      && line.includes('p-1.5')),
    '图片分支必须仍是 rounded-2xl rounded-tl-md p-1.5 胶囊',
  );

  // 文本正文容器不再有 78% 上限，也没有胶囊的圆角与内边距
  const textBodyLine = lines.find((line) => line.includes('leading-relaxed') && !line.includes("message.content_type === 'image'"));
  assert.ok(textBodyLine, '文本正文容器必须仍在助手分支内');
  for (const token of ['max-w-[78%]', 'rounded-2xl', 'rounded-tl-md', 'px-4', 'py-2.5']) {
    assert.equal(textBodyLine.includes(token), false, `文本正文不得再有 ${token}：${textBodyLine.trim()}`);
  }
});

test('the tone mode and palette surface props are optional and appended last', () => {
  const bubble = read(MESSAGE_BUBBLE);

  // 两个新 prop 都必须是**可选**的（既有调用点不传时不报错、行为与今天一致）
  assert.match(bubble, /toneMode\?: ToneMode;/, 'toneMode 必须是可选 prop');
  assert.match(bubble, /paletteSurface\?: PalettePreference \| 'native';/, 'paletteSurface 必须是可选 prop');
  assert.match(bubble, /toneMode = 'dark'/, '缺省 toneMode 必须是 dark（= 今天的观感，零回归）');

  // 既有形参前缀逐字符保持（tests/character-palette.test.ts 钉住），新 prop 只能追加在末尾
  const signature = bubble.slice(bubble.indexOf('export function MessageBubble({'), bubble.indexOf('}: BubbleProps)'));
  assert.ok(
    signature.startsWith('export function MessageBubble({ message, theme, character,'),
    'MessageBubble 的既有形参前缀不得改动',
  );
  assert.ok(
    signature.indexOf('voiceLocked') < signature.indexOf('toneMode'),
    '新 prop 必须追加在既有 prop 之后',
  );

  // paletteSurface 必须透传给 VoiceBar（卡片跟随风格需要它；VoiceBar 侧的同源 prop 叫 palette，
  // 由 t36 定义 —— 名字以落地的代码为准，转换点只有 VoiceBar 里的那一次 paletteSurfaceFor）
  const voiceBarCall = bubble.slice(bubble.indexOf('<VoiceBar'), bubble.indexOf('/>', bubble.indexOf('<VoiceBar')));
  assert.match(voiceBarCall, /palette=\{paletteSurface\}/, 'paletteSurface 必须透传给 VoiceBar');
  assert.match(voiceBarCall, /locked=\{voiceLocked\}/, '既有的 locked 透传不得丢失');
});

test('the user bubble and the assistant outer container are untouched', () => {
  const bubble = read(MESSAGE_BUBBLE);

  // 用户气泡：既有 class 与 style 一字不改
  assert.match(bubble, /max-w-\[78%\] rounded-2xl rounded-tr-md px-4 py-2\.5/);
  assert.match(bubble, /style=\{\{ backgroundColor: theme\.myBubble, color: theme\.myText \}\}/);
  // 助手分支外层容器（feedback-ui-contract 的字面量锚点）保持原样
  assert.ok(bubble.includes(ASSISTANT_ANCHOR));
  // 时间戳语义底不动
  assert.equal(bubble.match(/data-testid="message-timestamp"/g)?.length, 2);
  assert.match(bubble, /bg-background\/90/);
});

test('this file only guards the message-bubble side of the presentation', () => {
  // 流式段的接线归 t38（规格 §4.1.3）：在它落地之前，本文件不得读另一个消费点的源码，
  // 否则「同一函数两处逐字符相同」这条断言会逼迫别人（或我）越界改另一个文件。
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(self, /components\/chat\/chat-shell/, '本文件不得跨文件断言流式段');
});
