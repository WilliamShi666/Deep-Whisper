import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getPersonalConfig, getProviderConfig, isE2EMockProviderMode } from '../src/lib/config/runtime';
import { loadScriptEnv } from '../scripts/lib/load-script-env';
import { openDatabase } from '../src/storage/database/db';

test('OSS-002/005 local defaults and production local persistence need no cloud account', () => {
  const config = getPersonalConfig({ NODE_ENV: 'production' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5000);
  assert.equal(config.appBaseUrl, 'http://127.0.0.1:5000');
  assert.equal(config.accessMode, 'local');
  assert.equal(getProviderConfig({ NODE_ENV: 'production' }).objectStorage.provider, 'local');
  assert.equal(config.letterDelivery, 'in-app');
  assert.equal(getProviderConfig({}).email.provider, 'none');
  assert.equal(getPersonalConfig({PORT:'5001'}).appBaseUrl, 'http://127.0.0.1:5001');
  assert.throws(() => getPersonalConfig({HOST:'0.0.0.0'}), /local.*loopback/i);
  assert.throws(() => getPersonalConfig({PORT:'5001',APP_BASE_URL:'http://localhost:5000'}), /port/i);
  assert.equal(getPersonalConfig({APP_ACCESS_MODE:'password',OWNER_PASSWORD:'a sufficiently long password',HOST:'0.0.0.0',APP_BASE_URL:'https://personal.example'}).port, 5000);
});

test('OSS-003/004/018 configuration matrix never leaks credentials or requires absent fallback', () => {
  assert.equal(getPersonalConfig({}).memoryRetrievalMode, 'keyword');
  assert.equal(getPersonalConfig({DASHSCOPE_API_KEY:'fixture-secret'}).memoryRetrievalMode, 'hybrid');
  assert.throws(() => getPersonalConfig({MEMORY_RETRIEVAL_MODE:'hybrid'}), /DASHSCOPE_API_KEY/);
  assert.equal(getPersonalConfig({OPENROUTER_API_KEY:'fixture-secret'}).capabilities.speech.enabled, true);
  assert.equal(getProviderConfig({OPENROUTER_API_KEY:'fixture-secret'}).speech.provider, 'openrouter-gemini');
  assert.equal(getPersonalConfig({}).capabilities.speech.enabled, false);
  assert.equal(getProviderConfig({DASHSCOPE_API_KEY:'fixture-secret'}).speech.provider, 'qwen-audio');
  assert.throws(() => getPersonalConfig({AI_TTS_PROVIDER:'qwen-audio',OPENROUTER_API_KEY:'fixture-secret'}), /DASHSCOPE_API_KEY/);
  assert.equal(JSON.stringify(getPersonalConfig({DEEPSEEK_API_KEY:'fixture-secret'}).capabilities).includes('fixture-secret'), false);
  assert.throws(() => getPersonalConfig({EMAIL_PROVIDER:'typo'}), /EMAIL_PROVIDER/);
  assert.throws(() => getPersonalConfig({LETTER_DELIVERY:'both'}), /EMAIL_PROVIDER/);
  assert.equal(isE2EMockProviderMode({APP_ENV:'test',E2E_MOCK_PROVIDERS:'1'}), true);
  assert.throws(() => isE2EMockProviderMode({APP_ENV:'production',E2E_MOCK_PROVIDERS:'1'}), /test/);
});

test('OSS-007 scripts respect NODE_ENV priorities, test excludes local secrets, shell wins', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dw-env-'));
  const prior = {...process.env};
  try {
    writeFileSync(path.join(root,'.env'), 'DW_FIXTURE=base\n');
    writeFileSync(path.join(root,'.env.local'), 'DW_FIXTURE=private\n');
    writeFileSync(path.join(root,'.env.test'), 'DW_FIXTURE=test\n');
    writeFileSync(path.join(root,'.env.production'), 'DW_FIXTURE=prod\n');
    writeFileSync(path.join(root,'.env.production.local'), 'DW_FIXTURE=override\n');
    Reflect.set(process.env,'NODE_ENV','test'); delete process.env.DW_FIXTURE;
    loadScriptEnv(root); assert.equal(process.env.DW_FIXTURE,'test');
    Reflect.set(process.env,'NODE_ENV','production'); delete process.env.DW_FIXTURE;
    loadScriptEnv(root); assert.equal(process.env.DW_FIXTURE,'override');
    process.env.DW_FIXTURE='shell'; loadScriptEnv(root); assert.equal(process.env.DW_FIXTURE,'shell');
  } finally { process.env=prior; rmSync(root,{recursive:true,force:true}); }
});

test('OSS-008/021 real SQLite persists exactly one owner and enforces FK/CHECK/FTS5/WAL', () => {
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'dw-db-'));
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    db=openDatabase({dataDir});
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);
    assert.equal(db.pragma('journal_mode',{simple:true}),'wal');
    const owner=db.prepare('SELECT id FROM visitors').get() as {id:string};
    assert.ok(owner.id);
    assert.throws(() => db!.prepare("INSERT INTO visitors(id,owner_slot,created_at,updated_at) VALUES('other',1,0,0)").run(), /UNIQUE/);
    assert.throws(() => db!.prepare("INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES('a','invalid','x','A','chibi',0,0)").run(), /FOREIGN KEY/);
    db.exec('CREATE VIRTUAL TABLE test_fts USING fts5(content)');
    db.prepare('INSERT INTO test_fts(content) VALUES(?)').run('胃镜 团子');
    assert.equal((db.prepare('SELECT count(*) n FROM test_fts WHERE test_fts MATCH ?').get('胃镜') as {n:number}).n,1);
    db.close(); db=openDatabase({dataDir});
    assert.equal((db.prepare('SELECT id FROM visitors').get() as {id:string}).id,owner.id);
  } finally { if(db?.open) db.close(); rmSync(dataDir,{recursive:true,force:true}); }
});

test('review R3 explicit offline hybrid uses fake embeddings without admitting a real credential',()=>{
 const env={APP_ENV:'test',E2E_MOCK_PROVIDERS:'1',MEMORY_RETRIEVAL_MODE:'hybrid'};
 const config=getPersonalConfig(env);assert.equal(config.memoryRetrievalMode,'hybrid');assert.equal(config.capabilities.embedding.enabled,true);
 assert.throws(()=>getPersonalConfig({...env,DASHSCOPE_API_KEY:'real-looking'}),/refuse real provider credentials/);
 assert.equal(getPersonalConfig({APP_ENV:'test',E2E_MOCK_PROVIDERS:'1'}).memoryRetrievalMode,'keyword');
});
test('review S7 offline explicit Gemini compatibility is available only in credential-free test mode',()=>{
 const mock={APP_ENV:'test',E2E_MOCK_PROVIDERS:'1',AI_TTS_PROVIDER:'openrouter-gemini'};
 assert.equal(getPersonalConfig(mock).providers.speech.provider,'openrouter-gemini');
 assert.equal(getPersonalConfig(mock).capabilities.speech.enabled,true);
 assert.throws(()=>getPersonalConfig({...mock,OPENROUTER_API_KEY:'real-looking'}),/refuse real provider credentials/);
 assert.throws(()=>getPersonalConfig({AI_TTS_PROVIDER:'openrouter-gemini'}),/requires OPENROUTER_API_KEY/);
 assert.throws(()=>getPersonalConfig({...mock,APP_ENV:'production'}),/require APP_ENV=test/);
});

test('review S3 doctor shares validation of Gemini model and public letter origin without breaking chat',()=>{
 assert.throws(()=>getPersonalConfig({OPENROUTER_API_KEY:'fixture',AI_TTS_PROVIDER:'openrouter-gemini',AI_TTS_MODEL:'invalid model'}),/AI_TTS_MODEL/);
 assert.throws(()=>getPersonalConfig({LETTER_PUBLIC_BASE_URL:'http://localhost:5000'}),/LETTER_PUBLIC_BASE_URL/);
 const mailError=getPersonalConfig({DEEPSEEK_API_KEY:'fixture',LETTER_PUBLIC_BASE_URL:'http://localhost:5000'},{strict:false});
 assert.equal(mailError.capabilities.chat.enabled,true);assert.equal(mailError.capabilities.email.enabled,false);assert.match(mailError.configurationErrors.join(),/LETTER_PUBLIC_BASE_URL/);
});
