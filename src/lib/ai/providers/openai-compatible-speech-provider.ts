import { ProviderError, type GeneratedSpeech, type SpeechProvider, type SpeechSynthesisRequest } from '../contracts';
import { readModelId } from '@/lib/config/runtime';
import { toPublicVoiceId, upstreamVoiceIdFor } from '../qwen-voice-map';
import { getQwenVoice } from '../qwen-voices';
import { boundedBytes, compatibleFailure, compatibleHeaders, compatibleRequest, compatibleSignal, normalizeApiBaseUrl, type CompatibleConnection } from './compatible-http';
interface CompatibleSpeechConnection extends CompatibleConnection { voiceFemale?:string;voiceMale?:string }
function audioType(bytes:Uint8Array):string|undefined {
  const buffer=Buffer.from(bytes);
  if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WAVE')return 'audio/wav';
  if(buffer.length>=3&&(buffer.toString('ascii',0,3)==='ID3'||(buffer[0]===255&&(buffer[1]!&0xe0)===0xe0)))return 'audio/mpeg';
}
export class OpenAICompatibleSpeechProvider implements SpeechProvider {
  constructor(private readonly connection: CompatibleSpeechConnection) { normalizeApiBaseUrl(connection.baseUrl);readModelId(connection.model,'AI_TTS_MODEL'); }
  async synthesize(input:SpeechSynthesisRequest):Promise<GeneratedSpeech> {
    const text=input.text.trim();if(!text||text.length>10000)throw new ProviderError('Speech text is empty or too long','bad_request',false);
    const publicVoice=toPublicVoiceId(input.voice);const sourceVoice=publicVoice?getQwenVoice(upstreamVoiceIdFor(publicVoice)):undefined;
    if(!sourceVoice)throw new ProviderError('Speech voice is not in the reviewed catalog','bad_request',false);
    const voice=sourceVoice.gender==='female'?(this.connection.voiceFemale??'alloy'):(this.connection.voiceMale??'onyx');
    const signal=compatibleSignal(input);const response=await compatibleRequest(this.connection,'/audio/speech',{
      method:'POST',headers:{...compatibleHeaders(this.connection.apiKey),'Content-Type':'application/json'},
      body:JSON.stringify({model:this.connection.model,input:text,voice,response_format:'mp3',...(input.speed===undefined?{}:{speed:input.speed})}),
    },input,signal);
    const declared=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if(!declared||!['audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav'].includes(declared)){await response.body?.cancel();throw new ProviderError('AI speech returned an unsupported audio MIME','invalid_response',false);}
    let bytes:Uint8Array;try{bytes=await boundedBytes(response,20*1024*1024,signal);}catch(error){throw compatibleFailure(error,signal,input);}
    const mediaType=audioType(bytes);
    if(!mediaType||(mediaType==='audio/mpeg'?!['audio/mpeg','audio/mp3'].includes(declared):!['audio/wav','audio/wave','audio/x-wav'].includes(declared)))throw new ProviderError('AI speech returned invalid audio data','invalid_response',false);
    return {bytes,mediaType,model:this.connection.model};
  }
}
