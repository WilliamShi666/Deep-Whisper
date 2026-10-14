import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Use existing primary-key uniqueness as durable retry protection, scoped to the owner. */
export function creationRowId(visitorId: string, scope: string, key: unknown): string | undefined {
  if (key === undefined) return undefined;
  if (typeof key !== 'string' || !UUID.test(key)) throw new Error('Invalid creation reference');
  const bytes = createHash('sha256').update(JSON.stringify([visitorId, scope, key])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
