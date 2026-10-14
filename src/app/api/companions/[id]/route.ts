import { NextRequest, NextResponse } from 'next/server';
import { ownerRoute, readCoreBody } from '@/lib/personal/core-api';
import type { CompanionPatch } from '@/lib/personal/core-repository';
import { getCharacter, isSelectableVoiceId } from '@/lib/characters';
import { toPublicVoiceId } from '@/lib/ai/qwen-voice-map';
import { getCharacterAvatar, isAppearanceStyle } from '@/lib/character-appearance';
import { DEFAULT_CHAT_THEME_ID, getChatTheme } from '@/lib/chat-themes';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return ownerRoute(_request, async (visitorId, repo) => {
    const { id } = await params; const companion = repo.getCompanion(visitorId, id);
    return companion ? NextResponse.json({ companion }) : apiError(404, 'COMPANION_NOT_FOUND', '角色不存在');
  });
}

// PATCH: 更新陪伴角色（改名、称呼、性格补充、音色）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return ownerRoute(request, async (visitorId, repo) => {
    const { id } = await params;
    const body = (await readCoreBody(request)) as {
      name?: string;
      user_title?: string;
      persona?: string;
      occupation?: string;
      voice_id?: string;
      appearance_style?: string;
      theme_id?: string | null;
    };

    const allowedKeys = new Set([
      'name', 'user_title', 'persona', 'occupation', 'voice_id', 'appearance_style', 'theme_id',
    ]);
    const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
    if (unknownKey) {
      return NextResponse.json({ error: `不支持的字段：${unknownKey}`, code: 'UNKNOWN_FIELD' }, { status: 400 });
    }

    const companion = repo.getCompanion(visitorId, id);
    if (!companion) {
      return apiError(404, 'COMPANION_NOT_FOUND', '角色不存在');
    }

    const row = companion;
    const character = getCharacter(row.character_key);
    const updates: Record<string, string | null> = {};

    if (typeof body.name === 'string' && body.name.trim()) {
      updates.name = body.name.trim().slice(0, 12);
    }
    if (typeof body.user_title === 'string' && body.user_title.trim()) {
      updates.user_title = body.user_title.trim().slice(0, 12);
    }
    if (typeof body.persona === 'string') {
      const persona = body.persona.trim();
      if (persona.length > 600) {
        return apiError(400, 'PERSONA_TOO_LONG', '性格描述不能超过 600 个字符');
      }
      updates.persona = persona || null;
    }
    if (typeof body.occupation === 'string' && body.occupation.trim()) {
      updates.occupation = body.occupation.trim().slice(0, 20);
    }
    if (typeof body.voice_id === 'string' && character) {
      const requestedVoiceId = body.voice_id;
      // 护栏 = 「是该性别的合法音色」：保留集里 13/12 个正式 id，或它们挂着的 19 个旧别名。
      // **性别作用域必须在服务端也生效** —— 下拉只显示同性别音色是产品口径，
      // 若这里不校验，跨性别 id 仍能写进库，界面上的过滤就只是装饰。
      // 写库前仍要归一化：旧 companion 行里的历史平台 id 才不会把整次保存一起 400 掉。
      // 老客户端/老页面可能仍回传上游参数或旧别名：先收敛成公开代号再判合法性与性别作用域。
      const publicVoiceId = toPublicVoiceId(requestedVoiceId);
      if (!publicVoiceId || !isSelectableVoiceId(publicVoiceId, character.gender)) {
        return apiError(400, 'INVALID_VOICE', '音色无效');
      }
      updates.voice_id = publicVoiceId;
    }
    if ('appearance_style' in body) {
      if (!isAppearanceStyle(body.appearance_style)) {
        return apiError(400, 'INVALID_APPEARANCE_STYLE', '形象比例无效', { detail: 'invalid' });
      }
      updates.appearance_style = body.appearance_style;
    }
    if ('theme_id' in body) {
      if (!character) return apiError(409, 'CHARACTER_TEMPLATE_MISSING', '角色模板缺失');
      const themeId = body.theme_id ?? null;
      const theme = themeId && themeId !== DEFAULT_CHAT_THEME_ID ? getChatTheme(themeId) : undefined;
      if (themeId && themeId !== DEFAULT_CHAT_THEME_ID && !theme) {
        return apiError(400, 'INVALID_THEME', '这套背景不存在');
      }
      if (theme && theme.gender !== character.gender) {
        return apiError(403, 'THEME_GENDER_MISMATCH', '这套背景和当前的 TA 不搭哦');
      }
      updates.theme_id = themeId === DEFAULT_CHAT_THEME_ID ? null : themeId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        companion: { ...row, avatar: getCharacterAvatar(row.character_key, row.appearance_style) },
      });
    }

    return NextResponse.json({ companion: repo.updateCompanion(visitorId, id, updates as CompanionPatch) });
  });
}
