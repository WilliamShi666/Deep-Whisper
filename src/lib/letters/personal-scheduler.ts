import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getPersonalConfig, getLetterPublicBaseUrl, type RuntimeEnvironment } from '@/lib/config/runtime';
import { getEmailProvider } from '@/lib/email/registry';
import type { EmailMessage, EmailReceipt } from '@/lib/email/contracts';
import { EmailSendError } from '@/lib/email/providers/smtp-email-provider';
import { ResendHttpError } from '@/lib/email/providers/resend-email-provider';
import { buildPersonalLetterEmail } from '@/lib/email/personal-template';
import { signPersonalUnsubscribeToken } from '@/lib/email/personal-unsubscribe-token';
import { getPrivateSecret } from '@/lib/personal/secrets';
import { maintenanceActive } from '@/lib/personal/maintenance';
import { assertInstanceOwnership } from '@/lib/personal/instance-lock';
import { BIRTHDAY_DESCRIPTION } from '@/lib/profile/important-dates';
import type { ImportantDate } from '@/lib/types';
import type { RecalledMemory } from '@/lib/memory';
import { selectImportantDateLetter } from './important-dates';
import { buildLetterTriggerKey, decideLetterEligibility, selectLetterAnchor } from './policy';
import { writeGroundedLetter } from './writer';
import { getLetterPreference, reconcilePersonalDeliveryEvents, type PersonalLetter } from './personal-repository';
import { captureLetterSource, letterSourceIsCurrent, type LetterSource } from './personal-source';

type WriterInput = Parameters<typeof writeGroundedLetter>[0];
interface Job { id:string; visitor_id:string; companion_id:string; conversation_id:string; local_date:string; payload:string; lease_token:string|null; attempts:number }
interface Payload { input:WriterInput; lastUserMessageAt:number|null; source?:LetterSource }
interface Outbox {id:string; visitor_id:string; letter_id:string; recipient:string; provider:'smtp'|'resend'; attempts:number; lease_token:string|null}
export interface LetterJobOptions { now?:Date; clock?:()=>Date; env?:RuntimeEnvironment; writeLetter?:(input:WriterInput)=>ReturnType<typeof writeGroundedLetter>; send?:(message:EmailMessage)=>Promise<EmailReceipt> }
export interface LetterJobResult {generated:number;accepted:number;failed:number;unknown:number}
const LEASE_MS=120_000;
const RETRY_MS=30*60_000;

export function letterLocalDate(now:Date,timezone:string):string {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(key=>parts.find(part=>part.type===key)!.value).join('-');
}
function dates(value:string|null):ImportantDate[] {try {const parsed=JSON.parse(value??'[]');return Array.isArray(parsed)?parsed.filter(entry=>entry&&typeof entry==='object'&&typeof entry.date==='string'&&typeof entry.type==='string'):[];}catch{return [];}}
function latestUserMessage(db:Database.Database,owner:string):number|null {
 return (db.prepare("SELECT max(m.created_at) AS value FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.visitor_id=? AND m.role='user'").get(owner) as {value:number|null}).value;
}
function hasLetterToday(db:Database.Database,owner:string,now:Date,timezone:string):boolean {
 // Re-evaluate stored instants in the current timezone as well as the original date,
 // so changing timezone cannot generate a second letter on the same local day.
 const today=letterLocalDate(now,timezone);
 const rows=db.prepare('SELECT local_date,created_at FROM letters WHERE visitor_id=? AND created_at>=?').all(owner,now.getTime()-48*60*60_000) as {local_date:string;created_at:number}[];
 return rows.some(row=>row.local_date===today||letterLocalDate(new Date(row.created_at),timezone)===today);
}
function queueToday(db:Database.Database,now:Date):void {
 const owners=db.prepare('SELECT id,locale FROM visitors').all() as {id:string;locale:string|null}[];
 for(const owner of owners) {
  const pref=getLetterPreference(db,owner.id); if(!pref.in_app_enabled)continue;
  const localDate=letterLocalDate(now,pref.timezone);
  if(hasLetterToday(db,owner.id,now,pref.timezone))continue;
  const target=db.prepare("SELECT c.id AS conversation_id,c.companion_id,p.name,max(m.created_at) AS interaction FROM conversations c JOIN companions p ON p.id=c.companion_id LEFT JOIN messages m ON m.conversation_id=c.id AND m.role='user' WHERE c.visitor_id=? GROUP BY c.id ORDER BY interaction DESC,c.id DESC LIMIT 1").get(owner.id) as {conversation_id:string;companion_id:string;name:string;interaction:number|null}|undefined;
  if(!target)continue;
  const latest=latestUserMessage(db,owner.id);
  const state=db.prepare('SELECT window_started_at,last_interaction_at FROM letter_preferences WHERE visitor_id=?').get(owner.id) as {window_started_at:number|null;last_interaction_at:number|null};
  let window=state.window_started_at;
  if(latest!==null&&(state.last_interaction_at===null||latest>state.last_interaction_at)) {
   // Base the window on the actual interaction. Sleeping for a week cannot reopen it.
   window=latest;db.prepare('UPDATE letter_preferences SET window_started_at=?,last_interaction_at=?,updated_at=? WHERE visitor_id=?').run(window,latest,now.getTime(),owner.id);
  }
  const profile=db.prepare('SELECT display_name,birthday,important_dates FROM user_profiles WHERE visitor_id=?').get(owner.id) as {display_name:string|null;birthday:string|null;important_dates:string|null}|undefined;
  const importantDates=dates(profile?.important_dates??null);
  if(profile?.birthday)importantDates.unshift({type:'birthday',date:profile.birthday,description:BIRTHDAY_DESCRIPTION,recurring:true});
  const importantDate=selectImportantDateLetter(importantDates,localDate);
  const rows=db.prepare("SELECT * FROM memories WHERE visitor_id=? AND companion_id=? AND status='active' AND (valid_until IS NULL OR valid_until>?) ORDER BY observed_at DESC LIMIT 100").all(owner.id,target.companion_id,now.getTime()) as {id:string;content:string;confidence:RecalledMemory['confidence'];importance:number;temporal_status:RecalledMemory['temporalStatus'];time_precision?:string|null;observed_at:number|null;occurred_at:string|number|null;valid_until:number|null}[];
  const memories=rows.map(row=>{
   const occurredAt=typeof row.occurred_at==='number'?new Date(row.occurred_at).toISOString():row.occurred_at;
   const due=occurredAt&&(row.time_precision==='day'?occurredAt.slice(0,10)<localDate:Date.parse(occurredAt)<=now.getTime());
   return {id:row.id,text:row.content,importance:row.importance,confidence:row.confidence,temporalStatus:row.temporal_status==='upcoming'&&due?'follow_up_due':row.temporal_status,observedAt:row.observed_at!==null?new Date(row.observed_at).toISOString():null,occurredAt,validUntil:row.valid_until!==null?new Date(row.valid_until).toISOString():null,score:null};
  }) as RecalledMemory[];
  // The existing selector compares civil dates. Supply today's local date while
  // retaining the actual instant for expiry/window decisions below.
  let anchor=selectLetterAnchor(memories,now,window?new Date(window).toISOString():null);
  if(anchor) {
   const memory=memories.find(memory=>memory.id===anchor!.id);
   if(memory?.temporalStatus==='upcoming')anchor={...anchor,kind:memory.occurredAt?.slice(0,10)===localDate?'L0':'L2'};
  }
  const locale=owner.locale==='en'?'en':'zh-CN';
  const decision=decideLetterEligibility({preferenceStatus:'enabled',anchor,windowStartedAt:window?new Date(window).toISOString():null,importantDate,now,locale});
  if(decision.skipReason||!decision.anchor||!decision.kind)continue;
  const relation=db.prepare('SELECT relationship_stage,emotional_tone,dynamic_summary FROM relationship_snapshots WHERE visitor_id=? AND companion_id=?').get(owner.id,target.companion_id) as {relationship_stage:string|null;emotional_tone:string|null;dynamic_summary:string|null}|undefined;
  const source=captureLetterSource(db,owner.id,target.companion_id,decision.anchor,!!importantDate);
  if(!source)continue;
  const payload:Payload={lastUserMessageAt:latest,source,input:{companionName:target.name,userName:profile?.display_name,kind:decision.kind,anchors:[decision.anchor],isWindowEnd:decision.isWindowEnd,importantDateDescription:importantDate?.description,relationship:relation?{stage:relation.relationship_stage,tone:relation.emotional_tone,summary:relation.dynamic_summary}:null,locale,timeoutMs:60_000}};
  db.prepare('INSERT OR IGNORE INTO letter_jobs(id,visitor_id,companion_id,conversation_id,local_date,trigger_key,payload,available_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),owner.id,target.companion_id,target.conversation_id,localDate,buildLetterTriggerKey(decision.kind,decision.anchor.id,localDate),JSON.stringify(payload),now.getTime(),now.getTime());
 }
}
function publicUnsubscribeUrl(owner:string,env:RuntimeEnvironment):string|undefined {
 // No public origin means no invented callback. A loopback app remains usable.
 if(!env.LETTER_PUBLIC_BASE_URL?.trim())return undefined;
 const base=new URL(getLetterPublicBaseUrl(env)); if(base.protocol!=='https:')return undefined;
 const url=new URL('/api/letters/unsubscribe',base);
 url.searchParams.set('token',signPersonalUnsubscribeToken(owner,getPrivateSecret('unsubscribe',getPersonalConfig(env,{strict:false}).dataDir)));
 return url.toString();
}
function parsePayload(value:string):Payload|null {
 try {const payload=JSON.parse(value) as Payload;return payload&&payload.input&&Array.isArray(payload.input.anchors)?payload:null;}catch{return null;}
}
function sourceCurrent(db:Database.Database,job:Job,payload:Payload|null,now:Date):boolean {
 if(!payload)return false;
 return letterSourceIsCurrent(db,{owner:job.visitor_id,companion:job.companion_id,conversation:job.conversation_id,localDate:job.local_date,writer:payload.input,source:payload.source},now);
}
function emailSourceCurrent(db:Database.Database,row:Outbox,now:Date):boolean {
 const job=db.prepare("SELECT j.* FROM letters l JOIN letter_jobs j ON j.visitor_id=l.visitor_id AND j.companion_id=l.companion_id AND j.local_date=l.local_date AND j.trigger_key=l.trigger_key WHERE l.id=? AND l.visitor_id=? AND j.status='done'").get(row.letter_id,row.visitor_id) as Job|undefined;
 return !!job&&sourceCurrent(db,job,parsePayload(job.payload),now);
}
/** Local worker entry point; schema installation and lifecycle belong to the launcher. */
export async function processLetterJobs(db:Database.Database,options:LetterJobOptions={}):Promise<LetterJobResult> {
 const clock=options.clock??(options.now?()=>options.now!:()=>new Date());
 const now=clock();const ms=now.getTime();const env=options.env??process.env;
 const config=getPersonalConfig(env,{strict:false});const writer=options.writeLetter??writeGroundedLetter;
 const result:LetterJobResult={generated:0,accepted:0,failed:0,unknown:0};
 const paused=()=>db.name!==':memory:'&&maintenanceActive(path.dirname(db.name));
 const fence=()=>assertInstanceOwnership(path.dirname(db.name));
 fence();
 if(paused())return result;
 db.prepare("UPDATE letter_jobs SET status='pending',lease_token=NULL,lease_expires_at=NULL WHERE status='running' AND lease_expires_at<=?").run(ms);
 result.unknown+=db.prepare("UPDATE letter_outbox SET status='unknown',last_error='submission interrupted; delivery outcome unknown',updated_at=?,lease_token=NULL,lease_expires_at=NULL WHERE status='sending' AND lease_expires_at<=?").run(ms,ms).changes;
 const canGenerate=!!options.writeLetter||config.capabilities.chat.enabled;
 if(canGenerate&&!paused())queueToday(db,now);
 const jobs=canGenerate?db.prepare("SELECT * FROM letter_jobs WHERE status='pending' AND available_at<=? ORDER BY created_at LIMIT 10").all(ms) as Job[]:[];
 for(const job of jobs) {
  fence();
  if(paused())break;
  const claimNow=clock();
  const pref=getLetterPreference(db,job.visitor_id);
  const payload=parsePayload(job.payload);
  if(!pref.in_app_enabled||job.local_date!==letterLocalDate(claimNow,pref.timezone)||hasLetterToday(db,job.visitor_id,claimNow,pref.timezone)) {db.prepare("UPDATE letter_jobs SET status='cancelled' WHERE id=? AND status='pending'").run(job.id);continue;}
  const token=randomUUID();
  const claimed=db.transaction(()=>{
   if(!sourceCurrent(db,job,payload,claimNow)||latestUserMessage(db,job.visitor_id)!==payload?.lastUserMessageAt) {db.prepare("UPDATE letter_jobs SET status='cancelled',last_error='letter source withdrawn' WHERE id=? AND status='pending'").run(job.id);return false;}
   return !!db.prepare("UPDATE letter_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_expires_at=? WHERE id=? AND status='pending'").run(token,claimNow.getTime()+LEASE_MS,job.id).changes;
  }).immediate();
  if(!claimed||!payload)continue;
  try {
   const draft=await writer(payload.input);
   db.transaction(()=>{
    fence();
    const commitNow=clock();const commitMs=commitNow.getTime();
    const current=getLetterPreference(db,job.visitor_id);
    const live=db.prepare('SELECT * FROM letter_jobs WHERE id=? AND lease_token=? AND status=\'running\'').get(job.id,token) as {companion_id:string;conversation_id:string;trigger_key:string}|undefined;
    if(!live)return;
    const userReturned=latestUserMessage(db,job.visitor_id)!==payload.lastUserMessageAt;
    if(!current.in_app_enabled||userReturned||hasLetterToday(db,job.visitor_id,commitNow,current.timezone)||job.local_date!==letterLocalDate(commitNow,current.timezone)||!sourceCurrent(db,job,payload,commitNow)) {db.prepare("UPDATE letter_jobs SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,last_error='letter source or eligibility changed' WHERE id=?").run(job.id);return;}
    const id=randomUUID();db.prepare('INSERT INTO letters(id,visitor_id,companion_id,conversation_id,companion_name,subject,body,kind,local_date,trigger_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,job.visitor_id,live.companion_id,live.conversation_id,payload.input.companionName,draft.subject,draft.body,payload.input.kind,job.local_date,live.trigger_key,commitMs);
    if(config.capabilities.email.enabled&&config.letterDelivery!=='in-app'&&current.email_enabled&&current.email_address&&config.providers.email.provider!=='none')db.prepare('INSERT INTO letter_outbox(id,letter_id,visitor_id,recipient,provider,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,job.visitor_id,current.email_address,config.providers.email.provider,commitMs,commitMs,commitMs);
    db.prepare("UPDATE letter_jobs SET status='done',lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?").run(job.id,token);result.generated++;
   }).immediate();
  }catch {
   fence();
   const retry=job.attempts+1<3;
   db.prepare("UPDATE letter_jobs SET status=?,available_at=?,last_error='letter generation failed',lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND status='running'").run(retry?'pending':'failed',ms+RETRY_MS,job.id,token);result.failed++;
  }
 }
 if(!config.capabilities.email.enabled||config.letterDelivery==='in-app')return result;
 const send=options.send??(message=>getEmailProvider(env).send(message));
 const outbox=db.prepare("SELECT * FROM letter_outbox WHERE status='pending' AND available_at<=? ORDER BY created_at LIMIT 10").all(clock().getTime()) as Outbox[];
 for(const row of outbox) {
  fence();
  if(paused())break;
  const claimNow=clock();
  const token=randomUUID();const pref=getLetterPreference(db,row.visitor_id);
  const letterDate=db.prepare('SELECT local_date FROM letters WHERE id=?').get(row.letter_id) as {local_date:string}|undefined;
  if(!pref.email_enabled||pref.email_address!==row.recipient||row.provider!==config.providers.email.provider||letterDate?.local_date!==letterLocalDate(claimNow,pref.timezone)) {db.prepare("UPDATE letter_outbox SET status='cancelled',updated_at=? WHERE id=? AND status='pending'").run(claimNow.getTime(),row.id);continue;}
  const claimed=db.transaction(()=>{
   if(!emailSourceCurrent(db,row,claimNow)) {db.prepare("UPDATE letter_outbox SET status='cancelled',last_error='letter source withdrawn',updated_at=? WHERE id=? AND status='pending'").run(claimNow.getTime(),row.id);return false;}
   return !!db.prepare("UPDATE letter_outbox SET status='sending',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='pending'").run(token,claimNow.getTime()+LEASE_MS,claimNow.getTime(),row.id).changes;
  }).immediate();
  if(!claimed)continue;
  let submissionStarted=false;
  try {
   const letter=db.prepare('SELECT l.*,v.locale FROM letters l JOIN visitors v ON v.id=l.visitor_id WHERE l.id=?').get(row.letter_id) as PersonalLetter&{locale:string|null};
   const message=buildPersonalLetterEmail({to:row.recipient,fromAddress:config.providers.email.fromAddress,replyTo:config.providers.email.replyTo,companionName:letter.companion_name,subject:letter.subject,body:letter.body,locale:letter.locale==='en'?'en':'zh-CN',unsubscribeUrl:publicUnsubscribeUrl(row.visitor_id,env),idempotencyKey:`deep-whisper:${row.id}`});
   // Re-read after template construction, immediately before crossing the provider boundary.
   const current=getLetterPreference(db,row.visitor_id);
   const submitNow=clock();
   if(!current.email_enabled||current.email_address!==row.recipient||letter.local_date!==letterLocalDate(submitNow,current.timezone)||!emailSourceCurrent(db,row,submitNow)) {db.prepare("UPDATE letter_outbox SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,last_error='letter source or preference changed',updated_at=? WHERE id=? AND lease_token=?").run(submitNow.getTime(),row.id,token);continue;}
   fence();submissionStarted=true;const receipt=await send(message);
   db.transaction(()=>{fence();const changed=db.prepare("UPDATE letter_outbox SET status='accepted',provider_message_id=?,updated_at=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND status='sending'").run(receipt.providerMessageId,ms,row.id,token).changes;if(changed){reconcilePersonalDeliveryEvents(db,receipt.providerMessageId,ms);result.accepted++;}})();
  }catch(error) {
   fence();
   const rejected=!submissionStarted||error instanceof EmailSendError&&error.outcome==='rejected'||error instanceof ResendHttpError;
   const retryable=error instanceof EmailSendError?error.retryable:error instanceof ResendHttpError&&error.retryable;
   const status=rejected?(retryable&&row.attempts+1<3?'pending':'failed'):'unknown';
   db.prepare('UPDATE letter_outbox SET status=?,available_at=?,last_error=?,updated_at=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND status=\'sending\'').run(status,ms+RETRY_MS,status==='unknown'?'submission outcome unknown':'provider rejected email',ms,row.id,token);
   if(status==='unknown')result.unknown++;else result.failed++;
  }
 }
 return result;
}
