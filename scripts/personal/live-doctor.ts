import {IMAGE_CANARY_REQUESTS} from '../lib/image-canary-plan';
import {requireLiveCanaryApproval} from '../lib/live-canary-guard';
import type {RuntimeEnvironment} from '../../src/lib/config/runtime';
const probes={
 deepseek:{script:'test-deepseek-live.ts',requests:5,ceiling:0.25},
 image:{script:'test-openrouter-image-live.ts',requests:IMAGE_CANARY_REQUESTS,ceiling:1},
 'qwen-tts':{script:'test-qwen-tts-live.ts',requests:1,ceiling:0.01},
 'gemini-tts':{script:'test-openrouter-gemini-tts-live.ts',requests:1,ceiling:0.01},
} as const;
export function selectLiveDoctorProbe(args:readonly string[],env:RuntimeEnvironment){
 const index=args.indexOf('--provider');const provider=args[index+1];
 if(index<0||!Object.hasOwn(probes,provider))throw new Error('doctor --live requires --provider deepseek|image|qwen-tts|gemini-tts and the explicit canary request/cost budget');
 const probe=probes[provider as keyof typeof probes];
 requireLiveCanaryApproval(env,{expectedRequests:probe.requests,hardCostCeilingUsd:probe.ceiling});
 return {script:probe.script,requests:probe.requests};
}
