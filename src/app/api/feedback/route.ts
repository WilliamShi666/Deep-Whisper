import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { normalizeFeedbackInput } from '@/lib/feedback/validate';
export function GET(request: Request) {
  return ownerRoute(request, (owner, repo) => {
    const id = new URL(request.url).searchParams.get('conversation_id');
    if (!id) return coreError(400, 'MISSING_CONVERSATION_ID');
    const feedback = repo.listFeedback(owner, id);
    return feedback ? NextResponse.json({ feedback }) : coreError(404, 'CONVERSATION_NOT_FOUND');
  });
}
export function POST(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    const parsed = normalizeFeedbackInput(await readCoreBody(request));
    if (!parsed.ok) return coreError(400, 'INVALID_FEEDBACK', parsed.error);
    const input = parsed.value;
    const message = repo.getOwnedMessage(owner, input.message_id);
    if (!message || message.role !== 'assistant') return coreError(404, 'MESSAGE_NOT_FOUND');
    return NextResponse.json({
      feedback: repo.saveFeedback(
        owner,
        input.message_id,
        input.action === 'delete'
          ? { rating: null, comment: null }
          : { rating: input.rating, comment: input.comment },
      ),
    });
  });
}
