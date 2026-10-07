import { createHmac, timingSafeEqual } from 'node:crypto';

export type ResendDeliveryStatus = 'delivered' | 'bounced' | 'complained';

export function deliveryStatusForEvent(type: unknown): ResendDeliveryStatus | null {
  switch (type) {
    case 'email.delivered': return 'delivered';
    case 'email.bounced': return 'bounced';
    case 'email.complained': return 'complained';
    default: return null;
  }
}

function decodeSecret(secret: string): Buffer {
  const value = secret.trim().replace(/^whsec_/, '');
  if (!value) throw new Error('Missing required environment variable: RESEND_WEBHOOK_SECRET');
  return Buffer.from(value, 'base64');
}

/** Verify Resend's Svix-compatible signature without exposing the raw request body. */
export function verifyResendWebhook(input: { id: string | null; timestamp: string | null; signature: string | null; body: string; secret: string | undefined }): boolean {
  if (!input.id || !input.timestamp || !input.signature || !input.secret) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', decodeSecret(input.secret)).update(`${input.id}.${input.timestamp}.${input.body}`).digest();
  return input.signature.split(' ').some((part) => {
    const encoded = part.startsWith('v1,') ? part.slice(3) : '';
    try {
      const received = Buffer.from(encoded, 'base64');
      return received.length === expected.length && timingSafeEqual(received, expected);
    } catch { return false; }
  });
}

/** Webhook 编排所需的持久化动作。用接口而不是直接拿 client，路由与测试共用同一段顺序逻辑。 */
export interface LetterWebhookStore {
  recordEvent(input: { eventId: string; messageId: string; eventType: string }): Promise<void>;
  /** 单调状态转换；没有命中任何行时返回 null（可能是早到事件，也可能是已终态）。 */
  transitionDelivery(messageId: string, status: ResendDeliveryStatus): Promise<string[] | null>;
  /** 按 provider_message_id 找回既有终态投递，用于重试时恢复 visitor。 */
  findTerminalDelivery(messageId: string): Promise<{ visitorId: string; status: string } | null>;
  suppressVisitor(visitorId: string, status: ResendDeliveryStatus): Promise<void>;
  markProcessed(eventId: string): Promise<void>;
}

export type ResendEventOutcome = 'processed' | 'pending';

/**
 * 处理一条 Resend 送达事件。
 *
 * 顺序是这个函数的全部意义：**先完成抑制，再写 processed_at**。反过来的话，
 * 一次抑制写失败会被「已处理」永久掩盖，而 Resend 不会再重投这条事件——
 * 结果是用户明明投诉了，我们却继续给他发信。
 *
 * 重试路径同样重要：首次可能已经把 delivery 置成 bounced/complained，
 * 却在写 preference 时失败。此时 guarded update 命中 0 行，必须从既有终态
 * delivery 反查 visitor_id 再抑制一次，否则重试永远不会成功。
 */
export async function applyResendEvent(
  store: LetterWebhookStore,
  event: { eventId: string; messageId: string; status: ResendDeliveryStatus },
): Promise<ResendEventOutcome> {
  await store.recordEvent({ eventId: event.eventId, messageId: event.messageId, eventType: `email.${event.status}` });

  const transitioned = await store.transitionDelivery(event.messageId, event.status);
  const visitors = transitioned ?? [];
  const terminal = visitors.length > 0 ? null : await store.findTerminalDelivery(event.messageId);
  if (visitors.length === 0 && !terminal) return 'pending';

  if (event.status !== 'delivered') {
    const targets = visitors.length > 0 ? visitors : terminal ? [terminal.visitorId] : [];
    for (const visitorId of targets) await store.suppressVisitor(visitorId, event.status);
  }

  await store.markProcessed(event.eventId);
  return 'processed';
}
