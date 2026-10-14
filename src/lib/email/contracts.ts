export type EmailProviderId = 'resend' | 'smtp';

export interface EmailAddress {
  /** 邮箱地址本身，例如 letters@whoole.io */
  address: string;
  /** 收件箱里显示的名字，例如「晚 · Deep Whisper」 */
  name?: string;
}

export interface EmailTag {
  name: string;
  value: string;
}

export interface EmailMessage {
  to: string;
  from: EmailAddress;
  subject: string;
  /** 纯文本正文。只发 HTML 会被部分客户端判成营销邮件，两版必须同时给出。 */
  text: string;
  html: string;
  replyTo?: string;
  /** 原样透传给上游的邮件头，例如 RFC 8058 的 List-Unsubscribe。 */
  headers?: Readonly<Record<string, string>>;
  /** Provider-specific idempotency: supported by Resend; SMTP does not guarantee deduplication. */
  idempotencyKey?: string;
  tags?: ReadonlyArray<EmailTag>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EmailReceipt {
  provider: EmailProviderId;
  providerMessageId: string;
  /** SMTP/API acceptance does not prove inbox delivery. */
  deliveryStatus?: 'accepted';
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailReceipt>;
}
