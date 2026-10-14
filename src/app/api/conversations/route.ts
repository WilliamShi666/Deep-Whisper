import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { creationRowId } from '@/lib/creation-reference';
import { buildDefaultConversationTitle } from '@/lib/conversation-title';
export function GET(request: Request) {
  return ownerRoute(request, (owner, repo) =>
    NextResponse.json(
      repo.listConversations(owner, new URL(request.url).searchParams.get('before')),
    ),
  );
}
export function POST(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    const body = await readCoreBody(request);
    if (typeof body.companion_id !== 'string' || !body.companion_id)
      return coreError(400, 'MISSING_COMPANION');
    const companion = repo.getCompanion(owner, body.companion_id);
    if (!companion) return coreError(404, 'COMPANION_NOT_FOUND');
    let id;
    try {
      id = creationRowId(owner, `conversation:${companion.id}`, body.creation_id);
    } catch {
      return coreError(400, 'INVALID_CREATION_ID');
    }
    const locale = repo.getVisitor(owner)?.locale === 'en' ? 'en' : 'zh-CN';
    return NextResponse.json({
      conversation: repo.createConversation(owner, companion.id, {
        id,
        title: buildDefaultConversationTitle(companion.name, locale),
      }),
    });
  });
}
