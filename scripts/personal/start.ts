import {spawn,type ChildProcess} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';import {createRequire} from 'node:module';
import {loadScriptEnv} from '../lib/load-script-env';
import {getPersonalConfig} from '../../src/lib/config/runtime';
import {openDatabase} from '../../src/storage/database/db';
import {getPrivateSecret} from '../../src/lib/personal/secrets';
import {claimInstanceLock} from '../../src/lib/personal/instance-lock';
const require=createRequire(import.meta.url);
async function main(){
 const mode=process.argv[2];if(!['dev','start'].includes(mode))throw new Error('Expected dev or start');
 if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Node 24 LTS is required');
 Reflect.set(process.env,'NODE_ENV',mode==='dev'?'development':'production');loadScriptEnv();
 const config=getPersonalConfig(process.env,{strict:false});for(const error of config.configurationErrors)console.error(`[configuration] ${error}`);
 const cleanup=claimInstanceLock(config.dataDir);
 const token=(JSON.parse(readFileSync(path.join(config.dataDir,'private','instance.json'),'utf8')) as {token:string}).token;
 let web:ChildProcess|undefined;let worker:ChildProcess|undefined;let exiting=false;
 const stop=(code:number)=>{if(exiting)return;exiting=true;process.exitCode=code;web?.kill('SIGTERM');worker?.kill('SIGTERM');const timeout=setTimeout(()=>{web?.kill('SIGKILL');worker?.kill('SIGKILL');cleanup();},5000);timeout.unref();};
 process.once('SIGINT',()=>stop(0));process.once('SIGTERM',()=>stop(0));process.once('exit',cleanup);
 try{
  const db=openDatabase({dataDir:config.dataDir});db.close();getPrivateSecret('session',config.dataDir);getPrivateSecret('unsubscribe',config.dataDir);
  const env={...process.env,DW_INSTANCE_TOKEN:token};
  web=spawn(process.execPath,[require.resolve('tsx/cli'),path.join(process.cwd(),'scripts/personal/web.ts'),mode],{cwd:process.cwd(),env,stdio:'inherit'});
  worker=spawn(process.execPath,['--conditions=react-server',require.resolve('tsx/cli'),path.join(process.cwd(),'scripts/personal/worker.ts')],{cwd:process.cwd(),env,stdio:'inherit'});
  for(const child of [web,worker]){child.once('error',e=>{console.error(e.message);stop(1);});child.once('exit',(code)=>{if(!exiting){console.error('[supervisor] child exited',code);stop(code===0?1:(code??1));}});}
  await Promise.all([web,worker].map(child=>new Promise<void>(resolve=>child.once('exit',()=>resolve()))));
 }finally{cleanup();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Startup failed');process.exitCode=1;});
