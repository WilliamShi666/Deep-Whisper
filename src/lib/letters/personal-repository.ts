import type Database from 'better-sqlite3';

export type EmailPreferenceStatus = 'enabled' | 'paused' | 'unsubscribed' | 'suppressed';
export interface PersonalLetterPreference {
 status: 'enabled'|'paused'; is_default: boolean; in_app_enabled: boolean; email_enabled: boolean;
 email_address: string|null; email_status: EmailPreferenceStatus; timezone: string;
}
interface PreferenceRow {in_app_enabled:number;email_enabled:number;email_address:string|null;email_status:EmailPreferenceStatus;timezone:string}
export interface PersonalLetter {id:string;visitor_id:string;companion_id:string;conversation_id:string|null;companion_name:string;subject:string;body:string;kind:'L0'|'L1'|'L2';local_date:string;created_at:number;read_at:number|null}
export interface PreferencePatch {status?:'enabled'|'paused';in_app_enabled?:boolean;email_enabled?:boolean;email_address?:string|null;timezone?:string;reconsent?:boolean}
export class LetterPreferenceError extends Error {constructor(message:string,readonly status=400){super(message);this.name='LetterPreferenceError';}}
export function getLetterPreference(db:Database.Database,owner:string):PersonalLetterPreference {
 const row=db.prepare('SELECT * FROM letter_preferences WHERE visitor_id=?').get(owner) as PreferenceRow|undefined;
 return {status:row?.in_app_enabled?'enabled':'paused',is_default:!row,in_app_enabled:!!row?.in_app_enabled,email_enabled:!!row?.email_enabled,email_address:row?.email_address??null,email_status:row?.email_status??'paused',timezone:row?.timezone??'Asia/Shanghai'};
}
export function updateLetterPreference(db:Database.Database,owner:string,patch:PreferencePatch,now=Date.now()):PersonalLetterPreference {
 return db.transaction(()=>{
  const prior=getLetterPreference(db,owner);
  const email=patch.email_address===undefined?prior.email_address:patch.email_address?.trim().toLowerCase()||null;
  if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new LetterPreferenceError('Invalid recipient email');
  const timezone=patch.timezone??prior.timezone;
  try {new Intl.DateTimeFormat('en',{timeZone:timezone}).format(now);}catch {throw new LetterPreferenceError('Invalid IANA timezone');}
  const enabled=patch.in_app_enabled??(patch.status===undefined?prior.in_app_enabled:patch.status==='enabled');
  const emailEnabled=patch.email_enabled??prior.email_enabled;
  if(emailEnabled&&!email)throw new LetterPreferenceError('Save your recipient email before enabling email');
  if(emailEnabled&&(prior.email_status==='suppressed'||prior.email_status==='unsubscribed')&&patch.reconsent!==true)throw new LetterPreferenceError('Explicit confirmation required to resume email',409);
  const emailStatus=emailEnabled?'enabled':(['suppressed','unsubscribed'].includes(prior.email_status)?prior.email_status:'paused');
  db.prepare(`INSERT INTO letter_preferences(visitor_id,in_app_enabled,email_enabled,email_address,email_status,timezone,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,email_enabled=excluded.email_enabled,email_address=excluded.email_address,email_status=excluded.email_status,timezone=excluded.timezone,updated_at=excluded.updated_at`).run(owner,Number(enabled),Number(emailEnabled),email,emailStatus,timezone,now);
  if(!emailEnabled||email!==prior.email_address)db.prepare("UPDATE letter_outbox SET status='cancelled',updated_at=? WHERE visitor_id=? AND status='pending'").run(now,owner);
  return getLetterPreference(db,owner);
 })();
}
export function listPersonalLetters(db:Database.Database,owner:string,limit=50):PersonalLetter[] {
 return db.prepare('SELECT * FROM letters WHERE visitor_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(owner,Math.max(1,Math.min(limit,100))) as PersonalLetter[];
}
export function markLetterRead(db:Database.Database,owner:string,id:string,now=Date.now()):PersonalLetter|null {
 db.prepare('UPDATE letters SET read_at=coalesce(read_at,?) WHERE id=? AND visitor_id=?').run(now,id,owner);
 return db.prepare('SELECT * FROM letters WHERE id=? AND visitor_id=?').get(id,owner) as PersonalLetter|undefined??null;
}
export function suppressEmail(db:Database.Database,owner:string,status:'unsubscribed'|'suppressed',now=Date.now(),recipient?:string):void {
 db.transaction(()=>{
  if(recipient&&getLetterPreference(db,owner).email_address!==recipient)return;
  db.prepare(`INSERT INTO letter_preferences(visitor_id,email_enabled,email_status,updated_at) VALUES(?,0,?,?) ON CONFLICT(visitor_id) DO UPDATE SET email_enabled=0,email_status=excluded.email_status,updated_at=excluded.updated_at`).run(owner,status,now);
  db.prepare("UPDATE letter_outbox SET status='cancelled',updated_at=? WHERE visitor_id=? AND status='pending'").run(now,owner);
 })();
}
export interface DeliveryEvent {eventId:string;messageId:string;status:'delivered'|'bounced'|'complained'}
export function applyPersonalDeliveryEvent(db:Database.Database,event:DeliveryEvent,now=Date.now()):'processed'|'pending' {
 return db.transaction(()=>{
  db.prepare('INSERT OR IGNORE INTO letter_webhook_events(id,provider_message_id,event_type,created_at) VALUES(?,?,?,?)').run(event.eventId,event.messageId,event.status,now);
  const saved=db.prepare('SELECT * FROM letter_webhook_events WHERE id=?').get(event.eventId) as {provider_message_id:string;event_type:DeliveryEvent['status'];processed_at:number|null};
  if(saved.processed_at!==null)return 'processed';
  const delivery=db.prepare("SELECT * FROM letter_outbox WHERE provider='resend' AND provider_message_id=?").get(saved.provider_message_id) as {id:string;visitor_id:string;recipient:string;status:string}|undefined;
  if(!delivery)return 'pending';
  const status=delivery.status==='complained'||saved.event_type==='complained'?'complained':delivery.status==='bounced'||saved.event_type==='bounced'?'bounced':'delivered';
  db.prepare('UPDATE letter_outbox SET status=?,updated_at=? WHERE id=?').run(status,now,delivery.id);
  if(status==='bounced'||status==='complained')suppressEmail(db,delivery.visitor_id,'suppressed',now,delivery.recipient);
  db.prepare('UPDATE letter_webhook_events SET processed_at=? WHERE id=?').run(now,event.eventId);return 'processed';
 })();
}
export function reconcilePersonalDeliveryEvents(db:Database.Database,messageId:string,now:number):void {
 const pending=db.prepare('SELECT id,provider_message_id,event_type FROM letter_webhook_events WHERE provider_message_id=? AND processed_at IS NULL').all(messageId) as {id:string;provider_message_id:string;event_type:DeliveryEvent['status']}[];
 for(const event of pending)applyPersonalDeliveryEvent(db,{eventId:event.id,messageId:event.provider_message_id,status:event.event_type},now);
}
