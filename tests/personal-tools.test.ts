import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {setupPersonal} from '../scripts/personal/setup';
import {inspectPersonalEnvironment} from '../scripts/personal/doctor';
import {createDataBackup,restoreDataBackup} from '../src/lib/personal/backup';
import {openDatabase} from '../src/storage/database/db';
import {createLocalObjectStore,readPrivateMedia} from '../src/lib/storage/local-object-store';
test('OSS-006/007 setup preserves existing secrets and doctor is offline',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'dw-setup-'));
 try{
  writeFileSync(path.join(root,'.env.example'),'DEEPSEEK_API_KEY=\n');setupPersonal(root);
  writeFileSync(path.join(root,'.env.local'),'DEEPSEEK_API_KEY=personal-secret\n');setupPersonal(root);
  assert.match(readFileSync(path.join(root,'.env.local'),'utf8'),/personal-secret/);
  const missing=inspectPersonalEnvironment({APP_DATA_DIR:path.join(root,'data')});assert.equal(missing.ok,false);assert.match(missing.errors.join(),/DEEPSEEK_API_KEY/);
  const ready=inspectPersonalEnvironment({APP_DATA_DIR:path.join(root,'data'),DEEPSEEK_API_KEY:'fixture-secret'});assert.equal(ready.ok,true);
  assert.equal(JSON.stringify(ready).includes('fixture-secret'),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('OSS-036 online backup includes WAL state, media and secrets and verified offline restore',async()=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'dw-backup-'));const restored=dataDir+'-restored';
 let db:ReturnType<typeof openDatabase>|undefined;
 try{
  db=openDatabase({dataDir});const owner=db.prepare('SELECT id FROM visitors').get() as {id:string};
  db.prepare('UPDATE visitors SET nickname=? WHERE id=?').run('backup point',owner.id);
  await createLocalObjectStore(dataDir).put({key:'tts/sample.wav',bytes:Buffer.from('hello'),mediaType:'audio/wav'});
  writeFileSync(path.join(dataDir,'private','instance.json'),JSON.stringify({pid:process.pid,token:'fixture'}));
  mkdirSync(path.join(dataDir,'private','instance-recovery.lock'));writeFileSync(path.join(dataDir,'private','instance-recovery.lock','fixture'),JSON.stringify({pid:process.pid,token:'fixture'}));
  const backup=await createDataBackup(dataDir);
  assert.equal(existsSync(path.join(backup,'private','instance.json')),false);
  assert.equal(existsSync(path.join(backup,'private','media-write.lock')),false);
  assert.equal(existsSync(path.join(backup,'private','instance-recovery.lock')),false);
  db.prepare('UPDATE visitors SET nickname=? WHERE id=?').run('after backup',owner.id);db.close();
  await restoreDataBackup(backup,restored);
  db=openDatabase({dataDir:restored});assert.equal((db.prepare('SELECT nickname FROM visitors').get() as {nickname:string}).nickname,'backup point');
  assert.equal((await readPrivateMedia('tts/sample.wav',restored)).bytes.toString(),'hello');
  writeFileSync(path.join(backup,'media','tts','sample.wav'),'tampered');
  await assert.rejects(()=>restoreDataBackup(backup,restored+'-bad'),/hash|integrity/i);
 }finally{if(db?.open)db.close();for(const p of [dataDir,restored,restored+'-bad'])rmSync(p,{recursive:true,force:true});}
});

test('review S2 backup refuses a missing, unversioned or unsupported source rather than creating an unrestorable success',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'dw-invalid-backup-'));try{
  await assert.rejects(()=>createDataBackup(root),/initialized|does not exist|missing/i);
  const Database=(await import('better-sqlite3')).default;const db=new Database(path.join(root,'deep-whisper.sqlite'));db.close();
  await assert.rejects(()=>createDataBackup(root),/version|initialized/i);
  const newer=new Database(path.join(root,'deep-whisper.sqlite'));newer.pragma('user_version=999');newer.close();
  await assert.rejects(()=>createDataBackup(root),/version/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});
