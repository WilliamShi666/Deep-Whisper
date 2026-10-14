import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import * as visitors from '../src/app/api/visitor/route';
import * as companions from '../src/app/api/companions/route';
import * as companionRoute from '../src/app/api/companions/[id]/route';
import * as conversations from '../src/app/api/conversations/route';
import * as conversationRoute from '../src/app/api/conversations/[id]/route';
import * as messageRoute from '../src/app/api/conversations/[id]/messages/route';
import * as profile from '../src/app/api/profile/route';
import * as relationship from '../src/app/api/relationship/route';
import * as feedback from '../src/app/api/feedback/route';
import * as tts from '../src/app/api/tts/route';
import * as preview from '../src/app/api/tts-preview/route';
import * as photo from '../src/app/api/photo/route';
import * as upload from '../src/app/api/upload/route';
import * as localeDefault from '../src/app/api/locale-default/route';
import * as themes from '../src/app/api/themes/route';
import * as chat from '../src/app/api/chat/route';
import { getSqlite, closeDatabase } from '../src/storage/database/db';
import { createCoreRepository } from '../src/lib/personal/core-repository';
import { CHARACTER_PRESETS } from '../src/lib/characters';
import { getChatThemesForGender } from '../src/lib/chat-themes';
import { resetE2EMockTrace, snapshotE2EMockTrace } from '../src/lib/ai/providers/e2e-mock-trace';

const base = 'http://127.0.0.1:5000';
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(`${base}/api/${path}`, {
    method,
    headers: {
      host: '127.0.0.1:5000',
      ...(method === 'GET' ? {} : { origin: base, 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture(t: { after(fn: () => void): void }) {
  const prior = process.env;
  const dir = mkdtempSync(join(tmpdir(), 'dw-api-'));
  closeDatabase();
  process.env = {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    APP_DATA_DIR: dir,
    APP_ACCESS_MODE: 'local',
    HOST: '127.0.0.1',
    PORT: '5000',
    APP_BASE_URL: base,
  };
  const db = getSqlite();
  const owner = (db.prepare('SELECT id FROM visitors').get() as { id: string }).id;
  t.after(() => {
    closeDatabase();
    process.env = prior;
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, owner, repo: createCoreRepository(db) };
}
test('OSS-008/009 API creates 8×2 appearances, replays creation IDs, and ignores forged browser identity', async (t) => {
  const f = fixture(t);
  const first = await (await visitors.GET(request('visitor'))).json();
  assert.equal(first.visitor.gender, null);
  assert.equal(first.companion, null);
  assert.equal(
    (
      await companions.POST(
        request('companions', 'POST', { character_key: CHARACTER_PRESETS[0].key }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await visitors.POST(request('visitor', 'POST', { gender: 'other', orientation: 'female' })))
      .status,
    200,
  );
  for (const character of CHARACTER_PRESETS)
    for (const style of ['chibi', 'normal']) {
      const creation_id = randomUUID();
      const body = { character_key: character.key, appearance_style: style, creation_id };
      const response = await companions.POST(
        request('companions', 'POST', body, {
          'x-visitor-id': 'forged-owner',
          'x-session': 'forged-token',
        }),
      );
      assert.equal(response.status, 200);
      const saved = (await response.json()).companion;
      assert.equal(saved.visitor_id, f.owner);
      assert.equal(saved.appearance_style, style);
      assert.equal(saved.avatar, character.appearanceAssets[style as 'chibi' | 'normal'].avatar);
      const replay = (await (await companions.POST(request('companions', 'POST', body))).json())
        .companion;
      assert.equal(replay.id, saved.id);
    }
  assert.equal((f.db.prepare('SELECT count(*) n FROM companions').get() as { n: number }).n, 16);
});
test('OSS-010/014 API wrappers, per-companion mutations, profile CAS and feedback survive real SQLite', async (t) => {
  const f = fixture(t);
  await visitors.POST(request('visitor', 'POST', { gender: 'other', orientation: 'female' }));
  const companion = (
    await (
      await companions.POST(
        request('companions', 'POST', { character_key: CHARACTER_PRESETS[0].key }),
      )
    ).json()
  ).companion;
  const context = { params: Promise.resolve({ id: companion.id }) };
  assert.equal(
    (
      await companionRoute.PATCH(
        request(`companions/${companion.id}`, 'PATCH', { voice_id: 'voice-zh-m-01' }),
        context,
      )
    ).status,
    400,
  );
  const conversation = (
    await (
      await conversations.POST(request('conversations', 'POST', { companion_id: companion.id }))
    ).json()
  ).conversation;
  assert.equal(conversation.companion_name, companion.name);
  const c = { params: Promise.resolve({ id: conversation.id }) };
  const user = f.repo.insertMessage(f.owner, conversation.id, {
    role: 'user',
    content: 'synthetic',
  });
  const assistant = f.repo.insertMessage(f.owner, conversation.id, {
    role: 'assistant',
    content: 'synthetic reply',
  });
  assert.equal(
    (await feedback.POST(request('feedback', 'POST', { message_id: user.id, rating: 1 }))).status,
    404,
  );
  assert.equal(
    (
      await feedback.POST(
        request('feedback', 'POST', {
          message_id: assistant.id,
          rating: 1,
          conversation_id: 'forged',
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await feedback.GET(request(`feedback?conversation_id=${conversation.id}`))).json())
      .feedback.length,
    1,
  );
  assert.equal(
    (await (await messageRoute.GET(request(`conversations/${conversation.id}/messages`), c)).json())
      .messages.length,
    2,
  );
  assert.equal(
    (await profile.PUT(request('profile', 'PUT', { timezone: 'invalid/timezone' }))).status,
    400,
  );
  assert.equal(f.repo.getProfile(f.owner), null);
  const saved = (
    await (
      await profile.PUT(
        request('profile', 'PUT', { timezone: 'Asia/Shanghai', display_name: 'Owner' }),
      )
    ).json()
  ).profile;
  assert.equal(
    (
      await profile.PUT(
        request('profile', 'PUT', { display_name: 'fresh', profile_updated_at: saved.updated_at }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await profile.PUT(
        request('profile', 'PUT', { display_name: 'stale', profile_updated_at: saved.updated_at }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await relationship.PUT(
        request('relationship', 'PUT', {
          companion_id: randomUUID(),
          dynamic_summary: 'not yours',
        }),
      )
    ).status,
    404,
  );
  const deletion = await conversationRoute.DELETE(request(`conversations/${conversation.id}`, 'DELETE'), c);
  assert.equal(deletion.status, 200);
  const deletionPayload = await deletion.json();
  assert.deepEqual(Object.keys(deletionPayload).sort(), ['forget', 'ok']);
  assert.equal(deletionPayload.ok, true);
  assert.ok(f.repo.getCompanion(f.owner, companion.id));
});
test('OSS-004/005 media missing configuration and owner failures return actionable status before external I/O', async (t) => {
  const f = fixture(t);
  await visitors.POST(request('visitor', 'POST', { gender: 'other', orientation: 'female' }));
  const companion = (
    await (
      await companions.POST(
        request('companions', 'POST', { character_key: CHARACTER_PRESETS[0].key }),
      )
    ).json()
  ).companion;
  const conversation = f.repo.createConversation(f.owner, companion.id, { title: 'synthetic' });
  const message = f.repo.insertMessage(f.owner, conversation.id, {
    role: 'assistant',
    content: 'test',
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('External I/O forbidden in fixture');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  for (const [handler, path, body] of [
    [tts.POST, 'tts', { message_id: message.id }],
    [preview.POST, 'tts-preview', { voice_id: 'voice-zh-f-01' }],
    [photo.POST, 'photo', { conversation_id: conversation.id, appearance_style: 'chibi' }],
    [upload.POST, 'upload', {}],
  ] as const) {
    const response = await handler(request(path, 'POST', body));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'FEATURE_NOT_CONFIGURED');
  }
  assert.equal(calls, 0);
  const denied = await visitors.POST(
    request(
      'visitor',
      'POST',
      { gender: 'male', orientation: 'female' },
      { origin: 'https://attacker.invalid' },
    ),
  );
  assert.equal(denied.status, 403);
  assert.equal(f.repo.getVisitor(f.owner)?.gender, 'other');
  process.env.APP_ACCESS_MODE = 'password';
  process.env.OWNER_PASSWORD = 'a synthetic sufficiently long password';
  const unauthorized = await visitors.GET(
    request('visitor', 'GET', undefined, { 'x-visitor-id': f.owner }),
  );
  assert.equal(unauthorized.status, 401);
});
test('OSS-018 personal language default uses device preference and never writes identity/cookie', async (t) => {
  const f = fixture(t);
  const response = localeDefault.GET(
    request('locale-default', 'GET', undefined, {
      'accept-language': 'en-US,en;q=0.9,zh;q=0.8',
      'x-vercel-ip-country': 'CN',
    }),
  );
  assert.deepEqual(await response.json(), { locale: 'en' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.repo.getVisitor(f.owner)?.locale, null);
  assert.deepEqual(
    await localeDefault
      .GET(request('locale-default', 'GET', undefined, { 'accept-language': 'en;q=0,zh-TW;q=0.9' }))
      .json(),
    { locale: 'zh-CN' },
  );
});
test('OSS-010 malformed JSON bodies are input errors and never become internal failures', async (t) => {
  fixture(t);
  for (const [handler, path] of [[visitors.POST, 'visitor'], [companions.POST, 'companions'], [conversations.POST, 'conversations'], [profile.PUT, 'profile'], [relationship.PUT, 'relationship']] as const) {
    const response = await handler(request(path, 'POST', null));
    assert.equal(response.status, 400, path);
  }
});
test('OSS-011/013 actual chat route streams the mock provider and durably queues eligible text exchanges', async (t) => {
  const f=fixture(t);process.env.E2E_MOCK_PROVIDERS='1';resetE2EMockTrace();
  await visitors.POST(request('visitor','POST',{gender:'other',orientation:'female'}));
  const companion=(await (await companions.POST(request('companions','POST',{character_key:CHARACTER_PRESETS[0].key}))).json()).companion;
  const conversation=f.repo.createConversation(f.owner,companion.id,{title:'synthetic'});
  const opening=await chat.POST(request('chat','POST',{conversation_id:conversation.id,opening:true}));assert.equal(opening.status,200);assert.ok((await opening.text()).includes('"type":"done"'));
  assert.equal((await chat.POST(request('chat','POST',{conversation_id:conversation.id,opening:true}))).status,409);
  const response=await chat.POST(request('chat','POST',{conversation_id:conversation.id,content:'synthetic hello'}));
  const events=(await response.text()).split('\n\n').filter(Boolean).map(line=>JSON.parse(line.slice(6)));
  assert.equal(events[0].type,'user_message');assert.equal(events.at(-1).type,'done');
  assert.equal((f.db.prepare('SELECT count(*) n FROM memory_jobs').get() as {n:number}).n,1);
  assert.equal(snapshotE2EMockTrace().chatStreams.length,2);
});
test('OSS-012 image-only chat, stored photo, and click TTS use mock bytes with real private SQLite/media persistence', async (t) => {
  const f=fixture(t);process.env.E2E_MOCK_PROVIDERS='1';resetE2EMockTrace();
  await visitors.POST(request('visitor','POST',{gender:'other',orientation:'female'}));
  const companion=(await (await companions.POST(request('companions','POST',{character_key:CHARACTER_PRESETS[0].key}))).json()).companion;
  const conversation=f.repo.createConversation(f.owner,companion.id,{title:'synthetic'});
  const form=new FormData();form.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'fixture.png',{type:'image/png'}));
  const uploaded=await upload.POST(new NextRequest(`${base}/api/upload`,{method:'POST',headers:{host:'127.0.0.1:5000',origin:base},body:form}));assert.equal(uploaded.status,200);
  const image_path=(await uploaded.json()).path;
  const response=await chat.POST(request('chat','POST',{conversation_id:conversation.id,image_path}));const body=await response.text();assert.ok(body.includes('"type":"done"'));
  assert.equal((f.db.prepare('SELECT count(*) n FROM memory_jobs').get() as {n:number}).n,0);
  const message=f.repo.recentMessages(f.owner,conversation.id).find(row=>row.role==='assistant')!;
  const speech=await tts.POST(request('tts','POST',{message_id:message.id}));assert.equal(speech.status,200);const audio_url=(await speech.json()).audio_url;assert.ok(audio_url.startsWith('/api/media/'));assert.equal(f.repo.getOwnedMessage(f.owner,message.id)?.audio_url,audio_url);
  assert.equal((await tts.POST(request('tts','POST',{message_id:message.id}))).status,200);assert.equal(snapshotE2EMockTrace().speechCalls.length,1);
  assert.equal((await photo.POST(request('photo','POST',{conversation_id:conversation.id,appearance_style:'normal'}))).status,409);assert.equal(snapshotE2EMockTrace().imageCalls.length,0);
  const image=await photo.POST(request('photo','POST',{conversation_id:conversation.id,appearance_style:'chibi',photo_scene:'ordinary sunny window'}));assert.equal(image.status,200);const saved=(await image.json()).message;assert.equal(saved.content_type,'image');assert.ok(saved.image_url.startsWith('/api/media/'));assert.equal(f.repo.getOwnedMessage(f.owner,saved.id)?.image_url,saved.image_url);assert.equal(snapshotE2EMockTrace().imageCalls.length,1);
});

test('OSS-009/010/011 personal locale, palette, theme and manual preferences enforce real persisted boundaries', async (t) => {
  const f = fixture(t);
  for (const body of [{locale: 'fr'}, {palette: 'green'}, {ui_theme: 'missing'}]) {
    assert.equal((await visitors.PATCH(request('visitor', 'PATCH', body))).status, 400);
  }
  assert.equal((await visitors.PATCH(request('visitor', 'PATCH', {theme_id: 'default'}))).status, 409);
  const before = f.repo.getVisitor(f.owner)!;
  assert.equal(before.locale, null);
  assert.equal(before.palette, null);
  const patch = await visitors.PATCH(request('visitor', 'PATCH', {locale:'en', palette:'rose'}));
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).visitor.locale, 'en');
  assert.equal(f.repo.getVisitor(f.owner)!.palette, 'rose');
  await visitors.PATCH(request('visitor', 'PATCH', {locale:null,palette:null}));
  assert.equal(f.repo.getVisitor(f.owner)!.locale, null);
  assert.equal(f.repo.getVisitor(f.owner)!.palette, null);
  await visitors.POST(request('visitor','POST',{gender:'other',orientation:'female'}));
  const female = CHARACTER_PRESETS.find(character=>character.gender==='female')!;
  const male = CHARACTER_PRESETS.find(character=>character.gender==='male')!;
  const first = (await (await companions.POST(request('companions','POST',{character_key:female.key}))).json()).companion;
  const second = (await (await companions.POST(request('companions','POST',{character_key:male.key}))).json()).companion;
  const conversation = f.repo.createConversation(f.owner,first.id,{title:'Theme scope'});
  const ownTheme = getChatThemesForGender('female').find(theme=>theme.id!=='default')!;
  const wrongTheme = getChatThemesForGender('male').find(theme=>theme.id!=='default')!;
  const context={params:Promise.resolve({id:first.id})};
  assert.equal((await companionRoute.PATCH(request('companions/'+first.id,'PATCH',{theme_id:wrongTheme.id}),context)).status,403);
  assert.equal((await companionRoute.PATCH(request('companions/'+first.id,'PATCH',{theme_id:ownTheme.id}),context)).status,200);
  const active = await (await themes.GET(request('themes?conversation_id='+conversation.id))).json();
  assert.equal(active.gender,'female');
  assert.equal(active.current_id,ownTheme.id);
  assert.notEqual(f.repo.getCompanion(f.owner,second.id)!.theme_id,ownTheme.id);
  assert.equal((await profile.PUT(request('profile','PUT',{timezone:'not-a-zone'}))).status,400);
  assert.equal(f.repo.getProfile(f.owner),null);
  await profile.PUT(request('profile','PUT',{communication_prefs:{love_language:'playful'}}));
  for(const feedbackText of ['Please be concise','Please ask before photos']){
    assert.equal((await profile.PUT(request('profile','PUT',{feedback_action:'append',feedback:feedbackText}))).status,200);
  }
  assert.deepEqual(f.repo.getProfile(f.owner)!.communication_prefs!.explicit_feedback,['Please be concise','Please ask before photos']);
  assert.equal((await profile.PUT(request('profile','PUT',{feedback_action:'append',feedback:'   '}))).status,400);
  assert.equal((await profile.PUT(request('profile','PUT',{feedback_action:'revoke',revoke_mode:'explicit_feedback'}))).status,200);
  assert.equal(f.repo.getProfile(f.owner)!.communication_prefs!.love_language,'playful');
  assert.equal(f.repo.getProfile(f.owner)!.communication_prefs!.explicit_feedback,undefined);
  assert.equal(f.repo.listConversations(f.owner).conversations.length,1);
  assert.equal(f.repo.getCompanion(f.owner,first.id)!.theme_id,ownTheme.id);
});

test('review R1 mail configuration conflict preserves chat, upload, photo, persona and speech capabilities', async (t) => {
  const f=fixture(t);process.env.E2E_MOCK_PROVIDERS='1';process.env.LETTER_DELIVERY='both';process.env.EMAIL_PROVIDER='none';resetE2EMockTrace();
  await visitors.POST(request('visitor','POST',{gender:'other',orientation:'female'}));
  const companion=(await (await companions.POST(request('companions','POST',{character_key:CHARACTER_PRESETS[0].key}))).json()).companion;
  const conversation=f.repo.createConversation(f.owner,companion.id,{title:'synthetic'});
  const form=new FormData();form.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'fixture.png',{type:'image/png'}));
  const uploaded=await upload.POST(new NextRequest(`${base}/api/upload`,{method:'POST',headers:{host:'127.0.0.1:5000',origin:base},body:form}));assert.equal(uploaded.status,200);
  const image_path=(await uploaded.json()).path;
  const response=await chat.POST(request('chat','POST',{conversation_id:conversation.id,image_path}));const body=await response.text();assert.ok(body.includes('"type":"done"'));
  assert.equal((f.db.prepare('SELECT count(*) n FROM memory_jobs').get() as {n:number}).n,0);
  const message=f.repo.recentMessages(f.owner,conversation.id).find(row=>row.role==='assistant')!;
  const speech=await tts.POST(request('tts','POST',{message_id:message.id}));assert.equal(speech.status,200);const audio_url=(await speech.json()).audio_url;assert.ok(audio_url.startsWith('/api/media/'));assert.equal(f.repo.getOwnedMessage(f.owner,message.id)?.audio_url,audio_url);
  assert.equal((await tts.POST(request('tts','POST',{message_id:message.id}))).status,200);assert.equal(snapshotE2EMockTrace().speechCalls.length,1);
  assert.equal((await photo.POST(request('photo','POST',{conversation_id:conversation.id,appearance_style:'normal'}))).status,409);assert.equal(snapshotE2EMockTrace().imageCalls.length,0);
  const image=await photo.POST(request('photo','POST',{conversation_id:conversation.id,appearance_style:'chibi',photo_scene:'ordinary sunny window'}));assert.equal(image.status,200);const saved=(await image.json()).message;assert.equal(saved.content_type,'image');assert.ok(saved.image_url.startsWith('/api/media/'));assert.equal(f.repo.getOwnedMessage(f.owner,saved.id)?.image_url,saved.image_url);assert.equal(snapshotE2EMockTrace().imageCalls.length,1);
  assert.equal((await preview.POST(request('tts-preview','POST',{voice_id:companion.voice_id}))).status,200);
  const persona=await import('../src/app/api/persona-enhance/route');assert.equal((await persona.POST(request('persona-enhance','POST',{persona:'温柔坦诚'}))).status,200);
});


test('OSS-014 actual chat excludes concurrent provider work and releases its reservation after reader disconnect',async(t)=>{
 const f=fixture(t);process.env.E2E_MOCK_PROVIDERS='1';resetE2EMockTrace({chatChunkDelayMs:75});
 await visitors.POST(request('visitor','POST',{gender:'other',orientation:'female'}));
 const companion=(await (await companions.POST(request('companions','POST',{character_key:CHARACTER_PRESETS[0].key}))).json()).companion;
 const conversation=f.repo.createConversation(f.owner,companion.id,{title:'lease fixture'});
 const first=await chat.POST(request('chat','POST',{conversation_id:conversation.id,content:'first fixture'}));assert.equal(first.status,200);
 const reader=first.body!.getReader();await reader.read();
 const second=await chat.POST(request('chat','POST',{conversation_id:conversation.id,content:'must not start'}));assert.equal(second.status,409);assert.equal((await second.json()).code,'conversation_busy');
 assert.equal(snapshotE2EMockTrace().chatStreams.length,1);await reader.cancel();
 const deadline=Date.now()+1500;while((f.db.prepare('SELECT count(*) n FROM operation_leases').get() as {n:number}).n&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((f.db.prepare('SELECT count(*) n FROM operation_leases').get() as {n:number}).n,0);
 assert.equal((f.db.prepare('SELECT count(*) n FROM memory_jobs').get() as {n:number}).n,1);
 assert.equal(f.repo.recentMessages(f.owner,conversation.id).filter(row=>row.role==='assistant').length,1);
 const next=await chat.POST(request('chat','POST',{conversation_id:conversation.id,content:'next fixture'}));assert.ok((await next.text()).includes('"type":"done"'));
});
test('OSS-014 real chat provider rejection clears the lease and permits a subsequent request',async(t)=>{
 const f=fixture(t);process.env.DEEPSEEK_API_KEY='fixture-only';
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{message:'synthetic rejection'}},{status:400});t.after(()=>{globalThis.fetch=original;});
 await visitors.POST(request('visitor','POST',{gender:'other',orientation:'female'}));
 const companion=(await (await companions.POST(request('companions','POST',{character_key:CHARACTER_PRESETS[0].key}))).json()).companion;const conversation=f.repo.createConversation(f.owner,companion.id,{title:'failure fixture'});
 const failed=await chat.POST(request('chat','POST',{conversation_id:conversation.id,content:'synthetic failure'}));assert.ok((await failed.text()).includes('"type":"error"'));
 assert.equal((f.db.prepare('SELECT count(*) n FROM operation_leases').get() as {n:number}).n,0);
 delete process.env.DEEPSEEK_API_KEY;process.env.E2E_MOCK_PROVIDERS='1';resetE2EMockTrace();
 const next=await chat.POST(request('chat','POST',{conversation_id:conversation.id,content:'synthetic retry'}));assert.ok((await next.text()).includes('"type":"done"'));
});
test('OSS-014 expiry and token fences prevent an old release deleting a replacement lease',async(t)=>{
 const f=fixture(t);const {acquireOperationLease,releaseOperationLease}=await import('../src/lib/operation-lease');
 const first=(await acquireOperationLease('fixture:operation'))!;assert.ok(first);assert.equal(await acquireOperationLease(first.key),null);
 f.db.prepare('UPDATE operation_leases SET expires_at=? WHERE resource_key=?').run(Date.now()-1,first.key);
 const replacement=(await acquireOperationLease(first.key))!;assert.ok(replacement);assert.notEqual(first.token,replacement.token);
 await releaseOperationLease(first);assert.equal((f.db.prepare('SELECT token FROM operation_leases WHERE resource_key=?').get(first.key) as {token:string}).token,replacement.token);
 await releaseOperationLease(replacement);assert.equal((f.db.prepare('SELECT count(*) n FROM operation_leases').get() as {n:number}).n,0);
});
