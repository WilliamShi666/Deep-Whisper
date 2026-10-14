import { NextResponse } from 'next/server';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { DEFAULT_UI_THEME_ID, UI_THEMES } from '@/lib/chat-themes';
import { decidePalettePatchValue } from '@/lib/palette-patch';
import { decideLocalePatchValue } from '@/lib/i18n/locale-patch';
export function GET(request: Request) {
  return ownerRoute(request, (owner, repo) =>
    NextResponse.json({
      visitor: repo.getVisitor(owner),
      companion: repo.latestCompanion(owner),
      visitor_id: owner,
      is_new: false,
      claimed: false,
      auth: { authed: true, email: null },
    }),
  );
}
export function POST(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    const body = await readCoreBody(request);
    if (!['male', 'female', 'other'].includes(body.gender)) return coreError(400, 'INVALID_GENDER');
    if (!['male', 'female'].includes(body.orientation))
      return coreError(400, 'INVALID_ORIENTATION');
    return NextResponse.json({
      visitor: repo.updateVisitor(owner, { gender: body.gender, orientation: body.orientation }),
    });
  });
}
export function PATCH(request: Request) {
  return ownerRoute(request, async (owner, repo) => {
    const body = await readCoreBody(request);
    const update: Record<string, string | null> = {};
    if ('theme_id' in body) return coreError(409, 'THEME_CONTEXT_REQUIRED');
    if ('ui_theme' in body) {
      const id = body.ui_theme ?? null;
      if (id && id !== DEFAULT_UI_THEME_ID && !UI_THEMES.some((t) => t.id === id))
        return coreError(400, 'INVALID_THEME');
      update.ui_theme = id === DEFAULT_UI_THEME_ID ? null : id;
    }
    if ('palette' in body) {
      const d = decidePalettePatchValue(body.palette);
      if (!d.ok) return coreError(400, 'INVALID_PALETTE');
      update.palette = d.value;
    }
    if ('locale' in body) {
      const d = decideLocalePatchValue(body.locale);
      if (!d.ok) return coreError(400, 'INVALID_LOCALE');
      update.locale = d.value;
    }
    if (!Object.keys(update).length) return coreError(400, 'NO_UPDATE_FIELDS');
    return NextResponse.json({ visitor: repo.updateVisitor(owner, update) });
  });
}
