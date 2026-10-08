import { ProviderError, type ChatProvider, type ChatRequest, type ChatCompletion, type StructuredChatRequest, type StructuredChatCompletion, type StructuredOutputSchema } from '../contracts';
import { readModelId } from '@/lib/config/runtime';
import { boundedJson, compatibleFailure, compatibleHeaders, compatibleRequest, compatibleSignal, normalizeApiBaseUrl, type CompatibleConnection } from './compatible-http';
interface CompletionPayload {
  id?: string; model?: string; error?: unknown;
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
export class OpenAICompatibleChatProvider implements ChatProvider {
  constructor(private readonly connection: CompatibleConnection) { normalizeApiBaseUrl(connection.baseUrl); readModelId(connection.model, 'AI_CHAT_MODEL / AI_VISION_MODEL'); }
  private async request(input: ChatRequest, stream: boolean, schema?: StructuredOutputSchema): Promise<{ response: Response; signal: AbortSignal }> {
    const signal = compatibleSignal(input);
    const messages = schema ? [{role:'system',content:`Return only valid JSON matching schema ${schema.name}: ${JSON.stringify(schema.schema)}`},...input.messages] : input.messages;
    const response = await compatibleRequest(this.connection, '/chat/completions', {
      method:'POST', headers:{...compatibleHeaders(this.connection.apiKey),'Content-Type':'application/json'},
      body:JSON.stringify({model:this.connection.model,messages,stream,...(input.temperature === undefined ? {} : {temperature:input.temperature}),...(schema ? {response_format:{type:'json_object'}} : {})}),
    },input,signal);
    return {response,signal};
  }
  private completion(payload: CompletionPayload): ChatCompletion {
    const choice=payload.choices?.[0];
    const raw=choice?.message?.content;
    const content=typeof raw==='string' ? raw : Array.isArray(raw) ? raw.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('') : '';
    if(payload.error || !content || (choice?.finish_reason && choice.finish_reason!=='stop')) throw new ProviderError('AI returned an empty or incomplete completion','invalid_response',false);
    return {content,model:typeof payload.model==='string'?payload.model:this.connection.model,finishReason:choice?.finish_reason,providerRequestId:payload.id,usage:payload.usage ? {inputTokens:payload.usage.prompt_tokens,outputTokens:payload.usage.completion_tokens,totalTokens:payload.usage.total_tokens} : undefined};
  }
  async complete(input: ChatRequest): Promise<ChatCompletion> {
    const {response,signal}=await this.request(input,false);
    return this.completion(await boundedJson<CompletionPayload>(response,4*1024*1024,signal));
  }
  async completeStructured<T>(input: StructuredChatRequest<T>): Promise<StructuredChatCompletion<T>> {
    const {response,signal}=await this.request(input,false,input.outputSchema);
    const completion=this.completion(await boundedJson<CompletionPayload>(response,4*1024*1024,signal));
    try { return {...completion,data:input.parse(JSON.parse(completion.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')) as unknown)}; }
    catch { throw new ProviderError('AI returned malformed structured JSON','invalid_response',false); }
  }
  async *stream(input: ChatRequest): AsyncIterable<string> {
    const {response,signal}=await this.request(input,true);
    if(!response.body) throw new ProviderError('AI returned an empty stream','invalid_response',false);
    const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';let completed=false;
    const abort=()=>{void reader.cancel().catch(()=>undefined);}; signal.addEventListener('abort',abort,{once:true});
    const consume=(event:string):string|undefined=>{
      const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;
      if(data==='[DONE]'){completed=true;return;}
      let payload:{error?:unknown;choices?:Array<{delta?:{content?:unknown};finish_reason?:string|null}>};
      try{payload=JSON.parse(data);}catch{throw new ProviderError('AI returned malformed streaming data','invalid_response',false);}
      if(payload.error)throw new ProviderError('AI stream returned an error','invalid_response',false);
      const choice=payload.choices?.[0];if(choice?.finish_reason){if(choice.finish_reason!=='stop')throw new ProviderError('AI reply did not complete normally','invalid_response',false);completed=true;}
      return typeof choice?.delta?.content==='string'?choice.delta.content:undefined;
    };
    try {
      while(!completed){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();buffer+=decoder.decode(value,{stream:!done});buffer=buffer.replace(/\r\n/g,'\n');
        if(buffer.length>1024*1024)throw new ProviderError('AI streaming frame exceeds size limit','invalid_response',false);
        let boundary=buffer.indexOf('\n\n');while(boundary!==-1){const text=consume(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);if(text)yield text;if(completed)break;boundary=buffer.indexOf('\n\n');}
        if(done)break;
      }
      if(!completed&&buffer.trim()){const text=consume(buffer);if(text)yield text;}
      if(!completed)throw new ProviderError('AI stream ended before the reply completed','invalid_response',false);
    } catch (error) { throw compatibleFailure(error,signal,input); } finally {signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  }
}
