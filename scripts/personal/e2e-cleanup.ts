import {type ChildProcess} from 'node:child_process';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface E2EHolder {version:2;pid:number;token:string;children:Array<{pid:number;role:string}>}
const roles=new Set(['worker','web-wrapper','web-cli','web-server']);
const validPid=(pid:unknown):pid is number=>Number.isSafeInteger(pid)&&Number(pid)>1&&pid!==process.pid;
function ownedDirectory(dir:string) {try {const real=realpathSync(dir);return path.dirname(real)===realpathSync(os.tmpdir())&&path.basename(real).startsWith('dw-e2e-');}catch{return false}}
function validateHolder(value:unknown):E2EHolder {
 const holder=value as E2EHolder;
 if(!holder||holder.version!==2||!validPid(holder.pid)||typeof holder.token!=='string'||!holder.token||!Array.isArray(holder.children)||!holder.children.every(child=>validPid(child?.pid)&&roles.has(child.role)))throw new Error('Unverifiable E2E process inventory');
 return holder;
}
export function readOwnedE2EInventory(dir:string):E2EHolder|undefined {
 if(!ownedDirectory(dir))throw new Error('E2E cleanup requires its own temporary directory');
 const file=path.join(dir,'private/instance.json');if(!existsSync(file))return;
 return validateHolder(JSON.parse(readFileSync(file,'utf8')));
}
function alive(pid:number) {try {process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}
function signal(pid:number,name:NodeJS.Signals) {if(!alive(pid))return;try{process.kill(pid,name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}
/** Confirm every registered process offline before callers remove synthetic data. */
export async function stopOwnedE2EApp(dir:string,launcher:ChildProcess|undefined,options:{holder?:E2EHolder;previouslyStopped?:boolean;timeoutMs?:number;killTimeoutMs?:number}={}):Promise<boolean> {
 try {
  const current=readOwnedE2EInventory(dir);const cached=options.holder?validateHolder(options.holder):undefined;
  if(current&&cached&&(current.token!==cached.token||current.pid!==cached.pid))throw new Error('E2E inventory ownership changed');
  let holder=current??cached;
  if(!holder)return !!options.previouslyStopped&&(!launcher||launcher.exitCode!==null||launcher.signalCode!==null);
  const pids=new Set<number>();if(launcher?.pid)pids.add(launcher.pid);
  const refresh=()=>{const current=readOwnedE2EInventory(dir);if(current){if(current.token!==holder!.token||current.pid!==holder!.pid)throw new Error('E2E inventory ownership changed');holder=current;}pids.add(holder!.pid);for(const child of holder!.children)pids.add(child.pid);};
  const wait=async(name:NodeJS.Signals,ms:number)=>{const end=Date.now()+ms;do{refresh();for(const pid of pids)signal(pid,name);if([...pids].every(pid=>!alive(pid)))return true;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);return false;};
  return await wait('SIGTERM',options.timeoutMs??6000)||await wait('SIGKILL',options.killTimeoutMs??2000);
 }catch(error){console.error('[e2e cleanup]',error instanceof Error?error.message:'Cannot confirm offline processes');return false;}
}
