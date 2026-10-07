import type { Metadata } from 'next';
import { getAppBaseUrl } from '@/lib/config/runtime';
import { BRAND_DESCRIPTION, BRAND_SHARE_IMAGE } from '@/lib/brand-metadata';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth';
import { LocaleProvider } from '@/lib/i18n-client';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(getAppBaseUrl()),
  applicationName: 'Deep Whisper',
  icons: {
    icon: [
      { url: '/brand/favicon-transparent-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/favicon-transparent-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/brand/favicon-transparent.ico',
  },
  title: {
    default: 'Deep Whisper · 你的 AI 恋人',
    template: '%s | Deep Whisper',
  },
  description: BRAND_DESCRIPTION,
  openGraph: {
    title: 'Deep Whisper · 你的 AI 恋人',
    description: BRAND_DESCRIPTION,
    siteName: 'Deep Whisper',
    type: 'website',
    locale: 'zh_CN',
    images: [BRAND_SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Deep Whisper · 你的 AI 恋人',
    description: BRAND_DESCRIPTION,
    images: [BRAND_SHARE_IMAGE],
  },
  keywords: ['Deep Whisper', 'DeepSeek AI 恋人', 'AI 聊天', '虚拟恋人', '陪伴', '心动'],
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={`antialiased`}>
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
