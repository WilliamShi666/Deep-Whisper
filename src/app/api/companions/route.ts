import { NextRequest, NextResponse } from 'next/server';
import { ownerRoute, readCoreBody } from '@/lib/personal/core-api';
import { getCharacter, isSelectableCharacterKey, resolveVoiceId } from '@/lib/characters';
import { toPublicVoiceId } from '@/lib/ai/qwen-voice-map';
import { isAppearanceStyle } from '@/lib/character-appearance';
import { getDefaultChatThemeId } from '@/lib/character-default-theme';
import { creationRowId } from '@/lib/creation-reference';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST: 捏人（创建陪伴角色实例）
export async function POST(request: NextRequest) {
  return ownerRoute(request, async (visitorId, repo) => {
    const body = (await readCoreBody(request)) as {
      character_key?: string;
      name?: string;
      user_title?: string;
      persona?: string;
      occupation?: string;
      voice_id?: string;
      appearance_style?: string;
      creation_id?: string;
    };
    let creationId: string | undefined;
    try {
      creationId = creationRowId(visitorId, 'companion', body.creation_id);
    } catch {
      return apiError(400, 'INVALID_CREATION_ID', '创建标识无效');
    }

    const characterKey = body.character_key ?? '';
    const character = getCharacter(characterKey);
    if (!character || !isSelectableCharacterKey(characterKey)) {
      return apiError(400, 'INVALID_CHARACTER_TEMPLATE', '请选择一个角色模板');
    }

    const appearanceStyle = body.appearance_style ?? 'chibi';
    if (!isAppearanceStyle(appearanceStyle)) {
      return apiError(400, 'INVALID_APPEARANCE_STYLE', '形象比例无效', { detail: 'invalid' });
    }

    const name = (body.name ?? '').trim().slice(0, 12) || character.defaultName;
    const userTitle = (body.user_title ?? '').trim().slice(0, 12) || '你';
    const persona = (body.persona ?? '').trim();
    if (persona.length > 600) {
      return apiError(400, 'PERSONA_TOO_LONG', '性格描述不能超过 600 个字符');
    }
    const occupation = (body.occupation ?? '').trim().slice(0, 20) || character.occupation;

    // 音色表已换成 Gemini TTS 的 30 个 id：开屏创建不带 voice_id，角色预设里的 defaultVoice
    // 仍是历史平台 id。统一经 resolveVoiceId 归一化，避免把旧 id 写库后被 PATCH 判成非法。
    // 请求值可能是公开代号、上游参数或旧别名（老客户端 / 老数据），统一收敛成公开代号再写库。
    const voiceId = resolveVoiceId(
      toPublicVoiceId(body.voice_id ?? character.defaultVoice) ?? character.defaultVoice,
      character.gender,
    );

    const visitor = repo.getVisitor(visitorId);
    if (!visitor?.gender || !visitor.orientation)
      return apiError(400, 'NEED_PROFILE', '请先完成基础信息');

    // 新伴侣进入对话即带该角色专属默认壁纸：默认值只由「角色 + 外观比例」决定
    // （src/lib/character-default-theme.ts），请求体不提供覆盖口。用户显式选「默认」
    // 仍走 PATCH /api/companions/[id] 归一化成 NULL —— 那才是「无壁纸」的唯一来源。
    const companion = repo.createCompanion(visitorId, {
      id: creationId,
      character_key: character.key,
      name,
      user_title: userTitle,
      persona: persona || null,
      occupation,
      voice_id: voiceId,
      appearance_style: appearanceStyle,
      theme_id: getDefaultChatThemeId(character.key, appearanceStyle),
    });
    return NextResponse.json({ companion });
  });
}
