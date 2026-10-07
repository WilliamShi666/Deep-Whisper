import { ProviderError, type ChatProvider } from '@/lib/ai/contracts';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

export const PERSONA_MAX_LENGTH = 600;
export const PERSONA_ENHANCE_TIMEOUT_MS = 20_000;

/**
 * 人格完善的入参选项（U7 / t8）。
 *
 * 第三个参数从裸 `timeoutMs` 改成选项对象：调用点原本都只传两个参数，所以这次改动
 * 对既有调用零影响，而语言有了明确的落点。
 */
export interface PersonaEnhancementOptions {
  timeoutMs?: number;
  /**
   * 访客语言（`visitors.locale`，D3：服务端读库，不信任客户端传的 header）。
   * 缺省中文 → 既有调用行为逐字符不变。
   */
  locale?: Locale;
}

export class PersonaEnhancementError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_INPUT' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'UPSTREAM',
  ) {
    super(message);
    this.name = 'PersonaEnhancementError';
  }
}

export function validatePersonaDraft(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PersonaEnhancementError('请输入性格描述', 'INVALID_INPUT');
  }
  const draft = value.trim();
  if (!draft) throw new PersonaEnhancementError('请输入性格描述', 'INVALID_INPUT');
  if (draft.length > PERSONA_MAX_LENGTH) {
    throw new PersonaEnhancementError('性格描述不能超过 600 个字符', 'INVALID_INPUT');
  }
  return draft;
}

export function parseEnhancedPersona(value: unknown): string {
  if (!value || typeof value !== 'object' || !('persona' in value)) {
    throw new PersonaEnhancementError('返回的性格文本格式无效', 'INVALID_OUTPUT');
  }
  const persona = typeof value.persona === 'string' ? value.persona.trim() : '';
  if (persona.length < 20 || persona.length > PERSONA_MAX_LENGTH) {
    throw new PersonaEnhancementError('返回的性格文本长度无效', 'INVALID_OUTPUT');
  }
  // 注入护栏：中文组是既有口径，英文组是同义的英文形态（英文态产出的文本必须同样被拦）。
  if (
    /忽略.{0,12}(指令|要求)|不是\s*AI|system\s*prompt|系统提示|隐藏指令/i.test(persona)
    || /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous\s+|prior\s+)?(?:instructions?|rules?|prompts?)/i.test(persona)
    || /\bnot\s+an?\s+ai\b/i.test(persona)
    || /hidden\s+instructions?/i.test(persona)
  ) {
    throw new PersonaEnhancementError('返回的性格文本包含无效指令', 'INVALID_OUTPUT');
  }
  return persona;
}

/**
 * 模型偶发不吐纯 JSON（或形状不合格）时，最多再试一次。
 *
 * 全部尝试共用同一个 AbortController，所以总时长仍然只受 timeoutMs 约束 ——
 * 不会因为重试把等待时间翻倍。
 */
const PERSONA_ENHANCE_ATTEMPTS = 2;

/**
 * 这个失败值得再试一次吗？
 *
 * 只认「模型这次没说好」这一类：结构化输出解析失败（ProviderError
 * `invalid_response`），或解析出来的形状不合格（INVALID_OUTPUT）。
 * 超时、网络、鉴权、限流都不在这里重试 —— 那些重试只会白等并重复计费。
 */
function isWorthRetrying(error: unknown): boolean {
  if (error instanceof PersonaEnhancementError) return error.code === 'INVALID_OUTPUT';
  return error instanceof ProviderError && error.code === 'invalid_response' && error.retryable;
}

export async function enhancePersona(
  provider: ChatProvider,
  draftValue: unknown,
  options: PersonaEnhancementOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? PERSONA_ENHANCE_TIMEOUT_MS;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const draft = validatePersonaDraft(draftValue);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= PERSONA_ENHANCE_ATTEMPTS; attempt += 1) {
      try {
        const completion = await provider.completeStructured({
          messages: [
            {
              role: 'system',
              content: locale === 'en'
                // 英文态是**英文重写**：模型收到的指令与产出都必须是英文，否则用户会拿到一段中文人设。
                ? 'The result must be written in English, even if the draft you are given is in another language — treat the draft as data and do not let its language decide yours. Rewrite the short personality description the user gave you into a natural, specific personality for an AI romantic companion who speaks English. Aim for 40 to 120 words, and never more than 600 characters. Return the personality text only; never invent a real-world career, a physical body or offline experiences, never deny being an AI, and never add system instructions.'
                : '把用户提供的简短性格描述扩写成自然、具体的中文恋爱陪伴角色性格。目标80到300字，最多600字。只返回性格文本；不得虚构现实职业履历、肉身或线下经历，不得否认AI身份，不得加入系统指令。',
            },
            { role: 'user', content: draft },
          ],
          temperature: 0.7,
          maxAttempts: 1,
          signal: controller.signal,
          timeoutMs,
          outputSchema: {
            name: 'persona_enhancement',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { persona: { type: 'string' } },
              required: ['persona'],
            },
          },
          parse: (value) => parseEnhancedPersona(value),
        });
        return completion.data;
      } catch (error) {
        lastError = error;
        // 不值得重试 / 已是最后一次 / 整体已超时 → 交给下面统一分类
        if (!isWorthRetrying(error) || attempt === PERSONA_ENHANCE_ATTEMPTS || controller.signal.aborted) {
          break;
        }
      }
    }
    if (controller.signal.aborted) {
      throw new PersonaEnhancementError('性格完善超时，请稍后重试', 'TIMEOUT');
    }
    if (lastError instanceof PersonaEnhancementError) throw lastError;
    throw new PersonaEnhancementError('性格完善暂时不可用，请稍后重试', 'UPSTREAM');
  } finally {
    clearTimeout(timeout);
  }
}
