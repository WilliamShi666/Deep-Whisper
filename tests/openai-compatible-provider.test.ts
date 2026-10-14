import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleChatProvider } from '../src/lib/ai/providers/openai-compatible-chat-provider';
import { OpenAICompatibleImageProvider } from '../src/lib/ai/providers/openai-compatible-image-provider';
import { OpenAICompatibleSpeechProvider } from '../src/lib/ai/providers/openai-compatible-speech-provider';
import { DeepSeekChatProvider } from '../src/lib/ai/providers/deepseek-chat-provider';
const connection = { model:'custom-model', baseUrl:'http://localhost:1234/v1/', apiKey:'own-key' };
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=','base64');
function transport(fn:(url:string,init:RequestInit)=>Promise<Response>):typeof fetch { return ((url,init)=>fn(String(url),init!)) as typeof fetch; }
test('compatible chat has its own URL/key and no native thinking fields',async()=>{
 const provider=new OpenAICompatibleChatProvider({...connection,fetchImpl:transport(async(url,init)=>{
  assert.equal(url,'http://localhost:1234/v1/chat/completions'); assert.equal(new Headers(init.headers).get('authorization'),'Bearer own-key');
  const body=JSON.parse(String(init.body)); assert.equal(body.model,'custom-model'); assert.equal(body.thinking,undefined); assert.equal(body.reasoning_effort,undefined);
  return Response.json({model:'upstream-alias',choices:[{message:{content:'hello'},finish_reason:'stop'}]});
 })});
 assert.equal((await provider.complete({messages:[],thinking:'enabled',reasoningEffort:'low'})).content,'hello');
});
test('compatible structured JSON and unauthenticated local endpoints',async()=>{
 const provider=new OpenAICompatibleChatProvider({...connection,apiKey:undefined,fetchImpl:transport(async(_url,init)=>{
  assert.equal(new Headers(init.headers).has('authorization'),false); const body=JSON.parse(String(init.body)); assert.deepEqual(body.response_format,{type:'json_object'});
  return Response.json({choices:[{message:{content:'{"answer":42}'}}]});
 })});
 assert.equal((await provider.completeStructured({messages:[],outputSchema:{name:'answer',schema:{type:'object'}},parse:value=>(value as {answer:number}).answer})).data,42);
});
test('compatible SSE handles split CRLF and rejects incomplete streams',async()=>{
 const chunks=['data: {"choices":[{"delta":{"content":"hi"}}]}\r','\n\r\ndata: [DONE]\r\n\r\n'];
 const provider=new OpenAICompatibleChatProvider({...connection,fetchImpl:transport(async()=>new Response(new ReadableStream({start(c){for(const part of chunks)c.enqueue(new TextEncoder().encode(part));c.close();}})))});
 assert.deepEqual(await Array.fromAsync(provider.stream({messages:[]})),['hi']);
 const broken=new OpenAICompatibleChatProvider({...connection,fetchImpl:transport(async()=>new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))});
 await assert.rejects(()=>Array.fromAsync(broken.stream({messages:[]})),/complete/);
});
test('compatible photo preserves reference bytes via multipart edits',async()=>{
 const provider=new OpenAICompatibleImageProvider({...connection,fetchImpl:transport(async(url,init)=>{
  assert.equal(url,'http://localhost:1234/v1/images/edits'); assert.ok(init.body instanceof FormData); assert.equal(new Headers(init.headers).has('content-type'),false);
  const file=init.body.get('image') as File; assert.deepEqual(Buffer.from(await file.arrayBuffer()),png); assert.equal(init.body.get('model'),'custom-model');
  return Response.json({data:[{b64_json:png.toString('base64')}]});
 })});
 const image=await provider.generate({prompt:'portrait',referenceImages:[{bytes:png,mediaType:'image/png'}]}); assert.equal(image.mediaType,'image/png');assert.deepEqual(Buffer.from(image.bytes),png);
});
test('compatible generations use JSON and reject URL-only, malformed or spoofed outputs',async()=>{
 let calls=0;
 for(const payload of [{data:[{url:'https://unsafe.test/image.png'}]},{data:[{b64_json:'not-base64'}]},{data:[{b64_json:Buffer.from('wrong').toString('base64'),media_type:'image/png'}]}]){
  const provider=new OpenAICompatibleImageProvider({...connection,fetchImpl:transport(async(url,init)=>{calls++;assert.match(url,/images\/generations$/);assert.equal(JSON.parse(String(init.body)).n,1);return Response.json(payload);})});
  await assert.rejects(()=>provider.generate({prompt:'test',referenceImages:[]}));
 }
 assert.equal(calls,3);
});
test('compatible image rejection never retries without references or exposes echoed secrets',async()=>{
 let calls=0; const provider=new OpenAICompatibleImageProvider({...connection,fetchImpl:transport(async(url)=>{calls++;assert.match(url,/images\/edits$/);return Response.json({error:{code:'content_policy_violation',message:'own-key private prompt'}},{status:400});})});
 await assert.rejects(()=>provider.generate({prompt:'private prompt',referenceImages:[{bytes:png,mediaType:'image/png'}],maxAttempts:3}),error=>error instanceof Error&&!error.message.includes('own-key')&&!error.message.includes('private prompt'));assert.equal(calls,1);
});
test('compatible speech maps saved voice gender to configured service voice',async()=>{
 const voices:string[]=[];const provider=new OpenAICompatibleSpeechProvider({...connection,voiceFemale:'service-woman',voiceMale:'service-man',fetchImpl:transport(async(url,init)=>{
  assert.match(url,/audio\/speech$/);const body=JSON.parse(String(init.body));voices.push(body.voice);assert.equal(body.model,'custom-model');assert.equal(body.response_format,'mp3');
  return new Response(Buffer.from('ID3test'),{headers:{'content-type':'audio/mpeg'}});
 })});
 assert.equal((await provider.synthesize({text:'hello',voice:'anyuqing_v3.1'})).mediaType,'audio/mpeg'); await provider.synthesize({text:'hi',voice:'voice-en-m-01'});assert.deepEqual(voices,['service-woman','service-man']);
});
test('compatible speech validates voice and audio before returning bytes',async()=>{
 let calls=0;const provider=new OpenAICompatibleSpeechProvider({...connection,fetchImpl:transport(async()=>{calls++;return new Response('<html>error</html>',{headers:{'content-type':'audio/mpeg'}});})});
 await assert.rejects(()=>provider.synthesize({text:'hello',voice:'unknown'}));assert.equal(calls,0);
 await assert.rejects(()=>provider.synthesize({text:'hello',voice:'voice-zh-f-01'}));assert.equal(calls,1);
});
test('all compatible adapters reject credential/query/fragment endpoint URLs',()=>{
 for(const baseUrl of ['https://user:pass@service.test/v1','https://service.test/v1?key=x','https://service.test/v1#x','file:///tmp']) for(const Adapter of [OpenAICompatibleChatProvider,OpenAICompatibleImageProvider,OpenAICompatibleSpeechProvider]) assert.throws(()=>new Adapter({...connection,baseUrl}));
});
test('native DeepSeek canonical endpoint and key override vendor aliases',async()=>{
 const provider=new DeepSeekChatProvider({model:'deepseek-flash',env:{AI_CHAT_BASE_URL:'https://canonical.test/v1/',AI_CHAT_API_KEY:'canonical',DEEPSEEK_BASE_URL:'https://old.test',DEEPSEEK_API_KEY:'old'},fetchImpl:transport(async(url,init)=>{assert.equal(url,'https://canonical.test/v1/chat/completions');assert.equal(new Headers(init.headers).get('authorization'),'Bearer canonical');return Response.json({choices:[{message:{content:'ok'}}]});})});
 assert.equal((await provider.complete({messages:[]})).content,'ok');
});
test('compatible response timeout and cancellation stop stalled stream readers',async()=>{
 const keepAlive=setTimeout(()=>undefined,1000);try{
  let cancelled=0;
  const fetchImpl=transport(async()=>new Response(new ReadableStream({cancel(){cancelled++;}})));
  const provider=new OpenAICompatibleChatProvider({...connection,fetchImpl});
  await assert.rejects(()=>provider.complete({messages:[],timeoutMs:20}));
  await assert.rejects(()=>Array.fromAsync(provider.stream({messages:[],timeoutMs:20})));
  assert.equal(cancelled,2);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>provider.complete({messages:[],signal:controller.signal}));
 } finally { clearTimeout(keepAlive); }
});
test('compatible image accepts multiple references and MIME-checked JPEG/WebP bytes',async()=>{
 const jpeg=Buffer.from([255,216,255,224,0,1]);const webp=Buffer.from('RIFFabcdWEBPdata');
 const provider=new OpenAICompatibleImageProvider({...connection,fetchImpl:transport(async(_url,init)=>{const files=(init.body as FormData).getAll('image[]');assert.equal(files.length,2);return Response.json({data:[{b64_json:webp.toString('base64'),media_type:'image/webp'}]});})});
 assert.equal((await provider.generate({prompt:'portrait',referenceImages:[{bytes:png,mediaType:'image/png'},{bytes:jpeg,mediaType:'image/jpeg'}]})).mediaType,'image/webp');
 await assert.rejects(()=>provider.generate({prompt:'portrait',referenceImages:[{bytes:png,mediaType:'image/jpeg'}]}));
});
test('compatible speech accepts MIME-checked WAV and never leaks upstream errors',async()=>{
 const wav=Buffer.from('RIFFabcdWAVEdata');
 const provider=new OpenAICompatibleSpeechProvider({...connection,fetchImpl:transport(async()=>new Response(wav,{headers:{'content-type':'audio/x-wav'}}))});
 assert.equal((await provider.synthesize({text:'hello',voice:'voice-zh-f-01'})).mediaType,'audio/wav');
 const failure=new OpenAICompatibleSpeechProvider({...connection,fetchImpl:transport(async()=>Response.json({error:{message:'own-key private words'}},{status:401}))});
 await assert.rejects(()=>failure.synthesize({text:'private words',voice:'voice-zh-f-01'}),error=>error instanceof Error&&!error.message.includes('own-key')&&!error.message.includes('private words'));
});
test('registries select all compatible adapters without vendor credentials',async()=>{
 const {getChatProvider}=await import('../src/lib/ai/chat-provider');const {getImageProvider}=await import('../src/lib/ai/image-provider');const {getSpeechProvider}=await import('../src/lib/ai/speech-provider');const {getVisionSafetyProvider}=await import('../src/lib/ai/vision-safety-provider');
 const changes:Record<string,string|undefined>={AI_CHAT_PROVIDER:'openai-compatible',AI_CHAT_MODEL:'local-chat',AI_CHAT_BASE_URL:'http://localhost:1234/v1',AI_IMAGE_PROVIDER:'openai-compatible',AI_IMAGE_MODEL:'local-image',AI_IMAGE_BASE_URL:'http://localhost:1234/v1',AI_TTS_PROVIDER:'openai-compatible',AI_TTS_MODEL:'local-tts',AI_TTS_BASE_URL:'http://localhost:1234/v1',DEEPSEEK_API_KEY:undefined,OPENROUTER_API_KEY:undefined,DASHSCOPE_API_KEY:undefined,AI_CHAT_API_KEY:undefined,AI_IMAGE_API_KEY:undefined,AI_TTS_API_KEY:undefined,AI_VISION_PROVIDER:undefined,AI_VISION_MODEL:undefined,AI_VISION_BASE_URL:undefined,AI_VISION_API_KEY:undefined};
 const before=Object.fromEntries(Object.keys(changes).map(key=>[key,process.env[key]]));
 try {for(const [key,value]of Object.entries(changes))if(value===undefined)delete process.env[key];else process.env[key]=value;
  assert.ok(getChatProvider() instanceof OpenAICompatibleChatProvider);assert.ok(getImageProvider() instanceof OpenAICompatibleImageProvider);assert.ok(getSpeechProvider() instanceof OpenAICompatibleSpeechProvider);assert.ok(getVisionSafetyProvider());
 }finally{for(const[key,value]of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('Qwen fallback keeps Gemini legacy model, key and URL independent from primary overrides',async()=>{
 const {getSpeechProvider}=await import('../src/lib/ai/speech-provider');const before=globalThis.fetch;const calls:string[]=[];
 try{globalThis.fetch=transport(async(url,init)=>{calls.push(url);const key=new Headers(init.headers).get('authorization');const body=JSON.parse(String(init.body));
   if(url.startsWith('https://primary.test/')){assert.equal(key,'Bearer primary-key');assert.equal(body.model,'custom-qwen');return Response.json({code:'Rejected'},{status:500});}
   assert.equal(url,'https://fallback.test/v1/audio/speech');assert.equal(key,'Bearer fallback-key');assert.equal(body.model,'google/gemini-3.1-flash-tts-preview');return new Response(new Uint8Array([1,2,3,4]),{headers:{'content-type':'audio/pcm'}});
  });
  const provider=getSpeechProvider({AI_TTS_PROVIDER:'qwen-audio',AI_TTS_MODEL:'custom-qwen',AI_TTS_BASE_URL:'https://primary.test/v1',AI_TTS_API_KEY:'primary-key',OPENROUTER_BASE_URL:'https://fallback.test/v1',OPENROUTER_API_KEY:'fallback-key'});
  assert.equal((await provider.synthesize({text:'hello',voice:'voice-zh-f-01'})).mediaType,'audio/wav');assert.equal(calls.length,2);
 }finally{globalThis.fetch=before;}
});
test('native resolved vision connection never borrows canonical chat credentials',async()=>{
 let calls=0;
 const provider=new DeepSeekChatProvider({model:'deepseek-flash',baseUrl:'https://vision.test/v1',apiKey:undefined,env:{AI_CHAT_API_KEY:'private-chat-key'},fetchImpl:transport(async()=>{calls++;return Response.json({});})});
 await assert.rejects(()=>provider.complete({messages:[],maxAttempts:1}),/Missing API key/);assert.equal(calls,0);
});
test('compatible image HTTP 200 policy errors retain conservative-scene classification',async()=>{
 const provider=new OpenAICompatibleImageProvider({...connection,fetchImpl:transport(async()=>Response.json({error:{type:'content_policy_violation',message:'private upstream'}}))});
 await assert.rejects(()=>provider.generate({prompt:'test',referenceImages:[{bytes:png,mediaType:'image/png'}]}),error=>error instanceof Error&&'code'in error&&error.code==='policy_rejected'&&!error.message.includes('private upstream'));
});
test('compatible chat cancellation sanitizes caller abort reason',async()=>{
 const controller=new AbortController();const provider=new OpenAICompatibleChatProvider({...connection,fetchImpl:transport(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));}})))});
 const stream=provider.stream({messages:[],signal:controller.signal})[Symbol.asyncIterator]();assert.equal((await stream.next()).value,'hi');controller.abort(new Error('private-key-from-custom-abort'));
 await assert.rejects(()=>stream.next(),error=>error instanceof Error&&!error.message.includes('private-key')&&'code'in error&&error.code==='aborted');
});
