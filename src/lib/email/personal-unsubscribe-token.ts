import {createHmac,timingSafeEqual} from 'node:crypto';
export function signPersonalUnsubscribeToken(owner:string,secret:string,expiresAt=Date.now()+90*86_400_000):string {
 const id=owner.trim();const key=secret.trim();
 if(!id||id.length>64)throw new Error('Unsubscribe signing requires a valid owner');
 if(!key)throw new Error('Unsubscribe signing requires a private secret');
 if(!Number.isFinite(expiresAt))throw new Error('Unsubscribe signing requires an expiry');
 const payload=Buffer.from(JSON.stringify({owner:id,expiresAt})).toString('base64url');
 return payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
}
export function verifyPersonalUnsubscribeToken(token:string,secret:string,now=Date.now()):string|null {
 if(!secret.trim()||token.length>2048)return null;
 const parts=token.split('.');if(parts.length!==2)return null;
 try {const expected=createHmac('sha256',secret.trim()).update(parts[0]).digest();const signature=Buffer.from(parts[1],'base64url');
  if(signature.length!==expected.length||!timingSafeEqual(signature,expected))return null;
  const value=JSON.parse(Buffer.from(parts[0],'base64url').toString()) as {owner?:unknown;expiresAt?:unknown};
  return typeof value.owner==='string'&&value.owner.length<=64&&typeof value.expiresAt==='number'&&Number.isFinite(value.expiresAt)&&value.expiresAt>now?value.owner:null;
 }catch{return null;}
}
