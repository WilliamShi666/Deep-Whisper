import { NextResponse } from 'next/server';
import { personalDefaultLocale } from '@/lib/personal/locale';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return NextResponse.json(
    { locale: personalDefaultLocale(request.headers.get('accept-language')) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
