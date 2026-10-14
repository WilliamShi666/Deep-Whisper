import Database from 'better-sqlite3';
import {applyMigrations} from '../../src/storage/database/db';
import {updateLetterPreference} from '../../src/lib/letters/personal-repository';
export const LETTER_TEST_NOW=new Date('2026-10-07T16:30:00.000Z');
export const LETTER_TEST_SMTP={APP_ENV:'test',EMAIL_PROVIDER:'smtp',LETTER_DELIVERY:'both',EMAIL_FROM:'sender@example.test',SMTP_HOST:'smtp.example.test',SMTP_USER:'sender',SMTP_PASSWORD:'fixture-password'};
export function personalLettersFixture() {
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');applyMigrations(db);
 const ms=LETTER_TEST_NOW.getTime();const owner='owner';
 db.prepare('INSERT INTO visitors(id,owner_slot,locale,created_at,updated_at) VALUES(?,1,?,?,?)').run(owner,'en',ms,ms);
 db.prepare('INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('companion',owner,'deepseek_f_01','Alex','normal',ms,ms);
 db.prepare('INSERT INTO conversations(id,visitor_id,companion_id,created_at,updated_at) VALUES(?,?,?,?,?)').run('conversation',owner,'companion',ms,ms);
 db.prepare('INSERT INTO user_profiles(id,visitor_id,display_name,birthday,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('profile',owner,'Sam','1990-10-08',ms,ms);
 return {db,owner};
}
export function enableLetterCopies(db:Database.Database,owner:string) {return updateLetterPreference(db,owner,{in_app_enabled:true,email_enabled:true,email_address:'owner@example.test',timezone:'Asia/Shanghai'},LETTER_TEST_NOW.getTime());}
export async function letterTestDraft(input?:{anchors?:{id:string}[]}) {return {subject:'A birthday letter',body:'Have a lovely day. I remembered your birthday.',anchorIds:input?.anchors?.map(anchor=>anchor.id)??[]};}
export function seedAcceptedResend(db:Database.Database,owner:string,id='receipt-id') {
 const ms=LETTER_TEST_NOW.getTime();
 db.prepare('INSERT INTO letters(id,visitor_id,companion_id,conversation_id,companion_name,subject,body,kind,local_date,trigger_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('letter',owner,'companion','conversation','Alex','Hello','A station copy','L0','2026-10-08','birthday',ms);
 db.prepare("INSERT INTO letter_outbox(id,letter_id,visitor_id,recipient,provider,status,available_at,provider_message_id,created_at,updated_at) VALUES(?,?,?,?,'resend','accepted',?,?,?,?)").run('outbox','letter',owner,'owner@example.test',ms,id,ms,ms);
}
