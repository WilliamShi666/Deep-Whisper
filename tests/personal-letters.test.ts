import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import { lettersMigrationSql } from '../src/storage/database/migrations/0003-letters';
import { getLetterPreference, updateLetterPreference, listPersonalLetters, markLetterRead, suppressEmail, applyPersonalDeliveryEvent } from '../src/lib/letters/personal-repository';
import { processLetterJobs } from '../src/lib/letters/personal-scheduler';
import { SmtpEmailProvider } from '../src/lib/email/providers/smtp-email-provider';
import { buildPersonalLetterEmail } from '../src/lib/email/personal-template';
import { signPersonalUnsubscribeToken, verifyPersonalUnsubscribeToken } from '../src/lib/email/personal-unsubscribe-token';

const now = new Date('2026-10-07T16:30:00.000Z'); // October 8 in Shanghai
function fixture(file=':memory:') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE visitors(id TEXT PRIMARY KEY,locale TEXT);
    CREATE TABLE companions(id TEXT PRIMARY KEY,visitor_id TEXT,name TEXT);
    CREATE TABLE conversations(id TEXT PRIMARY KEY,visitor_id TEXT,companion_id TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,created_at INTEGER);
    CREATE TABLE user_profiles(visitor_id TEXT PRIMARY KEY,display_name TEXT,birthday TEXT,important_dates TEXT);
    CREATE TABLE relationship_snapshots(visitor_id TEXT,companion_id TEXT,relationship_stage TEXT,emotional_tone TEXT,dynamic_summary TEXT);
    CREATE TABLE memories(id TEXT PRIMARY KEY,visitor_id TEXT,companion_id TEXT,content TEXT,confidence TEXT,importance REAL,status TEXT,temporal_status TEXT,observed_at INTEGER,occurred_at TEXT,valid_until INTEGER,content_version INTEGER NOT NULL DEFAULT 1);
    INSERT INTO visitors VALUES('owner','en'); INSERT INTO companions VALUES('companion','owner','Alex');
    INSERT INTO conversations VALUES('conversation','owner','companion');
    INSERT INTO user_profiles VALUES('owner','Sam','1990-10-08','[]');`);
  db.exec(lettersMigrationSql);
  return db;
}
const draft = async () => ({subject:'Happy birthday',body:'I remember your special day. Have a lovely day.',anchorIds:[]});
const quietEnv = { EMAIL_PROVIDER:'none', LETTER_DELIVERY:'in-app' };

test('OSS-030 default is opt-in; Shanghai birthday creates one durable letter, restart cannot duplicate', async () => {
  const db=fixture(); let calls=0;
  assert.equal(getLetterPreference(db,'owner').in_app_enabled,false);
  await processLetterJobs(db,{now,env:quietEnv,writeLetter:async()=>{calls++;return draft();}});
  assert.equal(calls,0);
  updateLetterPreference(db,'owner',{in_app_enabled:true,timezone:'Asia/Shanghai'},now.getTime());
  await processLetterJobs(db,{now,env:quietEnv,writeLetter:async()=>{calls++;return draft();}});
  assert.equal(calls,1); assert.equal(listPersonalLetters(db,'owner').length,1);
  await processLetterJobs(db,{now,env:quietEnv,writeLetter:async()=>{calls++;return draft();}});
  assert.equal(calls,1);
  const letter=listPersonalLetters(db,'owner')[0]; assert.equal(letter.local_date,'2026-10-08');
  assert.equal(letter.read_at,null); assert.equal(markLetterRead(db,'owner',letter.id,now.getTime())?.read_at,now.getTime());
  assert.equal(markLetterRead(db,'someone-else',letter.id,now.getTime()),null); db.close();
});

test('OSS-031 missed dates are never backfilled and closed interaction window causes no AI calls', async()=>{
  const db=fixture(); updateLetterPreference(db,'owner',{in_app_enabled:true},now.getTime());
  let calls=0; await processLetterJobs(db,{now:new Date('2026-10-12T00:00:00Z'),env:quietEnv,writeLetter:async()=>{calls++;return draft();}});
  assert.equal(calls,0); assert.equal(listPersonalLetters(db,'owner').length,0); db.close();
});

test('OSS-032 emails go to the saved owner address; email failure keeps the station copy',async()=>{
  const db=fixture(); updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
  let recipient=''; const env={EMAIL_PROVIDER:'smtp',LETTER_DELIVERY:'both',EMAIL_FROM:'sender@example.com',SMTP_HOST:'smtp.example.com',SMTP_PORT:'465',SMTP_USER:'sender',SMTP_PASSWORD:'secret'};
  await processLetterJobs(db,{now,env,writeLetter:draft,send:async message=>{recipient=message.to;throw new Error('submitted then disconnected');}});
  assert.equal(recipient,'owner@example.com'); assert.equal(listPersonalLetters(db,'owner').length,1);
  assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}|undefined)?.status,'unknown');
  await processLetterJobs(db,{now:new Date(now.getTime()+600_000),env,writeLetter:draft,send:async()=>{throw new Error('must not retry unknown');}});
  assert.equal((db.prepare('SELECT attempts FROM letter_outbox').get() as {attempts:number}|undefined)?.attempts,1); db.close();
});

test('OSS-034 stopping email in-flight does not change in-app generation preference or send the queued copy',async()=>{
  const db=fixture(); updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
  let sends=0; await processLetterJobs(db,{now,env:{EMAIL_PROVIDER:'resend',LETTER_DELIVERY:'both',RESEND_API_KEY:'fake',EMAIL_FROM:'sender@example.com'},writeLetter:async()=>{suppressEmail(db,'owner','unsubscribed',now.getTime());return draft();},send:async()=>{sends++;return {provider:'resend',providerMessageId:'id'};}});
  assert.equal(sends,0); assert.equal(getLetterPreference(db,'owner').in_app_enabled,true);
  assert.equal(listPersonalLetters(db,'owner').length,1);
  assert.throws(()=>updateLetterPreference(db,'owner',{email_enabled:true},now.getTime()),/confirm/i);
  assert.equal(updateLetterPreference(db,'owner',{email_enabled:true,reconsent:true},now.getTime()).email_enabled,true); db.close();
});

test('OSS-034 replayed complaint suppresses only email; later delivered cannot undo suppression',async()=>{
  const db=fixture(); updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
  await processLetterJobs(db,{now,env:{EMAIL_PROVIDER:'resend',LETTER_DELIVERY:'both',RESEND_API_KEY:'fake',EMAIL_FROM:'sender@example.com'},writeLetter:draft,send:async()=>({provider:'resend',providerMessageId:'provider-id'})});
  applyPersonalDeliveryEvent(db,{eventId:'complaint',messageId:'provider-id',status:'complained'},now.getTime());
  applyPersonalDeliveryEvent(db,{eventId:'complaint',messageId:'provider-id',status:'complained'},now.getTime());
  applyPersonalDeliveryEvent(db,{eventId:'delivered',messageId:'provider-id',status:'delivered'},now.getTime());
  assert.equal(getLetterPreference(db,'owner').email_enabled,false); assert.equal(getLetterPreference(db,'owner').in_app_enabled,true);
  assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}|undefined)?.status,'complained'); db.close();
});

test('OSS-033 SMTP 465/587 enforce TLS and record accepted, never delivered',async()=>{
 for(const port of [465,587]) {
  let options:Record<string,unknown>={};
  const provider=new SmtpEmailProvider({EMAIL_PROVIDER:'smtp',EMAIL_FROM:'sender@example.com',SMTP_HOST:'smtp.example.com',SMTP_PORT:String(port),SMTP_USER:'sender',SMTP_PASSWORD:'secret'}, o=>{options=o;return {sendMail:async()=>({messageId:'smtp-id',accepted:['owner@example.com'],rejected:[]})};});
  const receipt=await provider.send({to:'owner@example.com',from:{address:'sender@example.com'},subject:'Hello',text:'Body',html:'<p>Body</p>'});
  assert.equal(options.secure,port===465); assert.equal(options.requireTLS,port===587); assert.equal(receipt.deliveryStatus,'accepted');
 }
});

test('OSS-034 private mail has no pretend public unsubscribe URL; signed expiry and tampering reject',()=>{
 const message=buildPersonalLetterEmail({to:'owner@example.com',fromAddress:'sender@example.com',companionName:'Alex',subject:'Hello',body:'<private>',locale:'en'});
 assert.ok(!message.headers?.['List-Unsubscribe']); assert.ok(message.html.includes('&lt;private&gt;'));
 const token=signPersonalUnsubscribeToken('owner','a-secret',now.getTime()+1000);
 assert.equal(verifyPersonalUnsubscribeToken(token,'a-secret',now.getTime()),'owner');
 assert.equal(verifyPersonalUnsubscribeToken(token+'x','a-secret',now.getTime()),null);
 assert.equal(verifyPersonalUnsubscribeToken(token,'a-secret',now.getTime()+1001),null);
});

test('OSS-033 omitted SMTP_PORT uses documented STARTTLS default; authentication rejection is definite',async()=>{
 let options:Record<string,unknown>={};
 const provider=new SmtpEmailProvider({EMAIL_FROM:'sender@example.com',SMTP_HOST:'smtp.example.com',SMTP_USER:'sender',SMTP_PASSWORD:'secret'},value=>{options=value;return {sendMail:async()=>{throw Object.assign(new Error('credentials rejected'),{code:'EAUTH',responseCode:535});}};});
 await assert.rejects(provider.send({to:'owner@example.com',from:{address:'sender@example.com'},subject:'Hello',text:'Body',html:'<p>Body</p>'}),error=>error instanceof Error&&'outcome' in error&&error.outcome==='rejected'&&'retryable' in error&&error.retryable===false);
 assert.equal(options.port,587);assert.equal(options.requireTLS,true);
});

test('OSS-030 an actual recent conversation enables three days only; stale interactions and resolved anchors never restart the window',async()=>{
 const db=fixture();db.prepare('UPDATE user_profiles SET birthday=NULL').run();
 updateLetterPreference(db,'owner',{in_app_enabled:true},now.getTime());
 db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('first','conversation','user','I have an interview soon',now.getTime()-60_000);
 db.prepare('INSERT INTO memories(id,visitor_id,companion_id,content,confidence,importance,status,temporal_status,observed_at,occurred_at,valid_until) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('memory','owner','companion','They have an interview soon','explicit',0.9,'active','ongoing',now.getTime()-60_000,null,null);
 let calls=0;const writer=async()=>{calls++;return draft();};
 for(let day=0;day<4;day++)await processLetterJobs(db,{now:new Date(now.getTime()+day*86_400_000),env:quietEnv,writeLetter:writer});
 assert.equal(calls,3);assert.equal(listPersonalLetters(db,'owner').length,3);
 await processLetterJobs(db,{now:new Date(now.getTime()+8*86_400_000),env:quietEnv,writeLetter:writer});assert.equal(calls,3);
 db.prepare("UPDATE memories SET temporal_status='resolved'").run();
 db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('return','conversation','user','Hello again',now.getTime()+8*86_400_000);
 await processLetterJobs(db,{now:new Date(now.getTime()+8*86_400_000+1000),env:quietEnv,writeLetter:writer});assert.equal(calls,3);db.close();
});

test('OSS-030 competing workers claim once; a user return before commit cancels the old job',async()=>{
 const db=fixture();updateLetterPreference(db,'owner',{in_app_enabled:true},now.getTime());let calls=0;let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const first=processLetterJobs(db,{now,env:quietEnv,writeLetter:async()=>{calls++;await blocked;return draft();}});
 await processLetterJobs(db,{now,env:quietEnv,writeLetter:async()=>{calls++;return draft();}});assert.equal(calls,1);
 db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('return','conversation','user','I am here',now.getTime()+1);release();await first;
 assert.equal(listPersonalLetters(db,'owner').length,0);assert.equal((db.prepare('SELECT status FROM letter_jobs').get() as {status:string}).status,'cancelled');db.close();
});

test('OSS-034 early webhook survives until receipt is saved; a previous recipient cannot suppress the new address',async()=>{
 const db=fixture();updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
 await processLetterJobs(db,{now,env:{EMAIL_PROVIDER:'resend',LETTER_DELIVERY:'both',RESEND_API_KEY:'fake',EMAIL_FROM:'sender@example.com'},writeLetter:draft,send:async()=>{assert.equal(applyPersonalDeliveryEvent(db,{eventId:'early',messageId:'early-id',status:'bounced'},now.getTime()),'pending');updateLetterPreference(db,'owner',{email_address:'new@example.com'},now.getTime());return {provider:'resend',providerMessageId:'early-id'};}});
 assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'bounced');assert.equal(getLetterPreference(db,'owner').email_enabled,true);assert.equal(getLetterPreference(db,'owner').email_address,'new@example.com');db.close();
});

test('OSS-031 a queued email after sleep is cancelled rather than sending historical copies',async()=>{
 const db=fixture();updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
 const env={EMAIL_PROVIDER:'resend',LETTER_DELIVERY:'both',RESEND_API_KEY:'fake',EMAIL_FROM:'sender@example.com'};
 const {EmailSendError}=await import('../src/lib/email/providers/smtp-email-provider');
 await processLetterJobs(db,{now,env,writeLetter:draft,send:async()=>{throw new EmailSendError('server is temporarily busy','rejected',true);}});
 let sends=0;await processLetterJobs(db,{now:new Date(now.getTime()+5*86_400_000),env,writeLetter:draft,send:async()=>{sends++;return {provider:'resend',providerMessageId:'should-not-send'};}});
 assert.equal(sends,0);assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'cancelled');db.close();
});

test('OSS-030/033 durable restart keeps one station copy and quarantines an expired submission lease',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'deep-whisper-letter-restart-'));const filename=path.join(dir,'letters.sqlite');let db=fixture(filename);
 try {
  updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
  const env={EMAIL_PROVIDER:'smtp',LETTER_DELIVERY:'both',EMAIL_FROM:'sender@example.com',SMTP_HOST:'smtp.example.com',SMTP_USER:'sender',SMTP_PASSWORD:'secret'};
  const {EmailSendError}=await import('../src/lib/email/providers/smtp-email-provider');
  await processLetterJobs(db,{now,env,writeLetter:draft,send:async()=>{throw new EmailSendError('busy','rejected',true);}});
  db.prepare("UPDATE letter_outbox SET status='sending',lease_token='interrupted',lease_expires_at=?").run(now.getTime()+1000);db.close();
  db=new Database(filename);let sends=0;let writes=0;
  await processLetterJobs(db,{now:new Date(now.getTime()+600_000),env,writeLetter:async()=>{writes++;return draft();},send:async()=>{sends++;return {provider:'smtp',providerMessageId:'must-not-resend'};}});
  assert.equal(sends,0);assert.equal(writes,0);assert.equal(listPersonalLetters(db,'owner').length,1);assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'unknown');
 }finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('OSS-032 conflicting none+both mail configuration disables forwarding while preserving core station generation',async()=>{
 const db=fixture();try {updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());let sends=0;
 await processLetterJobs(db,{now,env:{EMAIL_PROVIDER:'none',LETTER_DELIVERY:'both'},writeLetter:draft,send:async()=>{sends++;return {provider:'resend',providerMessageId:'disabled'};}});
 assert.equal(sends,0);assert.equal(listPersonalLetters(db,'owner').length,1);assert.equal((db.prepare('SELECT count(*) AS count FROM letter_outbox').get() as {count:number}).count,0);
 }finally{db.close();}
});

test('OSS-036 maintenance stops new letter claims but permits an in-flight station commit without starting email',async()=>{
 const {enterMaintenance}=await import('../src/lib/personal/maintenance');
 const dir=mkdtempSync(path.join(tmpdir(),'deep-whisper-letter-maintenance-'));const db=fixture(path.join(dir,'letters.sqlite'));let leave:()=>void=()=>{};
 try {
  updateLetterPreference(db,'owner',{in_app_enabled:true,email_address:'owner@example.com',email_enabled:true},now.getTime());
  const env={APP_DATA_DIR:dir,EMAIL_PROVIDER:'smtp',LETTER_DELIVERY:'both',EMAIL_FROM:'sender@example.com',SMTP_HOST:'smtp.example.com',SMTP_USER:'sender',SMTP_PASSWORD:'secret'};
  let writes=0;let sends=0;leave=enterMaintenance(dir);
  await processLetterJobs(db,{now,env,writeLetter:async()=>{writes++;return draft();},send:async()=>{sends++;return {provider:'smtp',providerMessageId:'id'};}});
  assert.equal(writes,0);leave();leave=()=>{};
  await processLetterJobs(db,{now,env,writeLetter:async()=>{writes++;leave=enterMaintenance(dir);return draft();},send:async()=>{sends++;return {provider:'smtp',providerMessageId:'id'};}});
  assert.equal(writes,1);assert.equal(sends,0);assert.equal(listPersonalLetters(db,'owner').length,1);assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'pending');
 }finally{leave();db.close();rmSync(dir,{recursive:true,force:true});}
});
