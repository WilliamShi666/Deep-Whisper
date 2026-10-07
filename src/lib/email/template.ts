import { render } from '@react-email/render';
import { createElement } from 'react';

import type { EmailMessage } from '@/lib/email/contracts';
import type { Locale } from '@/lib/i18n/locale';
import { CompanionLetterEmail } from '@/lib/email/companion-letter-email';

/**
 * 来信显示名里的品牌段。发件**地址**（letters@whoole.io）不在这里，
 * 也不随改名变动：域名已验证通过，改地址会影响投递与抑制列表。
 */
export const DEFAULT_BRAND_NAME = 'Deep Whisper';

export interface LetterEmailInput {
  to: string;
  /** 邮件的发信地址（必须等于 EMAIL_FROM）。 */
  fromAddress: string;
  /** 角色名，用于收件箱显示名与信件落款。 */
  companionName: string;
  /** 信件口吻的主题行；通知口吻的主题由写作层拦截，不在这里兜底。 */
  subject: string;
  /** 信件正文：纯文本，段落之间用空行分隔。 */
  body: string;
  unsubscribeUrl: string;
  replyTo?: string;
  brandName?: string;
  siteUrl?: string;
  idempotencyKey?: string;
  /**
   * 邮件的语言（= 界面语言的值域 `'zh-CN' | 'en'`），缺省中文。
   *
   * 模板里所有 chrome（标题、落款、页脚、退订入口）以及 `<html lang>` 都按它渲染；
   * **主题行**由调用方按同一语言传入（`visitors.locale` 由 U7 在 letters / scheduler 侧读出）。
   * 缺省即「既有调用点逐字符不变」（H4）。
   */
  locale?: Locale;
}

/** 保留给任何需要在 React Email 外拼装受信任富文本的调用方。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasBody(body: string): boolean {
  return body.split(/\n{2,}/).some((paragraph) => paragraph.trim().length > 0);
}

function httpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Letter email requires a valid https url for ${label}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Letter email requires a valid https url for ${label}`);
  }
  return url.toString();
}

/**
 * 信件 → HTML/纯文本邮件。React Email 负责跨客户端的标记与转义；
 * 业务层继续只得到现有 EmailMessage 契约，不依赖任何供应商 SDK。
 */
export async function buildLetterEmail(input: LetterEmailInput): Promise<EmailMessage> {
  const brandName = input.brandName?.trim() || DEFAULT_BRAND_NAME;
  const companionName = input.companionName.trim();
  if (!companionName) throw new Error('Letter email requires a companion name');
  if (!input.subject.trim()) throw new Error('Letter email requires a subject');
  if (!hasBody(input.body)) throw new Error('Letter email requires a body');
  if (!input.unsubscribeUrl.trim()) {
    throw new Error('Letter email requires an unsubscribe url');
  }
  const unsubscribeUrl = httpsUrl(input.unsubscribeUrl, 'unsubscribe');
  const siteUrl = input.siteUrl ? httpsUrl(input.siteUrl, 'site') : undefined;
  const element = createElement(CompanionLetterEmail, {
    brandName,
    companionName,
    body: input.body,
    unsubscribeUrl,
    siteUrl,
    // 模板 chrome（标题 / 落款 / 页脚 / 退订入口）与 <html lang> 按它渲染；
    // 缺省（undefined）时组件回落中文，既有调用点因此逐字符不变。
    locale: input.locale,
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return {
    to: input.to,
    from: { address: input.fromAddress, name: `${companionName} · ${brandName}` },
    subject: input.subject.trim(),
    text,
    html,
    replyTo: input.replyTo,
    idempotencyKey: input.idempotencyKey,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [{ name: 'category', value: 'companion_letter' }],
  };
}
