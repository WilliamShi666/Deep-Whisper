import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import {createCoreRepository} from '../src/lib/personal/core-repository';
import {persistSqliteMemory,updateSqliteMemory,PERSONAL_MEMORY_APP_ID} from '../src/lib/memory/sqlite-gateway';
import {processLetterJobs,type LetterJobOptions} from '../src/lib/letters/personal-scheduler';
import {listPersonalLetters} from '../src/lib/letters/personal-repository';
import {EmailSendError} from '../src/lib/email/providers/smtp-email-provider';
import {personalLettersFixture,enableLetterCopies,LETTER_TEST_NOW,LETTER_TEST_SMTP} from './support/personal-letters';

const ms=LETTER_TEST_NOW.getTime();
const privateFact='My confidential appointment is at the private clinic.';
function sourceFixture() {
 const fixture=personalLettersFixture();const {db,owner}=fixture;const repo=createCoreRepository(db);
 repo.saveProfile(owner,{birthday:null});
 repo.createConversation(owner,'companion',{id:'source-A',title:'Source'});
 repo.insertMessage(owner,'conversation',{id:'latest-B-user',role:'user',content:'Hello',created_at:new Date(ms-60_000).toISOString()});
 const memory=persistSqliteMemory(db,privateFact,{userId:owner,appId:PERSONAL_MEMORY_APP_ID,metadata:{visitor_id:owner,companion_id:'companion',source_conversation_id:'source-A',layer:'L3',bucket:'key_detail',domain:'life',memory_type:'event',importance:0.9,confidence:'explicit',temporal_status:'ongoing',observed_at:new Date(ms-30_000).toISOString()}},{now:LETTER_TEST_NOW});
 enableLetterCopies(db,owner);return {...fixture,repo,memoryId:memory.id};
}
const draft=(input:Parameters<NonNullable<LetterJobOptions['writeLetter']>>[0])=>({subject:'Thinking of you',body:input.anchors[0].text,anchorIds:input.anchors.map(anchor=>anchor.id)});
function jobStatus(db:Database.Database) {return (db.prepare('SELECT status FROM letter_jobs').get() as {status:string}).status;}
const receipt={provider:'smtp' as const,providerMessageId:'fixture-receipt'};

test('review R4 actual deletion of source A during writing cannot revive its fact through target B or email',async()=>{
 const {db,owner,repo,memoryId}=sourceFixture();try {
  let calls=0;let sends=0;
  const result=await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async input=>{calls++;assert.equal(input.anchors[0].id,memoryId);const deleted=repo.deleteConversation(owner,'source-A');assert.equal(deleted?.forget.status,'cleared');assert.equal(db.prepare('SELECT id FROM memories WHERE id=?').get(memoryId),undefined);return draft(input);},send:async()=>{sends++;return receipt;}});
  assert.equal(calls,1);assert.equal(result.generated,0);assert.equal(sends,0);assert.equal(listPersonalLetters(db,owner).length,0);assert.equal(jobStatus(db),'cancelled');
 }finally{db.close();}
});

test('review R4 changed memory content/version, eligibility or event timing fences old writer output',async()=>{
 const mutations=[
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{text:'The appointment was corrected.'},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{text:privateFact},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{metadata:{status:'retired'}},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{metadata:{temporal_status:'resolved'}},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{expirationDate:LETTER_TEST_NOW.toISOString()},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{metadata:{importance:0.1}},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>updateSqliteMemory(db,id,{metadata:{occurred_at:new Date(ms+86_400_000).toISOString(),temporal_status:'upcoming'}},{now:LETTER_TEST_NOW}),
  (db:Database.Database,id:string)=>db.prepare('DELETE FROM memories WHERE id=?').run(id),
 ];
 for(const mutate of mutations) {
  const {db,owner,memoryId}=sourceFixture();try {let sends=0;const result=await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async input=>{mutate(db,memoryId);return draft(input);},send:async()=>{sends++;return receipt;}});assert.equal(result.generated,0);assert.equal(sends,0);assert.equal(listPersonalLetters(db,owner).length,0);assert.equal(jobStatus(db),'cancelled');}finally{db.close();}
 }
});

test('review R4 an anchor that expires during writer IO is checked against the finalization clock',async()=>{
 const {db,owner,memoryId}=sourceFixture();try {
  updateSqliteMemory(db,memoryId,{expirationDate:new Date(ms+1000).toISOString()},{now:LETTER_TEST_NOW});let instant=LETTER_TEST_NOW;
  const options={now:LETTER_TEST_NOW,clock:()=>instant,env:LETTER_TEST_SMTP,writeLetter:async(input:Parameters<typeof draft>[0])=>{instant=new Date(ms+1001);return draft(input);},send:async()=>receipt} as LetterJobOptions;
  const result=await processLetterJobs(db,options);assert.equal(result.generated,0);assert.equal(listPersonalLetters(db,owner).length,0);assert.equal(jobStatus(db),'cancelled');
 }finally{db.close();}
});

test('review R4 stale queued retries are cancelled before any second writer call',async()=>{
 for(const remove of [false,true]) {
  const {db,owner,repo,memoryId}=sourceFixture();try {
   let calls=0;await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async()=>{calls++;throw new Error('fixture writer failure');}});assert.equal(jobStatus(db),'pending');
   if(remove)repo.deleteConversation(owner,'source-A');else updateSqliteMemory(db,memoryId,{text:'Corrected detail'},{now:LETTER_TEST_NOW});
   await processLetterJobs(db,{now:new Date(ms+30*60_000),env:LETTER_TEST_SMTP,writeLetter:async input=>{calls++;return draft(input);},send:async()=>receipt});
   assert.equal(calls,1);assert.equal(jobStatus(db),'cancelled');assert.equal(listPersonalLetters(db,owner).length,0);
  }finally{db.close();}
 }
});

test('review R4 profile birthday/date removal or correction cannot persist captured date output',async()=>{
 for(const mutation of ['birthday','profile-delete','date-remove','date-description','date-value'] as const) {
  const {db,owner}=personalLettersFixture();const repo=createCoreRepository(db);try {
   if(mutation.startsWith('date-'))repo.saveProfile(owner,{birthday:null,important_dates:[{type:'anniversary',date:'2026-10-08',description:'my private anniversary',recurring:false}]});
   enableLetterCopies(db,owner);let sends=0;
   const result=await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async input=>{
    if(mutation==='birthday')repo.saveProfile(owner,{birthday:'1990-10-09'});
    if(mutation==='profile-delete')db.prepare('DELETE FROM user_profiles WHERE visitor_id=?').run(owner);
    if(mutation==='date-remove')repo.saveProfile(owner,{important_dates:[]});
    if(mutation==='date-description')repo.saveProfile(owner,{important_dates:[{type:'anniversary',date:'2026-10-08',description:'a corrected public anniversary',recurring:false}]});
    if(mutation==='date-value')repo.saveProfile(owner,{important_dates:[{type:'anniversary',date:'2026-10-09',description:'my private anniversary',recurring:false}]});
    return draft(input);
   },send:async()=>{sends++;return receipt;}});
   assert.equal(result.generated,0,mutation);assert.equal(sends,0,mutation);assert.equal(listPersonalLetters(db,owner).length,0,mutation);assert.equal(jobStatus(db),'cancelled',mutation);
  }finally{db.close();}
 }
});

test('review R4 queued profile source changes and a foreign companion anchor never reach the writer',async()=>{
 for(const mutation of ['profile','foreign-companion','missing-source'] as const) {
  const {db,owner,repo}=sourceFixture();try {
   if(mutation==='profile')repo.saveProfile(owner,{birthday:'1990-10-08'});
   let calls=0;await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async()=>{calls++;throw new Error('fixture writer failure');}});
   if(mutation==='profile')repo.saveProfile(owner,{birthday:null});
   else {
    const row=db.prepare('SELECT id,payload FROM letter_jobs').get() as {id:string;payload:string};const payload=JSON.parse(row.payload);
    if(mutation==='missing-source')delete payload.source;
    else {db.prepare('INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('other-companion',owner,'deepseek_m_01','Other','normal',ms,ms);const other=persistSqliteMemory(db,'An unrelated companion fact',{userId:owner,appId:PERSONAL_MEMORY_APP_ID,metadata:{visitor_id:owner,companion_id:'other-companion',layer:'L3',bucket:'key_detail',domain:'life',memory_type:'event',importance:0.9,confidence:'explicit',temporal_status:'ongoing'}},{now:LETTER_TEST_NOW});payload.input.anchors=[{id:other.id,text:'An unrelated companion fact',kind:'L2'}];if(payload.source)payload.source.id=other.id;}
    db.prepare('UPDATE letter_jobs SET payload=? WHERE id=?').run(JSON.stringify(payload),row.id);
   }
   await processLetterJobs(db,{now:new Date(ms+30*60_000),env:LETTER_TEST_SMTP,writeLetter:async input=>{calls++;return draft(input);},send:async()=>receipt});
   assert.equal(calls,1,mutation);assert.equal(jobStatus(db),'cancelled',mutation);
  }finally{db.close();}
 }
});

test('review R4 withdrawn source cancels an email retry and leaves the earlier station copy inert',async()=>{
 for(const mutation of ['memory-delete','memory-correct','birthday'] as const) {
  const {db,owner,repo,memoryId}=sourceFixture();try {
   if(mutation==='birthday')repo.saveProfile(owner,{birthday:'1990-10-08'});let sends=0;
   await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async input=>draft(input),send:async()=>{sends++;throw new EmailSendError('fixture busy','rejected',true);}});
   assert.equal(listPersonalLetters(db,owner).length,1);
   if(mutation==='memory-delete')repo.deleteConversation(owner,'source-A');
   if(mutation==='memory-correct')updateSqliteMemory(db,memoryId,{text:'Corrected detail'},{now:LETTER_TEST_NOW});
   if(mutation==='birthday')repo.saveProfile(owner,{birthday:null});
   await processLetterJobs(db,{now:new Date(ms+30*60_000),env:LETTER_TEST_SMTP,writeLetter:async input=>draft(input),send:async()=>{sends++;return receipt;}});
   assert.equal(sends,1,mutation);assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'cancelled',mutation);assert.equal(listPersonalLetters(db,owner).length,1,mutation);
  }finally{db.close();}
 }
});

test('review R4 source withdrawn as outbox is claimed is rechecked immediately before provider submission',async()=>{
 const {db,owner}=sourceFixture();try {
  db.exec("CREATE TRIGGER revoke_at_email_claim AFTER UPDATE OF status ON letter_outbox WHEN NEW.status='sending' BEGIN DELETE FROM memories; END;");let sends=0;
  const result=await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:async input=>draft(input),send:async()=>{sends++;return receipt;}});
  assert.equal(result.generated,1);assert.equal(sends,0);assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'cancelled');assert.equal(listPersonalLetters(db,owner).length,1);
 }finally{db.close();}
});
