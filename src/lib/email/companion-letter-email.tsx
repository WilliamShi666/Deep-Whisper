import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
  Column,
} from '@react-email/components';

import { DEFAULT_LOCALE, HTML_LANG, parseLocale, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate } from '@/lib/i18n/messages';

// 只使用冰透蓝：明亮、干净，不引入紫色或灰调。
const SKY_START = '#F1F8FF';
const SKY_END = '#DDEEFF';
const PAPER = '#FFFFFF';
const ICE_BLUE = '#C7E4FF';
const BRIGHT_BLUE = '#5B9BFF';
const INK = '#28425E';
const MUTED_INK = '#71859A';
const SIGNATURE = '#397FD4';

export interface CompanionLetterEmailProps {
  brandName: string;
  companionName: string;
  body: string;
  unsubscribeUrl: string;
  siteUrl?: string;
  /**
   * 信件语言。取值域与界面语言同一个 `Locale`（`'zh-CN' | 'en'`），缺省中文 ——
   * 缺省即「既有调用点逐字符不变」（H4）。真正的来源是 `visitors.locale`，
   * 由 U7 在 letters / scheduler 侧读出后传进来。
   */
  locale?: Locale;
}

function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * “星光来信”不是产品通知：不使用深色底、整块企业色标题栏、按钮或硬性 CTA。
 * 整个标题单元格承载渐变。光晕单独一层，避免某个背景函数被过滤时丢掉所有层次。
 * 浅色底只做降级，不能保证覆盖各邮件客户端的深色模式重写。
 *
 * 模板文案**全部**住 `messages/{zh-CN,en}/email.ts`：本文件里没有任何面向用户的字面量，
 * 所以「英文界面 = 英文邮件」不需要第二份模板，也不会漏翻某个角标或落款。
 */
export function CompanionLetterEmail({
  brandName,
  companionName,
  body,
  unsubscribeUrl,
  siteUrl,
  locale = DEFAULT_LOCALE,
}: CompanionLetterEmailProps) {
  const messages = MESSAGES[parseLocale(locale) ?? DEFAULT_LOCALE];
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(messages, key, vars);
  const letterParagraphs = paragraphs(body);
  const preview = letterParagraphs[0]?.replace(/\s+/g, ' ').slice(0, 80)
    ?? t('email.letter.preview', { name: companionName });

  return (
    <Html lang={HTML_LANG[parseLocale(locale) ?? DEFAULT_LOCALE]}>
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Body
        style={{
          backgroundColor: SKY_START,
          backgroundImage: `linear-gradient(135deg, ${SKY_START} 0%, ${SKY_END} 100%)`,
          color: INK,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          margin: '0',
          padding: '40px 12px',
        }}
      >
        <Preview>{preview}</Preview>
        <Container
          style={{
            backgroundColor: PAPER,
            border: `1px solid ${ICE_BLUE}`,
            borderRadius: '28px',
            boxShadow: '0 10px 40px -10px rgba(91, 155, 255, 0.28)',
            margin: '0 auto',
            maxWidth: '560px',
            overflow: 'hidden',
          }}
        >
          <Section>
            <Row>
              <Column
                data-letter-header="true"
                style={{
                  backgroundColor: '#E7F1FD',
                  // Inline background shorthand survives more mail sanitizers than background-image.
                  background: 'linear-gradient(115deg, #F7FBFF 0%, #E5EFFB 18%, #B8D2F3 43%, #D8E8FB 60%, #F8FCFF 78%, #D1E4FA 100%)',
                  borderRadius: '27px 27px 0 0',
                  borderBottom: '1px solid #D6E6F8',
                }}
              >
                <Section style={{ background: 'radial-gradient(ellipse at 26% 0%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.48) 30%, rgba(255,255,255,0) 70%)', borderRadius: '27px 27px 0 0' }}>
                  <Section style={{ padding: '42px 42px 38px' }}>
                    <Text style={{ color: SIGNATURE, fontSize: '12px', letterSpacing: '0.12em', margin: '0 0 18px' }}>
                      {t('email.letter.kicker', { brand: brandName })}
                    </Text>
                    <Heading
                      as="h1"
                      style={{
                        color: INK,
                        fontFamily: "Georgia, 'Times New Roman', 'Songti SC', SimSun, serif",
                        fontSize: '29px',
                        fontWeight: 400,
                        letterSpacing: '-0.02em',
                        lineHeight: '1.42',
                        margin: '0 0 12px',
                      }}
                    >
                      {t('email.letter.title')}
                    </Heading>
                    <Text style={{ color: '#416D99', fontSize: '15px', lineHeight: '1.75', margin: '0' }}>
                      {t('email.letter.subtitle', { name: companionName })}
                    </Text>
                  </Section>
                </Section>
              </Column>
            </Row>
          </Section>

          <Section style={{ padding: '42px 42px 20px' }}>
            {letterParagraphs.map((paragraph, index) => (
              <Text
                key={`${index}:${paragraph}`}
                style={{
                  color: INK,
                  fontSize: '16px',
                  lineHeight: '1.82',
                  margin: '0 0 24px',
                  whiteSpace: 'pre-line',
                }}
              >
                {paragraph}
              </Text>
            ))}
          </Section>

          <Section style={{ padding: '0 42px 42px' }}>
            <Text
              style={{
                color: SIGNATURE,
                fontFamily: "Georgia, 'Times New Roman', 'Songti SC', SimSun, serif",
                fontSize: '19px',
                fontStyle: 'italic',
                lineHeight: '1.5',
                margin: '2px 0 30px',
              }}
            >
              {t('email.letter.signature', { name: companionName })}
            </Text>
            <Hr style={{ border: 'none', borderTop: '1px solid #B8DAFF', margin: '0 0 18px' }} />
            <Text style={{ color: MUTED_INK, fontSize: '12px', lineHeight: '1.75', margin: '0 0 9px' }}>
              <span style={{ color: BRIGHT_BLUE }}>✦</span> {t('email.letter.about', { brand: brandName, name: companionName })}
            </Text>
            <Text style={{ color: MUTED_INK, fontSize: '12px', lineHeight: '1.75', margin: '0 0 9px' }}>
              {t('email.letter.unsubscribe_question', { name: companionName })}{' '}
              <Link href={unsubscribeUrl} style={{ color: SIGNATURE, textDecoration: 'underline' }}>
                {t('email.letter.unsubscribe_action')}
              </Link>
            </Text>
            {siteUrl && (
              <Text style={{ color: MUTED_INK, fontSize: '12px', lineHeight: '1.75', margin: '0' }}>
                <Link href={siteUrl} style={{ color: SIGNATURE, textDecoration: 'underline' }}>
                  {siteUrl}
                </Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
