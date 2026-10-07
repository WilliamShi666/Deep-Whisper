import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
import {readOwnedE2EInventory,stopOwnedE2EApp,type E2EHolder} from './e2e-cleanup';
import {REAL_PROVIDER_CREDENTIAL_ENV_NAMES} from '../../src/lib/config/runtime';
const require=createRequire(import.meta.url);
async function main(){
 const profile=process.env.E2E_PROFILE||'keyword';
 if(!['keyword','hybrid','gemini','password'].includes(profile))throw new Error('Unknown synthetic E2E profile');
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'dw-e2e-'));const port=Number(process.env.E2E_PORT||5500);const base=`http://127.0.0.1:${port}`;
 const env={...process.env,APP_ENV:'test',E2E_MOCK_PROVIDERS:'1',APP_DATA_DIR:dataDir,E2E_DATA_DIR:dataDir,E2E_PROFILE:profile,HOST:'127.0.0.1',PORT:String(port),APP_BASE_URL:base,APP_ACCESS_MODE:profile==='password'?'password':'local',OWNER_PASSWORD:profile==='password'?'synthetic-owner-password-2026':'',MEMORY_RETRIEVAL_MODE:profile==='hybrid'?'hybrid':'keyword',EMAIL_PROVIDER:'none',LETTER_DELIVERY:'in-app',OBJECT_STORAGE_PROVIDER:'local',AI_TTS_PROVIDER:profile==='gemini'?'openrouter-gemini':'',AI_TTS_MODEL:'',LETTER_PUBLIC_BASE_URL:'',E2E_BASE_URL:base};
 for(const name of REAL_PROVIDER_CREDENTIAL_ENV_NAMES)Reflect.set(env,name,'');
 let web:ChildProcess|undefined;let child:ChildProcess|undefined;let holder:E2EHolder|undefined;let failed=true;let interrupted=false;
 const stop=()=>{interrupted=true;child?.kill('SIGTERM');web?.kill('SIGTERM');};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  web=spawn(process.execPath,[require.resolve('tsx/cli'),'scripts/personal/start.ts','dev'],{env,stdio:'inherit'});
  const deadline=Date.now()+120_000;let ready=false;
  while(Date.now()<deadline){
   if(interrupted)throw new Error('E2E interrupted');
   if(web.exitCode!==null||web.signalCode!==null)throw new Error('E2E supervisor exited before readiness');
   try{const response=await fetch(base+'/api/capabilities');if(response.ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw new Error('E2E web readiness timed out');
  holder=readOwnedE2EInventory(dataDir);
  child=spawn(process.execPath,[require.resolve('@playwright/test/cli'), 'test',...process.argv.slice(2)],{env,stdio:'inherit'});
  const code=await new Promise<number>(resolve=>{child!.once('error',()=>resolve(1));child!.once('exit',code=>resolve(code??1));});
  process.exitCode=interrupted?1:code;failed=code!==0||interrupted;
 }finally{
  const cleanupConfirmed=await stopOwnedE2EApp(dataDir,web,{holder});
  if(!cleanupConfirmed){failed=true;process.exitCode=1;}
  if(failed)console.error(`E2E isolated data retained at ${dataDir}`);else if(cleanupConfirmed)rmSync(dataDir,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'E2E failed');process.exitCode=1;});
