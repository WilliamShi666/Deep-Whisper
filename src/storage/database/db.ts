import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, lstatSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getPersonalConfig } from '@/lib/config/runtime';
import * as schema from './shared/all-schema';
import { assertInstanceOwnership } from '@/lib/personal/instance-lock';
import { coreMigrationSql } from './migrations/0001-core';
import { memoryMigrationSql } from './migrations/0002-memory';
import { lettersMigrationSql } from './migrations/0003-letters';
export type DbClient = BetterSQLite3Database<typeof schema>;
export const DATABASE_VERSION=3;
const migrations=[coreMigrationSql,memoryMigrationSql,lettersMigrationSql];
export function applyMigrations(db: Database.Database): void {
  const version=db.pragma('user_version',{simple:true}) as number;
  if(version>DATABASE_VERSION) throw new Error('Database was created by a newer Deep Whisper version');
  db.transaction(()=>{
    for(let i=version;i<migrations.length;i++) {db.exec(migrations[i]);db.pragma(`user_version = ${i+1}`);}
  }).immediate();
}
export function openDatabase(options:{dataDir:string;allowMigrate?:boolean}): Database.Database {
  mkdirSync(options.dataDir,{recursive:true,mode:0o700});
  if(lstatSync(options.dataDir).isSymbolicLink()) throw new Error('APP_DATA_DIR must not be a symbolic link');
  const file=path.join(options.dataDir,'deep-whisper.sqlite');
  const db=new Database(file);
  try {
    chmodSync(file,0o600);
    db.pragma('foreign_keys=ON');db.pragma('journal_mode=WAL');db.pragma('busy_timeout=5000');
    const version=db.pragma('user_version',{simple:true}) as number;
    const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all());
    if(version===0&&tables.length) throw new Error('Unversioned database: refusing to initialize over existing data');
    if(version>DATABASE_VERSION) throw new Error('Database was created by a newer Deep Whisper version');
    if(version!==DATABASE_VERSION) {
      if(version!==0&&!options.allowMigrate) throw new Error('Database upgrade required: back up then run pnpm data:migrate');
      applyMigrations(db);
    }
    db.prepare('INSERT OR IGNORE INTO visitors(id,owner_slot,created_at,updated_at) VALUES(?,1,?,?)').run(randomUUID(),Date.now(),Date.now());
    return db;
  } catch(error) {db.close();throw error;}
}
let sqlite: Database.Database | undefined;
let orm: DbClient | undefined;
export function getSqlite(): Database.Database {
  const dataDir=getPersonalConfig(process.env,{strict:false}).dataDir;
  assertInstanceOwnership(dataDir);
  if(!sqlite?.open) sqlite=openDatabase({dataDir});
  return sqlite;
}
export function getDb(): DbClient {return orm??=drizzle(getSqlite(),{schema});}
export function closeDatabase(): void {if(sqlite?.open) sqlite.close();sqlite=undefined;orm=undefined;}
