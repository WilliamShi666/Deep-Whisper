import { NextResponse } from 'next/server';
import { getPersonalConfig, readConfiguredValue } from '@/lib/config/runtime';
import { validateOwnerRequest, OwnerAccessError } from '@/lib/personal/owner';
import type { SpeechPresentation } from '@/lib/personal/speech-presentation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    validateOwnerRequest(request, process.env, { allowUnauthenticated: true });
    const config = getPersonalConfig(process.env, { strict: false });
    const catalog = config.providers.speech.provider === 'qwen-audio';
    const speechPresentation: SpeechPresentation = {
      mode: !config.capabilities.speech.enabled ? 'unconfigured' : catalog ? 'catalog' : 'compatibility',
      fallback: config.capabilities.speech.enabled && catalog && readConfiguredValue(process.env, 'OPENROUTER_API_KEY') ? 'gender-compatible' : 'none',
    };
    return NextResponse.json({ capabilities: config.capabilities, accessMode: config.accessMode, speechPresentation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof OwnerAccessError ? error.message : 'Configuration invalid', code: error instanceof OwnerAccessError ? error.code : 'CONFIGURATION_INVALID' }, { status: error instanceof OwnerAccessError ? error.status : 500 });
  }
}
