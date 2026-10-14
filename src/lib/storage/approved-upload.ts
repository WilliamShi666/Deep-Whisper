import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPrivateSecret } from '@/lib/personal/secrets';
import { readPrivateMedia } from './local-object-store';
import { getProviderConfig } from '@/lib/config/runtime';

const MAX_BYTES = 10 * 1024 * 1024;
const RECEIPT_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function uploadLocation(key: string): string {
  if (!new RegExp(`^uploads/${UUID}/${UUID}\\.(jpg|png|webp|gif)$`, 'i').test(key)) {
    throw new Error('Invalid upload object key');
  }
  if (getProviderConfig().objectStorage.provider === 'local') return `/api/media/${key}`;
  const base = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!base || new URL(base).protocol !== 'https:') throw new Error('Invalid upload storage URL');
  return `${base}/${key}`;
}

function signature(visitorId: string, url: string, expires: number): string {
  const secret = getPrivateSecret('session');
  if (!secret) throw new Error('Upload signing is unavailable');
  // Separate this capability from every other use of the server credential.
  return createHmac('sha256', secret)
    .update(JSON.stringify(['deep-whisper:approved-upload:v1', visitorId, url, expires]))
    .digest('hex');
}

/** Issued only after moderation and storage succeeded; the fragment is never sent to R2. */
export function approveUpload(visitorId: string, key: string, storedUrl: string): string {
  const url = uploadLocation(key);
  if (url !== storedUrl || !key.startsWith(`uploads/${visitorId}/`)) {
    throw new Error('Upload object identity mismatch');
  }
  const expires = Date.now() + RECEIPT_LIFETIME_MS;
  return `${url}#dw-upload=1.${expires}.${signature(visitorId, url, expires)}`;
}

/** Verify ownership and approval before any network/file IO or chat persistence. */
export async function readApprovedUpload(reference: string, visitorId: string): Promise<{
  url: string; bytes: Buffer; mediaType: string;
}> {
  if (reference.length > 4096) throw new Error('Invalid upload reference');
  const match = /^(.*)#dw-upload=1\.(\d{13})\.([0-9a-f]{64})$/.exec(reference);
  if (!match) throw new Error('Upload approval is missing');
  const [, url, expiresText, proof] = match;
  const expires = Number(expiresText);
  if (expires <= Date.now() || expires > Date.now() + RECEIPT_LIFETIME_MS) {
    throw new Error('Upload approval has expired');
  }
  const expected = signature(visitorId, url, expires);
  if (!timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('Upload approval does not belong to this visitor');
  }
  const keyMatch = new RegExp(`(uploads/${UUID}/${UUID}\\.(jpg|png|webp|gif))$`, 'i').exec(url);
  if (!keyMatch || !keyMatch[1].startsWith(`uploads/${visitorId}/`)
    || uploadLocation(keyMatch[1]) !== url) throw new Error('Invalid upload location');
  const key = keyMatch[1];
  const mediaType = MEDIA_TYPES[keyMatch[2].toLowerCase()];
  let bytes: Buffer;
  if (getProviderConfig().objectStorage.provider === 'local') {
    const media = await readPrivateMedia(key);
    if (media.mediaType !== mediaType || media.bytes.length > MAX_BYTES) throw new Error('Invalid local upload');
    bytes = media.bytes;
  } else {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body
      || response.headers.get('content-type')?.split(';')[0].trim() !== mediaType) {
      await response.body?.cancel();
      throw new Error('Approved upload is unavailable');
    }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) {
      await response.body.cancel();
      throw new Error('Upload is too large');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('Upload is too large');
        chunks.push(value);
      }
      bytes = Buffer.concat(chunks, size);
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  if (!bytes.length) throw new Error('Upload is empty');
  return { url, bytes, mediaType };
}
