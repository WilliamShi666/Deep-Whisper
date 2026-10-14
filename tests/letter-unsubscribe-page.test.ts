import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DEFAULT_CHAT_THEME_BY_CHARACTER } from '../src/lib/character-default-theme';
import { getChatTheme } from '../src/lib/chat-themes';
import { getCharacter } from '../src/lib/characters';
import { renderUnsubscribePage, type UnsubscribePageProps } from '../src/lib/letters/unsubscribe-page';
import {
  LETTER_STAGE_STYLE,
  letterStageThemeId,
  letterWriterAvatar,
  resolveLetterStage,
} from '../src/lib/letters/unsubscribe-stage';
import { DEEPSEEK_WALLPAPER_PLAN_BY_ID } from './support/deepseek-wallpaper-plan';
import { scanSource } from './support/i18n-cjk';

/**
 * 退订页（`/api/letters/unsubscribe`）的两件事，都必须离线可验：
 *
 * 1. **渲染**：四种状态都是完整文档、零脚本、用户可控字段全部转义；
 * 2. **壁纸匹配**（用户 2026-10-07 的三条硬要求）：性别匹配、角色匹配、默认 Q 版。
 *
 * 第 2 条的期望值**不抄实现里的常量**（那样断言恒真）：角色 → 壁纸的归属取自
 * `tests/support/deepseek-wallpaper-plan.ts`（素材归属的权威表），再要求实现选出来的那一张
 * 同时满足 `characterKey` 相同、`style === 'chibi'`、`gender` 与角色定义一致。
 */

const COMPONENT_FILE = 'src/lib/letters/unsubscribe-page.ts';
const componentSource = readFileSync(new URL('../' + COMPONENT_FILE, import.meta.url), 'utf8');

const STAGE = resolveLetterStage({ visitorId: 'visitor-abc', characterKey: 'deepseek_f_02', genderHint: null });

function page(overrides: Partial<UnsubscribePageProps> = {}): string {
  return renderUnsubscribePage({
    locale: 'zh-CN',
    state: 'confirm',
    brandName: 'Deep Whisper',
    actionUrl: '/api/letters/unsubscribe?token=abc.def',
    siteUrl: 'https://app.example.com',
    stage: STAGE,
    writer: {
      name: '知沫',
      avatarUrl: '/characters/deepseek/deepseek_f_02-chibi.png',
      lettersSent: 3,
    },
    ...overrides,
  });
}

test('四种状态都渲染成可独立打开的完整文档，且一个脚本都没有', () => {
  for (const state of ['confirm', 'done', 'invalid', 'failed'] as const) {
    const html = page({ state, actionUrl: state === 'done' || state === 'invalid' ? undefined : '/api/letters/unsubscribe?token=abc.def' });
    assert.match(html, /^<!doctype html><html lang="zh-CN">/, `state=${state} 必须是完整文档`);
    assert.match(html, /<meta name="viewport"/, `state=${state} 要有 viewport（手机上不能缩成一屏白字）`);
    assert.match(html, /<style>/, `state=${state} 的样式必须内嵌（邮件客户端内置浏览器不保证加载外链 CSS）`);
    assert.match(html, /content="noindex, nofollow"/, `state=${state} 是一次性链接，不得被收录`);
    assert.doesNotMatch(html, /<script/i, `state=${state} 不得包含任何脚本（零 JS 是这一页的契约）`);
  }
});

test('每种状态说自己的话，且都来自字典（中文态）', () => {
  assert.match(page({ state: 'confirm' }), /停止恋人来信/);
  assert.match(page({ state: 'done' }), /已停止来信/);
  assert.match(page({ state: 'invalid' }), /链接已失效/);
  assert.match(page({ state: 'failed' }), /暂时没有保存成功/);

  // 只有确认态与失败态需要回投表单：已完成/失效的人不该再看到一个「确认停止」的按钮。
  assert.match(page({ state: 'confirm' }), /<form[^>]+method="post"/);
  assert.match(page({ state: 'failed' }), /<form[^>]+method="post"/);
  assert.match(page({ state: 'done' }), /<a[^>]+href="https:\/\/app\.example\.com"/);
  assert.doesNotMatch(page({ state: 'done' }), /<form/);
  assert.doesNotMatch(page({ state: 'invalid' }), /<form/);
});

test('英文态整页没有中文（文案确实走了字典，不是写死在模板里）', () => {
  // 伴侣名是**用户数据**，可以本来就是中文 —— 这里换成拉丁名，才能让「整页无汉字」这条断言
  // 只针对界面文案本身（否则它会把「角色叫知沫」误判成漏翻）。
  const en = page({ locale: 'en', writer: { name: 'Zhi Mo', avatarUrl: null, lettersSent: 2 } });
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Stop companion letters/);
  assert.doesNotMatch(en, /[\u4E00-\u9FFF]/, '英文页面里不得出现任何汉字');
});

test('文档外壳里的动态取值也转义（`<title>` 是 RCDATA，`</title>` 能提前闭合它）', () => {
  // 品牌名今天是常量，但外壳由模板字符串拼装 —— 这条断言锁住「未来谁把它变成可配置」时的边界。
  const html = page({ brandName: '</title><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<title>[^<]*&lt;\/title&gt;/);
  assert.doesNotMatch(html, /<\/title>\s*<script/);
});

test('写信人名与回投地址都经过转义（伴侣名是用户自由文本）', () => {
  const html = page({
    writer: { name: '<img src=x onerror=alert(1)>', avatarUrl: null, lettersSent: 1 },
    actionUrl: '/api/letters/unsubscribe?token=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E',
  });
  assert.doesNotMatch(html, /<img src=x/, '伴侣名不得作为标签落地');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script/i);
  // 属性里的引号不能提前闭合 action。
  assert.doesNotMatch(html, /action="[^"]*">\s*<script/);
});

test('壁纸：角色匹配 + 性别匹配 + 默认 Q 版（逐角色核对素材归属表）', () => {
  for (const characterKey of Object.keys(DEFAULT_CHAT_THEME_BY_CHARACTER)) {
    const character = getCharacter(characterKey);
    assert.ok(character, `${characterKey} 必须能解析出角色定义`);

    const themeId = letterStageThemeId({ visitorId: 'visitor-abc', characterKey, genderHint: null });
    assert.ok(themeId, `${characterKey} 必须选出一张壁纸`);

    const plan = DEEPSEEK_WALLPAPER_PLAN_BY_ID.get(themeId);
    assert.ok(plan, `${themeId} 必须存在于素材归属表`);
    assert.equal(plan.characterKey, characterKey, `${characterKey} 的退订页壁纸必须是它自己的画面`);
    assert.equal(plan.style, 'chibi', `${characterKey} 的退订页壁纸默认取 Q 版`);
    assert.equal(plan.gender, character.gender, `${characterKey} 的壁纸性别必须与角色一致`);

    // 素材路径必须与素材表里的 id 对得上（防止「选对了 id、渲染了别的图」）。
    const stage = resolveLetterStage({ visitorId: 'visitor-abc', characterKey, genderHint: null });
    const file = themeId.replace('deepseek-', '');
    assert.equal(stage?.image, `/backgrounds/deepseek/${file}.webp`);
    assert.equal(stage?.desktopImage, `/backgrounds/deepseek/desktop/${file}.jpg`);
    assert.equal(getChatTheme(themeId)?.gender, character.gender);
  }
});

test('角色认不出来时按访客取向守住性别；连取向都没有也仍是 Q 版', () => {
  for (const genderHint of ['female', 'male'] as const) {
    for (const characterKey of [null, 'a_key_that_no_longer_exists']) {
      const themeId = letterStageThemeId({ visitorId: 'visitor-abc', characterKey, genderHint });
      const plan = themeId ? DEEPSEEK_WALLPAPER_PLAN_BY_ID.get(themeId) : undefined;
      assert.ok(plan, '兜底也必须落在素材表里');
      assert.equal(plan.gender, genderHint, '认不出角色时至少不能给出异性画面');
      assert.equal(plan.style, LETTER_STAGE_STYLE);
    }
  }

  const unknown = letterStageThemeId({ visitorId: 'visitor-abc', characterKey: null, genderHint: null });
  assert.ok(unknown && DEEPSEEK_WALLPAPER_PLAN_BY_ID.has(unknown), '没有任何线索时仍要给出 Q 版壁纸');
});

test('同一个访客每次点开是同一幅画面（刷新不换脸）', () => {
  const first = resolveLetterStage({ visitorId: 'visitor-stable', characterKey: null, genderHint: 'female' });
  const second = resolveLetterStage({ visitorId: 'visitor-stable', characterKey: null, genderHint: 'female' });
  assert.deepEqual(first, second);

  const ids = new Set(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(
      (id) => resolveLetterStage({ visitorId: id, characterKey: null, genderHint: 'female' })?.image,
    ),
  );
  assert.ok(ids.size > 1, '不同访客应当散开在不同画面上（否则哈希没起作用）');
});

test('素材缺失时降级为纯色夜色底，而不是白板或坏图', () => {
  const html = page({ stage: null });
  assert.match(html, /background-image:none/);
  assert.match(html, /background-color:#0a1020/);
});

test('渲染器不碰 react-dom/server（Next 16 在 app 路由图里禁止它，会让 `pnpm build` 直接红）', () => {
  // 这条断言是 2026-10-07 那次真实构建失败的化石：原实现用 renderToStaticMarkup 换取自动转义，
  // Turbopack 报「You're importing a component that imports react-dom/server」。
  // 现在转义由本模块的 esc() 承担 —— 把它换回来必须立刻变红，而不是等到部署时才发现。
  // 只匹配 **import** 与 **调用** 形态：文件里的注释正当地解释了「为什么不这么做」。
  assert.doesNotMatch(componentSource, /from\s+['"]react-dom\/server['"]/);
  assert.doesNotMatch(componentSource, /renderToStaticMarkup\s*\(/);
});

test('写信人头像与壁纸同档（Q 版），未知角色不留空头像位', () => {
  assert.match(letterWriterAvatar('deepseek_m_02') ?? '', /-chibi\.png$/);
  assert.equal(letterWriterAvatar('a_key_that_no_longer_exists'), null);
  const html = page({ writer: { name: '知沫', avatarUrl: null, lettersSent: 0 } });
  assert.doesNotMatch(html, /class="avatar"/);
  assert.doesNotMatch(html, /已经给你写过/, '没有投递记录时不编造「写了 0 封」');

  // 头像路径走白名单：不在角色插画目录内的整条丢掉，绝不落进 src 属性。
  const hostile = page({
    writer: { name: '知沫', avatarUrl: 'x" onerror="alert(1)', lettersSent: 1 },
  });
  assert.doesNotMatch(hostile, /class="avatar"/);
  assert.doesNotMatch(hostile, /onerror/);
});

test('组件里不得出现中文字面量（文案全部住字典）', () => {
  assert.deepEqual(scanSource(COMPONENT_FILE, componentSource), []);
});
