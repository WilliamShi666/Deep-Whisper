import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLocalObjectStore,readPrivateMedia,parseByteRange} from '../src/lib/storage/local-object-store';
import {enterMaintenance} from '../src/lib/personal/maintenance';
test('OSS-035 local production media is private, byte exact and rejects traversal/symlinks',async()=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'dw-media-'));
 const outside=mkdtempSync(path.join(os.tmpdir(),'dw-outside-'));
 try {
  const store=createLocalObjectStore(dataDir);
  const saved=await store.put({key:'tts/voice-zh-f-01/sample.wav',bytes:Buffer.from('sample'),mediaType:'audio/wav'});
  assert.equal(saved.url,'/api/media/tts/voice-zh-f-01/sample.wav');
  const file=await readPrivateMedia('tts/voice-zh-f-01/sample.wav',dataDir);
  assert.equal(file.bytes.toString(),'sample');assert.equal(file.mediaType,'audio/wav');
  for(const key of ['../private/session.key','/absolute','tts\\escape','tts/%2e%2e/key']) await assert.rejects(()=>store.put({key,bytes:Buffer.from('x'),mediaType:'audio/wav'}));
  mkdirSync(path.join(dataDir,'media','photos'),{recursive:true});
  symlinkSync(outside,path.join(dataDir,'media','photos','escape'));
  await assert.rejects(()=>store.put({key:'photos/escape/image.png',bytes:Buffer.from('x'),mediaType:'image/png'}),/symbolic/i);
 }finally{rmSync(dataDir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('OSS-035 audio byte ranges are validated including suffix and unsatisfiable ranges',()=>{
 assert.deepEqual(parseByteRange('bytes=1-3',6),{start:1,end:3});
 assert.deepEqual(parseByteRange('bytes=-2',6),{start:4,end:5});
 assert.deepEqual(parseByteRange('bytes=2-',6),{start:2,end:5});
 assert.throws(()=>parseByteRange('bytes=9-',6));assert.throws(()=>parseByteRange('bytes=0-1,3-4',6));
});
test('OSS-036 maintenance pauses new media writes and releases after backup',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'dw-pause-'));
 const leave=enterMaintenance(dir);
 try{await assert.rejects(()=>createLocalObjectStore(dir).put({key:'tts/sample.wav',bytes:Buffer.from('x'),mediaType:'audio/wav'}),/maintenance/i);}
 finally{leave();}
 await createLocalObjectStore(dir).put({key:'tts/sample.wav',bytes:Buffer.from('x'),mediaType:'audio/wav'});
 rmSync(dir,{recursive:true,force:true});
});
