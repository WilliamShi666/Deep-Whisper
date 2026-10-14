import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateOwnerRequest, createOwnerSession, validateOwnerSession, attemptOwnerLogin } from '../src/lib/personal/owner';

test('OSS-009 local Host/Origin/Fetch-Metadata rejection happens before any owner data',()=>{
  const env={PORT:'5000'};
  assert.doesNotThrow(()=>validateOwnerRequest(new Request('http://127.0.0.1:5000/api/profile',{headers:{host:'127.0.0.1:5000'}}),env));
  assert.throws(()=>validateOwnerRequest(new Request('http://127.0.0.1:5000/api/chat',{method:'POST',headers:{host:'127.0.0.1:5000',origin:'https://evil.example'}}),env), /Origin/);
  assert.throws(()=>validateOwnerRequest(new Request('http://127.0.0.1:5000/api/profile',{headers:{host:'evil.example:5000'}}),env), /Host/);
  assert.throws(()=>validateOwnerRequest(new Request('http://127.0.0.1:5000/api/profile',{headers:{host:'127.0.0.1:5000','sec-fetch-site':'cross-site'}}),env), /cross-site/);
  assert.throws(()=>validateOwnerRequest(new Request('http://127.0.0.1:5000/api/chat',{method:'POST',headers:{host:'127.0.0.1:5000'}}),env), /Origin/);
});
test('OSS-010 password sessions expire, are tamper proof and rotate with password',()=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'dw-owner-'));
  const env={APP_DATA_DIR:dataDir,APP_ACCESS_MODE:'password',OWNER_PASSWORD:'correct sufficiently long password',APP_BASE_URL:'https://personal.example',HOST:'0.0.0.0'};
  try {
    const session=createOwnerSession(env,1000);
    assert.equal(validateOwnerSession(session,env,1100),true);
    assert.equal(validateOwnerSession(session+'bad',env,1100),false);
    assert.equal(validateOwnerSession(session,{...env,OWNER_PASSWORD:'rotated sufficiently long password'},1100),false);
    assert.equal(validateOwnerSession(session,env,1000+8*24*60*60*1000),false);
    assert.throws(()=>validateOwnerRequest(new Request('https://personal.example/api/profile',{headers:{host:'personal.example'}}),env), /Authentication/);
    assert.doesNotThrow(()=>validateOwnerRequest(new Request('https://personal.example/api/profile',{headers:{host:'personal.example',cookie:`dw_owner=${createOwnerSession(env)}`}}),env));
    for(let i=0;i<10;i++) assert.equal(attemptOwnerLogin('bad',env,2000).authenticated,false);
    assert.equal(attemptOwnerLogin(env.OWNER_PASSWORD,env,2000).status,429);
    assert.equal(attemptOwnerLogin(env.OWNER_PASSWORD,env,2000+16*60*1000).authenticated,true);
  } finally {rmSync(dataDir,{recursive:true,force:true});}
});
