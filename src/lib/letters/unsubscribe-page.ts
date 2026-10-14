import { HTML_LANG, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate, type MessageKey } from '@/lib/i18n/messages';

import type { LetterStage } from './unsubscribe-stage';

/**
 * 退订确认页的**唯一视觉真源**（`/api/letters/unsubscribe` 的 GET/POST 都渲染它）。
 *
 * ## 为什么手写 HTML，而不是 React
 *
 * 原实现用 `renderToStaticMarkup`（理由是好拿 React 的自动转义）。**它过不了构建**：
 * Next 16 + Turbopack 在 app 路由图里禁止 import `react-dom/server`
 * （`You're importing a component that imports react-dom/server`，`pnpm build` 必红）。
 * 于是改成这里这样：一份自包含的文档字符串 + **一个必须经过的转义入口**。
 *
 * 转义的面比看起来小，而且每一条都在 `tests/letter-unsubscribe-page.test.ts` 里钉着：
 * 伴侣名（用户自由文本）、回投地址（含 token）、App 地址、品牌名，四处全部走 `esc()`；
 * 素材路径走 `ASSET_PATH` / `POSITION` 白名单（比值转义更严：不在素材目录内就整条丢掉）。
 * 其余内容要么是我们自己的字典文案，要么是纯数字。
 *
 * ## 为什么直出整份文档、零 JS
 *
 * 用户是从邮件里点进来的，可能是手机蜂窝网络、可能是邮件客户端内置浏览器。
 * 不 hydration、不加载任何 chunk、不依赖 `.next` 的 CSS 产物，一次请求就是最终画面。
 *
 * 本文件**不得出现中文字面量**（仓库 i18n 覆盖门禁口径，注释不计）：文案全部住
 * `messages/{zh-CN,en}/server.ts`。
 */

export type UnsubscribePageState = 'confirm' | 'done' | 'invalid' | 'failed';

export interface UnsubscribeWriter {
  name: string;
  /** 头像路径；未知角色时为 null（只渲染名字，不留空位）。 */
  avatarUrl: string | null;
  /** 已投递信件数；0 时不渲染这一行（不写「写了 0 封」）。 */
  lettersSent: number;
}

export interface UnsubscribePageProps {
  locale: Locale;
  state: UnsubscribePageState;
  brandName: string;
  /** 回投地址（含 token 的查询串）。缺省时表单回投当前 URL。 */
  actionUrl?: string;
  /** 「回到 App」的公开地址。 */
  siteUrl: string;
  /** 壁纸舞台；为 null 时渲染纯色夜色底（素材缺失也不至于变成白板）。 */
  stage: LetterStage | null;
  writer?: UnsubscribeWriter | null;
}

/** 只放行素材目录下的相对路径 —— 会拼进 `style` 与 `src`，这里是不信任边界。 */
const ASSET_PATH = /^\/backgrounds\/deepseek\/[a-z0-9/._-]+$/i;
/** 头像只放行角色插画目录。 */
const AVATAR_PATH = /^\/characters\/deepseek\/[a-z0-9/._-]+$/i;
/** 只放行 CSS 背景定位可用的字符（数字 / 单位 / 空格 / 百分号）。 */
const POSITION = /^[0-9a-z%.\s-]+$/i;

/**
 * 文本与属性共用的转义入口。**本文件里任何来自外部的字符串都必须经过它。**
 *
 * 属性用双引号包裹，所以 `"` 必须转掉；`'` 一并转掉，避免将来有人把某处属性改成单引号包裹时
 * 留下一个隐形缺口。`&` 必须最先替换，否则会把后面生成的实体再转一遍。
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assetUrl(value: string | undefined): string {
  return value && ASSET_PATH.test(value) ? `url("${value}")` : 'none';
}

function position(value: string | undefined): string {
  return value && POSITION.test(value) ? value : '50% 50%';
}

/**
 * 样式内嵌在一份 `<style>` 里（而不是每个元素 inline style）：只有媒体查询能表达
 * 「手机用竖版图、宽屏用横版图」，而这一条正是壁纸不被裁成一条中缝的关键。
 */
function stylesheet(stage: LetterStage | null): string {
  const mobile = assetUrl(stage?.image);
  const desktop = assetUrl(stage?.desktopImage);
  const mobilePosition = position(stage?.mobilePosition);
  const desktopPosition = position(stage?.desktopPosition);
  return `
:root{--paper:#fff;--ice:#c7e4ff;--bright:#5b9bff;--ink:#28425e;--muted:#71859a;--signature:#397fd4}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:var(--ink);background:#0a1020;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.stage{position:relative;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;padding:30px 14px;overflow:hidden}
.photo{position:absolute;inset:-8%;background-color:#0a1020;background-image:${mobile};background-size:cover;background-position:${mobilePosition};background-repeat:no-repeat;filter:blur(9px) saturate(1.12) brightness(1.04);transform:scale(1.05)}
.veil{position:absolute;inset:0;background:radial-gradient(120% 85% at 50% 2%,rgba(16,26,48,.18) 0%,rgba(9,15,30,.48) 58%,rgba(5,9,18,.72) 100%),linear-gradient(180deg,rgba(6,11,22,.3) 0%,rgba(6,11,22,.46) 100%)}
.card{position:relative;width:100%;max-width:540px;border-radius:28px;padding:32px 24px 26px;overflow:hidden;background:rgba(255,255,255,.94);border:1px solid rgba(255,255,255,.7);box-shadow:0 32px 70px -26px rgba(2,6,16,.8),0 2px 10px rgba(2,6,16,.28);backdrop-filter:blur(20px) saturate(1.1);-webkit-backdrop-filter:blur(20px) saturate(1.1)}
.card::before{content:'';position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#f7fbff 0%,#b8d2f3 34%,#5b9bff 62%,#d8e8fb 100%)}
.kicker{margin:0 0 20px;font-size:11.5px;letter-spacing:.12em;color:var(--signature)}
.writer{display:flex;align-items:center;gap:12px;margin:0 0 24px}
.avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;object-position:50% 22%;background:#e7f1fd;border:2px solid rgba(255,255,255,.95);box-shadow:0 4px 14px -4px rgba(57,127,212,.55)}
.writer-name{margin:0;font-size:13.5px;font-weight:600}
.writer-meta{margin:3px 0 0;font-size:12px;color:var(--muted)}
h1{margin:0 0 12px;font-family:Georgia,'Times New Roman','Songti SC',SimSun,serif;font-size:25px;font-weight:400;line-height:1.4;letter-spacing:-.02em}
.intro{margin:0 0 26px;font-size:14.5px;line-height:1.82;color:#416d99}
.primary{display:block;width:100%;height:50px;border:0;border-radius:999px;font-family:inherit;font-size:15px;font-weight:600;letter-spacing:.02em;color:#fff;background:linear-gradient(135deg,#6fa8ff 0%,#397fd4 100%);box-shadow:0 12px 28px -10px rgba(57,127,212,.65);cursor:pointer}
.primary:hover{filter:brightness(1.06)}
.primary:active{transform:translateY(1px) scale(.995)}
.secondary{display:block;height:50px;border-radius:999px;font-size:15px;font-weight:600;text-align:center;line-height:48px;text-decoration:none;color:var(--signature);background:rgba(255,255,255,.72);border:1px solid rgba(57,127,212,.34)}
.aside{margin:16px 0 0;font-size:12.5px;line-height:1.85;color:var(--muted);text-align:center}
.rule{height:1px;margin:24px 0 14px;background:linear-gradient(90deg,rgba(184,218,255,0) 0%,rgba(184,218,255,1) 50%,rgba(184,218,255,0) 100%)}
.footnote{margin:0;font-size:11.5px;line-height:1.8;color:#8d9fb3}
.footnote a{color:inherit}
a{text-decoration:underline;text-underline-offset:2px}
.seal{width:60px;height:60px;margin:0 0 20px;border-radius:50%;background:linear-gradient(140deg,#eaf4ff 0%,#c7e4ff 100%);box-shadow:inset 0 0 0 1px rgba(91,155,255,.35),0 10px 26px -12px rgba(57,127,212,.6);display:flex;align-items:center;justify-content:center}
.review{margin:20px 0 0;padding:15px 17px;border-radius:18px;background:rgba(241,248,255,.95);border:1px solid rgba(199,228,255,.9);font-size:12.5px;line-height:1.8;color:#416d99}
.stack{margin-top:20px}
:focus-visible{outline:2px solid var(--signature);outline-offset:3px}
@media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}
@media (min-width:820px){
.stage{padding:56px 24px}
.photo{background-image:${desktop};background-position:${desktopPosition};filter:blur(16px) saturate(1.08) brightness(1.02)}
.card{padding:44px 40px 34px}
h1{font-size:29px}
}
`.trim();
}

/** 写信人一行。名字是用户自由文本，必须转义；头像路径不在角色插画目录内就整条丢掉。 */
function writerBlock(writer: UnsubscribeWriter | null | undefined, t: Translator): string {
  if (!writer) return '';
  const avatar = writer.avatarUrl && AVATAR_PATH.test(writer.avatarUrl)
    ? `<img class="avatar" src="${esc(writer.avatarUrl)}" alt="" width="46" height="46">`
    : '';
  const meta = writer.lettersSent > 0
    ? `<p class="writer-meta">${esc(t('server.letters.unsubscribe_writer_meta', { count: writer.lettersSent }))}</p>`
    : '';
  return `<div class="writer">${avatar}<div><p class="writer-name">${esc(t('server.letters.unsubscribe_writer', { name: writer.name }))}</p>${meta}</div></div>`;
}

/** 回投表单：`action` 缺省即回投当前 URL（当前 URL 里就带着 token）。 */
function submitForm(actionUrl: string | undefined, label: string): string {
  return `<form method="post" action="${esc(actionUrl ?? '')}"><button class="primary" type="submit">${esc(label)}</button></form>`;
}

type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

function cardBody(props: UnsubscribePageProps, t: Translator): string {
  const { state, brandName, actionUrl, siteUrl } = props;
  const openApp = esc(t('server.letters.unsubscribe_open_app', { brand: brandName }));

  /**
   * kicker 直接复用邮件那一条 key（`✦ {brand} · 星光来信`）：
   * 页面与邮件是同一封信的两端，两处各写一遍必然漂移。
   */
  const head = `<p class="kicker">${esc(t('email.letter.kicker', { brand: brandName }))}</p>`
    + writerBlock(props.writer, t);

  if (state === 'confirm') {
    return head + [
      '<div>',
      `<h1>${esc(t('server.letters.unsubscribe_title'))}</h1>`,
      `<p class="intro">${esc(t('server.letters.unsubscribe_intro'))}</p>`,
      submitForm(actionUrl, t('server.letters.unsubscribe_confirm')),
      `<p class="aside">${esc(t('server.letters.unsubscribe_pause_hint'))}</p>`,
      '<div class="rule"></div>',
      '<p class="footnote">',
      esc(t('server.letters.unsubscribe_link_note')),
      '<br>',
      `<a href="${esc(siteUrl)}">${openApp} →</a>`,
      '</p>',
      '</div>',
    ].join('');
  }

  if (state === 'done') {
    return head + [
      '<div>',
      '<div class="seal" aria-hidden="true">',
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#397fd4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"></path></svg>',
      '</div>',
      `<h1>${esc(t('server.letters.unsubscribe_done_title'))}</h1>`,
      `<p class="intro">${esc(t('server.letters.unsubscribe_done_body'))}</p>`,
      `<div class="review">${esc(t('server.letters.unsubscribe_done_hint'))}</div>`,
      `<div class="stack"><a class="secondary" href="${esc(siteUrl)}">${openApp}</a></div>`,
      '<div class="rule"></div>',
      `<p class="footnote">${esc(t('server.letters.unsubscribe_done_note'))}</p>`,
      '</div>',
    ].join('');
  }

  if (state === 'invalid') {
    return head + [
      '<div>',
      `<h1>${esc(t('server.letters.unsubscribe_link_invalid'))}</h1>`,
      `<p class="intro">${esc(t('server.letters.unsubscribe_invalid_body'))}</p>`,
      `<a class="secondary" href="${esc(siteUrl)}">${openApp}</a>`,
      '<div class="rule"></div>',
      `<p class="footnote">${esc(t('server.letters.unsubscribe_invalid_note'))}</p>`,
      '</div>',
    ].join('');
  }

  return head + [
    '<div>',
    `<h1>${esc(t('server.letters.unsubscribe_failed_title'))}</h1>`,
    `<p class="intro">${esc(t('server.letters.unsubscribe_failed_body'))}</p>`,
    submitForm(actionUrl, t('server.letters.unsubscribe_failed_retry')),
    '<div class="rule"></div>',
    `<p class="footnote">${esc(t('server.letters.unsubscribe_failed_note'))}</p>`,
    '</div>',
  ].join('');
}

/** 渲染成完整文档字符串。 */
export function renderUnsubscribePage(props: UnsubscribePageProps): string {
  const messages = MESSAGES[props.locale];
  const t: Translator = (key, vars) => translate(messages, key, vars);

  return [
    '<!doctype html>',
    `<html lang="${HTML_LANG[props.locale]}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="color-scheme" content="light">',
    `<title>${esc(t('server.letters.unsubscribe_doc_title', { brand: props.brandName }))}</title>`,
    `<style>${stylesheet(props.stage)}</style>`,
    '</head>',
    '<body>',
    '<main class="stage">',
    '<div class="photo" aria-hidden="true"></div>',
    '<div class="veil" aria-hidden="true"></div>',
    '<section class="card">',
    cardBody(props, t),
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
}
