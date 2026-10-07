import { NextResponse } from 'next/server';
import { ownerRoute, coreError } from '@/lib/personal/core-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownerRoute(request, async (owner, repo) => {
    const { id } = await params;
    const result = repo.listMessages(owner, id, new URL(request.url).searchParams.get('before'));
    return result
      ? NextResponse.json(result)
      : coreError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
  });
}
