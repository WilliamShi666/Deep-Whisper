import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import Database from 'better-sqlite3';
import {claimInstanceLock} from '../src/lib/personal/instance-lock';
import {coreMigrationSql} from '../src/storage/database/migrations/0001-core';
import {openDatabase} from '../src/storage/database/db';import {createDataBackup} from '../src/lib/personal/backup';
test('S11 crashed instance is reclaimed for backup plus explicit old-schema migration',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dw-stale-upgrade-'));const lock=path.join(dir,'private','instance.json');let release:(()=>void)|undefined;
 try{mkdirSync(path.dirname(lock));writeFileSync(lock,JSON.stringify({version:2,pid:2147483647,token:'dead-owner',children:[]}));
 const db=new Database(path.join(dir,'deep-whisper.sqlite'));db.exec(coreMigrationSql);db.pragma('user_version=1');db.prepare("INSERT INTO visitors(id,owner_slot,nickname,created_at,updated_at) VALUES('owner',1,'kept',1,1)").run();db.close();
 release=claimInstanceLock(dir);assert.equal(JSON.parse(readFileSync(lock,'utf8')).pid,process.pid);
 const backup=await createDataBackup(dir);assert.ok(existsSync(backup));
 const migrated=openDatabase({dataDir:dir,allowMigrate:true});assert.equal(migrated.pragma('user_version',{simple:true}),3);assert.equal((migrated.prepare('SELECT nickname FROM visitors').get() as {nickname:string}).nickname,'kept');migrated.close();release();release=undefined;assert.equal(existsSync(lock),false);
 }finally{release?.();rmSync(dir,{recursive:true,force:true});}
});
test('S11 live instance rejects maintenance and release cannot remove another token',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dw-live-lock-'));const lock=path.join(dir,'private','instance.json');let release:(()=>void)|undefined;
 try{release=claimInstanceLock(dir);assert.throws(()=>claimInstanceLock(dir),/Stop.*app|already uses/i);writeFileSync(lock,JSON.stringify({pid:process.pid,token:'replacement'}));release();release=undefined;assert.equal(JSON.parse(readFileSync(lock,'utf8')).token,'replacement');}
 finally{release?.();rmSync(dir,{recursive:true,force:true});}
});
test('S11 malformed instance fails closed with recovery guidance',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dw-bad-lock-'));const lock=path.join(dir,'private','instance.json');
 try{mkdirSync(path.dirname(lock));writeFileSync(lock,'{bad');assert.throws(()=>claimInstanceLock(dir),/malformed.*Stop all/i);assert.equal(readFileSync(lock,'utf8'),'{bad');writeFileSync(lock,JSON.stringify({pid:0,token:'bad'}));assert.throws(()=>claimInstanceLock(dir),/malformed/i);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
