import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE_URL = new URL('../src/components/chat/chat-shell.tsx', import.meta.url);

/**
 * 源码护栏：用户气泡必须是乐观插入的。
 *
 * 曾经的行为是「气泡唯一数据源 = 服务端 SSE 回显」，模型慢的时候用户消息会和 AI 回复
 * 一起冒出来。这里钉死三件事，防止后续有人把它改回去：
 *   1. 发送时先本地插入用户气泡（临时 id / created_at 按 MessageDTO 必填契约自造）；
 *   2. 服务端 user_message 回显到达时按临时 id 原位替换，避免出现两条；
 *   3. 失败时按「服务端是否已回显」决定撤掉还是保留气泡。
 */
test('user bubble is inserted optimistically before the model request is sent', async () => {
  const source = await readFile(SOURCE_URL, 'utf8');

  // 临时 id 计数器与 pending 记录必须按 conversationId 作键（单值 ref 在快速切会话时会串味）
  assert.match(source, /const tempMessageSeqRef = useRef\(0\);/);
  assert.match(source, /const pendingTempIdRef = useRef<Record<string, string \| null>>\(\{\}\);/);

  const optimisticIndex = source.indexOf('const optimisticMessage: MessageDTO = {');
  assert.ok(optimisticIndex >= 0, 'optimistic message literal must exist and be typed as MessageDTO');

  // 乐观插入必须发生在发起 SSE 请求之前
  const requestIndex = source.indexOf('{ conversation_id: conversationId, content, image_path: imagePath },');
  assert.ok(requestIndex >= 0, 'the send request body must exist');
  assert.ok(
    optimisticIndex < requestIndex,
    'the optimistic bubble must be inserted before the model request is dispatched',
  );
});

test('optimistic bubble satisfies the MessageDTO required-field contract', async () => {
  const source = await readFile(SOURCE_URL, 'utf8');
  const start = source.indexOf('const optimisticMessage: MessageDTO = {');
  const end = source.indexOf('pendingTempIdRef.current[conversationId] = tempId;', start);
  assert.ok(start >= 0 && end > start, 'optimistic literal must be followed by the pending registration');
  const literal = source.slice(start, end);

  // 临时 id：与 message-bubble 的 data-testid={`message-${id}`} 兼容，渲染成 message-temp-1
  assert.match(literal, /id: tempId,/);
  assert.match(source, /const tempId = `temp-\$\{\+\+tempMessageSeqRef\.current\}`;/);
  assert.match(literal, /conversation_id: conversationId,/);
  assert.match(literal, /role: 'user',/);
  assert.match(literal, /content_type: imagePath \? 'image' : 'text',/);
  // U7 / t8（F1）：无文字配图的占位不再写死字面量，改用共享常量 IMAGE_PLACEHOLDER
  // （落库哨兵与显示分离；显示侧由 message-bubble 按语言渲染）。断言因此改成「必须用共享常量」。
  assert.match(literal, /content: content \|\| \(imagePath \? IMAGE_PLACEHOLDER : ''\),/);
  assert.match(source, /import \{ IMAGE_PLACEHOLDER \} from '@\/lib\/chat\/image-placeholder';/);
  assert.equal(source.includes("'[图片]'"), false, 'chat-shell 不得再写字面量 [图片]');
  assert.match(literal, /image_url: imagePath \?\? null,/);
  assert.match(literal, /audio_url: null,/);
  // created_at 必须是合法 ISO，否则 formatTime 会渲染出 NaN:NaN
  assert.match(literal, /created_at: new Date\(\)\.toISOString\(\),/);
  // 不允许用类型断言绕过必填契约
  assert.doesNotMatch(literal, /as (unknown|any)\b/);
});

test('server echo replaces the optimistic bubble in place instead of appending a duplicate', async () => {
  const source = await readFile(SOURCE_URL, 'utf8');

  assert.match(source, /pendingTempIdRef\.current\[conversationId\] = tempId;/);
  assert.match(source, /const pendingTempId = pendingTempIdRef\.current\[conversationId\];/);
  assert.match(source, /prev\.map\(\(item\) => \(item\.id === pendingTempId \? m : item\)\)/);
  // pending 为空时保持旧的 append 行为
  assert.match(source, /: \[\.\.\.prev, m\]\)\);/);
});

test('failed send rolls the optimistic bubble back only when the server never echoed it', async () => {
  const source = await readFile(SOURCE_URL, 'utf8');
  const sendIndex = source.indexOf('{ conversation_id: conversationId, content, image_path: imagePath },');
  assert.ok(sendIndex >= 0, 'the send request body must exist');
  const catchIndex = source.indexOf('.catch((e: unknown) => {', sendIndex);
  assert.ok(catchIndex >= 0, 'the send failure branch must exist');
  const failure = source.slice(catchIndex, source.indexOf('});', catchIndex));

  assert.match(failure, /const pendingTempId = pendingTempIdRef\.current\[conversationId\];/);
  assert.match(failure, /pendingTempIdRef\.current\[conversationId\] = null;/);
  // 服务端从未回显 → 移除临时气泡
  assert.match(failure, /prev\.filter\(\(item\) => item\.id !== pendingTempId\)/);
  // 已回显（只是流中断）→ 保留，但仍要清 stream / phase 并提示
  assert.match(failure, /setConversationStream\(conversationId, null\);/);
  assert.match(failure, /setConversationPhase\(conversationId, 'idle'\);/);
});
