import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {exportPersonalCandidate} from '../scripts/personal/export';
const requiredDocuments=['docs/opensource/README.md','docs/opensource/01-plan.md','docs/opensource/02-architecture.md','docs/opensource/03-spec.md','docs/opensource/04-environment.md','docs/opensource/implementation/acceptance-ledger.md','docs/opensource/implementation/api-contracts.md','docs/opensource/implementation/api-contracts-letters.md'];
function seedRequiredDocuments(root:string){for(const file of requiredDocuments){mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),'Reviewed personal contract');}}
test('OSS-037 export uses a reviewed allowlist and omits Git history, env, data and commercial evidence',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'dw-export-'));const target=root+'-candidate';
 try{
  for(const dir of ['.git','src','data','tests/fixtures/billing','docs/handoffs'])mkdirSync(path.join(root,dir),{recursive:true});
  for(const file of ['.git/config','.env.local','data/private-message','tests/fixtures/billing/order.json','docs/handoffs/customer.md'])writeFileSync(path.join(root,file),'private');
  writeFileSync(path.join(root,'src/example.ts'),'export const edition="personal";');writeFileSync(path.join(root,'.env.example'),'DEEPSEEK_API_KEY=\n');
  writeFileSync(path.join(root,'README.en.md'),'# Personal edition\nEnglish startup instructions\n');
  seedRequiredDocuments(root);
  exportPersonalCandidate(root,target);
  assert.ok(existsSync(path.join(target,'src/example.ts')));assert.ok(existsSync(path.join(target,'.env.example')));
  assert.equal(readFileSync(path.join(target,'README.en.md'),'utf8'),'# Personal edition\nEnglish startup instructions\n');
  for(const file of ['.git','.env.local','data','tests/fixtures/billing','docs/handoffs'])assert.equal(existsSync(path.join(target,file)),false);
  assert.equal(JSON.parse(readFileSync(path.join(target,'EXPORT-MANIFEST.json'),'utf8')).gitHistoryIncluded,false);
  assert.throws(()=>exportPersonalCandidate(root,target),/new export directory/);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(target,{recursive:true,force:true});}
});
test('OSS-037 refuses an export with a missing required API contract before creating a candidate',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'dw-export-contract-'));const target=root+'-candidate';
 try{seedRequiredDocuments(root);rmSync(path.join(root,'docs/opensource/implementation/api-contracts.md'));assert.throws(()=>exportPersonalCandidate(root,target),/Required public artifact.*api-contracts/);assert.equal(existsSync(target),false);}
 finally{rmSync(root,{recursive:true,force:true});rmSync(target,{recursive:true,force:true});}
});
test('OSS-037 excludes runtime media and retired landing assets while retaining product artwork',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'dw-export-media-'));const target=root+'-candidate';
 const privateFiles=['public/uploads/private.png','public/images/generated.png','public/tts/voice-zh-f-01/private.mp3','public/tts-preview/qwen-audition/manifest.json'];
 const retiredFiles=['public/landing/voice/sample.mp3','public/landing/hero.webp'];
 const productFiles=['public/characters/deepseek/deepseek_f_01-normal.png','public/backgrounds/deepseek/desktop/fn01.jpg','public/brand/logo.png'];
 try{
  seedRequiredDocuments(root);
  for(const file of [...privateFiles,...retiredFiles,...productFiles]){mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),'synthetic fixture');}
  exportPersonalCandidate(root,target);
  const manifest=JSON.parse(readFileSync(path.join(target,'EXPORT-MANIFEST.json'),'utf8')).files;
  for(const file of [...privateFiles,...retiredFiles]){assert.equal(existsSync(path.join(target,file)),false,`${file} must stay out of the public export`);assert.equal(file in manifest,false);assert.ok(existsSync(path.join(root,file)),'original media must be preserved');}
  for(const file of productFiles){assert.equal(existsSync(path.join(target,file)),true);assert.ok(manifest[file]);}
 }finally{rmSync(root,{recursive:true,force:true});rmSync(target,{recursive:true,force:true});}
});
