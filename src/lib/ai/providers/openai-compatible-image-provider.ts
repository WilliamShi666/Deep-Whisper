import { ProviderError, type GeneratedImage, type ImageGenerationRequest, type ImageProvider } from '../contracts';
import { readModelId } from '@/lib/config/runtime';
import { boundedJson, isCompatiblePolicyError, compatibleHeaders, compatibleRequest, compatibleSignal, normalizeApiBaseUrl, type CompatibleConnection } from './compatible-http';
const MAX_OUTPUT_BYTES=20*1024*1024;
const MAX_REFERENCE_BYTES=10*1024*1024;
function imageType(bytes: Uint8Array): string | undefined {
  const buffer=Buffer.from(bytes);
  if(buffer.length>=8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buffer.length>=3 && buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
}
interface ImagePayload { id?:string; model?:string; error?:unknown; data?:Array<{b64_json?:string;media_type?:string}> }
export class OpenAICompatibleImageProvider implements ImageProvider {
  constructor(private readonly connection: CompatibleConnection) { normalizeApiBaseUrl(connection.baseUrl);readModelId(connection.model,'AI_IMAGE_MODEL'); }
  async generate(input: ImageGenerationRequest): Promise<GeneratedImage> {
    if(!input.prompt.trim())throw new ProviderError('AI image requires a prompt','bad_request',false);
    if(input.referenceImages.length>16)throw new ProviderError('AI image has too many references','bad_request',false);
    for(const reference of input.referenceImages){
      if(!reference.bytes.length||reference.bytes.length>MAX_REFERENCE_BYTES||imageType(reference.bytes)!==reference.mediaType)throw new ProviderError('AI image reference has invalid MIME, signature or size','bad_request',false);
    }
    const signal=compatibleSignal(input);const headers=compatibleHeaders(this.connection.apiKey);let body:FormData|string;let path:string;
    if(input.referenceImages.length){
      path='/images/edits';const form=new FormData();form.set('model',this.connection.model);form.set('prompt',input.prompt);form.set('n','1');
      input.referenceImages.forEach((reference,index)=>{const extension=reference.mediaType==='image/jpeg'?'jpg':reference.mediaType.split('/')[1];form.append(input.referenceImages.length===1?'image':'image[]',new Blob([Uint8Array.from(reference.bytes)],{type:reference.mediaType}),`reference-${index}.${extension}`);});
      body=form;
    }else{
      path='/images/generations';headers['Content-Type']='application/json';body=JSON.stringify({model:this.connection.model,prompt:input.prompt,n:1});
    }
    const startedAt=Date.now();const response=await compatibleRequest(this.connection,path,{method:'POST',headers,body},input,signal);
    const maxEncoded=Math.ceil(MAX_OUTPUT_BYTES/3)*4;const payload=await boundedJson<ImagePayload>(response,maxEncoded+1024*1024,signal);
    if(payload.error)throw new ProviderError('AI image returned an error response',isCompatiblePolicyError(payload.error)?'policy_rejected':'invalid_response',false);
    const image=payload.data?.[0];const base64=image?.b64_json;
    if(payload.error||typeof base64!=='string'||!base64||base64.length>maxEncoded||base64.length%4!==0||!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(base64))throw new ProviderError('AI image returned invalid Base64 or an unsupported response','invalid_response',false);
    const bytes=Buffer.from(base64,'base64');const mediaType=imageType(bytes);
    if(!bytes.length||bytes.length>MAX_OUTPUT_BYTES||!mediaType||(image?.media_type&&image.media_type!==mediaType))throw new ProviderError('AI image returned invalid MIME, signature or size','invalid_response',false);
    return {bytes,mediaType,model:typeof payload.model==='string'?payload.model:this.connection.model,providerRequestId:payload.id,durationMs:Date.now()-startedAt};
  }
}
