import Database from 'better-sqlite3';
import {mkdir,readdir,lstat,readFile,writeFile,copyFile,rename,rm} from 'node:fs/promises';
import {existsSync,lstatSync} from 'node:fs';
import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {DATABASE_VERSION} from '@/storage/database/db';
import {getPrivateSecret} from './secrets';
import {enterMaintenance,withMediaMutex} from './maintenance';
import {ownsOfflineInstance} from './instance-lock';
interface Manifest{format:1;databaseVersion:number;createdAt:string;files:Record<string,string>}
const TRANSIENT_PRIVATE_PATHS=new Set(['maintenance.json','instance.json','media-write.lock','instance-recovery.lock']);
async function filesUnder(root:string,prefix='',excluded:ReadonlySet<string>=new Set()):Promise<string[]>{
 const result:string[]=[];
 for(const name of await readdir(path.join(root,prefix))){const relative=path.posix.join(prefix,name);if(excluded.has(relative))continue;const info=await lstat(path.join(root,relative));if(info.isSymbolicLink())throw new Error('Backup contains a symbolic path');if(info.isDirectory())result.push(...await filesUnder(root,relative,excluded));else if(info.isFile())result.push(relative);else throw new Error('Backup contains unsupported file');}
 return result.sort();
}
const hash=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
async function waitForWrites(db:Database.Database):Promise<void>{
 const deadline=Date.now()+6*60*1000;
 while(true){
  const now=Date.now();
  const hasTable=(name:string)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const count=(name:string,sql:string)=>hasTable(name)?(db.prepare(sql).get(now) as {n:number}).n:0;
  const busy=count('operation_leases','SELECT count(*) n FROM operation_leases WHERE expires_at>?')+count('memory_jobs',"SELECT count(*) n FROM memory_jobs WHERE state='running' AND lease_expires_at>?")+count('letter_jobs',"SELECT count(*) n FROM letter_jobs WHERE status='running' AND lease_expires_at>?")+count('letter_outbox',"SELECT count(*) n FROM letter_outbox WHERE status='sending' AND lease_expires_at>?");
  if(!busy)return;if(Date.now()>deadline)throw new Error('Timed out draining active work; backup not created');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}
export async function createDataBackup(dataDir:string):Promise<string>{
 const sourceFile=path.join(dataDir,'deep-whisper.sqlite');
 if(!existsSync(sourceFile))throw new Error('Initialized database does not exist; start the app or run data:migrate before backup');
 if(lstatSync(sourceFile).isSymbolicLink())throw new Error('Database source must not be symbolic');
 const source=new Database(sourceFile,{readonly:true,fileMustExist:true});
 try{const version=source.pragma('user_version',{simple:true}) as number;if(!Number.isInteger(version)||version<1||version>DATABASE_VERSION)throw new Error('Unsupported or uninitialized database version; backup not created');if(source.pragma('quick_check',{simple:true})!=='ok'||(source.pragma('foreign_key_check') as unknown[]).length)throw new Error('Source database integrity failed; backup not created');}finally{source.close();}
 getPrivateSecret('session',dataDir);getPrivateSecret('unsubscribe',dataDir);
 const leave=enterMaintenance(dataDir);
 const db=new Database(sourceFile,{fileMustExist:true});db.pragma('busy_timeout=5000');
 const folder=path.join(dataDir,'backups',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`);
 let reader:Database.Database|undefined;
 try{
  if(!ownsOfflineInstance(dataDir))await waitForWrites(db);await mkdir(folder,{recursive:true,mode:0o700});
  // Drain the app/worker first, then freeze all writers while SQLite's backup API
  // copies its consistent WAL snapshot and private media/secrets are copied.
  await withMediaMutex(dataDir,async()=>{
  db.exec('BEGIN IMMEDIATE');reader=new Database(path.join(dataDir,'deep-whisper.sqlite'),{readonly:true});
  await reader.backup(path.join(folder,'deep-whisper.sqlite'));
  for(const dir of ['media','private'])if(existsSync(path.join(dataDir,dir))){
   for(const relative of await filesUnder(path.join(dataDir,dir),'',dir==='private'?TRANSIENT_PRIVATE_PATHS:undefined)){const target=path.join(folder,dir,relative);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await copyFile(path.join(dataDir,dir,relative),target);}
  }
  db.exec('COMMIT');
  });
  const manifest:Manifest={format:1,databaseVersion:db.pragma('user_version',{simple:true}) as number,createdAt:new Date().toISOString(),files:{}};
  for(const file of await filesUnder(folder))manifest.files[file]=await hash(path.join(folder,file));
  await writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});return folder;
 }catch(e){if(db.inTransaction)db.exec('ROLLBACK');await rm(folder,{recursive:true,force:true});throw e;}
 finally{reader?.close();db.close();leave();}
}
export async function restoreDataBackup(backup:string,target:string):Promise<void>{
 if(existsSync(target))throw new Error('Restore target already exists; choose a new offline data directory');
 const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8')) as Manifest;
 if(manifest.format!==1||(manifest.databaseVersion<1||manifest.databaseVersion>DATABASE_VERSION)||!manifest.files||!manifest.files['deep-whisper.sqlite'])throw new Error('Unsupported backup version');
 const files=(await filesUnder(backup)).filter(v=>v!=='manifest.json');
 if(JSON.stringify(files)!==JSON.stringify(Object.keys(manifest.files).sort()))throw new Error('Backup file manifest integrity mismatch');
 for(const file of files){if(!/^[a-zA-Z0-9_./-]+$/.test(file)||file.split('/').includes('..'))throw new Error('Invalid backup path');if(await hash(path.join(backup,file))!==manifest.files[file])throw new Error(`Backup hash integrity mismatch: ${file}`);}
 const db=new Database(path.join(backup,'deep-whisper.sqlite'),{readonly:true});
 try{if(db.pragma('user_version',{simple:true})!==manifest.databaseVersion||db.pragma('quick_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Backup database integrity failed');}finally{db.close();}
 const staging=`${target}.restore-${randomUUID()}`;
 try{await mkdir(staging,{recursive:true,mode:0o700});for(const file of files){await mkdir(path.dirname(path.join(staging,file)),{recursive:true,mode:0o700});await copyFile(path.join(backup,file),path.join(staging,file));}await rename(staging,target);}catch(e){await rm(staging,{recursive:true,force:true});throw e;}
}
