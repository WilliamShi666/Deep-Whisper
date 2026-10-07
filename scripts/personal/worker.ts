import {loadScriptEnv} from '../lib/load-script-env';
import { registerInstanceProcess, assertInstanceOwnership, watchInstanceOwnership } from '../../src/lib/personal/instance-lock';
loadScriptEnv();
async function main(){
 const {getPersonalConfig}=await import('../../src/lib/config/runtime');
 const {getSqlite,closeDatabase}=await import('../../src/storage/database/db');
 const {processMemoryJobs}=await import('../../src/lib/memory/sqlite-jobs');
 const {getMemoryWorkerOptions}=await import('../../src/lib/memory/dependencies');
 const {processLetterJobs}=await import('../../src/lib/letters/personal-scheduler');
 const {maintenanceActive}=await import('../../src/lib/personal/maintenance');
 const config=getPersonalConfig(process.env,{strict:false});
 await registerInstanceProcess(config.dataDir,'worker');
 const unwatch=watchInstanceOwnership(config.dataDir);
 const memoryOptions=getMemoryWorkerOptions();let stopping=false;
 process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
 console.info('[worker] ready');
 try{while(!stopping){
  assertInstanceOwnership(config.dataDir);
  if(!maintenanceActive(config.dataDir)&&config.capabilities.chat.enabled){
   await processMemoryJobs(getSqlite(),{...memoryOptions,limit:4});
   assertInstanceOwnership(config.dataDir);
   if(!maintenanceActive(config.dataDir))await processLetterJobs(getSqlite());
  }
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,1000));
 }}finally{unwatch();closeDatabase();console.info('[worker] stopped');}
}
main().catch(error=>{console.error('[worker] failed',error instanceof Error?error.message:'Unknown error');process.exitCode=1;});
