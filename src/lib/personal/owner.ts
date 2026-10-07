import { createHmac, timingSafeEqual, scryptSync, createHash } from 'node:crypto';
import { getPersonalConfig, isLoopback, type RuntimeEnvironment } from '@/lib/config/runtime';
import { getPrivateSecret } from './secrets';
import { getSqlite } from '@/storage/database/db';
export class OwnerAccessError extends Error {
  constructor(public status:number,public code:string,message:string){super(message);this.name='OwnerAccessError';}
}
export const OWNER_COOKIE='dw_owner';
const duration=7*24*60*60*1000;
function signingKey(env:RuntimeEnvironment):string {
  const config=getPersonalConfig(env,{strict:false});
  return getPrivateSecret('session',config.dataDir)+createHash('sha256').update(env.OWNER_PASSWORD||'').digest('hex');
}
export function createOwnerSession(env:RuntimeEnvironment=process.env,now=Date.now()):string {
  const body=Buffer.from(JSON.stringify({expires:now+duration})).toString('base64url');
  return `${body}.${createHmac('sha256',signingKey(env)).update(body).digest('base64url')}`;
}
export function validateOwnerSession(token:string|undefined,env:RuntimeEnvironment=process.env,now=Date.now()):boolean {
  if(!token||token.length>512) return false;
  try {
    const [body,signature,extra]=token.split('.');if(!body||!signature||extra) return false;
    const expected=createHmac('sha256',signingKey(env)).update(body).digest();const actual=Buffer.from(signature,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) return false;
    const parsed=JSON.parse(Buffer.from(body,'base64url').toString());
    return Number.isSafeInteger(parsed.expires)&&parsed.expires>now&&parsed.expires<=now+duration;
  } catch{return false;}
}
export function validateOwnerRequest(request:Request,env:RuntimeEnvironment=process.env,options:{allowUnauthenticated?:boolean;allowPublicNavigation?:boolean}={}):void {
  const config=getPersonalConfig(env,{strict:false});const base=new URL(config.appBaseUrl);
  const host=request.headers.get('host')||new URL(request.url).host;
  let target:URL;try{target=new URL(`${base.protocol}//${host}`);}catch{throw new OwnerAccessError(403,'INVALID_HOST','Host is not allowed');}
  const allowed=config.accessMode==='local'?isLoopback(target.hostname)&&Number(target.port||(target.protocol==='https:'?443:80))===config.port:target.host.toLowerCase()===base.host.toLowerCase();
  if(!allowed||target.username||target.password) throw new OwnerAccessError(403,'INVALID_HOST','Host is not allowed');
  if(request.headers.get('sec-fetch-site')==='cross-site'&&!options.allowPublicNavigation) throw new OwnerAccessError(403,'CROSS_SITE_REQUEST','cross-site requests are not allowed');
  const origin=request.headers.get('origin');const writes=!['GET','HEAD','OPTIONS'].includes(request.method);
  if(writes&&!origin) throw new OwnerAccessError(403,'INVALID_ORIGIN','Origin is required');
  if(origin) {
    let source:URL;try{source=new URL(origin);}catch{throw new OwnerAccessError(403,'INVALID_ORIGIN','Origin is not allowed');}
    const same=config.accessMode==='local'?source.origin===target.origin:source.origin===base.origin;
    if(!same) throw new OwnerAccessError(403,'INVALID_ORIGIN','Origin is not allowed');
  }
  if(config.accessMode==='password'&&!options.allowUnauthenticated) {
    const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${OWNER_COOKIE}=`))?.slice(OWNER_COOKIE.length+1);
    if(!validateOwnerSession(token,env)) throw new OwnerAccessError(401,'OWNER_AUTH_REQUIRED','Authentication required');
  }
}
export function requireOwner(request:Request):string {
  validateOwnerRequest(request);
  return (getSqlite().prepare('SELECT id FROM visitors WHERE owner_slot=1').get() as {id:string}).id;
}
const attempts=new Map<string,{count:number;reset:number}>();
export function attemptOwnerLogin(password:string,env:RuntimeEnvironment=process.env,now=Date.now()):{authenticated:boolean;status:number} {
  const config=getPersonalConfig(env,{strict:false});const key=config.dataDir;
  let state=attempts.get(key);if(!state||state.reset<=now){state={count:0,reset:now+15*60*1000};attempts.set(key,state);}
  if(state.count>=10) return {authenticated:false,status:429};
  state.count++;
  if(typeof password!=='string'||password.length>1024) return {authenticated:false,status:401};
  const salt=getPrivateSecret('session',config.dataDir);
  const match=timingSafeEqual(scryptSync(password,salt,32),scryptSync(env.OWNER_PASSWORD||'',salt,32));
  if(match) {attempts.delete(key);return {authenticated:true,status:200};}
  return {authenticated:false,status:401};
}
