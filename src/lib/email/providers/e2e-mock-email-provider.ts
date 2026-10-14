import type { EmailMessage, EmailProvider, EmailReceipt } from '@/lib/email/contracts';
import { getE2EMockTrace } from '@/lib/ai/providers/e2e-mock-trace';
import { formatSender } from './resend-email-provider';

/**
 * E2E 专用：只记录「打算发什么」，不出网、不落库、不消耗真实额度。
 * trace 记录的是 provider 真正收到的内容，判定逻辑不得回写它。
 */
export class E2EMockEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailReceipt> {
    const trace = getE2EMockTrace();
    trace.emailCalls.push({
      to: message.to,
      from: formatSender(message.from),
      subject: message.subject,
      text: message.text,
      headers: message.headers ? { ...message.headers } : undefined,
      idempotencyKey: message.idempotencyKey,
    });
    const delayMs = trace.config.emailDelayMs;
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return { provider: 'resend', providerMessageId: `e2e-mock-email-${trace.emailCalls.length}` };
  }
}
