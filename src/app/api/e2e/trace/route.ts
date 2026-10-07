import { NextRequest, NextResponse } from 'next/server';
import { isE2EMockProviderMode } from '@/lib/config/runtime';
import {
  type E2EImageFailureCode,
  resetE2EMockTrace,
  snapshotE2EMockTrace,
} from '@/lib/ai/providers/e2e-mock-trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAllowed(): boolean {
  try {
    return isE2EMockProviderMode();
  } catch {
    return false;
  }
}

function unavailable() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function GET() {
  if (!isAllowed()) return unavailable();
  return NextResponse.json(snapshotE2EMockTrace());
}

export async function POST(request: NextRequest) {
  if (!isAllowed()) return unavailable();
  const body = (await request.json().catch(() => ({}))) as {
    personaDelayMs?: unknown;
    chatChunkDelayMs?: unknown;
    chatReplyPrefix?: unknown;
    imageDelayMs?: unknown;
    imageFailuresRemaining?: unknown;
    imageFailureCode?: unknown;
    speechDelayMs?: unknown;
  };
  const imageFailureCode = body.imageFailureCode ?? 'policy_rejected';
  const failureCodes = ['policy_rejected', 'network', 'timeout', 'rate_limited', 'upstream_unavailable'];
  const chatReplyPrefix = body.chatReplyPrefix ?? '';
  const chatChunkDelayMs = Number(body.chatChunkDelayMs ?? 0);
  const imageDelayMs = Number(body.imageDelayMs ?? 0);
  const personaDelayMs = Number(body.personaDelayMs ?? 0);
  const imageFailuresRemaining = Number(body.imageFailuresRemaining ?? 0);
  const speechDelayMs = Number(body.speechDelayMs ?? 0);
  if (typeof chatReplyPrefix !== 'string' || chatReplyPrefix.length > 64
    || ![chatChunkDelayMs, imageDelayMs].every((value) => Number.isInteger(value) && value >= 0 && value <= 25_000)
    || !Number.isInteger(personaDelayMs) || personaDelayMs < 0 || personaDelayMs > 25_000
    || !Number.isInteger(speechDelayMs) || speechDelayMs < 0 || speechDelayMs > 25_000
    || !Number.isInteger(imageFailuresRemaining) || imageFailuresRemaining < 0 || imageFailuresRemaining > 2
    || typeof imageFailureCode !== 'string' || !failureCodes.includes(imageFailureCode)) {
    return NextResponse.json({ error: 'Invalid E2E mock configuration' }, { status: 400 });
  }
  return NextResponse.json(resetE2EMockTrace({ personaDelayMs, chatChunkDelayMs, chatReplyPrefix, imageDelayMs, imageFailuresRemaining, imageFailureCode: imageFailureCode as E2EImageFailureCode, speechDelayMs }));
}
