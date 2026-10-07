/**
 * 入口三页（`/` 骨架屏、`/login` 登录注册、`/onboarding` 开屏四步）与第三方登录文案
 * （**所有者：U2 / t6**）。
 *
 * 三条硬约束（改这一份字典前先读）：
 *   1. **中文态逐字符不变**（契约 H4 / I1）：每一条 zh 值都是改造前源码字面量的**逐字符复制**，
 *      不是重写。既有 e2e 的中文选择器（`开始心动` / `下一步` / `TA 的名字` / `遇见 TA` /
 *      `捏出你的 TA` / `Q 版` / `真人比例版（插画）` / `使用 Google 账号继续` / `注册并登录` /
 *      `你取消了授权，随时可以再试一次` …）依赖这一点。
 *   2. **key 命名规则**（契约 §2.2）：`^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,2}$` —— 小写 + 1–2 层点分。
 *   3. **占位符集合中英一致**（契约 §2.4.1）：`{count}` / `{name}` / `{names}` / `{code}` 两侧同集合。
 *
 * 归属边界：角色名 / 气质文案 / 音色代号**不进字典**（契约 §2.5）——它们在
 * `src/lib/characters.ts`（`nameRoman` / `en.*`）与 `src/lib/character-display.ts`
 * （`characterDisplayName` / `formatVoiceLabel`）。日期与数字格式在 `src/lib/i18n/format.ts`。
 *
 * 本文件是 `en/entry.ts` 的类型源：那边的 `Record<keyof typeof entry, string>` 少一条 key 就
 * `pnpm ts-check` 红（TS2739），多一条红（TS2353）。
 */
export const entry = {
  'owner.subtitle': "解锁你的私人陪伴空间",
  'owner.password': "主人密码",
  'owner.unlocking': "正在解锁…",
  'owner.unlock': "解锁",
  'owner.help': "使用部署此实例时设置的 OWNER_PASSWORD。",
  'owner.rate_limited': "尝试次数过多，请稍后重试。",
  'owner.invalid': "密码不正确或访问暂时不可用。",
  'owner.network': "无法连接，请检查服务已启动后重试。",
  'owner.title': "Deep Whisper Personal · 你的 AI 恋人",

  /* ---------- `/` 入口分发骨架屏 ---------- */
  'splash.preparing': '正在为你准备…',
  'splash.entering': '正在进入…',

  /* ---------- `/login`：页面 metadata（服务端按 cookie 语言取值） ---------- */
  'login.meta.title': '解锁 Deep Whisper',
  'login.meta.description': '使用主人密码解锁你自己部署的私人陪伴空间',

  /* ---------- `/onboarding` 第 0 步：欢迎 ---------- */
  'onboarding.welcome.headline': '总有人，在深夜为你亮着一盏灯。',
  'onboarding.welcome.subline': '这一次，换 TA 来陪你。',
  'onboarding.welcome.cta': '开始心动',
  'onboarding.welcome.login_prompt': '已设置主人密码？',
  'onboarding.welcome.login_link': '解锁实例',

  /* ---------- 流程导航（顶部返回键的 aria-label 与底部主按钮） ---------- */
  'onboarding.back': '上一步',
  'onboarding.next': '下一步',

  /* ---------- `/onboarding` 第 1 步：关于你 ---------- */
  'onboarding.about.title': '先认识一下你',
  'onboarding.about.subtitle': '这是你自己的陪伴空间，聊过就算认识。',
  'onboarding.about.gender_label': '我是',
  'onboarding.about.gender_male': '男生',
  'onboarding.about.gender_female': '女生',
  'onboarding.about.gender_other': '保密',
  'onboarding.about.orientation_label': '希望我的恋人是',
  'onboarding.about.orientation_female': '女朋友',
  'onboarding.about.orientation_male': '男朋友',

  /* ---------- `/onboarding` 第 2 步：选角色 ---------- */
  'onboarding.character.title': '谁会走向你？',
  'onboarding.character.subtitle': '选择一位 DeepSeek AI 伴侣；每个身份都能切换 Q 版和真人比例版插画。',
  /** 角色卡两张立绘的 alt 后缀（名字本身来自 characters.ts，见 characterDisplayName / nameRoman）。 */
  'onboarding.character.alt_chibi': 'Q版',
  'onboarding.character.alt_normal': '真人比例版插画',

  /* ---------- `/onboarding` 第 3 步：捏人 ---------- */
  'onboarding.customize.title': '捏出你的 TA',
  'onboarding.customize.intro': '「{name}」是 DeepSeek AI 伴侣；名字、性格和数字形象都可以由你选择。',
  'onboarding.customize.name_label': 'TA 的名字',
  'onboarding.customize.user_title_label': 'TA 怎么称呼你',
  'onboarding.customize.user_title_placeholder': '比如：宝宝 / 阿哲 / 小朋友',
  'onboarding.customize.user_title_hint': '填一个名字，TA 才可能从里面长出一个只属于你们的小叫法',
  'onboarding.customize.occupation_label': '交流风格标签（可选）',
  'onboarding.customize.occupation_placeholder': '例如：理性搭档 / 温柔倾听者',
  'onboarding.customize.persona_label': 'TA 的性格',
  'onboarding.customize.voice_note': 'TA 的声音来自云端音色库，创建后可在聊天设置里试听和更换。',
  'onboarding.customize.submit': '遇见 TA',
  'onboarding.customize.submitting': '正在为你们牵线…',

  /* ---------- 数字形象（立绘比例） ---------- */
  'onboarding.style.label': '数字形象',
  'onboarding.style.chibi': 'Q 版',
  'onboarding.style.normal': '真人比例版（插画）',
  'onboarding.style.chibi_preview_alt': 'Q版预览',
  'onboarding.style.normal_preview_alt': '真人比例版插画预览',

  /* ---------- `/onboarding` 失败提示（本地兜底；服务端原文仍走服务端 error 字段） ---------- */
  'onboarding.error.profile_save': '档案保存失败',
  'onboarding.error.dates_save': '画像与重要日期保存失败，请重试',
  'onboarding.timezone.label': '确认你的时区',
  'onboarding.timezone.hint': '已按浏览器检测预填；检测失败时使用 Asia/Shanghai。可填写其他 IANA 时区，例如 Europe/Paris，首次创建后保存。',
  'onboarding.timezone.invalid': '请填写有效的 IANA 时区，例如 Asia/Shanghai 或 Europe/Paris。',
  'onboarding.error.companion_create': '创建失败',
  'onboarding.error.conversation_create': '会话创建失败',
  'onboarding.error.generic': '出了点问题，请重试',
} as const;
