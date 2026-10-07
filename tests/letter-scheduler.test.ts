import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { decideLetterEligibility, selectLetterAnchor } from '../src/lib/letters/policy';
import { deliveryStatusForEvent, verifyResendWebhook } from '../src/lib/letters/webhook';
import { assertSafeLetterCopy, writeGroundedLetter } from '../src/lib/letters/writer';

const now = new Date('2026-09-20T12:00:00.000Z');

test('a letter needs an explicit, live memory anchor', () => {
  const anchor = selectLetterAnchor([{ id: 'due', text: '用户说周一有面试', layer: 'L3', bucket: 'key_detail', domain: 'event', memoryType: 'event', importance: 0.9, confidence: 'explicit', evidenceMemoryIds: [], score: 0.9, observedAt: null, occurredAt: '2026-09-19T09:00:00Z', timePrecision: 'exact', validUntil: null, temporalStatus: 'follow_up_due', sourceConversationIds: [], createdAt: null, updatedAt: null }], now, null);
  assert.deepEqual(anchor, { id: 'due', text: '用户说周一有面试', kind: 'L1' });
  assert.equal(selectLetterAnchor([{ id: 'guess', text: '模型猜测', layer: 'L3', bucket: 'key_detail', domain: 'other', memoryType: 'other', importance: 1, confidence: 'inferred', evidenceMemoryIds: [], score: 1, observedAt: null, occurredAt: null, timePrecision: null, validUntil: null, temporalStatus: 'timeless', sourceConversationIds: [], createdAt: null, updatedAt: null }], now, null), null);
});

test('the window, the daily cap and a paused preference all prevent sending', () => {
  const anchor = { id: 'a', text: '明确事件', kind: 'L2' } as const;
  for (const input of [
    { preferenceStatus: 'paused', windowStartedAt: '2026-09-20T12:00:00Z', hasLetterToday: false, expected: 'preference_disabled' },
    { preferenceStatus: 'enabled', windowStartedAt: null, hasLetterToday: false, expected: 'no_interaction' },
    { preferenceStatus: 'enabled', windowStartedAt: '2026-09-15T12:00:00Z', hasLetterToday: false, expected: 'window_closed' },
    { preferenceStatus: 'enabled', windowStartedAt: '2026-09-20T12:00:00Z', hasLetterToday: true, expected: 'daily_limit' },
  ]) assert.equal(decideLetterEligibility({ ...input, anchor, now }).skipReason, input.expected);
});

test('Resend webhook signature rejects tampering', () => {
  const secret = `whsec_${Buffer.from('test-signing-secret').toString('base64')}`;
  const id = 'msg_1'; const timestamp = String(Math.floor(Date.now() / 1000)); const body = '{"type":"email.bounced"}';
  const signature = `v1,${createHmac('sha256', Buffer.from('test-signing-secret')).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
  assert.equal(verifyResendWebhook({ id, timestamp, signature, body, secret }), true);
  assert.equal(verifyResendWebhook({ id, timestamp, signature, body: '{}', secret }), false);
});

test('Resend delivery events retain delivery audit and suppress only bounce or complaint', () => {
  assert.equal(deliveryStatusForEvent('email.delivered'), 'delivered');
  assert.equal(deliveryStatusForEvent('email.bounced'), 'bounced');
  assert.equal(deliveryStatusForEvent('email.complained'), 'complained');
  assert.equal(deliveryStatusForEvent('email.opened'), null);
});

test('coercive or guilt-inducing copy is rejected before delivery', () => {
  assert.doesNotThrow(() => assertSafeLetterCopy('想问问你', '希望一切顺利，不用急着回。'));
  assert.throws(() => assertSafeLetterCopy('你是不是忘了我', '我一直在等你。'), /coercive/);
});

test('writing a letter costs exactly one model call, at temperature 1', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/lib/letters/writer.ts', import.meta.url), 'utf8');

  // 创始人决定去掉第二次模型调用（事实审计器）：一封信只调一次模型。
  // 审计器同时是「每一封 L2 都被拒」的成因，去掉它也让写信回到单次调用。
  assert.equal((source.match(/completeStructured\(/g) ?? []).length, 1, 'a letter must cost exactly one model call');

  // 温度 1：模型的采样行为与训练时不同，低温反而更容易写出模板腔。
  assert.match(source, /temperature: 1\b/, 'the writer must run at temperature 1');
  assert.doesNotMatch(source, /temperature: 0\.72/, 'the old low temperature must be gone');
});

test('the letter addresses the user, never the companion itself', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/lib/letters/writer.ts', import.meta.url), 'utf8');

  // 曾经真的写错过：画像里没有 display_name，模型就把**恋人自己的名字**当成了称呼，
  // 正文成了「星寻，我记得你提过，William 下周要…」，读起来像星寻在跟星寻说话。
  assert.match(source, /称呼/, 'the prompt must say how to address the user');
  assert.match(source, /不要用你自己的名字/, 'the prompt must forbid using the companion name as the salutation');

  // 锚点常以第三人称记录（「William 下周要找…他对此感到紧张」）。
  // 模型不知道 William 就是用户，会把他当成第三个人，写成「你说他…」。
  assert.match(source, /第三人称/, 'the prompt must explain third-person anchors refer to the user');
});

test('the letter carries the companion own warmth without inventing facts about the user', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/lib/letters/writer.ts', import.meta.url), 'utf8');

  // 反过来也错过一次：为了通过审计把恋人自己的挂念一起删掉，
  // 结果信只剩复述用户的话，完全没有恋爱的感觉。
  assert.match(source, /可以分享你自己的日常/, 'the guidance must allow the companion own warmth');
  assert.match(source, /不得编造关于对方的事实/, 'but it must forbid inventing facts about the user');
});

test('the fixed regex safety net survives without the model auditor', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/lib/letters/writer.ts', import.meta.url), 'utf8');

  // 审计器被去掉后，防催促/愧疚的那一层只剩这个固定正则，必须仍然被调用。
  assert.match(source, /assertSafeLetterCopy\(draft\.subject, draft\.body\)/, 'the regex safety net must still run');
});

test('the companion may share its own day and thoughts, but never invents facts about the user', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/lib/letters/writer.ts', import.meta.url), 'utf8');

  // 创始人明确要求：AI 恋人可以分享自己的日常与想法。
  // 曾经为了骗过事实审计器，这里禁止过「你自己的日常见闻」。
  // 审计器已按创始人要求整个拆掉，这条禁令也必须去掉 ——
  // 否则信只剩复述对方的话，完全没有恋爱的感觉（创始人原话）。
  assert.match(source, /可以分享你自己的日常/, 'the prompt must allow the companion own daily life');
  assert.doesNotMatch(source, /不要编造你自己具体的日常见闻/, 'the old ban on the companion own day must be gone');

  // 唯一必须守住的红线：不得编造**关于对方**的事实（对方说过的事只能来自锚点）。
  assert.match(source, /不得编造关于对方的事实/, 'facts about the user must still be anchored');

  // L2 的落点仍然是「我这边也有你」，但不再禁止写自己的日常。
  assert.match(source, /我这边/, 'the L2 landing point must stay');
});

test('local mail omits public callbacks; a configured callback must use the actual HTTPS app origin',async()=>{
 const {getLetterPublicBaseUrl}=await import('../src/lib/config/runtime');
 assert.equal(getLetterPublicBaseUrl({APP_ENV:'test',APP_BASE_URL:'http://127.0.0.1:5000'}),'http://127.0.0.1:5000');
 const publicEnv={APP_ENV:'production',APP_BASE_URL:'https://personal.example.test',LETTER_PUBLIC_BASE_URL:'https://personal.example.test'};
 assert.equal(getLetterPublicBaseUrl(publicEnv),'https://personal.example.test');
 assert.throws(()=>getLetterPublicBaseUrl({...publicEnv,LETTER_PUBLIC_BASE_URL:'https://production.example.test'}),/same public HTTPS origin/);
 assert.throws(()=>getLetterPublicBaseUrl({...publicEnv,LETTER_PUBLIC_BASE_URL:'http://personal.example.test'}),/same public HTTPS origin/);
});

function fakeLetterChat(draft:{subject:string;body:string;anchorIds:string[]},inspect?:(input:import('../src/lib/ai/contracts').ChatRequest)=>void):import('../src/lib/ai/contracts').ChatProvider {
 return {
  complete:async()=>{throw new Error('Plain completion is not used');},
  stream:async function*(){throw new Error('Streaming is not used');},
  async completeStructured<T>(input:import('../src/lib/ai/contracts').StructuredChatRequest<T>) {inspect?.(input);return {content:JSON.stringify(draft),model:'unit-fake',data:input.parse(draft)};},
 };
}
test('the real writer issues one grounded structured call and obeys the selected English locale',async()=>{
 let calls=0;
 const result=await writeGroundedLetter({companionName:'Alex',userName:'Sam',locale:'en',kind:'L1',anchors:[{id:'known',text:'用户说周一有面试',kind:'L1'}]},fakeLetterChat({subject:'Checking in',body:'I remembered your interview. No rush to reply.',anchorIds:['known']},input=>{
  calls++;assert.equal(input.temperature,1);assert.ok(String(input.messages[0].content).includes('Write the letter in English'));assert.ok(String(input.messages[1].content).includes('id=known: 用户说周一有面试'));
 }));
 assert.equal(calls,1);assert.equal(result.anchorIds[0],'known');
});
test('the real writer refuses empty or foreign anchor citations after the model call',async()=>{
 for(const anchorIds of [[],['unapproved']])await assert.rejects(()=>writeGroundedLetter({companionName:'Alex',kind:'L2',anchors:[{id:'known',text:'A known event',kind:'L2'}]},fakeLetterChat({subject:'Hello',body:'A short letter.',anchorIds})),/unapproved anchor/);
});
test('the real writer applies its coercion guard to model output in either language',async()=>{
 for(const body of ['你是不是忘了我','I have been waiting for you'])await assert.rejects(()=>writeGroundedLetter({companionName:'Alex',kind:'L2',anchors:[{id:'known',text:'A known event',kind:'L2'}]},fakeLetterChat({subject:'Hello',body,anchorIds:['known']})),/coercive/);
});
