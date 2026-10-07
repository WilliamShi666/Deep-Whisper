import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * 品牌名：Deep Whisper。
 *
 * 产品从「晚安之前」更名为 Deep Whisper。中文名待定，因此用户可见处
 * 只使用英文名，不留下任何旧名的残留 —— 半个页面上还是旧名字，
 * 比不改名更让人困惑。
 *
 * 个人版的邮件发件地址由主人自己的环境配置决定。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const BRAND = 'Deep Whisper';
const OLD_BRAND = '晚安之前';

test('the document metadata carries the new brand name', () => {
  const layout = read('src/app/layout.tsx');
  assert.match(layout, new RegExp(BRAND), 'layout metadata 必须使用新品牌名');
  assert.doesNotMatch(layout, new RegExp(OLD_BRAND), 'layout metadata 不得残留旧品牌名');
});

test('the onboarding welcome screen shows the new brand name', () => {
  // t53：开屏页拆成服务端 `page.tsx` + 客户端岛，界面文案住在客户端岛里。
  const onboarding = read('src/app/onboarding/onboarding-client.tsx');
  assert.match(onboarding, new RegExp(BRAND), '开屏页必须显示新品牌名');
  assert.doesNotMatch(onboarding, new RegExp(OLD_BRAND), '开屏页不得残留旧品牌名');
});

test('the owner unlock page uses the fixed Deep Whisper brand without a configuration endpoint',()=>{
 const source=read('src/app/login/login-client.tsx');
 assert.match(source,/Deep Whisper/);
 assert.doesNotMatch(source,/supabase-config/);
});

test('the owner unlock page does not restore a legacy placeholder brand',()=>{
 const client=read('src/app/login/login-client.tsx');
 assert.match(client,/Deep Whisper/);
 assert.doesNotMatch(client,/config\?\.name/);
});



test('personal mail inherits the fixed brand and takes its sender from generic configuration',()=>{
 const template=read('src/lib/i18n/messages/en/email.ts');
 assert.match(template,/Deep Whisper/);
 const config=read('src/lib/config/runtime.ts');
 assert.match(config,/EMAIL_FROM/);
 assert.doesNotMatch(template,/letters@whoole\.io/);
});



test('no user-visible surface still says the old brand name', () => {
  const surfaces = [
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/app/onboarding/onboarding-client.tsx',
    'src/app/login/page.tsx',
    'src/app/login/login-client.tsx',
    'src/lib/email/template.ts',
  ];
  for (const file of surfaces) {
    assert.doesNotMatch(read(file), new RegExp(OLD_BRAND), `${file} 仍残留旧品牌名`);
  }
});

test('the repository-facing docs are renamed too', () => {
  // Only the personal edition's public entry documents are distributed.
  for (const file of ['README.md', 'AGENTS.md']) {
    const source = read(file);
    assert.match(source, new RegExp(BRAND), `${file} 必须使用新品牌名`);
    assert.doesNotMatch(source, new RegExp(OLD_BRAND), `${file} 仍残留旧品牌名`);
  }
});


test('the login page metadata carries the new brand name', () => {
  /**
   * 断言形状的**刻意变更**（U2 / t6）：`/login` 的静态 `metadata` 改成了 `generateMetadata()`
   * 并以 `getServerLocale()` 取语言（契约 §9.5 判据 9.5.1），标题/描述因此搬进了字典
   * （`src/lib/i18n/messages/{zh-CN,en}/entry.ts`）。原断言钉的是「页面文件里出现品牌名」——
   * 那在抽取字典之后必然假红（页面不再持有文案），而品牌名本身并没有消失。
   * 所以这里改成核**文案的新家**（两种语言的字典各核一次，覆盖没有减少），
   * 并额外钉住页面确实接上了 `generateMetadata`。
   */
  const login = read('src/app/login/page.tsx');
  assert.match(
    login,
    /export async function generateMetadata\(\): Promise<Metadata>/,
    '登录页必须用 generateMetadata() 按服务端语言给标题与描述',
  );
  assert.doesNotMatch(login, new RegExp(OLD_BRAND), '登录页不得残留旧品牌名');
  for (const locale of ['zh-CN', 'en']) {
    const dict = read(`src/lib/i18n/messages/${locale}/entry.ts`);
    assert.match(dict, new RegExp(BRAND), `${locale} 入口字典必须使用新品牌名`);
    assert.doesNotMatch(dict, new RegExp(OLD_BRAND), `${locale} 入口字典不得残留旧品牌名`);
  }
});
