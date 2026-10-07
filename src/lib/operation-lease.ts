import 'server-only';
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {dirname} from 'node:path';
import {assertInstanceOwnership} from '@/lib/personal/instance-lock';
import {getSqlite} from '@/storage/database/db';
export type OperationLease={key:string;token:string};
export async function acquireOperationLease(key:string):Promise<OperationLease|null>{
 const db=getSqlite();const token=randomUUID();const now=Date.now();
 const claimed=db.transaction(()=>{
  db.prepare('DELETE FROM operation_leases WHERE resource_key IN (SELECT resource_key FROM operation_leases WHERE expires_at<=? LIMIT 100)').run(now);
  return db.prepare('INSERT INTO operation_leases(resource_key,token,expires_at) VALUES(?,?,?) ON CONFLICT(resource_key) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at WHERE operation_leases.expires_at<=?').run(key,token,now+10*60*1000,now).changes;
 }).immediate();
 return claimed?{key,token}:null;
}
export async function assertOperationLease(tx:Database.Database,lease:OperationLease):Promise<void>{
 assertInstanceOwnership(dirname(tx.name));
 if(!tx.prepare('SELECT resource_key FROM operation_leases WHERE resource_key=? AND token=? AND expires_at>?').get(lease.key,lease.token,Date.now())) throw new Error('Operation reservation expired');
}
export async function releaseOperationLease(lease:OperationLease):Promise<void>{getSqlite().prepare('DELETE FROM operation_leases WHERE resource_key=? AND token=?').run(lease.key,lease.token);}
