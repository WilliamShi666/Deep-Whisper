import assert from 'node:assert/strict';
import test from 'node:test';
import {getTableName} from 'drizzle-orm';
import {letterPreferences,letterJobs,letters,letterOutbox,letterWebhookEvents} from '../src/lib/letters/personal-schema';
import {personalLettersFixture,seedAcceptedResend} from './support/personal-letters';

test('personal letter Drizzle definitions correspond to the installed SQLite tables',()=>{
 const {db,owner}=personalLettersFixture();try {
  const configured=[letterPreferences,letterJobs,letters,letterOutbox,letterWebhookEvents].map(getTableName);
  assert.deepEqual(configured,['letter_preferences','letter_jobs','letters','letter_outbox','letter_webhook_events']);
  const physical=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
  for(const name of configured)assert.ok(physical.some(row=>row.name===name),name);
  db.prepare('INSERT INTO letter_preferences(visitor_id,updated_at) VALUES(?,?)').run(owner,1);
  const defaults=db.prepare('SELECT in_app_enabled,email_enabled,email_status FROM letter_preferences').get();assert.deepEqual(defaults,{in_app_enabled:0,email_enabled:0,email_status:'paused'});
 }finally{db.close();}
});
test('SQLite enforces one station letter per owner/local day, fixed references and allowed delivery states',()=>{
 const {db,owner}=personalLettersFixture();try {
  db.prepare('INSERT INTO letter_preferences(visitor_id,updated_at) VALUES(?,?)').run(owner,1);seedAcceptedResend(db,owner);
  assert.throws(()=>db.prepare('INSERT INTO letters SELECT ?,visitor_id,companion_id,conversation_id,companion_name,subject,body,kind,local_date,?,created_at,read_at FROM letters').run('second-letter','different-trigger'),/UNIQUE/);
  assert.throws(()=>db.prepare("UPDATE letter_outbox SET status='sent'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE letter_preferences SET email_enabled=2").run(),/CHECK/);
  assert.throws(()=>db.prepare("INSERT INTO letter_preferences(visitor_id,updated_at) VALUES('absent-owner',1)").run(),/FOREIGN KEY/);
  db.prepare("DELETE FROM companions WHERE id='companion'").run();assert.equal((db.prepare('SELECT count(*) AS n FROM letters').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT count(*) AS n FROM letter_outbox').get() as {n:number}).n,0);
 }finally{db.close();}
});
