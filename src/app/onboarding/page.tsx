import type { Metadata } from 'next';
import { MESSAGES } from '@/lib/i18n/messages';

import { brandDescription, brandShareImage } from '@/lib/brand-metadata';
import { getServerLocale } from '@/lib/i18n-server';
import { OnboardingClient } from './onboarding-client';

/** Keep page and social metadata localized without changing the interactive workflow. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const title = MESSAGES[locale].entry['owner.title'];
  const description = brandDescription(locale);
  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      siteName: 'Deep Whisper',
      type: 'website',
      locale: locale === 'en' ? 'en_US' : 'zh_CN',
      images: [brandShareImage(locale)],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [brandShareImage(locale)],
    },
  };
}

export default function OnboardingPage() {
  return <OnboardingClient />;
}
