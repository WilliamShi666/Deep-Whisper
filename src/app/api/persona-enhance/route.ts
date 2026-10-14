import { NextRequest, NextResponse } from 'next/server';
import { getChatProvider } from '@/lib/ai/chat-provider';
import {
  PersonaEnhancementError,
  enhancePersona,
  validatePersonaDraft,
} from '@/lib/persona-enhancement';
import { ownerRoute, coreError, readCoreBody } from '@/lib/personal/core-api';
import { getPersonalConfig } from '@/lib/config/runtime';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return ownerRoute(request, async (visitorId, repo) => {
    try {
      if (!getPersonalConfig(process.env,{strict:false}).capabilities.chat.enabled)
        return coreError(503, 'FEATURE_NOT_CONFIGURED');

      const body = (await readCoreBody(request)) as { persona?: unknown };
      const draft = validatePersonaDraft(body.persona);
      // 语言只读访客档案（D3）：没有客户端上下文时它才是可信来源，且读失败回落默认语言。
      const locale = repo.getVisitor(visitorId)?.locale === 'en' ? 'en' : 'zh-CN';
      const persona = await enhancePersona(getChatProvider(), draft, { locale });
      return NextResponse.json({ persona, based_on: draft });
    } catch (error) {
      if (error instanceof PersonaEnhancementError) {
        const status = error.code === 'INVALID_INPUT' ? 400 : error.code === 'TIMEOUT' ? 504 : 502;
        return NextResponse.json({ error: error.message, code: error.code }, { status });
      }
      console.error('[persona-enhance:POST]', error);
      return apiError(500, 'INTERNAL_ERROR', '服务器开了小差，请稍后重试');
    }
  });
}
