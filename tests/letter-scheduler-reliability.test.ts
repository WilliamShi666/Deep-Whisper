import assert from 'node:assert/strict';
import test from 'node:test';
import {processLetterJobs} from '../src/lib/letters/personal-scheduler';
import {EmailSendError} from '../src/lib/email/providers/smtp-email-provider';
import {getLetterPreference,listPersonalLetters} from '../src/lib/letters/personal-repository';
import {personalLettersFixture,enableLetterCopies,letterTestDraft,LETTER_TEST_NOW,LETTER_TEST_SMTP} from './support/personal-letters';

test('a definite transient rejection respects backoff and stops after three attempts',async()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);let calls=0;const send=async()=>{calls++;throw new EmailSendError('temporary rejection','rejected',true);};
  for(const minutes of [0,29,30,59,60,180])await processLetterJobs(db,{now:new Date(LETTER_TEST_NOW.getTime()+minutes*60_000),env:LETTER_TEST_SMTP,writeLetter:letterTestDraft,send});
  assert.equal(calls,3);assert.deepEqual(db.prepare('SELECT status,attempts FROM letter_outbox').get(),{status:'failed',attempts:3});assert.equal(listPersonalLetters(db,owner).length,1);
 }finally{db.close();}
});
test('a permanent rejection and an accepted submission are both never automatically retried',async()=>{
 for(const accepted of [false,true]) {
  const {db,owner}=personalLettersFixture();try {
   enableLetterCopies(db,owner);let calls=0;const send=async()=>{calls++;if(!accepted)throw new EmailSendError('authentication failed','rejected');return {provider:'smtp' as const,providerMessageId:'smtp-accepted'};};
   for(const minutes of [0,30,120])await processLetterJobs(db,{now:new Date(LETTER_TEST_NOW.getTime()+minutes*60_000),env:LETTER_TEST_SMTP,writeLetter:letterTestDraft,send});
   assert.equal(calls,1);assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,accepted?'accepted':'failed');assert.equal(getLetterPreference(db,owner).in_app_enabled,true);
  }finally{db.close();}
 }
});
test('reclaiming an expired generation lease fences the interrupted writer before commit',async()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);let release!:()=>void;const paused=new Promise<void>(resolve=>{release=resolve;});let calls=0;
  const first=processLetterJobs(db,{now:LETTER_TEST_NOW,env:{EMAIL_PROVIDER:'none'},writeLetter:async input=>{calls++;await paused;return letterTestDraft(input);}});
  await processLetterJobs(db,{now:new Date(LETTER_TEST_NOW.getTime()+121_000),env:{EMAIL_PROVIDER:'none'},writeLetter:async input=>{calls++;return letterTestDraft(input);}});
  release();await first;assert.equal(calls,2);assert.equal(listPersonalLetters(db,owner).length,1);assert.deepEqual(db.prepare('SELECT status,attempts FROM letter_jobs').get(),{status:'done',attempts:2});
 }finally{db.close();}
});
test('station copy, optional outbox and completed job commit atomically when outbox persistence fails',async()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON letter_outbox BEGIN SELECT RAISE(ABORT,'outbox disk error'); END;");
  let writes=0;const writer=async(input:Parameters<typeof letterTestDraft>[0])=>{writes++;return letterTestDraft(input);};const send=async()=>({provider:'smtp' as const,providerMessageId:'accepted'});
  const failed=await processLetterJobs(db,{now:LETTER_TEST_NOW,env:LETTER_TEST_SMTP,writeLetter:writer,send});assert.equal(failed.failed,1);assert.equal(listPersonalLetters(db,owner).length,0);assert.equal((db.prepare('SELECT status FROM letter_jobs').get() as {status:string}).status,'pending');
  db.exec('DROP TRIGGER fail_outbox');const recovered=await processLetterJobs(db,{now:new Date(LETTER_TEST_NOW.getTime()+30*60_000),env:LETTER_TEST_SMTP,writeLetter:writer,send});
  assert.equal(recovered.generated,1);assert.equal(recovered.accepted,1);assert.equal(writes,2);assert.equal(listPersonalLetters(db,owner).length,1);
 }finally{db.close();}
});
