import {existsSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
export function maintenanceActive(dataDir:string):boolean {
 const file=path.join(dataDir,'private','maintenance.json');if(!existsSync(file))return false;
 try{const {pid}=JSON.parse(readFileSync(file,'utf8'));if(!Number.isInteger(pid))return true;process.kill(pid,0);return true;}
 catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}
}
export function enterMaintenance(dataDir:string):()=>void {
 const dir=path.join(dataDir,'private');mkdirSync(dir,{recursive:true,mode:0o700});
 if(lstatSync(dir).isSymbolicLink())throw new Error('Private directory must not be symbolic');
 const file=path.join(dir,'maintenance.json');if(existsSync(file)){if(maintenanceActive(dataDir))throw new Error('Another maintenance operation is running');unlinkSync(file);}
 writeFileSync(file,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
 return ()=>{unlinkSync(file);};
}

/** Serializes short private media writes with backup copying across processes. */
export async function withMediaMutex<T>(dataDir:string,work:()=>Promise<T>):Promise<T>{
 const dir=path.join(dataDir,'private');mkdirSync(dir,{recursive:true,mode:0o700});if(lstatSync(dir).isSymbolicLink())throw new Error('Private directory must not be symbolic');
 const file=path.join(dir,'media-write.lock');const token=`${process.pid}-${Date.now()}-${Math.random()}`;const deadline=Date.now()+60_000;
 while(true){
  try{writeFileSync(file,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});break;}
  catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   try{const previous=JSON.parse(readFileSync(file,'utf8'));process.kill(previous.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){unlinkSync(file);continue;}}
   if(Date.now()>deadline)throw new Error('Media maintenance lock timed out');await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
 try{return await work();}finally{if(JSON.parse(readFileSync(file,'utf8')).token===token)unlinkSync(file);}
}
