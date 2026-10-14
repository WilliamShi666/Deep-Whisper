import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { getPersonalConfig } from '@/lib/config/runtime';
export function getPrivateSecret(name:'session'|'unsubscribe',dataDir=getPersonalConfig(process.env,{strict:false}).dataDir):string {
  const dir=path.join(dataDir,'private');mkdirSync(dir,{recursive:true,mode:0o700});
  if(lstatSync(dir).isSymbolicLink()) throw new Error('Private directory must not be a symbolic link');
  const file=path.join(dir,`${name}.key`);
  try {writeFileSync(file,randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600});}
  catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;}
  if(lstatSync(file).isSymbolicLink()) throw new Error('Private secret must not be a symbolic link');
  const secret=readFileSync(file,'utf8').trim();
  if(!/^[a-zA-Z0-9_-]{43}$/.test(secret)) throw new Error('Private secret is invalid; refusing to replace it');
  return secret;
}
