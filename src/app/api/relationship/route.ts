import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return ownerRoute(request, (owner, repo) => {
    const id = new URL(request.url).searchParams.get('companion_id');
    if (!id) return coreError(400, 'MISSING_COMPANION');
    if (!repo.getCompanion(owner, id)) return coreError(404, 'COMPANION_NOT_FOUND');
    return NextResponse.json({ snapshot: repo.getRelationship(owner, id) });
  });
}
export function PUT(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    const body = await readCoreBody(request);
    if (typeof body.companion_id !== 'string' || !body.companion_id)
      return coreError(400, 'MISSING_COMPANION');
    const input: Record<string, unknown> = {};
    for (const key of ['relationship_stage', 'emotional_tone', 'dynamic_summary'])
      if (body[key] !== undefined)
        input[key] = typeof body[key] === 'string' ? body[key].trim().slice(0, 2000) : null;
    if (body.key_milestones !== undefined) {
      if (!Array.isArray(body.key_milestones)) return coreError(400, 'INVALID_MILESTONES');
      input.key_milestones = body.key_milestones;
    }
    const snapshot = repo.saveRelationship(owner, body.companion_id, input);
    return snapshot ? NextResponse.json({ snapshot }) : coreError(404, 'COMPANION_NOT_FOUND');
  });
}
