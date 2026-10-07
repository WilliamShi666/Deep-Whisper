import { mkdir,writeFile,lstat,readFile,open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type {ObjectStore} from '@/lib/ai';
import {getPersonalConfig} from '@/lib/config/runtime';
import {maintenanceActive,withMediaMutex} from '@/lib/personal/maintenance';
const allowedTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','audio/wav','audio/mpeg','audio/mp3','audio/ogg','audio/mp4','audio/aac','audio/flac']);
function keyParts(key:string):string[]{
 const parts=key.split('/');
 if(!key||key.length>512||parts.some(p=>!p||p==='.'||p==='..'||!/^[a-zA-Z0-9_.-]+$/.test(p))) throw new Error('Invalid private media key');
 return parts;
}
async function safePath(key:string,dataDir:string,create:boolean):Promise<string>{
 const parts=keyParts(key);const root=path.join(dataDir,'media');
 if(create) await mkdir(root,{recursive:true,mode:0o700});
 if((await lstat(root)).isSymbolicLink()) throw new Error('Media directory must not be symbolic');
 let target=root;
 for(let i=0;i<parts.length;i++) {
  target=path.join(target,parts[i]);
  if(create&&i<parts.length-1) await mkdir(target,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST') throw e;});
  try {if((await lstat(target)).isSymbolicLink()) throw new Error('Media path must not be symbolic');}
  catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT'||!create) throw e;}
 }
 return target;
}
export function createLocalObjectStore(dataDir=getPersonalConfig(process.env,{strict:false}).dataDir):ObjectStore {
 return {async put(input){
  if(maintenanceActive(dataDir)) throw new Error('Media writes paused for maintenance');
  return withMediaMutex(dataDir,async()=>{
  if(maintenanceActive(dataDir)) throw new Error('Media writes paused for maintenance');
  if(!allowedTypes.has(input.mediaType)) throw new Error('Unsupported private media type');
  if(!input.bytes.length||input.bytes.length>30*1024*1024) throw new Error('Media size is invalid');
  const target=await safePath(input.key,dataDir,true);
  const handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(input.bytes);await handle.sync();}finally{await handle.close();}
  await writeFile(`${target}.meta.json`,JSON.stringify({mediaType:input.mediaType}),{flag:'wx',mode:0o600});
  return {key:input.key,url:`/api/media/${input.key}`};
  });
 }};
}
export async function readPrivateMedia(key:string,dataDir=getPersonalConfig(process.env,{strict:false}).dataDir):Promise<{bytes:Buffer;mediaType:string}>{
 const target=await safePath(key,dataDir,false);await safePath(`${key}.meta.json`,dataDir,false);
 const meta=JSON.parse(await readFile(`${target}.meta.json`,'utf8'));
 if(!allowedTypes.has(meta.mediaType)) throw new Error('Invalid media metadata');
 const handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>30*1024*1024) throw new Error('Invalid media file');return {bytes:await handle.readFile(),mediaType:meta.mediaType};}finally{await handle.close();}
}
export function parseByteRange(value:string,size:number):{start:number;end:number}{
 const m=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!m||(!m[1]&&!m[2])||size<=0) throw new Error('Invalid byte range');
 let start:number,end:number;
 if(!m[1]){const suffix=Number(m[2]);if(suffix<=0) throw new Error('Invalid byte range');start=Math.max(0,size-suffix);end=size-1;}
 else {start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start) throw new Error('Unsatisfiable byte range');
 return {start,end};
}
