import test from 'node:test';import assert from 'node:assert/strict';
import Database from 'better-sqlite3';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {coreMigrationSql} from '../src/storage/database/migrations/0001-core';
import {openDatabase} from '../src/storage/database/db';import {createDataBackup,restoreDataBackup} from '../src/lib/personal/backup';
test('OSS-021/036 old schema requires explicit upgrade, backup preserves its actual version',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dw-upgrade-'));const restored=dir+'-restored';let db:Database.Database|undefined;
 try{db=new Database(path.join(dir,'deep-whisper.sqlite'));db.pragma('foreign_keys=ON');db.exec(coreMigrationSql);db.pragma('user_version=1');const owner=randomUUID();db.prepare('INSERT INTO visitors(id,owner_slot,nickname,created_at,updated_at) VALUES(?,1,?,1,1)').run(owner,'retain me');db.close();
 assert.throws(()=>openDatabase({dataDir:dir}),/upgrade required/i);
 const backup=await createDataBackup(dir);await restoreDataBackup(backup,restored);
 assert.throws(()=>openDatabase({dataDir:restored}),/upgrade required/i);
 db=openDatabase({dataDir:dir,allowMigrate:true});assert.equal(db.pragma('user_version',{simple:true}),3);assert.equal((db.prepare('SELECT nickname FROM visitors WHERE id=?').get(owner) as {nickname:string}).nickname,'retain me');
 }finally{if(db?.open)db.close();rmSync(dir,{recursive:true,force:true});rmSync(restored,{recursive:true,force:true});}
});
