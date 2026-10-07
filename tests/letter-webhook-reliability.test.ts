import assert from 'node:assert/strict';
import test from 'node:test';
import {applyPersonalDeliveryEvent,reconcilePersonalDeliveryEvents,getLetterPreference} from '../src/lib/letters/personal-repository';
import {personalLettersFixture,enableLetterCopies,seedAcceptedResend,LETTER_TEST_NOW} from './support/personal-letters';

test('a suppression failure rolls back the receipt and can be safely replayed',()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);seedAcceptedResend(db,owner);
  db.exec("CREATE TRIGGER fail_suppression BEFORE UPDATE OF email_enabled ON letter_preferences BEGIN SELECT RAISE(ABORT,'preference disk error'); END;");
  const event={eventId:'bounce',messageId:'receipt-id',status:'bounced' as const};assert.throws(()=>applyPersonalDeliveryEvent(db,event,LETTER_TEST_NOW.getTime()),/preference disk error/);
  assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'accepted');assert.equal(getLetterPreference(db,owner).email_enabled,true);assert.equal((db.prepare('SELECT count(*) AS n FROM letter_webhook_events').get() as {n:number}).n,0);
  db.exec('DROP TRIGGER fail_suppression');assert.equal(applyPersonalDeliveryEvent(db,event,LETTER_TEST_NOW.getTime()),'processed');assert.equal(getLetterPreference(db,owner).email_enabled,false);assert.equal(getLetterPreference(db,owner).in_app_enabled,true);
 }finally{db.close();}
});
test('failure to mark a receipt processed cannot leave a partially suppressed state',()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);seedAcceptedResend(db,owner);db.exec("CREATE TRIGGER fail_processed BEFORE UPDATE OF processed_at ON letter_webhook_events BEGIN SELECT RAISE(ABORT,'receipt disk error'); END;");
  const event={eventId:'complaint',messageId:'receipt-id',status:'complained' as const};assert.throws(()=>applyPersonalDeliveryEvent(db,event),/receipt disk error/);assert.equal(getLetterPreference(db,owner).email_enabled,true);
  db.exec('DROP TRIGGER fail_processed');applyPersonalDeliveryEvent(db,event);assert.equal(getLetterPreference(db,owner).email_status,'suppressed');assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'complained');
 }finally{db.close();}
});
test('receipt reconciliation targets the exact message id and is never starved by unrelated early events',()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);for(let n=0;n<30;n++)applyPersonalDeliveryEvent(db,{eventId:`other-${n}`,messageId:`external-${n}`,status:'delivered'},1);
  const early={eventId:'early',messageId:'receipt-id',status:'bounced' as const};assert.equal(applyPersonalDeliveryEvent(db,early,LETTER_TEST_NOW.getTime()),'pending');seedAcceptedResend(db,owner);reconcilePersonalDeliveryEvents(db,'receipt-id',LETTER_TEST_NOW.getTime());
  assert.equal((db.prepare("SELECT processed_at FROM letter_webhook_events WHERE id='early'").get() as {processed_at:number}).processed_at,LETTER_TEST_NOW.getTime());assert.equal(getLetterPreference(db,owner).email_enabled,false);
  assert.equal((db.prepare('SELECT count(*) AS n FROM letter_webhook_events WHERE processed_at IS NULL').get() as {n:number}).n,30);
 }finally{db.close();}
});
test('delivered, bounced and complained move monotonically and replays do not change station preference',()=>{
 const {db,owner}=personalLettersFixture();try {
  enableLetterCopies(db,owner);seedAcceptedResend(db,owner);
  for(const status of ['delivered','bounced','delivered','complained','bounced','delivered'] as const)applyPersonalDeliveryEvent(db,{eventId:`event-${status}`,messageId:'receipt-id',status});
  assert.equal((db.prepare('SELECT status FROM letter_outbox').get() as {status:string}).status,'complained');assert.equal(getLetterPreference(db,owner).email_enabled,false);assert.equal(getLetterPreference(db,owner).in_app_enabled,true);assert.equal((db.prepare('SELECT count(*) AS n FROM letter_webhook_events').get() as {n:number}).n,3);
 }finally{db.close();}
});
