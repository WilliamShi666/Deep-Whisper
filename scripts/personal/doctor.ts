import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {selectLiveDoctorProbe} from './live-doctor';
import Database from 'better-sqlite3';
import {existsSync,mkdirSync,mkdtempSync,rmSync,accessSync,constants} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {getPersonalConfig,type RuntimeEnvironment} from '../../src/lib/config/runtime';
import {DATABASE_VERSION} from '../../src/storage/database/db';
import {loadScriptEnv} from '../lib/load-script-env';
export function inspectPersonalEnvironment(env:RuntimeEnvironment=process.env):{ok:boolean;errors:string[];checks:string[]}{
 const errors:string[]=[];const checks:string[]=[];let temporary:string|undefined;
 try{
  if(Number(process.versions.node.split('.')[0])!==24)errors.push('Node 24 LTS is required');
  const config=getPersonalConfig(env,{strict:false});errors.push(...config.configurationErrors);
  if(!config.capabilities.chat.enabled)errors.push(`${config.capabilities.chat.reason}; default DeepSeek keys: https://platform.deepseek.com/api_keys`);
  mkdirSync(config.dataDir,{recursive:true,mode:0o700});accessSync(config.dataDir,constants.W_OK|constants.R_OK);
  temporary=mkdtempSync(path.join(os.tmpdir(),'dw-doctor-'));const db=new Database(path.join(temporary,'probe.sqlite'));
  try{db.exec('CREATE VIRTUAL TABLE probe USING fts5(content)');checks.push(`SQLite ${db.prepare('SELECT sqlite_version() version').get() ? 'FTS5 available' : ''}`);}finally{db.close();}
  if(existsSync(path.join(config.dataDir,'deep-whisper.sqlite'))){const db=new Database(path.join(config.dataDir,'deep-whisper.sqlite'),{readonly:true});try{const version=db.pragma('user_version',{simple:true}) as number;if(version!==DATABASE_VERSION)errors.push(`Database version ${version}: backup then pnpm data:migrate (current ${DATABASE_VERSION})`);if(db.pragma('quick_check',{simple:true})!=='ok')errors.push('SQLite integrity check failed');}finally{db.close();}}
  checks.push(`Access: ${config.accessMode}`,`Storage: ${config.providers.objectStorage.provider}`,`Memory: ${config.memoryRetrievalMode}`,`Letters: ${config.letterDelivery}`);
  if(config.providers.objectStorage.provider==='r2')for(const key of ['R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ENDPOINT','R2_BUCKET_NAME','R2_PUBLIC_URL'])if(!env[key]?.trim())errors.push(`${key} is required for explicit R2 storage`);
 }catch(e){errors.push(e instanceof Error?e.message:'Environment check failed');}finally{if(temporary)rmSync(temporary,{recursive:true,force:true});}
 return {ok:errors.length===0,errors,checks};
}
if(process.argv[1]?.endsWith('/doctor.ts')||process.argv[1]?.endsWith('\\doctor.ts')){
 loadScriptEnv();
 if(process.argv.includes('--live')){
  try{const probe=selectLiveDoctorProbe(process.argv.slice(2),process.env);console.info(`Live probe: ${probe.requests} maximum requests; see provider canary runbook`);const child=spawn(process.execPath,[createRequire(import.meta.url).resolve('tsx/cli'),path.join(process.cwd(),'scripts',probe.script)],{env:process.env,stdio:'inherit'});child.once('error',error=>{console.error(error.message);process.exitCode=1;});child.once('exit',code=>{process.exitCode=code??1;});}catch(error){console.error(error instanceof Error?error.message:'Live probe refused');process.exitCode=1;}
 }
 else{const result=inspectPersonalEnvironment();for(const line of result.checks)console.info(line);for(const error of result.errors)console.error(error);process.exitCode=result.ok?0:1;}
}
