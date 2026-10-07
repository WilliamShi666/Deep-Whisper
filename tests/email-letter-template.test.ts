import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLetterEmail, escapeHtml } from '../src/lib/email/template';
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../src/lib/email/unsubscribe-token';

const UNSUBSCRIBE_URL = 'https://app.example.com/letters/unsubscribe?token=abc.def';
const SECRET = 'unit-test-secret';

function letter(overrides: Partial<Parameters<typeof buildLetterEmail>[0]> = {}) {
  return buildLetterEmail({
    to: 'reader@example.com',
    fromAddress: 'letters@whoole.io',
    companionName: '晚',
    subject: '今天路过那家店',
    body: '阿哲，我今天煮面，锅里的水刚好是一个人的量。\n\n你最近忙就忙你的。',
    unsubscribeUrl: UNSUBSCRIBE_URL,
    ...overrides,
  });
}

test('shows the companion name plus the brand in the inbox sender field', async () => {
  const email = await letter();
  assert.deepEqual(email.from, { address: 'letters@whoole.io', name: '晚 · Deep Whisper' });
});

test('keeps a custom brand name in the sender field', async () => {
  const email = await letter({ brandName: '测试品牌' });
  assert.equal(email.from.name, '晚 · 测试品牌');
});

test('adds the one-click unsubscribe headers required by RFC 8058', async () => {
  const email = await letter();
  assert.equal(email.headers?.['List-Unsubscribe'], `<${UNSUBSCRIBE_URL}>`);
  assert.equal(email.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('keeps an identifiable sender and an unsubscribe entry in both bodies', async () => {
  const email = await letter();

  assert.ok(email.text.includes('这封信由「晚」写给你'));
  assert.ok(email.text.includes('这封信不用回复'));
  assert.ok(email.text.includes(UNSUBSCRIBE_URL));
  assert.match(email.html, /https:\/\/app\.example\.com\/letters\/unsubscribe/);
  assert.match(email.html, /href=/);
});

test('writes the body paragraphs into separate paragraphs without rewriting the text', async () => {
  const email = await letter();
  assert.match(email.html, /<p/);
  assert.ok(email.html.includes('阿哲，我今天煮面，锅里的水刚好是一个人的量。'));
  assert.ok(email.html.includes('你最近忙就忙你的。'));
});

test('escapes html in the letter body instead of rendering it', async () => {
  const email = await letter({ body: 'a < b & c "d" <script>alert(1)</script>' });

  assert.ok(email.html.includes('a &lt; b &amp; c &quot;d&quot;'));
  assert.ok(email.html.includes('&lt;script&gt;'));
  assert.equal(email.html.includes('<script>'), false);
});

test('escapeHtml covers the five html-reserved characters', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('refuses a letter without a subject, body, companion name or unsubscribe url', async () => {
  await assert.rejects(() => letter({ subject: '   ' }), /requires a subject/);
  await assert.rejects(() => letter({ body: '   ' }), /requires a body/);
  await assert.rejects(() => letter({ companionName: '' }), /requires a companion name/);
  await assert.rejects(() => letter({ unsubscribeUrl: '' }), /requires an unsubscribe url/);
});

test('refuses an unsubscribe url that cannot be sent as an https link', async () => {
  await assert.rejects(() => letter({ unsubscribeUrl: 'javascript:alert(1)' }), /valid https url/);
  await assert.rejects(() => letter({ unsubscribeUrl: '/letters/unsubscribe' }), /valid https url/);
});

test('does not attach marketing tags or call-to-action copy to the letter', async () => {
  const email = await letter();
  assert.equal(email.html.includes('button'), false);
  assert.equal(email.html.includes('点击查看'), false);
  assert.deepEqual(email.tags, [{ name: 'category', value: 'companion_letter' }]);
});

/**
 * 模板按 `locale` 参数化（U6 / t10）。
 *
 * 缺省 = 中文（既有调用点逐字符不变，上面那组断言就是它的回归网）；
 * `locale: 'en'` = 全部 chrome 换英文、`<html lang="en">`、**零汉字**（H1）。
 * 信件正文与角色名由调用方按同一语言给（U7 传 `visitors.locale`），所以英文态这里给英文正文 ——
 * 剩下任何汉字都只可能来自模板 chrome，正是这条断言要抓的东西。
 */
test('renders its chrome in English when locale is en, and keeps the default zh rendering unchanged', async () => {
  const han = /\p{Script=Han}/u;

  const zh = await letter();
  assert.match(zh.html, /lang="zh-CN"/);
  assert.ok(zh.text.includes('这封信由「晚」写给你'));
  assert.ok(zh.html.includes('在这里关闭'));

  const en = await letter({
    locale: 'en',
    companionName: 'Wan',
    subject: 'Walked past that shop today',
    body: 'Azhe, I cooked noodles tonight. The water in the pot was exactly enough for one.',
  });
  assert.match(en.html, /lang="en"/);
  assert.match(en.html, /Starlight Letter/);
  assert.match(en.html, /Turn letters off/);
  assert.ok(en.text.includes('This letter was written to you by Wan'));
  assert.equal(han.test(en.html), false, 'en 邮件 HTML 不得含汉字');
  assert.equal(han.test(en.text), false, 'en 邮件纯文本不得含汉字');
  for (const leak of ['星光来信', '在这里关闭', '不想再收到', '最后更新']) {
    assert.equal(en.html.includes(leak), false, `中文 chrome 漏进了英文邮件：${leak}`);
  }
  // 发件显示名与主题沿用调用方给的值（语言由 U7 侧决定），不因为 locale 被改写
  assert.deepEqual(en.from, { address: 'letters@whoole.io', name: 'Wan · Deep Whisper' });
  assert.equal(en.subject, 'Walked past that shop today');
});

test('the locale parameter reaches the template instead of being silently dropped', async () => {
  const en = await letter({ locale: 'en', companionName: 'Wan', body: 'Just one line tonight.' });
  const zh = await letter({ locale: 'zh-CN', companionName: 'Wan', body: 'Just one line tonight.' });
  // 同一封信只换语言：可见本体（正文段落）逐字符相同，chrome 必须不同
  assert.ok(en.html.includes('Just one line tonight.'));
  assert.ok(zh.html.includes('Just one line tonight.'));
  assert.notEqual(en.html.replace(/<!-- -->/g, ''), zh.html.replace(/<!-- -->/g, ''));
});

test('unsubscribe token round-trips the visitor id', () => {
  const token = signUnsubscribeToken('0f0e1d2c-3b4a-5978-8675-4433221100ff', SECRET);
  assert.equal(verifyUnsubscribeToken(token, SECRET), '0f0e1d2c-3b4a-5978-8675-4433221100ff');
});

test('unsubscribe token keeps the raw visitor id out of the link', () => {
  const visitorId = '0f0e1d2c-3b4a-5978-8675-4433221100ff';
  const token = signUnsubscribeToken(visitorId, SECRET);
  assert.equal(token.includes(visitorId), false);
});

test('unsubscribe token rejects a swapped payload and a tampered signature', () => {
  const token = signUnsubscribeToken('visitor-a', SECRET);
  const [, signature] = token.split('.');
  const otherPayload = Buffer.from('visitor-b', 'utf8').toString('base64url');

  assert.equal(verifyUnsubscribeToken(`${otherPayload}.${signature}`, SECRET), null);
  assert.equal(verifyUnsubscribeToken(`${token}x`, SECRET), null);
  assert.equal(verifyUnsubscribeToken(token.slice(0, -4), SECRET), null);
});

test('unsubscribe token rejects a signature made with another secret', () => {
  const token = signUnsubscribeToken('visitor-a', 'other-secret');
  assert.equal(verifyUnsubscribeToken(token, SECRET), null);
});

test('unsubscribe token rejects malformed input without throwing', () => {
  for (const token of ['', '.', 'nodot', 'a.b.c']) {
    assert.equal(verifyUnsubscribeToken(token, SECRET), null);
  }
});

test('unsubscribe token requires a signing secret', () => {
  assert.throws(() => signUnsubscribeToken('visitor-a', '  '), /LETTER_UNSUBSCRIBE_SECRET/);
  assert.throws(
    () => verifyUnsubscribeToken(signUnsubscribeToken('visitor-a', SECRET), '  '),
    /LETTER_UNSUBSCRIBE_SECRET/,
  );
});

test('unsubscribe token requires a visitor id', () => {
  assert.throws(() => signUnsubscribeToken('   ', SECRET), /requires a visitor id/);
});

// Personal runtime uses the optional-callback template and expiring private tokens.
// The React Email renderer above remains a reusable layout helper, not a mail prerequisite.
test('personal template rejects empty required writing fields before reaching a transport',async()=>{
 const {buildPersonalLetterEmail}=await import('../src/lib/email/personal-template');
 const input={to:'owner@example.test',fromAddress:'sender@example.test',companionName:'Alex',subject:'Hello',body:'A letter'};
 for(const field of ['companionName','subject','body'] as const)assert.throws(()=>buildPersonalLetterEmail({...input,[field]:'   '}),/requires/);
});
test('private token signing rejects blank identities or signing material and expiry is mandatory',async()=>{
 const {signPersonalUnsubscribeToken,verifyPersonalUnsubscribeToken}=await import('../src/lib/email/personal-unsubscribe-token');
 assert.throws(()=>signPersonalUnsubscribeToken('   ','test-private-secret'),/owner/);
 assert.throws(()=>signPersonalUnsubscribeToken('owner','   '),/secret/);
 const token=signPersonalUnsubscribeToken('owner','test-private-secret',1000);
 assert.equal(verifyPersonalUnsubscribeToken(token,'test-private-secret',999),'owner');assert.equal(verifyPersonalUnsubscribeToken(token,'test-private-secret',1000),null);
});
