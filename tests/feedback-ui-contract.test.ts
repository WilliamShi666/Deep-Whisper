import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { zhCN } from '../src/lib/i18n/messages';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('the feedback control exists and is a self-contained component', () => {
  const path = 'src/components/chat/message-feedback.tsx';
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true);
  const component = read(path);

  assert.match(component, /'use client'/);
  assert.match(component, /export function MessageFeedback/);
  // 两个按钮都要有无障碍名（图标按钮没有可见文字）；t9/U3 起文案走字典，中文取值逐字符不变。
  assert.match(component, /aria-label=\{t\('chat\.feedback\.helpful'\)\}/);
  assert.match(component, /aria-label=\{t\('chat\.feedback\.unhelpful'\)\}/);
  assert.equal(zhCN.chat['feedback.helpful'], '有帮助');
  assert.equal(zhCN.chat['feedback.unhelpful'], '没帮助');
  // 留言上限与校验模块保持一致。
  assert.match(component, /MAX_COMMENT_LENGTH|500/);
});

test('the bubble only renders feedback for assistant messages', () => {
  const bubble = read('src/components/chat/message-bubble.tsx');

  assert.match(bubble, /MessageFeedback/);
  assert.match(bubble, /feedback\?:/);
  assert.match(bubble, /onFeedback\?:/);

  // 用户自己的气泡分支不得出现反馈控件：只有助手回复可被反馈。
  // 两个锚点必须先断言存在：否则 indexOf 返回 -1 时 slice 会退化成空串，
  // doesNotMatch 就变成永远为真的假绿——而被格式变动吃掉的恰恰可能是**第一个**锚点。
  const userAnchor = bubble.indexOf('if (isMine)');
  const assistantAnchor = bubble.indexOf('return (\n    <div\n      className="anim-fade-in-up flex items-start gap-2.5"');
  assert.ok(userAnchor >= 0, 'the user-branch anchor must exist in the bubble source');
  assert.ok(assistantAnchor > userAnchor, 'the assistant-branch anchor must follow the user branch');
  const userBranch = bubble.slice(userAnchor, assistantAnchor);
  assert.doesNotMatch(userBranch, /MessageFeedback/);

  // E2E 依赖这两个属性定位消息（e2e/support.ts 用 [data-testid^="message-"] 过滤）。
  // 期望值用拼接构造：正则里出现 ${ 时会被模板字符串吃掉转义，得到裸 $ 锚点而永远不匹配。
  const MESSAGE_TESTID_ATTR = 'data-testid={' + '`' + 'message-' + '${' + 'message.id}' + '`' + '}';
  assert.equal(bubble.includes(MESSAGE_TESTID_ATTR), true, 'the message testid must stay for E2E');
  assert.match(bubble, /data-content-type={message.content_type}/);
});

test('the chat shell keeps feedback state per conversation and rolls back on failure', () => {
  const shell = read('src/components/chat/chat-shell.tsx');

  assert.match(shell, /feedbackByConversation/);
  assert.match(shell, /\/api\/feedback/);
  // 失败必须回滚乐观状态并提示，而不是静默丢弃。
  assert.match(shell, /toast\.error/);
  // 删除会话时要一并清掉该会话的反馈状态。
  assert.match(shell, /delete next\[id\]/);
});

test('the shared type carries the feedback contract', () => {
  const types = read('src/lib/types.ts');
  assert.match(types, /export interface MessageFeedbackDTO/);
  assert.match(types, /rating: 1 \| -1/);
});
