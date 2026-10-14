import { render } from '@react-email/render';
import { createElement } from 'react';

import type { EmailMessage } from './contracts';
import { CompanionLetterEmail } from './companion-letter-email';
import { DEFAULT_BRAND_NAME } from './template';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

/**
 * 个人版来信 → HTML/纯文本邮件。
 *
 * **版式与商业版共用同一个 React Email 组件**（「星光来信」，见
 * `companion-letter-email.tsx`）。此前这里是手写的裸 HTML（`<h1>` + `<p>`），
 * 在真实收件箱里就是一段没有版式的文字 —— 用户实测反馈过，
 * 所以个人版来信直接复用商业版那套模板，而不是维护第二份样式。
 *
 * 与商业版唯一的差别是**退订入口可选**：
 * 自托管/回环实例（`LETTER_PUBLIC_BASE_URL` 未配置）没有公开 HTTPS 源，
 * 不能凭空造一个回调地址，此时不渲染退订行、也不带 `List-Unsubscribe` 头；
 * 邮件契约（`EmailMessage`）本身不变。
 *
 * 模板里没有面向用户的字面量，chrome 文案全部住 `messages/{zh-CN,en}/email.ts`。
 */
export interface PersonalLetterEmailInput {
  to: string;
  /** 发信地址，必须等于 `EMAIL_FROM`。 */
  fromAddress: string;
  replyTo?: string;
  companionName: string;
  subject: string;
  /** 纯文本正文，段落之间用空行分隔（模板按空行切段）。 */
  body: string;
  locale?: Locale;
  /** 只有公开 HTTPS 源存在时才给；缺省即整封信不含任何退订入口。 */
  unsubscribeUrl?: string;
  /** 页脚站点链接，同样只在公开 HTTPS 源存在时给。 */
  siteUrl?: string;
  brandName?: string;
  idempotencyKey?: string;
}

/**
 * 公开链接校验：必须是绝对 HTTPS。退订地址是**用户点得到**的对外承诺，
 * 相对路径或 `javascript:` 一律拒绝，而不是静默降级。
 */
function httpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Public ${label} url must use HTTPS`);
  }
  if (url.protocol !== 'https:') throw new Error(`Public ${label} url must use HTTPS`);
  return url.toString();
}

export async function buildPersonalLetterEmail(input: PersonalLetterEmailInput): Promise<EmailMessage> {
  const brandName = input.brandName?.trim() || DEFAULT_BRAND_NAME;
  const companionName = input.companionName.trim();
  if (!companionName) throw new Error('Letter email requires a companion name');
  if (!input.subject.trim()) throw new Error('Letter email requires a subject');
  if (!input.body.trim()) throw new Error('Letter email requires a body');
  const unsubscribeUrl = input.unsubscribeUrl ? httpsUrl(input.unsubscribeUrl, 'unsubscribe') : undefined;
  const siteUrl = input.siteUrl ? httpsUrl(input.siteUrl, 'site') : undefined;
  const element = createElement(CompanionLetterEmail, {
    brandName,
    companionName,
    body: input.body,
    unsubscribeUrl,
    siteUrl,
    locale: input.locale ?? DEFAULT_LOCALE,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return {
    to: input.to,
    from: { address: input.fromAddress, name: `${companionName} · ${brandName}` },
    replyTo: input.replyTo,
    subject: input.subject.trim(),
    text,
    html,
    idempotencyKey: input.idempotencyKey,
    ...(unsubscribeUrl
      ? {
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
      : {}),
  };
}
