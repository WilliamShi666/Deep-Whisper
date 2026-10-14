import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_VISITOR_ID_LENGTH = 64;

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

function requireSecret(secret: string): string {
  const value = secret.trim();
  if (!value) {
    throw new Error('Missing required environment variable: LETTER_UNSUBSCRIBE_SECRET');
  }
  return value;
}

/**
 * 退订链接里不出现明文 visitor_id：载荷用 base64url 编码 + HMAC-SHA256 签名。
 * 目的不是保密（uuid 本身不是秘密），而是让任何人都无法伪造「替别人退订」的链接。
 */
export function signUnsubscribeToken(visitorId: string, secret: string): string {
  const id = visitorId.trim();
  if (!id) throw new Error('Unsubscribe token requires a visitor id');
  if (id.length > MAX_VISITOR_ID_LENGTH) {
    throw new Error('Unsubscribe token visitor id is too long');
  }
  const payload = Buffer.from(id, 'utf8').toString('base64url');
  return `${payload}.${signature(requireSecret(secret), payload).toString('base64url')}`;
}

/** 校验失败一律返回 null——调用方据此展示失效提示，不得回退成「按 token 里的 id 直接退订」。 */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const [payload, provided] = token.split('.');
  if (!payload || !provided) return null;

  let providedBytes: Buffer;
  try {
    providedBytes = Buffer.from(provided, 'base64url');
  } catch {
    return null;
  }

  const expected = signature(requireSecret(secret), payload);
  if (providedBytes.length !== expected.length) return null;
  if (!timingSafeEqual(providedBytes, expected)) return null;

  const visitorId = Buffer.from(payload, 'base64url').toString('utf8');
  if (!visitorId || visitorId.length > MAX_VISITOR_ID_LENGTH) return null;
  return visitorId;
}
