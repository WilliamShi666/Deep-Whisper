import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stopOwnedE2EApp} from '../scripts/personal/e2e-cleanup';

function alive(pid:number) { try {process.kill(pid,0);return true;} catch {return false;} }
async function sleeper():Promise<ChildProcess> {
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
 await new Promise<void>((resolve,reject)=>{child.stdout!.once('data',()=>resolve());child.once('error',reject);});return child;
}
async function kill(child:ChildProcess) {if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}
function fixture() {const dir=mkdtempSync(path.join(os.tmpdir(),'dw-e2e-cleanup-'));mkdirSync(path.join(dir,'private'));return dir;}
test('E2E cleanup stops inventory supervisor and writer even after launcher has exited',async()=>{
 const dir=fixture();const supervisor=await sleeper();const writer=await sleeper();
 try {writeFileSync(path.join(dir,'private/instance.json'),JSON.stringify({version:2,pid:supervisor.pid,token:'owned-fixture',children:[{pid:writer.pid,role:'worker'}]}));
  const stopped=await stopOwnedE2EApp(dir,undefined,{timeoutMs:40,killTimeoutMs:2000});
  assert.equal(stopped,true);assert.equal(alive(supervisor.pid!),false);assert.equal(alive(writer.pid!),false);
 } finally {await kill(supervisor);await kill(writer);rmSync(dir,{recursive:true,force:true});}
});
test('unverifiable inventory retains fixture and never signals a listed process',async()=>{
 const dir=fixture();const writer=await sleeper();
 try {writeFileSync(path.join(dir,'private/instance.json'),JSON.stringify({pid:writer.pid,token:'legacy-no-child-inventory'}));
  assert.equal(await stopOwnedE2EApp(dir,undefined,{timeoutMs:40,killTimeoutMs:40}),false);
  assert.equal(alive(writer.pid!),true);assert.equal(existsSync(dir),true);
 }finally {await kill(writer);rmSync(dir,{recursive:true,force:true});}
});
test('a previously stopped fixture can be confirmed again without a lock',async()=>{
 const dir=fixture();try {assert.equal(await stopOwnedE2EApp(dir,undefined,{previouslyStopped:true}),true);}finally {rmSync(dir,{recursive:true,force:true});}
});
test('a replacement inventory is retained and never signalled through a cached owner',async()=>{
 const dir=fixture();const old=await sleeper();await kill(old);const replacement=await sleeper();
 try {writeFileSync(path.join(dir,'private/instance.json'),JSON.stringify({version:2,pid:replacement.pid,token:'replacement',children:[]}));
  const stopped=await stopOwnedE2EApp(dir,undefined,{holder:{version:2,pid:old.pid!,token:'old-owned',children:[]},timeoutMs:40,killTimeoutMs:100});
  assert.equal(stopped,false);assert.equal(alive(replacement.pid!),true);assert.equal(existsSync(dir),true);
 }finally {await kill(replacement);rmSync(dir,{recursive:true,force:true});}
});
