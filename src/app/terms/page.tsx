import Link from 'next/link';
import {getServerLocale} from '@/lib/i18n-server';
import {MESSAGES} from '@/lib/i18n/messages';
export default async function Page(){const locale=await getServerLocale();const copy=MESSAGES[locale].legal;return <main className="mx-auto max-w-2xl p-8 space-y-4" lang={locale}><h1 className="text-2xl">{copy["terms.title"]}</h1><p>{copy["terms.use"]}</p><p>{copy["terms.ai"]}</p><Link href="/">{copy["chrome.back"]}</Link></main>;}
