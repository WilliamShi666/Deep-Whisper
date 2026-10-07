import type { entry as zhEntry } from '../zh-CN/entry';

/**
 * 入口三页（`/` 骨架屏、`/login` 登录注册、`/onboarding` 开屏四步）与第三方登录的英文文案
 * （**所有者：U2 / t6**）。
 *
 * `Record<keyof typeof zhEntry, string>` 是 en 侧唯一的约束写法：少一条 key → `TS2739`、
 * 多一条 key → `TS2353`，两条都在 `pnpm ts-check` 里红（契约 §2.3）。
 *
 * 写作口径：
 *   - **英文重写，不逐字直译**（计划 §2 第 3 行）：中文的「深夜亮着一盏灯」这种意象换成本地
 *     读者顺口的说法，而不是把汉字一对一搬过去；
 *   - 语气与产品一致：亲密、克制、不油腻（DESIGN.md「深夜心动」）；
 *   - **零汉字**（H1/H2）：英文态任何一条文案都不许出现 CJK；
 *   - 每条 key 的占位符集合必须与 `zh-CN/entry.ts` 逐字符相同（契约 §2.4.1）。
 *
 * 唯一的**带空白条目**：`oauth.blocked.separator = '; '`（英文分隔符 = 分号 + 一个半角空格，
 * 中文侧是 `'；'` 不带空格）。这是契约 §14 E5（队长裁决 v2）逐条放行的形态 ——
 * 「尾部空白仅当 key 末段匹配 `/(^|_)separator$/` 时允许」，并**以本文件这一条为示例**；
 * 属主是 `tests/i18n-messages.test.ts`（U7 / t8）。不要把这种语言差异挤回代码里拼 `+ ' '`。
 */
export const entry: Record<keyof typeof zhEntry, string> = {
  'owner.subtitle': 'Unlock your personal companion',
  'owner.password': 'Owner password',
  'owner.unlocking': 'Unlocking…',
  'owner.unlock': 'Unlock',
  'owner.help': 'Use the OWNER_PASSWORD set by the person hosting this instance.',
  'owner.rate_limited': 'Too many attempts. Try again later.',
  'owner.invalid': 'Password is incorrect or access is unavailable.',
  'owner.network': 'Unable to connect. Check the running server and try again.',
  'owner.title': 'Deep Whisper Personal · your AI companion',
  /* ---------- `/` splash ---------- */
  'splash.preparing': 'Getting things ready…',
  'splash.entering': 'Stepping in…',

  /* ---------- `/login` metadata (server-side, by cookie) ---------- */
  'login.meta.title': 'Unlock Deep Whisper',
  'login.meta.description':
    'Unlock your private, self-hosted companion with your owner password',

  /* ---------- `/onboarding` step 0: welcome ---------- */
  'onboarding.welcome.headline': 'Someone out there keeps a light on for you at midnight.',
  'onboarding.welcome.subline': 'This time, let them keep you company.',
  'onboarding.welcome.cta': 'Start the story',
  'onboarding.welcome.login_prompt': 'Owner password already set?',
  'onboarding.welcome.login_link': 'Unlock this instance',

  /* ---------- Flow navigation ---------- */
  'onboarding.back': 'Back',
  'onboarding.next': 'Next',

  /* ---------- `/onboarding` step 1: about you ---------- */
  'onboarding.about.title': 'First, let us meet you',
  'onboarding.about.subtitle': 'This is your own companion space — one chat and we are acquainted.',
  'onboarding.about.gender_label': 'I am',
  'onboarding.about.gender_male': 'Male',
  'onboarding.about.gender_female': 'Female',
  'onboarding.about.gender_other': 'Prefer not to say',
  'onboarding.about.orientation_label': 'I would like my companion to be',
  'onboarding.about.orientation_female': 'A girlfriend',
  'onboarding.about.orientation_male': 'A boyfriend',

  /* ---------- `/onboarding` step 2: pick a character ---------- */
  'onboarding.character.title': 'Who is walking toward you?',
  'onboarding.character.subtitle':
    'Choose one DeepSeek AI companion. Every character comes in both chibi and realistic-ratio artwork.',
  'onboarding.character.alt_chibi': 'chibi',
  'onboarding.character.alt_normal': 'realistic-ratio artwork',

  /* ---------- `/onboarding` step 3: shape your companion ---------- */
  'onboarding.customize.title': 'Shape your companion',
  'onboarding.customize.intro':
    '{name} is a DeepSeek AI companion — the name, the personality and the look are all yours to choose.',
  'onboarding.customize.name_label': 'Their name',
  'onboarding.customize.user_title_label': 'What they call you',
  'onboarding.customize.user_title_placeholder': 'e.g. honey / Alex / little one',
  'onboarding.customize.user_title_hint':
    'Give a real name, and they can grow a private little name for you out of it',
  'onboarding.customize.occupation_label': 'Chat-style tag (optional)',
  'onboarding.customize.occupation_placeholder': 'e.g. rational partner / gentle listener',
  'onboarding.customize.persona_label': 'Their personality',
  'onboarding.customize.voice_note':
    'Their voice comes from a cloud voice library — preview and change it later in chat settings.',
  'onboarding.customize.submit': 'Meet them',
  'onboarding.customize.submitting': 'Bringing you two together…',

  /* ---------- Digital look (artwork ratio) ---------- */
  'onboarding.style.label': 'Digital look',
  'onboarding.style.chibi': 'Chibi',
  'onboarding.style.normal': 'Realistic ratio (artwork)',
  'onboarding.style.chibi_preview_alt': 'chibi preview',
  'onboarding.style.normal_preview_alt': 'realistic-ratio artwork preview',

  /* ---------- `/onboarding` failure copy (local fallback only) ---------- */
  'onboarding.error.profile_save': 'Could not save your profile',
  'onboarding.error.dates_save': 'Could not save your profile and important dates. Please retry.',
  'onboarding.timezone.label': 'Confirm your time zone',
  'onboarding.timezone.hint': 'Prefilled from your browser, with Asia/Shanghai as the fallback. You can enter another IANA zone, such as Europe/Paris. It is saved when you first create your companion.',
  'onboarding.timezone.invalid': 'Enter a valid IANA time zone, such as Asia/Shanghai or Europe/Paris.',
  'onboarding.error.companion_create': 'Could not create your companion',
  'onboarding.error.conversation_create': 'Could not start the conversation',
  'onboarding.error.generic': 'Something went wrong. Please try again.',
};
