import type {
  ChatProvider,
  VisionInspectionResult,
  VisionSafetyProvider,
} from '@/lib/ai';

const DEFAULT_POLICY =
  '判断图片是否包含色情裸露、血腥暴力、恐怖主义、政治敏感、未成年人不当内容、广告二维码或违法违规内容。';

function parseInspection(value: unknown): VisionInspectionResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Vision safety provider returned an invalid result');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.safe !== 'boolean') {
    throw new Error('Vision safety provider did not return a boolean safe field');
  }
  return {
    safe: candidate.safe,
    reason: typeof candidate.reason === 'string' ? candidate.reason : undefined,
    reasonCode:
      typeof candidate.reasonCode === 'string' ? candidate.reasonCode : undefined,
  };
}

export class ChatVisionSafetyProvider implements VisionSafetyProvider {
  constructor(
    private readonly chat: ChatProvider,
    private readonly defaultPolicy = DEFAULT_POLICY,
  ) {}

  async inspect(input: Parameters<VisionSafetyProvider['inspect']>[0]) {
    const dataUri = `data:${input.image.mediaType};base64,${Buffer.from(input.image.bytes).toString('base64')}`;
    const completion = await this.chat.completeStructured({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `你是内容安全审核员。${input.policy || this.defaultPolicy}只返回符合 schema 的 JSON。`,
            },
            { type: 'image_url', image_url: { url: dataUri, detail: 'low' } },
          ],
        },
      ],
      temperature: 0,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      maxAttempts: 1,
      outputSchema: {
        name: 'vision_safety_result',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['safe'],
          properties: {
            safe: { type: 'boolean' },
            reason: { type: 'string' },
            reasonCode: { type: 'string' },
          },
        },
      },
      parse: parseInspection,
    });

    return {
      ...parseInspection(completion.data),
      providerRequestId: completion.providerRequestId,
    };
  }
}
