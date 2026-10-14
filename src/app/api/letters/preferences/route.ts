import { NextResponse } from 'next/server';
import { getSqlite } from '@/storage/database/db';
import { requireOwner, OwnerAccessError } from '@/lib/personal/owner';
import { getPersonalConfig } from '@/lib/config/runtime';
import { getLetterPreference, updateLetterPreference, LetterPreferenceError, type PreferencePatch } from '@/lib/letters/personal-repository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function response(owner:string) {
 const config=getPersonalConfig(process.env,{strict:false});
 return NextResponse.json({preference:getLetterPreference(getSqlite(),owner),email:{enabled:config.capabilities.email.enabled&&config.letterDelivery!=='in-app',provider:config.providers.email.provider,delivery:config.letterDelivery,reason:config.capabilities.email.reason}}, {headers:{'Cache-Control':'no-store'}});
}
function failure(error:unknown,save=false) {
 if(error instanceof OwnerAccessError)return NextResponse.json({error:'Owner access required',code:error.code},{status:error.status});
 if(save&&error instanceof LetterPreferenceError)return NextResponse.json({error:error.message,code:error.status===409?'LETTERS_CONFIRM_REQUIRED':'LETTERS_PREFERENCE_INVALID'},{status:error.status});
 return NextResponse.json({error:'Unable to access letter preferences',code:save?'LETTERS_PREFERENCE_SAVE_FAILED':'LETTERS_PREFERENCE_READ_FAILED'},{status:500});
}
export async function GET(request:Request) {try{return response(requireOwner(request));}catch(error){return failure(error);}}
export async function PATCH(request:Request) {
 let owner:string;try {owner=requireOwner(request);}catch(error){return failure(error);}
 let body:PreferencePatch;
 try {
  body=await request.json();
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length===0||Object.keys(body).some(key=>!['status','in_app_enabled','email_enabled','email_address','timezone','reconsent'].includes(key)))throw new Error('Invalid letter preference fields');
  if(body.status!==undefined&&!['enabled','paused'].includes(body.status))throw new Error('Invalid in-app status');
  for(const field of ['in_app_enabled','email_enabled','reconsent'] as const)if(body[field]!==undefined&&typeof body[field]!=='boolean')throw new Error('Invalid preference toggle');
  if(body.email_address!==undefined&&body.email_address!==null&&typeof body.email_address!=='string')throw new Error('Invalid recipient email');
  if(body.timezone!==undefined&&(typeof body.timezone!=='string'||body.timezone.length>100))throw new Error('Invalid IANA timezone');
 }catch {return NextResponse.json({error:'Invalid letter preference fields',code:'LETTERS_PREFERENCE_INVALID'},{status:400});}
 try {updateLetterPreference(getSqlite(),owner,body);return response(owner);}catch(error){return failure(error,true);}
}
