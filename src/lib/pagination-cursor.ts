import 'server-only';

type Cursor = { at: string; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id })).toString('base64url');
}

export function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid cursor');
  const cursor = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
  if (typeof cursor.at !== 'string' || !TIMESTAMP.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))
    || typeof cursor.id !== 'string' || !UUID.test(cursor.id)) throw new Error('Invalid cursor');
  return cursor;
}

/** Strictly validated values cannot introduce PostgREST filter grammar. */
export function beforeCursor(column: 'created_at' | 'updated_at', cursor: Cursor): string {
  return `${column}.lt.${cursor.at},and(${column}.eq.${cursor.at},id.lt.${cursor.id})`;
}
