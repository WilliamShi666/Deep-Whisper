import { NextRequest, NextResponse } from 'next/server';
import { ownerRoute } from '@/lib/personal/core-api';
import { getSqlite } from '@/storage/database/db';
import { getMemoryDependencies } from '@/lib/memory/dependencies';
import { acquireOperationLease, releaseOperationLease, type OperationLease } from '@/lib/operation-lease';
import type { ProviderMemory } from '@/lib/memory/service';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function owned(memory: ProviderMemory, scope: { visitorId: string; companionId: string; appId: string }) {
  const m = memory.metadata;
  return m?.visitor_id === scope.visitorId && m?.companion_id === scope.companionId
    && m?.app_id === scope.appId && m?.memory_type === 'communication_style' && m?.status === 'active';
}
function serialize(memory: ProviderMemory) {
  const text = memory.memory ?? memory.data ?? '';
  return { id: memory.id, text: typeof text === 'string' ? text : '' };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return ownerRoute(request, async (visitorId, repo) => {
  try {
    const {id:companionId}=await params;
    const scope = {visitorId,companionId};
    if (!repo.getCompanion(visitorId,companionId)) return apiError(404, 'COMPANION_NOT_FOUND', '角色不存在');
    const deps = getMemoryDependencies();
    if (!deps) return NextResponse.json({ memories: [], next_cursor: null, enabled: false });
    if (!deps.gateway.listCommunicationPreferences) throw new Error('Preference listing unavailable');
    const fullScope = { ...scope, appId: deps.appId };
    const page = await deps.gateway.listCommunicationPreferences({ ...fullScope,
      cursor: request.nextUrl.searchParams.get('before') ?? undefined });
    return NextResponse.json({ memories: page.memories.filter((memory) => owned(memory, fullScope)).map(serialize),
      next_cursor: page.nextCursor, enabled: true });
  } catch (error) {
    console.error('[preferences:GET]', error instanceof Error ? error.name : 'unknown');
    return apiError(503, 'PREFERENCE_READ_FAILED', '读取伴侣偏好失败，请重试');
  }
  });
}

async function mutate(request: NextRequest, params: Promise<{ id: string }>, remove: boolean) {
  return ownerRoute(request, async (visitorId, repo) => {
  let lease: OperationLease | null = null;
  let changed = false;
  const {id:companionId}=await params;
  const scope={visitorId,companionId};
  try {
    if (!repo.getCompanion(visitorId,companionId)) return apiError(404, 'COMPANION_NOT_FOUND', '角色不存在');
    const body = await request.json().catch(() => null) as { id?: unknown; text?: unknown } | null;
    if (!body || typeof body.id !== 'string' || !body.id || body.id.length > 256
      || (!remove && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 160))) {
      return apiError(400, 'INVALID_PREFERENCE_BODY', '偏好内容无效');
    }
    lease = await acquireOperationLease(`memory:${scope.visitorId}:${scope.companionId}`);
    if (!lease) return apiError(409, 'MEMORY_BUSY_PREFERENCE', '记忆正在整理，请稍后再试');
    const deps = getMemoryDependencies();
    if (!deps?.gateway.getById) return apiError(503, 'PREFERENCE_MANAGEMENT_UNAVAILABLE', '偏好管理暂不可用');
    const fullScope = { ...scope, appId: deps.appId };
    changed = true;
    const memory = await deps.gateway.getById(body.id, fullScope);
    if (!memory || !owned(memory, fullScope)) return apiError(404, 'PREFERENCE_NOT_FOUND', '偏好不存在');
    // A partial hybrid failure may still have changed one backend.
    if (remove) await deps.gateway.delete(body.id);
    else await deps.gateway.update(body.id, { text: (body.text as string).trim(),
      metadata: { ...memory.metadata, source: 'manual_preference_correction', observed_at: new Date().toISOString() } });
    getSqlite().prepare('DELETE FROM memory_recall_snapshots WHERE visitor_id=? AND companion_id=?').run(visitorId,companionId);
    changed = false;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[preferences:mutation]', error instanceof Error ? error.name : 'unknown');
    return apiError(503, 'PREFERENCE_UPDATE_UNCONFIRMED', '偏好更新未能确认完成，请刷新核对后重试');
  } finally {
    if (changed) getSqlite().prepare('DELETE FROM memory_recall_snapshots WHERE visitor_id=? AND companion_id=?').run(visitorId,companionId);
    if (lease) await releaseOperationLease(lease).catch((error) => console.error('[memory:lease]', error));
  }
  });
}
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, params, false);
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, params, true);
}
