import { NextResponse } from 'next/server';
import { ownerRoute, coreError } from '@/lib/personal/core-api';
import {
  DEFAULT_CHAT_THEME_ID,
  DEFAULT_UI_THEME_ID,
  UI_THEMES,
  getChatThemesForGender,
} from '@/lib/chat-themes';
import { getCharacter } from '@/lib/characters';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return ownerRoute(request, (owner, repo) => {
    const id = new URL(request.url).searchParams.get('conversation_id');
    const conversation = id ? repo.getConversation(owner, id) : null;
    if (id && !conversation) return coreError(404, 'CONVERSATION_NOT_FOUND');
    const companion = conversation
      ? repo.getCompanion(owner, conversation.companion_id)
      : repo.latestCompanion(owner);
    const gender = companion ? getCharacter(companion.character_key)?.gender : undefined;
    if (!gender) return coreError(409, 'CHARACTER_TEMPLATE_MISSING');
    const themes = getChatThemesForGender(gender);
    const current = companion?.theme_id;
    const ui = repo.getVisitor(owner)?.ui_theme;
    return NextResponse.json({
      themes,
      current_id: themes.some((t) => t.id === current) ? current : DEFAULT_CHAT_THEME_ID,
      gender,
      ui_themes: UI_THEMES,
      current_ui_id: UI_THEMES.some((t) => t.id === ui) ? ui : DEFAULT_UI_THEME_ID,
    });
  });
}
