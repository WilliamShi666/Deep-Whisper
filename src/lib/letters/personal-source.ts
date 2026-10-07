import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {RecalledMemory} from '@/lib/memory';
import type {ImportantDate} from '@/lib/types';
import {BIRTHDAY_DESCRIPTION} from '@/lib/profile/important-dates';
import {selectImportantDateLetter} from './important-dates';
import {decideLetterEligibility,selectLetterAnchor,type LetterAnchor} from './policy';
import type {writeGroundedLetter} from './writer';

type WriterInput=Parameters<typeof writeGroundedLetter>[0];
interface MemoryRow {id:string;visitor_id:string;companion_id:string;content:string;content_version:number;confidence:RecalledMemory['confidence'];importance:number;status:string;temporal_status:RecalledMemory['temporalStatus'];time_precision?:string|null;observed_at:number|null;occurred_at:string|number|null;valid_until:number|null}
interface ProfileRow {id?:string;display_name:string|null;birthday:string|null;important_dates:string|null}
export type LetterSource={type:'memory';id:string;contentVersion:number;fingerprint:string}|{type:'profile';fingerprint:string};
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function memoryFingerprint(row:MemoryRow):string {
 return fingerprint([row.id,row.visitor_id,row.companion_id,row.content,row.content_version,row.confidence,row.importance,row.status,row.temporal_status,row.time_precision??null,row.observed_at,row.occurred_at,row.valid_until]);
}
function profileFingerprint(row:ProfileRow):string {return fingerprint([row.id??null,row.display_name,row.birthday,row.important_dates]);}
function profile(db:Database.Database,owner:string):ProfileRow|undefined {return db.prepare('SELECT * FROM user_profiles WHERE visitor_id=?').get(owner) as ProfileRow|undefined;}
export function personalImportantDate(row:ProfileRow|undefined,localDate:string):ImportantDate|null {
 let dates:ImportantDate[]=[];
 try {const parsed=JSON.parse(row?.important_dates??'[]');if(Array.isArray(parsed))dates=parsed.filter(entry=>entry&&typeof entry==='object'&&typeof entry.date==='string'&&typeof entry.type==='string');}catch { /* Invalid source cannot create an important-date anchor. */ }
 if(row?.birthday)dates.unshift({type:'birthday',date:row.birthday,description:BIRTHDAY_DESCRIPTION,recurring:true});
 return selectImportantDateLetter(dates,localDate);
}
export function personalMemoryAnchor(row:MemoryRow,now:Date,localDate:string,window:number|null):LetterAnchor|null {
 const occurredAt=typeof row.occurred_at==='number'?new Date(row.occurred_at).toISOString():row.occurred_at;
 const due=occurredAt&&(row.time_precision==='day'?occurredAt.slice(0,10)<localDate:Date.parse(occurredAt)<=now.getTime());
 const memory={id:row.id,text:row.content,importance:row.importance,confidence:row.confidence,temporalStatus:row.temporal_status==='upcoming'&&due?'follow_up_due':row.temporal_status,observedAt:row.observed_at!==null?new Date(row.observed_at).toISOString():null,occurredAt,validUntil:row.valid_until!==null?new Date(row.valid_until).toISOString():null,score:null} as RecalledMemory;
 let anchor=selectLetterAnchor([memory],now,window===null?null:new Date(window).toISOString());
 if(anchor&&memory.temporalStatus==='upcoming')anchor={...anchor,kind:memory.occurredAt?.slice(0,10)===localDate?'L0':'L2'};
 return anchor;
}
/** Persisted source identity, separate from the writer's copied human-readable input. */
export function captureLetterSource(db:Database.Database,owner:string,companion:string,anchor:LetterAnchor,isProfile:boolean):LetterSource|null {
 if(isProfile) {const row=profile(db,owner);return row?{type:'profile',fingerprint:profileFingerprint(row)}:null;}
 const row=db.prepare('SELECT * FROM memories WHERE id=? AND visitor_id=? AND companion_id=?').get(anchor.id,owner,companion) as MemoryRow|undefined;
 return row&&Number.isInteger(row.content_version)?{type:'memory',id:row.id,contentVersion:row.content_version,fingerprint:memoryFingerprint(row)}:null;
}
/** Call synchronously before IO, and again inside the transaction which stores its output. */
export function letterSourceIsCurrent(db:Database.Database,input:{owner:string;companion:string;conversation:string;localDate:string;writer:WriterInput;source?:LetterSource},now:Date):boolean {
 const {source,writer}=input;
 if(!source||!Array.isArray(writer?.anchors)||writer.anchors.length!==1)return false;
 const captured=writer.anchors[0];
 if(!captured||typeof captured.id!=='string'||typeof captured.text!=='string'||!['L0','L1','L2'].includes(captured.kind)||typeof source.fingerprint!=='string')return false;
 if(!db.prepare('SELECT c.id FROM conversations c JOIN companions p ON p.id=c.companion_id WHERE c.id=? AND c.visitor_id=? AND c.companion_id=? AND p.visitor_id=?').get(input.conversation,input.owner,input.companion,input.owner))return false;
 const row=profile(db,input.owner);const importantDate=personalImportantDate(row,input.localDate);
 const window=(db.prepare('SELECT window_started_at FROM letter_preferences WHERE visitor_id=?').get(input.owner) as {window_started_at:number|null}|undefined)?.window_started_at??null;
 let anchor:LetterAnchor|null=null;
 if(source.type==='profile') {
  if(!row||profileFingerprint(row)!==source.fingerprint||!importantDate)return false;
 }else if(source.type==='memory') {
  if(writer.anchors[0].id!==source.id)return false;
  const memory=db.prepare('SELECT * FROM memories WHERE id=? AND visitor_id=? AND companion_id=?').get(source.id,input.owner,input.companion) as MemoryRow|undefined;
  if(!memory||memory.status!=='active'||memory.content_version!==source.contentVersion||memoryFingerprint(memory)!==source.fingerprint)return false;
  anchor=personalMemoryAnchor(memory,now,input.localDate,window);
 }else return false;
 const decision=decideLetterEligibility({preferenceStatus:'enabled',anchor,windowStartedAt:window===null?null:new Date(window).toISOString(),importantDate,now,locale:writer.locale});
 return !decision.skipReason&&decision.kind===writer.kind&&decision.isWindowEnd===writer.isWindowEnd&&decision.anchor?.id===writer.anchors[0].id&&decision.anchor?.text===writer.anchors[0].text&&decision.anchor?.kind===writer.anchors[0].kind&&importantDate?.description===writer.importantDateDescription;
}
