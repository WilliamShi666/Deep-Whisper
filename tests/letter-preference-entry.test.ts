import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {closeDatabase} from '../src/storage/database/db';
import {GET,PATCH} from '../src/app/api/letters/preferences/route';
const routeSource=readFileSync(new URL('../src/app/api/letters/preferences/route.ts',import.meta.url),'utf8');
const entrySource=readFileSync(new URL('../src/components/chat/companion-letter-settings.tsx',import.meta.url),'utf8');
const settingsSource=readFileSync(new URL('../src/components/chat/companion-settings.tsx',import.meta.url),'utf8');
test('personal letter settings mount for the owner without account-email or membership gates',()=>{
 assert.match(routeSource,/requireOwner/);assert.doesNotMatch(routeSource,/resolveCurrentIdentity|authUser|hasPaidFeature|Supabase/);
 assert.match(entrySource,/data-testid="companion-letter-settings"/);assert.match(entrySource,/in_app_enabled/);assert.match(entrySource,/email_enabled/);assert.match(entrySource,/letter-inbox/);
 assert.doesNotMatch(entrySource,/useAuth|hasPaidFeature|MEMBERSHIP_REQUIRED/);assert.match(settingsSource,/<CompanionLetterSettings open=\{open\} \/>/);
});
test('malformed JSON is a 400 client error and the default preference remains paused',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'personal-letter-preference-'));const names=['APP_DATA_DIR','APP_ENV','APP_ACCESS_MODE','HOST','PORT','APP_BASE_URL','EMAIL_PROVIDER','LETTER_DELIVERY'] as const;
 const previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));closeDatabase();
 Object.assign(process.env,{APP_DATA_DIR:dir,APP_ENV:'test',APP_ACCESS_MODE:'local',HOST:'127.0.0.1',PORT:'5000',APP_BASE_URL:'http://127.0.0.1:5000',EMAIL_PROVIDER:'none',LETTER_DELIVERY:'in-app'});
 try {
  const url='http://127.0.0.1:5000/api/letters/preferences';
  const response=await PATCH(new Request(url,{method:'PATCH',headers:{Origin:'http://127.0.0.1:5000','Content-Type':'application/json'},body:'{'}));assert.equal(response.status,400);assert.equal((await response.json()).code,'LETTERS_PREFERENCE_INVALID');
  const defaults=await GET(new Request(url));assert.equal((await defaults.json()).preference.in_app_enabled,false);
 }finally{closeDatabase();for(const key of names)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];rmSync(dir,{recursive:true,force:true});}
});
