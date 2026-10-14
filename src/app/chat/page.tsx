import type { Metadata } from 'next';

import { ChatShell } from '@/components/chat/chat-shell';
import { TimeZoneSync } from '@/components/time-zone-sync';
import { LocaleProvider } from '@/lib/i18n-client';
import { getServerLocale } from '@/lib/i18n-server';
import { brandDescription } from '@/lib/brand-metadata';
import { MESSAGES } from '@/lib/i18n/messages';
import { pageSocialMetadata } from '@/lib/page-metadata';

/**
 * 聊天页的 metadata：按访客语言出（契约 §9.5.1「6 个页面各有一条 generateMetadata，
 * 内部 `await getServerLocale()`」）。
 *
 * `title` 用 `absolute` 而不是裸字符串：根 layout 的 `title.template` 是 `%s | Deep Whisper`，
 * 裸字符串会被再拼一次品牌名；而中文态此刻继承的正是根 `title.default`
 * （`Deep Whisper · 你的 AI 恋人`）—— `absolute` 让**中文态逐字符不变**（H4）。
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const title = MESSAGES[locale].chat['meta.title'];
  return {
    title: { absolute: title },
    // 本页此前**没有**自己的描述 ⇒ 英文态继承的是根 layout 的中文描述；补上按语言的品牌描述
    // （zh 与根 layout 的 `BRAND_DESCRIPTION` 逐字符相同，H4）。
    description: brandDescription(locale),
    // 分享块整块给（同 /login）：否则四项整块继承根 layout 的中文档（t54）
    ...pageSocialMetadata({ locale, title }),
  };
}

/**
 * 语言（t44 / O1）：本页是服务端组件，且已因 metadata 按请求渲染 —— 把**同一个** `getServerLocale()`
 * 结果作为 `initialLocale` 传给页面树的 Provider（与 `/login`、`/love` 同一做法）：它既是首帧语言，
 * 也是解析链**设备镜像槽**的那一份 SSR 信号 ⇒ 「只剩 cookie」态下本页与其他四页一致，
 * 且不会把用户的 cookie 改写成默认值。
 */
export default async function ChatPage() {
  const locale = await getServerLocale();
  return (
    <LocaleProvider initialLocale={locale}>
      <ChatShell />
      {/* 聊天 boot 后把浏览器真实时区采一次（档案已有合法值时零请求；失败不影响对话）。 */}
      <TimeZoneSync />
    </LocaleProvider>
  );
}
