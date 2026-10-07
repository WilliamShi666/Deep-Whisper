import { NextResponse } from 'next/server';
import { en } from '@/lib/i18n/messages';
import { getSqlite } from '@/storage/database/db';
import { createCoreRepository } from './core-repository';
import { requireOwner, OwnerAccessError } from './owner';

export const coreRepository = () => createCoreRepository(getSqlite());
export async function readCoreBody(request: Request) {
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new SyntaxError('Invalid JSON object');
  return body;
}
export function coreError(status: number, code: string, error?: string) {
  return NextResponse.json(
    { error: error ?? en.errors[code as keyof typeof en.errors] ?? en.errors.UNKNOWN, code },
    { status },
  );
}
/** Preserve authorization status; never turn a rejected owner session into a 500. */
export async function ownerRoute(
  request: Request,
  handler: (
    visitorId: string,
    repo: ReturnType<typeof createCoreRepository>,
  ) => Promise<Response> | Response,
) {
  try {
    return await handler(requireOwner(request), coreRepository());
  } catch (error) {
    if (error instanceof OwnerAccessError)
      return coreError(error.status, error.code, error.message);
    if (error instanceof SyntaxError) return coreError(400, 'INVALID_JSON');
    if (error instanceof Error && error.message === 'INVALID_PAGE_CURSOR')
      return coreError(400, 'INVALID_PAGE_CURSOR');
    if (error instanceof Error && error.message === 'PROFILE_CONFLICT')
      return coreError(409, 'PROFILE_CONFLICT');
    console.error('[personal:core]', error instanceof Error ? error.name : 'unknown');
    return coreError(500, 'INTERNAL_ERROR');
  }
}
