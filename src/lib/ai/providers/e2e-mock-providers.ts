import type {
  EmbeddingProvider,
  EmbeddingRequest,
} from '@/lib/ai/embedding-contracts';
import { EMBEDDING_DIMENSIONS } from './dashscope-embedding-provider';
import type {
  ChatProvider,
  ChatRequest,
  ChatCompletion,
  StructuredChatRequest,
  StructuredChatCompletion,
  ImageProvider,
  ImageGenerationRequest,
  GeneratedImage,
  VisionInspectionRequest,
  VisionInspectionResult,
  SpeechProvider,
  SpeechSynthesisRequest,
  GeneratedSpeech,
  VisionSafetyProvider,
} from '@/lib/ai/contracts';
import { ProviderError } from '@/lib/ai/contracts';
import { createHash } from 'node:crypto';
import {
  consumeE2EImageFailure,
  getE2EMockTrace,
  type E2EMockImageCall,
} from './e2e-mock-trace';
import { OPENING_DIRECTIVE_PREFIX } from '@/lib/prompts';

/**
 * 开场白引导语由 /api/chat 以 user 角色下发，但它不是用户发言，而是一条系统指令。
 * 「用户有没有在索要照片」只应由用户真正说的话决定，否则引导语里那句
 * 「"看到你朋友圈/动态/照片"这类内容说出来就露馅了」会被读成「照片…来」而误触发，
 * 让普通开场凭空多出一张照片。
 *
 * ⚠️ 前缀**按语言给出**（`OPENING_DIRECTIVE_PREFIX` 是 `Record<Locale, string>`）：
 * 替身不知道这一轮是哪种语言（它只看消息文本），所以**两种语言的前缀都要认**。
 * 中文态只比中文前缀一样成立；漏掉英文前缀会让英文态开场白被当成用户发言 →
 * 照片判定误触发。类型上也不可能再写成 `startsWith(OPENING_DIRECTIVE_PREFIX)`。
 */
const OPENING_DIRECTIVE_PREFIXES = Object.values(OPENING_DIRECTIVE_PREFIX);

function isOpeningDirective(content: unknown): boolean {
  return typeof content === 'string'
    && OPENING_DIRECTIVE_PREFIXES.some((prefix) => content.startsWith(prefix));
}

/**
 * complete() 在服务端的唯一调用方是记忆整理器，它要求返回一个 JSON MemoryPlan。
 * 默认空计划保持普通测试轮无副作用。专用合成标记只取新一轮用户原文，
 * 让真实 worker 的提取、落库、召回和删除链路能够端到端验收。
 * 此前回自然语言会让整理器每轮都抛 malformed JSON，只在日志里留下噪声。
 */
const EMPTY_MEMORY_PLAN_JSON = '{"operations":[]}';

export class E2EMockChatProvider implements ChatProvider {
  async complete(input: ChatRequest): Promise<ChatCompletion> {
    const prompt=input.messages.findLast(message=>message.role==='user')?.content;
    const userText=typeof prompt==='string'?prompt.match(/【新对话】\n用户：([\s\S]*?)\n角色：/)?.[1]:undefined;
    const fact=userText?.match(/\[E2E_MEMORY_FACT:([^\]\r\n]{2,500})\]/)?.[1]?.trim();
    if(fact && fact.length>=2) return {content:JSON.stringify({operations:[{action:'ADD',text:fact,layer:'L3',bucket:'key_detail',domain:'preference',memoryType:'preference',confidence:'explicit',importance:0.8,reason:'explicit synthetic E2E user fact'}]}),model:'e2e-mock-chat'};
    return { content: EMPTY_MEMORY_PLAN_JSON, model: 'e2e-mock-chat' };
  }

  async *stream(input: ChatRequest): AsyncIterable<string> {
    const delayMs = getE2EMockTrace().config.chatChunkDelayMs;
    const replyPrefix = getE2EMockTrace().config.chatReplyPrefix;
    // 观察记录保留最后一条 user 消息的原样（开场时就是那条系统引导语本身）：
    // trace 说的是「provider 实际收到了什么」，不是判定结果。判定「TA 有没有在索要
    // 照片」是另一个问题，所以单独跳过引导语检索。两者混用会让观察记录被判定逻辑
    // 改写，测试就再也看不出 provider 收到了什么。
    const receivedUserMessage = input.messages.findLast((message) => message.role === 'user')?.content;
    const userRequest = input.messages.findLast(
      (message) => message.role === 'user' && !isOpeningDirective(message.content),
    )?.content;
    const explicitlyRequestsPhoto = typeof userRequest === 'string'
      && /(?:发|给|来|想看|看看).{0,8}(?:照片|自拍)|(?:照片|自拍).{0,8}(?:发|给|来|想看|看看)/.test(userRequest);
    const text = replyPrefix + (explicitlyRequestsPhoto
      ? '好呀，给你一张数字形象照片。\n[PHOTO:穿着完整日常服装坐在月夜窗边微笑]'
      : '我在这里，愿意认真听你说。');
    getE2EMockTrace().chatStreams.push({
      latestUser: typeof receivedUserMessage === 'string' ? receivedUserMessage : null,
      photoRequested: explicitlyRequestsPhoto,
    });
    getE2EMockTrace().chatSystemPrompts.push(input.messages
      .filter((message) => message.role === 'system')
      .map((message) => String(message.content)).join('\n'));
    yield text.slice(0, Math.ceil(text.length / 2));
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    yield text.slice(Math.ceil(text.length / 2));
  }

  async completeStructured<T>(input: StructuredChatRequest<T>): Promise<StructuredChatCompletion<T>> {
    const latestUser = input.messages.findLast((message) => message.role === 'user')?.content;
    getE2EMockTrace().structuredCalls.push({
      schema: input.outputSchema.name,
      latestUser: typeof latestUser === 'string' ? latestUser : null,
    });
    const delayMs = getE2EMockTrace().config.personaDelayMs;
    if (input.outputSchema.name === 'persona_enhancement' && delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        input.signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('E2E structured mock aborted'));
        }, { once: true });
      });
    }
    const letterAnchors = typeof latestUser === 'string' ? [...latestUser.matchAll(/^- id=(.+?): /gm)].slice(0,3).map(match=>match[1]) : [];
    const raw = input.outputSchema.name === 'companion_letter'
      ? {subject:'A small note for you',body:'I am thinking of you today. You can return here whenever you want to talk.',anchorIds:letterAnchors}
      : input.outputSchema.name === 'persona_enhancement'
      ? { persona: '温柔而坦诚，会先完整听完对方的感受，再用清楚而有分寸的方式回应；不虚构现实经历，也尊重对方做决定的节奏。' }
      : { safe: true, reason: 'local e2e mock' };
    return { content: JSON.stringify(raw), model: 'e2e-mock-chat', data: input.parse(raw) };
  }
}

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
));

export class E2EMockImageProvider implements ImageProvider {
  async generate(input: ImageGenerationRequest): Promise<GeneratedImage> {
    const shouldFail = consumeE2EImageFailure();
    const failureCode = getE2EMockTrace().config.imageFailureCode;
    const delayMs = getE2EMockTrace().config.imageDelayMs;
    const trace: E2EMockImageCall = {
      prompt: input.prompt,
      referenceSha256: input.referenceImages.map((image) =>
        createHash('sha256').update(image.bytes).digest('hex')),
      referenceByteLengths: input.referenceImages.map((image) => image.bytes.byteLength),
      size: input.size,
      aspectRatio: input.aspectRatio,
      outcome: shouldFail ? failureCode : 'success',
    };
    getE2EMockTrace().imageCalls.push(trace);
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (shouldFail) throw new ProviderError('Local E2E forced image failure', failureCode, failureCode !== 'policy_rejected');
    return { bytes: ONE_PIXEL_PNG, mediaType: 'image/png', model: 'e2e-mock-image', costUsd: 0 };
  }
}

export class E2EMockVisionSafetyProvider implements VisionSafetyProvider {
  async inspect(_input: VisionInspectionRequest): Promise<VisionInspectionResult> {
    return { safe: true, reason: 'local e2e mock' };
  }
}

const MOCK_WAV_SAMPLE_RATE = 24_000;
const MOCK_WAV_DURATION_MS = 1_200;

/**
 * 一段真实可播的静音 WAV。E2E 需要的是浏览器 <audio> 真的能 load 并 fire ended，
 * 所以不能只回几个字节；用静音而不是噪声，是为了让用例的等待时间可预期。
 */
function mockSilentWav(): Uint8Array {
  const frames = Math.round((MOCK_WAV_SAMPLE_RATE * MOCK_WAV_DURATION_MS) / 1000);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(MOCK_WAV_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(MOCK_WAV_SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buffer);
}

export class E2EMockSpeechProvider implements SpeechProvider {
  async synthesize(input: SpeechSynthesisRequest): Promise<GeneratedSpeech> {
    getE2EMockTrace().speechCalls.push({ text: input.text, voice: input.voice });
    const delayMs = getE2EMockTrace().config.speechDelayMs;
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return { bytes: mockSilentWav(), mediaType: 'audio/wav', model: 'e2e-mock-speech' };
  }
}

/**
 * E2E 下的 embedding mock：本地 E2E 必须可判定，绝不能打真实 DashScope。
 *
 * 为什么用确定性向量而不是随机数：召回结果必须可复现 —— 随机向量会让同一条记忆
 * 每次召回的排名都不同，E2E 断言就会随机红绿。这里按文本内容做哈希，
 * 同一文本永远得到同一向量、不同文本几乎必然得到不同向量。
 */
export class E2EMockEmbeddingProvider implements EmbeddingProvider {
  async embed(request: EmbeddingRequest): Promise<number[][]> {
    if (request.texts.length === 0) return [];
    getE2EMockTrace().embeddingCalls.push({ count: request.texts.length });
    return request.texts.map((text) => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (let index = 0; index < text.length; index += 1) {
        vector[index % EMBEDDING_DIMENSIONS] += text.charCodeAt(index) / 1000;
      }
      return vector;
    });
  }
}
