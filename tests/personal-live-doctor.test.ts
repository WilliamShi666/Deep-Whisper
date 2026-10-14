import test from 'node:test';import assert from 'node:assert/strict';
import {selectLiveDoctorProbe} from '../scripts/personal/live-doctor';
test('OSS-006 live doctor cannot dispatch without an explicit named and bounded paid probe',()=>{
 assert.throws(()=>selectLiveDoctorProbe(['--live'],{}),/requires --provider/);
 assert.throws(()=>selectLiveDoctorProbe(['--live','--provider','qwen-tts'],{}),/acknowledge/);
 const env={AI_PROVIDER_LIVE_CANARY:'I_UNDERSTAND_THIS_IS_PAID',AI_PROVIDER_LIVE_MAX_REQUESTS:'1',AI_PROVIDER_LIVE_MAX_COST_USD:'0.01'};
 assert.deepEqual(selectLiveDoctorProbe(['--live','--provider','qwen-tts'],env),{script:'test-qwen-tts-live.ts',requests:1});
 assert.throws(()=>selectLiveDoctorProbe(['--live','--provider','deepseek'],env),/exactly 5/);
 assert.throws(()=>selectLiveDoctorProbe(['--live','--provider','qwen-tts'],{...env,AI_PROVIDER_LIVE_MAX_COST_USD:'0.1'}),/at most/);
});
