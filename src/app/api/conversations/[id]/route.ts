import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return ownerRoute(request, async (owner, repo) => {
    const { id } = await context.params;
    const conversation = repo.getConversation(owner, id);
    return conversation
      ? NextResponse.json({ conversation })
      : coreError(404, 'CONVERSATION_NOT_FOUND');
  });
}
export function PATCH(request: Request, context: Context) {
  return ownerRoute(request, async (owner, repo) => {
    const { id } = await context.params;
    const body = await readCoreBody(request);
    if (typeof body.title !== 'string' || !body.title.trim())
      return coreError(400, 'INVALID_TITLE');
    const conversation = repo.updateConversation(owner, id, body.title.trim().slice(0, 128));
    return conversation
      ? NextResponse.json({ conversation })
      : coreError(404, 'CONVERSATION_NOT_FOUND');
  });
}
export function DELETE(request: Request, context: Context) {
  return ownerRoute(request, async (owner, repo) => {
    const { id } = await context.params;
    const deleted = repo.deleteConversation(owner, id);
    return deleted
      ? NextResponse.json(deleted)
      : coreError(404, 'CONVERSATION_NOT_FOUND');
  });
}
