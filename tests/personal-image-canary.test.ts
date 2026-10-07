import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {personalImageCanaryCases,IMAGE_CANARY_REQUESTS} from '../scripts/lib/image-canary-plan';
import {selectLiveDoctorProbe} from '../scripts/personal/live-doctor';
test('review S8 image canary matches eight normal references, real MIME and current budget dispatch',()=>{
 const cases=personalImageCanaryCases();assert.equal(cases.length,8);assert.equal(IMAGE_CANARY_REQUESTS,8);
 for(const item of cases){assert.equal(item.mediaType,'image/png');assert.ok(item.referencePath.includes('normal'));const bytes=readFileSync('public/'+item.referencePath.replace(/^\//,''));assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);}
 assert.deepEqual(selectLiveDoctorProbe(['--live','--provider','image'],{AI_PROVIDER_LIVE_CANARY:'I_UNDERSTAND_THIS_IS_PAID',AI_PROVIDER_LIVE_MAX_REQUESTS:'8',AI_PROVIDER_LIVE_MAX_COST_USD:'0.5'}),{script:'test-openrouter-image-live.ts',requests:8});
 const script=readFileSync('scripts/test-openrouter-image-live.ts','utf8');assert.doesNotMatch(script,/createR2ObjectStore|requires OBJECT_STORAGE_PROVIDER=r2|exactly ten/);assert.match(script,/getObjectStore/);assert.match(script,/getProviderConfig/);
});
