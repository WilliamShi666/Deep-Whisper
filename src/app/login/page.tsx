import type { Metadata } from 'next';
import { MESSAGES } from '@/lib/i18n/messages';

import { LocaleProvider } from '@/lib/i18n-client';
import { pageSocialMetadata } from '@/lib/page-metadata';
import { getServerLocale } from '@/lib/i18n-server';

import LoginClient from './login-client';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const title = MESSAGES[locale].entry['login.meta.title'];
  const description = MESSAGES[locale].entry['login.meta.description'];
  return {
    title: title,
    description: description,
    // 分享块必须整块给：只覆写 title/description 会让 openGraph/twitter 整块继承根 layout 的中文档（t54）
    ...pageSocialMetadata({
      locale,
      title: title,
      description: description,
    }),
  };
}

export default async function LoginPage() {
  const locale = await getServerLocale();
  return (
    <LocaleProvider initialLocale={locale}>
      <LoginClient />
    </LocaleProvider>
  );
}
