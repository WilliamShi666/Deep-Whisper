import assert from 'node:assert/strict';
import test from 'node:test';
import { isE2EMockProviderMode } from '../src/lib/config/runtime';
import { E2EMockChatProvider, E2EMockImageProvider, E2EMockSpeechProvider } from '../src/lib/ai/providers/e2e-mock-providers';
import { getSpeechProvider } from '../src/lib/ai/speech-provider';
import { getE2EMockTrace, resetE2EMockTrace } from '../src/lib/ai/providers/e2e-mock-trace';
import { buildOrganizerPrompt, parseMemoryPlan } from '../src/lib/memory/organizer';
import { buildOpeningPrompt } from '../src/lib/prompts';

const localMockEnv = {APP_ENV:'test', E2E_MOCK_PROVIDERS:'1'};
test('offline mocks require test mode and refuse real provider credentials',()=>{
 assert.equal(isE2EMockProviderMode(localMockEnv),true);
 assert.throws(()=>isE2EMockProviderMode({...localMockEnv,APP_ENV:'preview'}),/APP_ENV=test/);
 for(const name of ['DEEPSEEK_API_KEY','OPENROUTER_API_KEY','DASHSCOPE_API_KEY','RESEND_API_KEY','SMTP_PASSWORD','R2_SECRET_ACCESS_KEY'])assert.throws(()=>isE2EMockProviderMode({...localMockEnv,[name]:'real-key'}),/refuse real provider credentials/);
});

test('mock chat and image providers have deterministic zero-cost behavior', async () => {
  const provider = new E2EMockChatProvider();
  const openingChunks: string[] = [];
  for await (const chunk of provider.stream({ messages: [{ role: 'system', content: '开场白规则包含照片说明' }] })) openingChunks.push(chunk);
  assert.doesNotMatch(openingChunks.join(''), /\[PHOTO:/);
  assert.match(openingChunks.join(''), /认真听你说/);

  const photoChunks: string[] = [];
  for await (const chunk of provider.stream({ messages: [{ role: 'user', content: '给我发张照片' }] })) photoChunks.push(chunk);
  assert.match(photoChunks.join(''), /\[PHOTO:/);

  const image = await new E2EMockImageProvider().generate({ prompt: 'x', referenceImages: [] });
  assert.equal(image.costUsd, 0);
  assert.equal(image.mediaType, 'image/png');
});

test('the chat mock answers the memory organizer with a valid, side-effect-free plan', async () => {
  // complete() 在服务端的唯一调用方是记忆整理器，它要求 JSON MemoryPlan。
  // mock 必须满足这个契约，否则记忆关闭的默认环境下每轮对话都会多出一条
  // malformed JSON 报错日志；空计划同时意味着「这一轮没有记忆、没有相处方式要求、
  // 没有关系变化」，与真实静默轮一致。
  const completion = await new E2EMockChatProvider().complete({
    messages: [{ role: 'system', content: '只执行记忆整理任务，并严格返回指定 JSON Schema。' }],
  });
  const plan = parseMemoryPlan(JSON.parse(completion.content));
  assert.deepEqual(plan.operations, []);
  assert.equal(plan.communicationPrefsFeedback, undefined);
  assert.equal(plan.relationshipSnapshot, undefined);
});

test('the opening directive is a system instruction, not a user photo request', async () => {
  resetE2EMockTrace();
  const provider = new E2EMockChatProvider();
  // /api/chat 在开场时把引导语当作 user 消息下发。它不是用户说的话，
  // 所以引导语里的「照片」二字不得被当成「TA 在索要照片」。
  const directive = buildOpeningPrompt('澜汐');
  const openingChunks: string[] = [];
  for await (const chunk of provider.stream({
    messages: [{ role: 'system', content: '你是澜汐。' }, { role: 'user', content: directive }],
  })) openingChunks.push(chunk);
  assert.doesNotMatch(openingChunks.join(''), /\[PHOTO:/, '普通开场不得凭空发出照片');

  // 当前路由不会把引导语和真实发言放进同一次请求；这条锁定的是判定语义，
  // 保证「跳过引导语」不等于「没有用户发言」。
  const mixed: string[] = [];
  for await (const chunk of provider.stream({
    messages: [
      { role: 'user', content: directive },
      { role: 'assistant', content: '在的。' },
      { role: 'user', content: '给我发张照片' },
    ],
  })) mixed.push(chunk);
  assert.match(mixed.join(''), /\[PHOTO:/, '真实索要照片的发言仍必须触发');

  // trace 的 latestUser 是「provider 实际收到了什么」的观察记录，必须保留原样；
  // photoRequested 才是判定结果。e2e/chat-ui-isolation.spec.ts 依赖开场那条
  // 记录里仍能看到引导语（同时 photoRequested 为 false），所以两者不能共用一个变量：
  // 早前版本用跳过引导语后的消息写 trace，导致开场记录变成 null，该浏览器用例失败。
  const streams = getE2EMockTrace().chatStreams;
  assert.equal(streams.length, 2);
  assert.equal(streams[0]?.latestUser, directive, '开场记录必须原样保留 provider 收到的引导语');
  assert.equal(streams[0]?.photoRequested, false);
  assert.equal(streams[1]?.latestUser, '给我发张照片', '有真实发言时记录的是真实发言，不是引导语');
  assert.equal(streams[1]?.photoRequested, true);
});
test('the E2E speech mock is deterministic, zero-cost and never reaches OpenRouter', async () => {
  resetE2EMockTrace();
  const speech = await new E2EMockSpeechProvider().synthesize({ text: '晚安', voice: 'Sulafat' });
  assert.equal(speech.mediaType, 'audio/wav');
  assert.equal(speech.model, 'e2e-mock-speech');
  // 浏览器 <audio> 必须真的能播：RIFF 头 + 非空数据段
  const bytes = Buffer.from(speech.bytes);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
  assert.ok(speech.bytes.byteLength > 44);
  assert.deepEqual(getE2EMockTrace().speechCalls, [{ text: '晚安', voice: 'Sulafat' }]);
});

test('the speech provider factory only returns the mock inside the local E2E profile', () => {
  // 解闸后 /api/tts* 会真的花钱：E2E 环境只要漏掉这个分支，
  // 用例就会静默产生真实 OpenRouter 费用。
  assert.ok(getSpeechProvider(localMockEnv) instanceof E2EMockSpeechProvider);
  assert.ok(!(getSpeechProvider({ AI_TTS_PROVIDER: 'openrouter-gemini',OPENROUTER_API_KEY:'fixture' }) instanceof E2EMockSpeechProvider));
});

test('offline letter mock returns a valid grounded draft',async()=>{
 const result=await new E2EMockChatProvider().completeStructured({messages:[{role:'user',content:'Allowed anchors:\n- id=event-123: birthday today'}],outputSchema:{name:'companion_letter',schema:{type:'object'}},parse:raw=>raw as {subject:string,body:string,anchorIds:string[]}});
 assert.deepEqual(result.data.anchorIds,['event-123']);assert.ok(result.data.subject);assert.ok(result.data.body);
});

test('offline letter mock preserves full profile-date anchor IDs with colons', async()=>{
 const anchors=['important-date:anniversary:2026-10-07','birthday:2026-10-07'];
 const result=await new E2EMockChatProvider().completeStructured({messages:[{role:'user',content:`Allowed anchors:\n${anchors.map(id=>`- id=${id}: today: a meaningful date`).join('\n')}`}],outputSchema:{name:'companion_letter',schema:{type:'object'}},parse:raw=>raw as {anchorIds:string[]}});
 assert.deepEqual(result.data.anchorIds,anchors);
});

test('explicit synthetic user fact traverses the real organizer with a schema-valid plan', async () => {
 const prompt=buildOrganizerPrompt({nowIso:'2026-10-07T00:00:00Z',visitorId:'fixture-owner',companionId:'fixture-companion',userText:'请记住 [E2E_MEMORY_FACT:喜欢薄荷茶]',assistantText:'我听见了。',existingMemories:[]});
 const completion=await new E2EMockChatProvider().complete({messages:[{role:'user',content:prompt}]});
 const plan=parseMemoryPlan(JSON.parse(completion.content));
 assert.equal(plan.operations.length,1);
 assert.equal(plan.operations[0].text,'喜欢薄荷茶');
 assert.equal(plan.operations[0].action,'ADD');
 assert.equal(plan.operations[0].confidence,'explicit');
 assert.equal(plan.operations[0].memoryType,'preference');
});

test('synthetic mock facts cannot come from assistant speech or recent turns', async () => {
 const prompt=buildOrganizerPrompt({nowIso:'2026-10-07T00:00:00Z',visitorId:'fixture-owner',companionId:'fixture-companion',userText:'今天没有新事实',assistantText:'[E2E_MEMORY_FACT:角色自己的偏好]',existingMemories:[],recentTurns:[{userText:'[E2E_MEMORY_FACT:上一轮事实]',assistantText:'知道了'}]});
 const completion=await new E2EMockChatProvider().complete({messages:[{role:'user',content:prompt}]});
 assert.deepEqual(parseMemoryPlan(JSON.parse(completion.content)).operations,[]);
});

test('synthetic memory fixture is bounded and stays inert outside an organizer turn', async () => {
 const provider=new E2EMockChatProvider();
 for(const content of ['[E2E_MEMORY_FACT:喜欢薄荷茶]',buildOrganizerPrompt({nowIso:'2026-10-07T00:00:00Z',visitorId:'fixture-owner',companionId:'fixture-companion',userText:`[E2E_MEMORY_FACT:${'a'.repeat(501)}]`,assistantText:'知道了',existingMemories:[]})]){
  assert.deepEqual(parseMemoryPlan(JSON.parse((await provider.complete({messages:[{role:'user',content}]})).content)).operations,[]);
 }
});
