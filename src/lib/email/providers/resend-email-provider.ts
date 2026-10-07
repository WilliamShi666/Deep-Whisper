import type {
  EmailAddress,
  EmailMessage,
  EmailProvider,
  EmailReceipt,
} from '@/lib/email/contracts';
import { getProviderConfig } from '@/lib/config/runtime';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export const RESEND_BASE_URL = 'https://api.resend.com' as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 120_000;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

interface ResendSendResponse {
  id?: string;
}

interface ResendErrorPayload {
  name?: string;
  type?: string;
}

export class ResendHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly upstreamCode?: string,
  ) {
    super(`Resend request failed (${status}${upstreamCode ? `; code=${upstreamCode}` : ''})`);
    this.name = 'ResendHttpError';
  }
}

function requireApiKey(env: RuntimeEnvironment): string {
  const value = env.RESEND_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: RESEND_API_KEY');
  }
  return value;
}

function baseUrl(env: RuntimeEnvironment): string {
  const value = env.RESEND_BASE_URL?.trim() || RESEND_BASE_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('RESEND_BASE_URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * 显示名里的 < > " 或换行会把上游的 `Name <addr>` 解析撕开（最坏情况是把显示名当成地址本身），
 * 所以这里硬失败而不是静默清洗——静默清洗会让实际发出的 From 与配置悄悄不一致。
 */
export function formatSender(address: EmailAddress): string {
  const name = address.name?.trim();
  if (!name) return address.address;
  if (/[<>"\r\n]/.test(name)) {
    throw new Error('Sender display name must not contain <, >, " or line breaks');
  }
  return `${name} <${address.address}>`;
}

function sanitizeUpstreamCode(value: unknown): string | undefined {
  const candidate = String(value ?? '');
  return /^[a-z\d_-]{1,64}$/i.test(candidate) ? candidate : undefined;
}

function requestSignal(message: EmailMessage): AbortSignal {
  const timeout = AbortSignal.timeout(message.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return message.signal ? AbortSignal.any([message.signal, timeout]) : timeout;
}

function assertSendable(message: EmailMessage, configuredFrom: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to.trim())) {
    throw new Error('Email recipient address is not a valid mailbox');
  }
  const subject = message.subject.trim();
  if (!subject) throw new Error('Email subject must not be empty');
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new Error(`Email subject must not exceed ${MAX_SUBJECT_LENGTH} characters`);
  }
  if (!message.text.trim() && !message.html.trim()) {
    throw new Error('Email must carry a text or html body');
  }
  if (message.text.length > MAX_BODY_LENGTH || message.html.length > MAX_BODY_LENGTH) {
    throw new Error('Email body is too large to send');
  }
  // 只允许用配置里的那一个发件地址：Resend 按域名验证，写错地址等于往未验证域名发信。
  if (message.from.address.trim().toLowerCase() !== configuredFrom.trim().toLowerCase()) {
    throw new Error(
      'Email must be sent from the configured EMAIL_FROM address',
    );
  }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly env: RuntimeEnvironment = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<EmailReceipt> {
    const emailConfig = getProviderConfig(this.env).email;
    const configuredFrom = emailConfig.fromAddress;
    if (!configuredFrom) {
      throw new Error('Missing required environment variable: EMAIL_FROM');
    }
    assertSendable(message, configuredFrom);
    const apiKey = requireApiKey(this.env);

    // 用户一定会有人直接点「回复」。没配回复地址就等于让回信石沉大海，
    // 所以 EMAIL_REPLY_TO 是兜底，消息级 replyTo 只能覆盖、不能取消。
    const replyTo = message.replyTo ?? emailConfig.replyTo;

    const payload: Record<string, unknown> = {
      from: formatSender(message.from),
      to: [message.to.trim()],
      subject: message.subject.trim(),
      html: message.html,
      text: message.text,
    };
    if (replyTo) payload.reply_to = replyTo;
    if (message.headers && Object.keys(message.headers).length > 0) {
      payload.headers = { ...message.headers };
    }
    if (message.tags?.length) {
      payload.tags = message.tags.map((tag) => ({ name: tag.name, value: tag.value }));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey;

    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl(this.env)}/emails`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: requestSignal(message),
      });
    } catch (error) {
      const name = error instanceof Error && error.name ? ` (${error.name})` : '';
      throw new Error(`Resend network failure${name}`);
    }

    if (!response.ok) {
      let code: string | undefined;
      try {
        const body = (await response.json()) as ResendErrorPayload;
        code = sanitizeUpstreamCode(body.name) ?? sanitizeUpstreamCode(body.type);
      } catch {
        // 上游错误体一律不透传，只保留状态码与白名单化的 code。
      }
      throw new ResendHttpError(response.status, RETRYABLE_STATUSES.has(response.status), code);
    }

    const providerMessageId = await readMessageId(response);
    if (!providerMessageId) {
      throw new Error('Resend accepted the message without returning a message id');
    }
    return { provider: 'resend', providerMessageId, deliveryStatus: 'accepted' };
  }
}

async function readMessageId(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as ResendSendResponse;
    return typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
  } catch {
    return undefined;
  }
}
