import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {getSqlite,closeDatabase} from '../src/storage/database/db';
import {getPrivateSecret} from '../src/lib/personal/secrets';
import {signPersonalUnsubscribeToken} from '../src/lib/email/personal-unsubscribe-token';
import {getLetterPreference,updateLetterPreference} from '../src/lib/letters/personal-repository';
import * as preferences from '../src/app/api/letters/preferences/route';
import * as unsubscribe from '../src/app/api/letters/unsubscribe/route';
import * as webhook from '../src/app/api/webhooks/resend/route';
import * as inbox from '../src/app/api/letters/route';
import * as read from '../src/app/api/letters/[id]/route';

function setup() {
 const dir=mkdtempSync(path.join(tmpdir(),'deep-whisper-letter-routes-'));
 const saved={APP_DATA_DIR:process.env.APP_DATA_DIR,APP_ENV:process.env.APP_ENV,APP_ACCESS_MODE:process.env.APP_ACCESS_MODE,HOST:process.env.HOST,PORT:process.env.PORT,APP_BASE_URL:process.env.APP_BASE_URL,EMAIL_PROVIDER:process.env.EMAIL_PROVIDER,LETTER_DELIVERY:process.env.LETTER_DELIVERY,RESEND_WEBHOOK_SECRET:process.env.RESEND_WEBHOOK_SECRET};
 closeDatabase();Object.assign(process.env,{APP_DATA_DIR:dir,APP_ENV:'test',APP_ACCESS_MODE:'local',HOST:'127.0.0.1',PORT:'5000',APP_BASE_URL:'http://127.0.0.1:5000',EMAIL_PROVIDER:'none',LETTER_DELIVERY:'in-app'});delete process.env.RESEND_WEBHOOK_SECRET;
 const db=getSqlite();const owner=(db.prepare('SELECT id FROM visitors WHERE owner_slot=1').get() as {id:string}).id;
 return {db,owner,cleanup:()=>{closeDatabase();for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;rmSync(dir,{recursive:true,force:true});}};
}
function request(url:string,body?:unknown) {return new Request(`http://127.0.0.1:5000${url}`,body===undefined?undefined:{method:'PATCH',headers:{Origin:'http://127.0.0.1:5000','Content-Type':'application/json'},body:JSON.stringify(body)});}

test('OSS-032 route rejects arbitrary send-to fields and station inbox ownership is enforced',async()=>{
 const {db,owner,cleanup}=setup();try {
  const initial=await preferences.GET(request('/api/letters/preferences'));assert.equal(initial.status,200);assert.equal((await initial.json()).preference.in_app_enabled,false);
  const invalid=await preferences.PATCH(request('/api/letters/preferences',{to:'someone@example.com',in_app_enabled:true}));assert.equal(invalid.status,400);assert.equal(getLetterPreference(db,owner).in_app_enabled,false);
  const enabled=await preferences.PATCH(request('/api/letters/preferences',{in_app_enabled:true}));assert.equal(enabled.status,200);assert.equal(getLetterPreference(db,owner).in_app_enabled,true);
  db.prepare('INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('companion',owner,'test-key','Alex','normal',1,1);
  db.prepare('INSERT INTO letters(id,visitor_id,companion_id,companion_name,subject,body,kind,local_date,trigger_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('letter',owner,'companion','Alex','Hello','Private content','L0','2026-10-08','date-key',1);
  const letters=await inbox.GET(request('/api/letters'));const dto=(await letters.json()).letters;assert.equal(dto[0].body,'Private content');assert.equal(dto[0].created_at,'1970-01-01T00:00:00.001Z');
  const result=await read.PATCH(request('/api/letters/letter',{read:true}),{params:Promise.resolve({id:'letter'})});assert.equal(result.status,200);assert.ok((await result.json()).letter.read_at);
  const cross=await inbox.GET(new Request('http://127.0.0.1:5000/api/letters',{headers:{Origin:'https://attacker.example'}}));assert.equal(cross.status,403);
  const absent=await read.PATCH(request('/api/letters/no-such-id',{read:true}),{params:Promise.resolve({id:'no-such-id'})});assert.equal(absent.status,404);
 }finally{cleanup();}
});

test('OSS-034 scanner GET never unsubscribes; signed one-click POST stops email only; forged token is rejected',async()=>{
 const {db,owner,cleanup}=setup();try {
  updateLetterPreference(db,owner,{in_app_enabled:true,email_enabled:true,email_address:'owner@example.com'});
  const token=signPersonalUnsubscribeToken(owner,getPrivateSecret('unsubscribe'));
  const url=`http://127.0.0.1:5000/api/letters/unsubscribe?token=${encodeURIComponent(token)}`;
  const scan=await unsubscribe.GET(new Request(url));assert.equal(scan.status,200);assert.equal(getLetterPreference(db,owner).email_enabled,true);
  const response=await unsubscribe.POST(new Request(url,{method:'POST',body:'List-Unsubscribe=One-Click'}));assert.equal(response.status,200);assert.equal(getLetterPreference(db,owner).email_enabled,false);assert.equal(getLetterPreference(db,owner).in_app_enabled,true);
  const invalid=await unsubscribe.POST(new Request(url+'x',{method:'POST'}));assert.equal(invalid.status,400);
 }finally{cleanup();}
});

test('OSS-034 receipt endpoint is disabled without provider and secret; fake signature fails and signed replay is idempotent',async()=>{
 const {db,owner,cleanup}=setup();try {
  const body=JSON.stringify({type:'email.complained',data:{email_id:'receipt-id'}});
  assert.equal((await webhook.POST(new Request('http://127.0.0.1:5000/api/webhooks/resend',{method:'POST',body}))).status,404);
  process.env.EMAIL_PROVIDER='resend';assert.equal((await webhook.POST(new Request('http://127.0.0.1:5000/api/webhooks/resend',{method:'POST',body}))).status,404);
  const secret=Buffer.from('isolated-test-secret');process.env.RESEND_WEBHOOK_SECRET='whsec_'+secret.toString('base64');
  assert.equal((await webhook.POST(new Request('http://127.0.0.1:5000/api/webhooks/resend',{method:'POST',body}))).status,401);
  updateLetterPreference(db,owner,{in_app_enabled:true,email_enabled:true,email_address:'owner@example.com'});
  db.prepare('INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('companion',owner,'test-key','Alex','normal',1,1);
  db.prepare('INSERT INTO letters(id,visitor_id,companion_id,companion_name,subject,body,kind,local_date,trigger_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('letter',owner,'companion','Alex','Hello','Private content','L0','2026-10-08','date-key',1);
  db.prepare("INSERT INTO letter_outbox(id,letter_id,visitor_id,recipient,provider,status,available_at,provider_message_id,created_at,updated_at) VALUES(?,?,?,?,'resend','accepted',?,?,?,?)").run('outbox','letter',owner,'owner@example.com',1,'receipt-id',1,1);
  const eventId='event-test';const timestamp=String(Math.floor(Date.now()/1000));const signature=createHmac('sha256',secret).update(`${eventId}.${timestamp}.${body}`).digest('base64');
  for(let i=0;i<2;i++){const response=await webhook.POST(new Request('http://127.0.0.1:5000/api/webhooks/resend',{method:'POST',headers:{'svix-id':eventId,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`},body}));assert.equal(response.status,200);}
  assert.equal(getLetterPreference(db,owner).email_enabled,false);assert.equal(getLetterPreference(db,owner).in_app_enabled,true);assert.equal((db.prepare('SELECT count(*) AS count FROM letter_webhook_events').get() as {count:number}).count,1);
 }finally{cleanup();}
});
