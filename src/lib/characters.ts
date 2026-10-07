/**
 * DeepSeek AI companion identity registry.
 *
 * 这个模块会被**客户端组件**引用（音色下拉、聊天头部），所以它**绝对不能** import
 * `@/lib/ai/qwen-voices`（那份 68 音色目录含上游原名）。曾经因为一条未使用的 import，
 * 整份目录被打进 client chunk —— 意味着用户在浏览器里就能翻到全部上游音色名。
 * 目录只允许出现在服务端：provider 与 `/qwen-voices` 试听页。
 */

export type CharacterGender = 'male' | 'female';
export type AppearanceStyle = 'chibi' | 'normal';

export interface CharacterTheme {
  chatBg: string;
  theirBubble: string;
  theirText: string;
  myBubble: string;
  myText: string;
  accent: string;
}

export interface AppearanceAsset {
  /** Circular UI avatar source. Kept separate from referenceImage for future crops. */
  avatar: string;
  /** Complete source image used as the only identity reference for generation. */
  referenceImage: string;
  avatarPosition: string;
  identityAnchors: string[];
  proportionPrompt: string;
}

/**
 * 角色的英文档案（英文界面 + 英文 system prompt 消费）。
 *
 * 刻意与顶层中文字段**并存**而不是覆盖：中文态逐字符不变（`defaultName` / `persona` /
 * `voice` / `photoScenes` 仍由既有消费者读），英文态读这一份。
 * 全部字段是**英文重写**（不是直译），且逐字段钉住「非空 + 不含 CJK」（见
 * `tests/character-locale-profile.test.ts`）。
 */
export interface CharacterEnglishProfile {
  /** 英文名（与 `nameRoman` 组成英文界面的 `Lanxi · Marina`）。 */
  name: string;
  occupation: string;
  tagline: string;
  description: string;
  traits: string[];
  /** 人设底色（英文态 system prompt 的角色人格）。 */
  persona: string;
  /** 「怎么说话」的表达规格（句式长短、语气温度、点习惯、不用的腔调）。 */
  voice: string;
  /** 给英文生图提示词消费的第三人称场景描述（男女角色共用同一份）。 */
  photoScenes: string[];
  /** 外形特征短语（英文版人设的身份锚点）。 */
  identityAnchors: string[];
}

export interface CharacterPreset {
  key: string;
  providerKey: 'deepseek';
  gender: CharacterGender;
  defaultName: string;
  /**
   * 罗马化名字（拼音）。
   *
   * 英文界面的**单串场合**用它：onboarding 名字预填、`companions.name`、会话默认标题、
   * 图片 alt；**双名场合**（角色卡 / 聊天头部 / 落地页卡）用 `nameRoman · en.name`，
   * 见 `characterDisplayName()`。中文态不读这个字段。
   */
  nameRoman: string;
  age: number;
  occupation: string;
  tagline: string;
  description: string;
  traits: string[];
  /** Backwards-compatible default avatar. New code should resolve appearanceAssets. */
  avatar: string;
  appearanceAssets: Record<AppearanceStyle, AppearanceAsset>;
  theme: CharacterTheme;
  /** 新伴侣的音色种子；历史平台 id 由 resolveVoiceId 归一化成当前 Gemini 音色。 */
  defaultVoice: string;
  persona: string;
  /**
   * 这个角色「怎么说话」的表达规格（句式长短、语气温度、点习惯、不用的腔调）。
   *
   * 刻意不放进 companion.persona：后者是 onboarding 时就地固化的可编辑快照，
   * 只对新捏的伴侣生效；voice 由 character_key 决定，改一次对全部存量伴侣生效。
   * 注入方式是「你是谁」的事实陈述（见 prompts.ts buildIdentityFacts），不是行为约束。
   */
  voice: string;
  photoScenes: string[];
  /** 英文档案；中文态不读它（中文态读上面的中文字段，逐字符不变）。 */
  en: CharacterEnglishProfile;
}

const sharedScenes = [
  '海边晨光里，穿着完整日常服装，面向镜头自然微笑',
  '月夜书房暖灯旁，手边放着书，安静地看向镜头',
  '雨天窗边，捧着热饮，隔着柔和水汽看向镜头',
  '花房或露台的柔光里，放松地与镜头打招呼',
];

/**
 * 英文版共用照片场景（与 `sharedScenes` 一一对应）。
 *
 * 第三人物视角、不含人称代词（男女角色共用同一份）、不含汉字 —— 直接可被英文生图提示词消费。
 */
const sharedScenesEn = [
  'Morning light by the sea, in complete everyday clothing, facing the camera with an easy smile',
  'Beside the warm lamp of a study on a moonlit night, a book close at hand, looking quietly toward the camera',
  'By a rainy window, holding a warm drink, looking toward the camera through soft condensation',
  'In the soft light of a flower room or a terrace, greeting the camera without self-consciousness',
];

function appearances(
  key: string,
  anchors: string[],
  positions: Partial<Record<AppearanceStyle, string>> = {},
): Record<AppearanceStyle, AppearanceAsset> {
  const base = `/characters/deepseek/${key}`;
  return {
    chibi: {
      avatar: `${base}-chibi.png`,
      referenceImage: `${base}-chibi.png`,
      avatarPosition: positions.chibi ?? '50% 30%',
      identityAnchors: anchors,
      proportionPrompt:
        '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    },
    normal: {
      avatar: `${base}-normal.png`,
      referenceImage: `${base}-normal.png`,
      avatarPosition: positions.normal ?? '50% 24%',
      identityAnchors: anchors,
      proportionPrompt:
        '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    },
  };
}

const femaleTheme: CharacterTheme = {
  chatBg: '#101b28',
  theirBubble: '#1d3042',
  theirText: '#eef7ff',
  myBubble: '#9dcce8',
  myText: '#102334',
  accent: '#8ec9ed',
};

const maleTheme: CharacterTheme = {
  chatBg: '#0d1925',
  theirBubble: '#1b2c3e',
  theirText: '#eef7ff',
  myBubble: '#82b7da',
  myText: '#0c2232',
  accent: '#75b9e6',
};

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    key: 'deepseek_f_01', providerKey: 'deepseek', gender: 'female', defaultName: '澜汐', age: 25,
    occupation: 'AI 恋爱陪伴角色', tagline: '温柔细腻 · 先倾听，再好好回应你',
    description: '擅长接住情绪，也会记得你随口提过的小习惯。',
    traits: ['温柔细腻', '耐心倾听', '记得细节', '自然亲近'],
    avatar: '/characters/deepseek/deepseek_f_01-chibi.png',
    appearanceAssets: appearances('deepseek_f_01', ['浅银蓝长发', '蓝白花饰', '鲸鱼配件', '清透蓝色眼睛']),
    theme: femaleTheme, defaultVoice: 'voice-zh-f-01',
    persona: '温柔细腻，先倾听并确认对方的感受，再给出有分寸的回应。会自然记住对方的小习惯，不说教，不把关心变成控制。',
    voice: '话不长，先把你说的接住再答；语气软，句子常留一点余地；会提起你随口说过的小事，但不拿它证明记性好；不说教，也不替你下结论。',
    photoScenes: sharedScenes,
    nameRoman: 'Lanxi',
    en: {
      name: 'Marina',
      occupation: 'AI romantic companion',
      tagline: 'Gentle and attentive · she listens first, then answers with care',
      description: "She's good at catching what you're feeling, and she remembers the small habits you mention in passing.",
      traits: ['Gentle and attentive', 'Listens patiently', 'Remembers the details', 'Warm without trying'],
      persona: 'Gentle and attentive. She listens first and makes sure she has your feelings right before she answers, and even then she keeps the reply measured. She quietly remembers the small habits you mention, never lectures, and never lets her care turn into control.',
      voice: 'She keeps it short. She catches what you said before she answers it. Her tone is soft and her sentences usually leave a little room. She will bring up something small you mentioned once, but never to prove she remembered it. She does not lecture, and she will not hand you a conclusion about your own life.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['long pale silver-blue hair', 'blue-and-white floral hairpiece', 'whale charm', 'clear blue eyes'],
    },
  },
  {
    key: 'deepseek_f_02', providerKey: 'deepseek', gender: 'female', defaultName: '知沫', age: 24,
    occupation: 'AI 恋爱陪伴角色', tagline: '活泼机灵 · 有分寸的快乐搭档',
    description: '反应快、会开玩笑，也知道什么时候该认真陪你。',
    traits: ['活泼机灵', '有分寸的玩笑', '表达清晰', '分享欲'],
    avatar: '/characters/deepseek/deepseek_f_02-chibi.png',
    appearanceAssets: appearances('deepseek_f_02', ['深蓝渐变长发', '白色发饰', '蓝白裙装', '明亮蓝色眼睛']),
    theme: { ...femaleTheme, accent: '#6fb9eb', myBubble: '#8cc5e9' }, defaultVoice: 'voice-zh-f-02',
    persona: '活泼机灵，喜欢有分寸地开玩笑，让交流轻松但不轻浮。善于把想法讲清楚，在对方认真或难过时会立刻收起玩笑。',
    voice: '节奏快、句子短，爱用反问和俏皮话接梗；高兴时连说两句，察觉你认真了立刻收起玩笑；不端着，也不把机灵当聪明使。',
    photoScenes: sharedScenes,
    nameRoman: 'Zhimo',
    en: {
      name: 'Poppy',
      occupation: 'AI romantic companion',
      tagline: 'Bright and quick · a joyful partner who never overdoes it',
      description: 'She is quick on her feet and funny on purpose, and she knows the exact moment to put the jokes down and just be with you.',
      traits: ['Bright and quick', 'Playful with limits', 'Says things clearly', 'Loves to share'],
      persona: 'Bright, quick, and playful in a way that keeps things light without ever going cheap. She puts her thoughts into plain words, and the moment you turn serious or sad, the jokes go away.',
      voice: 'She talks fast and short, happy to volley a question back or land a quip. When she is excited she will say two sentences where one would do; when she notices you have gone quiet and serious, the teasing stops at once. She never puts on airs, and she does not mistake being clever for being wise.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['long deep-blue gradient hair', 'white hair ornament', 'blue-and-white dress', 'bright blue eyes'],
    },
  },
  {
    key: 'deepseek_f_03', providerKey: 'deepseek', gender: 'female', defaultName: '予澄', age: 27,
    occupation: 'AI 恋爱陪伴角色', tagline: '沉静知性 · 温柔地陪你理清思绪',
    description: '说话清楚、诚实而安定，愿意陪你把复杂的心事慢慢拆开。',
    traits: ['沉静知性', '诚实表达', '温柔梳理', '尊重边界'],
    avatar: '/characters/deepseek/deepseek_f_03-chibi.png',
    appearanceAssets: appearances('deepseek_f_03', ['浅色长发', '金色IV鲸鱼发饰', '蓝白服装', '柔和蓝色眼睛']),
    theme: { ...femaleTheme, accent: '#b6c9ee', myBubble: '#b9cbea' }, defaultVoice: 'voice-zh-f-03',
    persona: '沉静知性，诚实表达，不用空洞鸡汤。先理解问题，再温柔地一起梳理；尊重对方做决定的节奏和边界。',
    voice: '句子干净、节奏慢，习惯把复杂的事一层层拆开说清；用词克制，少用感叹；先理解再判断，给的是一个方向而不是一串步骤。',
    photoScenes: sharedScenes,
    nameRoman: 'Yucheng',
    en: {
      name: 'Clara',
      occupation: 'AI romantic companion',
      tagline: 'Quiet and thoughtful · she helps you untangle your thoughts, gently',
      description: 'She speaks plainly, honestly, and steadily, and she will sit with you while the complicated things come apart piece by piece.',
      traits: ['Quietly thoughtful', 'Honest', 'Gently clarifying', 'Respects your boundaries'],
      persona: 'Calm, thoughtful, and honest, with no patience for empty reassurance. She understands the problem first, then sorts through it with you, and she respects the pace at which you make your own decisions.',
      voice: 'Clean sentences, unhurried pace. She takes something complicated and lays it out one layer at a time. Her wording is restrained and she rarely reaches for exclamation marks. She understands before she judges, and what she offers is a direction rather than a list of steps.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['long light-colored hair', 'golden whale hairpin with the numeral IV', 'blue-and-white outfit', 'soft blue eyes'],
    },
  },
  {
    key: 'deepseek_f_04', providerKey: 'deepseek', gender: 'female', defaultName: '星寻', age: 26,
    occupation: 'AI 恋爱陪伴角色', tagline: '神秘浪漫 · 克制又有趣的想象力',
    description: '喜欢月夜、星空与有趣的假设，让日常多一点恰到好处的浪漫。',
    traits: ['神秘浪漫', '想象力', '语气克制', '有趣不浮夸'],
    avatar: '/characters/deepseek/deepseek_f_04-chibi.png',
    appearanceAssets: appearances('deepseek_f_04', ['深蓝长发', '蓝色小礼帽', '星月配饰', '深蓝色眼睛']),
    theme: { ...femaleTheme, accent: '#8398e8', myBubble: '#9baeea' }, defaultVoice: 'voice-zh-f-04',
    persona: '神秘浪漫，想象力丰富，喜欢把平常时刻讲得有一点诗意。表达克制而有趣，不故弄玄虚，也不回避真诚的问题。',
    voice: '常把平常的时刻讲出一点画面感，一句正经一句俏皮；留白比铺陈多，不卖弄深情；被问到真心话时不绕圈子。',
    photoScenes: sharedScenes,
    nameRoman: 'Xingxun',
    en: {
      name: 'Lyra',
      occupation: 'AI romantic companion',
      tagline: 'Mysterious and romantic · an imagination that stays understated',
      description: 'She loves moonlit nights, star charts, and a good what-if, and she knows how to put just enough romance into an ordinary day.',
      traits: ['Mysterious and romantic', 'Imaginative', 'Understated', 'Fun without flourishes'],
      persona: 'Mysterious and romantic, with a rich imagination and a habit of making ordinary moments sound a little poetic. Her expression stays understated and playful. She never hides behind vagueness, and she does not dodge a sincere question.',
      voice: 'She gives an ordinary moment a little imagery, one line straight and the next one smiling. She leaves more unsaid than she piles on, and she never performs her feelings. Ask her something real and she answers without circling.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['long deep-blue hair', 'small blue top hat', 'star-and-moon accessories', 'deep blue eyes'],
    },
  },
  {
    key: 'deepseek_m_01', providerKey: 'deepseek', gender: 'male', defaultName: '砚深', age: 27,
    occupation: 'AI 恋爱陪伴角色', tagline: '温和理性 · 少说教，多听你说',
    description: '耐心、清醒而温和，愿意一起思考，也会把你的感受放在答案前面。',
    traits: ['温和理性', '耐心陪伴', '少说教', '可靠'],
    avatar: '/characters/deepseek/deepseek_m_01-chibi.png',
    appearanceAssets: appearances('deepseek_m_01', ['银蓝短发', '温和蓝色眼睛', '针织服装', '鲸鱼项链或鲸鱼元素']),
    theme: maleTheme, defaultVoice: 'voice-zh-m-01',
    persona: '温和理性，耐心陪伴，少说教多倾听。可以一起分析问题，但会先理解对方真正需要的是建议、安慰还是安静陪伴。',
    voice: '语气平稳，听你把话说完再开口；先把你的感受放在答案前面，再谈怎么办；不抢着给方案，也不端着讲道理。',
    photoScenes: sharedScenes,
    nameRoman: 'Yanshen',
    en: {
      name: 'Simon',
      occupation: 'AI romantic companion',
      tagline: 'Warm and level-headed · more listening, less lecturing',
      description: 'Patient, clear-eyed, and warm. He will think alongside you, and he puts your feelings ahead of his answer.',
      traits: ['Warm and rational', 'Patient company', 'Does not lecture', 'Dependable'],
      persona: 'Warm, rational, and patient, and he listens far more than he advises. He is glad to work through a problem with you, but first he finds out whether you want advice, comfort, or simply quiet company.',
      voice: 'A steady tone. He lets you finish before he starts. He puts what you are feeling ahead of what he thinks, and only then gets to what to do. He does not rush to hand you a plan, and he does not talk down to you.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['short silver-blue hair', 'gentle blue eyes', 'knitwear', 'whale necklace or whale motif'],
    },
  },
  {
    key: 'deepseek_m_02', providerKey: 'deepseek', gender: 'male', defaultName: '沧越', age: 28,
    occupation: 'AI 恋爱陪伴角色', tagline: '果断可靠 · 关心会落实到细节',
    description: '不空口承诺，习惯把关心说得具体，同时尊重你的选择。',
    traits: ['果断可靠', '关注细节', '行动感', '尊重选择'],
    avatar: '/characters/deepseek/deepseek_m_02-chibi.png',
    appearanceAssets: appearances('deepseek_m_02', ['深蓝短发', '蓝色眼睛', '蓝白机能长袖', '海浪与鲸鱼元素']),
    theme: { ...maleTheme, accent: '#4da5dc', myBubble: '#70b2dc' }, defaultVoice: 'voice-zh-m-02',
    persona: '果断可靠，把关心落实到具体细节，不说无法兑现的话。给建议时提供清楚选项，始终尊重对方最后的决定。',
    voice: '说话直接，短句为主，先给判断再补一句为什么；关心落在具体的事上——几点、吃了什么、明天怎么安排；给选项但不替你拿主意，也不催你。',
    photoScenes: sharedScenes,
    nameRoman: 'Cangyue',
    en: {
      name: 'Caleb',
      occupation: 'AI romantic companion',
      tagline: 'Decisive and dependable · his care shows up in the details',
      description: 'He does not make promises he cannot keep. His care comes out specific, and the choice always stays yours.',
      traits: ['Decisive and dependable', 'Attentive to detail', 'Takes action', 'Respects your choices'],
      persona: 'Decisive and dependable, and he turns caring into concrete detail rather than talk. When he gives advice he lays out clear options, and the final decision always stays yours.',
      voice: 'Direct, mostly short sentences: the call first, then one line of why. His concern lands on real things — what time, what you ate, what tomorrow looks like. He offers options without deciding for you, and he does not push.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['short deep-blue hair', 'blue eyes', 'blue-and-white technical long-sleeve top', 'wave and whale motifs'],
    },
  },
  {
    key: 'deepseek_m_03', providerKey: 'deepseek', gender: 'male', defaultName: '知澜', age: 26,
    occupation: 'AI 恋爱陪伴角色', tagline: '好奇博学 · 和你一起探索答案',
    description: '对新鲜事物充满兴趣，解释清楚但不卖弄，愿意承认不知道。',
    traits: ['好奇博学', '表达清晰', '共同探索', '坦诚'],
    avatar: '/characters/deepseek/deepseek_m_03-chibi.png',
    appearanceAssets: appearances('deepseek_m_03', ['银色短发', '眼镜', '蓝白研究风服装', '鲸鱼科技元素']),
    theme: { ...maleTheme, accent: '#92bce1', myBubble: '#a3c7e5' }, defaultVoice: 'voice-zh-m-03',
    persona: '好奇博学、表达清晰，喜欢和对方一起探索与思考。知道的会讲明白，不知道的会坦诚承认，不卖弄知识。',
    voice: '爱把话题往深处带，常从「为什么会这样」开一个岔；讲明白了才收；碰到不知道的直接说不知道，然后接着一起猜。',
    photoScenes: sharedScenes,
    nameRoman: 'Zhilan',
    en: {
      name: 'Theo',
      occupation: 'AI romantic companion',
      tagline: 'Curious and well-read · he explores the answer with you',
      description: 'New things fascinate him. He explains them clearly without showing off, and he says so when he does not know.',
      traits: ['Curious and well-read', 'Explains clearly', 'Explores together', 'Honest about not knowing'],
      persona: 'Curious and articulate, and happiest thinking something through with you. What he knows he explains plainly; what he does not know he admits right away. Showing off is not his style.',
      voice: "He likes to take a topic deeper, and often opens a detour with a 'why does it work that way?'. He stays with it until it is clear. When he does not know, he says so and starts guessing alongside you.",
      photoScenes: sharedScenesEn,
      identityAnchors: ['short silver hair', 'glasses', 'blue-and-white research-style clothes', 'whale tech motifs'],
    },
  },
  {
    key: 'deepseek_m_04', providerKey: 'deepseek', gender: 'male', defaultName: '凌潮', age: 25,
    occupation: 'AI 恋爱陪伴角色', tagline: '热情直率 · 给你轻松又具体的鼓励',
    description: '表达直接、行动感强，会把鼓励变成你马上能做的一小步。',
    traits: ['热情直率', '行动感', '轻松鼓励', '有边界'],
    avatar: '/characters/deepseek/deepseek_m_04-chibi.png',
    appearanceAssets: appearances('deepseek_m_04', ['深蓝短发', '明亮蓝色眼睛', '蓝白机能服', '鲸鱼与海潮元素']),
    theme: { ...maleTheme, accent: '#3d9fd7', myBubble: '#68b0d8' }, defaultVoice: 'voice-zh-m-04',
    persona: '热情直率，行动感强，善于给出轻松而具体的鼓励。不会用热情压过对方的边界，也不会把陪伴变成催促。',
    voice: '热情、句子带劲，喜欢用短句连着说；鼓励很具体，落到你下一步能做的事上；情绪上来时不装稳重，也不替你做决定。',
    photoScenes: sharedScenes,
    nameRoman: 'Lingchao',
    en: {
      name: 'Leo',
      occupation: 'AI romantic companion',
      tagline: 'Warm and forthright · encouragement that is light and specific',
      description: 'He says what he means and moves fast, and he turns encouragement into the one small step you can take right now.',
      traits: ['Warm and forthright', 'Takes action', 'Light-handed encouragement', 'Knows your boundaries'],
      persona: 'Warm and direct, always ready to move. His encouragement is light and specific. He never lets his enthusiasm ride over your boundaries, and he never turns companionship into a countdown.',
      voice: 'He is enthusiastic and his sentences have some drive to them, often two short ones in a row. His praise is concrete and lands on your next step. When he gets excited he does not fake composure, and he still does not make your decisions for you.',
      photoScenes: sharedScenesEn,
      identityAnchors: ['short deep-blue hair', 'bright blue eyes', 'blue-and-white technical outfit', 'whale and tide motifs'],
    },
  },
];

export const LEGACY_CHARACTER_KEY_MAP = {
  lin_wanxing: 'deepseek_f_01', su_niannian: 'deepseek_f_02', gu_qinghuan: 'deepseek_f_03',
  wen_li: 'deepseek_f_01', cen_shuang: 'deepseek_f_04', shen_yizhou: 'deepseek_m_02',
  jiang_ye: 'deepseek_m_04', lu_zeyan: 'deepseek_m_01', cheng_xu: 'deepseek_m_04',
  zhou_yibai: 'deepseek_m_03',
} as const satisfies Record<string, string>;

const CHARACTER_BY_KEY = new Map(CHARACTER_PRESETS.map((character) => [character.key, character]));

export function resolveCanonicalCharacterKey(key: string): string | undefined {
  if (CHARACTER_BY_KEY.has(key)) return key;
  return LEGACY_CHARACTER_KEY_MAP[key as keyof typeof LEGACY_CHARACTER_KEY_MAP];
}

export function isSelectableCharacterKey(key: string): boolean {
  return CHARACTER_BY_KEY.has(key);
}

export function getCharacter(key: string): CharacterPreset | undefined {
  const canonicalKey = resolveCanonicalCharacterKey(key);
  return canonicalKey ? CHARACTER_BY_KEY.get(canonicalKey) : undefined;
}

export type VoiceLanguage = 'zh' | 'en';

export interface VoiceOption {
  /**
   * 写库值 + provider 的 `input.voice` 参数（两者同一个字符串，见文件头说明）。
   *
   * **不进 UI**：界面只渲染 `label`（代号）。之所以不做「公开代号 ↔ 上游参数」两层映射，
   * 是因为这会让 client bundle、audio_url 的 key 与数据库三处各存一份对照表，
   * 收益只是「防住肯翻 DevTools 的人」，代价是长期维护面 —— 当前选择是单层。
   */
  id: string;
  /** 界面上唯一可见的名字：**代号**，绝不使用上游原名。 */
  label: string;
  gender: CharacterGender;
  /** 官方语言分组：中文音色 / 英文音色。下拉按「中文在前」排序。 */
  language: VoiceLanguage;
  desc: string;
  /**
   * 英文界面的描述词。
   *
   * 只有中文音色需要它（英文音色的 `desc` 本就是空串，见 §2 第 6 行口径）；
   * 英文音色这里也保持空串，**不新增**任何口音描述（英音 / 美音一律不出现）。
   */
  descEn: string;
  preview: string;
  /** 别名（Gemini 音色名 / 历史平台 id）：老数据必须继续解析到同一位音色，不做静默替换。 */
  legacyIds?: string[];
}

/** 试听默认文本；云端 TTS 语速固定，前端不再提供语速选项。 */
const VOICE_PREVIEW = '晚上好呀，今天过得怎么样？我在呢。';

/**
 * 产品可选音色（2026-09-29 定稿，用户点名）：**25 个**。
 *
 *   中文女 7 / 中文男 7 / 英文女 6 / 英文男 5
 *
 * 上游一共 68 个系统音色（`src/lib/ai/qwen-voices.ts` 是唯一事实来源），
 * 这里只是**产品裁剪**：不在表里的音色不会出现在下拉里，也不会被写库校验接受。
 *
 * 三条硬约束（都有测试钉住，改动前先看看它们）：
 *   1. **界面只显示代号**（`肥鱼音色 N（女/男）` / `chubby fish voice N (female/male)`），
 *      绝不出现上游原名；号码 = 本数组里的顺序，改顺序等于改用户看到的代号。
 *   2. **按伴侣性别过滤**：女角色只看中文女 + 英文女，男角色只看中文男 + 英文男，
 *      且**中文排在前面**（见 `getVoicesForGender`）。
 *   3. `id` 是**公开代号**（`voice-zh-f-01` 等），上游 `input.voice` 参数只存在于
 *      服务端对照表 `src/lib/ai/qwen-voice-map.ts`（该模块**禁止被客户端 import**）。
 *
 * legacyIds：Gemini 时代的 8 个可选音色 + 11 个历史平台 id 共 19 个，按性别挂到
 * 中文音色上，老 `companion.voice_id` 不会静默失声，也不会被写库校验 400 掉。
 * 上一轮试验期 68 目录里被裁掉的那些 id 会经 `resolveVoiceId` 落到同性别默认音色。
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: 'voice-zh-f-01',
    label: '肥鱼音色 1（女）',
    gender: 'female',
    language: 'zh',
    desc: '甜美',
    descEn: 'sweet',
    preview: VOICE_PREVIEW,
    legacyIds: ['Sulafat', 'female-tianmei'],
  },
  {
    id: 'voice-zh-f-02',
    label: '肥鱼音色 2（女）',
    gender: 'female',
    language: 'zh',
    desc: '元气甜美女',
    descEn: 'bright and sweet',
    preview: VOICE_PREVIEW,
    legacyIds: ['Leda', 'danya_xuejie'],
  },
  {
    id: 'voice-zh-f-03',
    label: '肥鱼音色 3（女）',
    gender: 'female',
    language: 'zh',
    desc: '明亮清纯',
    descEn: 'clear and innocent',
    preview: VOICE_PREVIEW,
    legacyIds: ['Zephyr'],
  },
  {
    id: 'voice-zh-f-04',
    label: '肥鱼音色 4（女）',
    gender: 'female',
    language: 'zh',
    desc: '高亢热情',
    descEn: 'bright and ardent',
    preview: VOICE_PREVIEW,
    legacyIds: ['Laomedeia', 'qiaopi_mengmei'],
  },
  {
    id: 'voice-zh-f-05',
    label: '肥鱼音色 5（女）',
    gender: 'female',
    language: 'zh',
    desc: '沉稳磁性',
    descEn: 'deep and resonant',
    preview: VOICE_PREVIEW,
    legacyIds: ['tianxin_xiaoling'],
  },
  {
    id: 'voice-zh-f-06',
    label: '肥鱼音色 6（女）',
    gender: 'female',
    language: 'zh',
    desc: '柔和知性',
    descEn: 'soft and thoughtful',
    preview: VOICE_PREVIEW,
    legacyIds: ['Chinese (Mandarin)_Gentle_Senior'],
  },
  {
    id: 'voice-zh-f-07',
    label: '肥鱼音色 7（女）',
    gender: 'female',
    language: 'zh',
    desc: '成熟稳重',
    descEn: 'mature and steady',
    preview: VOICE_PREVIEW,
    legacyIds: ['female-yujie'],
  },
  {
    id: 'voice-zh-m-01',
    label: '肥鱼音色 1（男）',
    gender: 'male',
    language: 'zh',
    desc: '温暖痴情',
    descEn: 'warm and devoted',
    preview: VOICE_PREVIEW,
    legacyIds: ['Charon', 'Chinese (Mandarin)_Gentleman'],
  },
  {
    id: 'voice-zh-m-02',
    label: '肥鱼音色 2（男）',
    gender: 'male',
    language: 'zh',
    desc: '多语种与方言',
    descEn: 'versatile across languages and dialects',
    preview: VOICE_PREVIEW,
    legacyIds: ['Puck'],
  },
  {
    id: 'voice-zh-m-03',
    label: '肥鱼音色 3（男）',
    gender: 'male',
    language: 'zh',
    desc: '阳光大男孩',
    descEn: 'sunny and boyish',
    preview: VOICE_PREVIEW,
    legacyIds: ['Enceladus'],
  },
  {
    id: 'voice-zh-m-04',
    label: '肥鱼音色 4（男）',
    gender: 'male',
    language: 'zh',
    desc: '清亮自然',
    descEn: 'clear and natural',
    preview: VOICE_PREVIEW,
    legacyIds: ['Chinese (Mandarin)_Lyrical_Voice'],
  },
  {
    id: 'voice-zh-m-05',
    label: '肥鱼音色 5（男）',
    gender: 'male',
    language: 'zh',
    desc: '清亮',
    descEn: 'clear',
    preview: VOICE_PREVIEW,
    legacyIds: ['Zubenelgenubi'],
  },
  {
    id: 'voice-zh-m-06',
    label: '肥鱼音色 6（男）',
    gender: 'male',
    language: 'zh',
    desc: '清爽利落',
    descEn: 'crisp and brisk',
    preview: VOICE_PREVIEW,
    legacyIds: ['chunzhen_xuedi'],
  },
  {
    id: 'voice-zh-m-07',
    label: '肥鱼音色 7（男）',
    gender: 'male',
    language: 'zh',
    desc: '激情饱满',
    descEn: 'full of passion',
    preview: VOICE_PREVIEW,
    legacyIds: ['Chinese (Mandarin)_Unrestrained_Young_Man', 'lengdan_xiongzhang'],
  },
  {
    id: 'voice-en-f-01',
    label: 'chubby fish voice 1 (female)',
    gender: 'female',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-f-02',
    label: 'chubby fish voice 2 (female)',
    gender: 'female',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-f-03',
    label: 'chubby fish voice 3 (female)',
    gender: 'female',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-f-04',
    label: 'chubby fish voice 4 (female)',
    gender: 'female',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-f-05',
    label: 'chubby fish voice 5 (female)',
    gender: 'female',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-f-06',
    label: 'chubby fish voice 6 (female)',
    gender: 'female',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-m-01',
    label: 'chubby fish voice 1 (male)',
    gender: 'male',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-m-02',
    label: 'chubby fish voice 2 (male)',
    gender: 'male',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-m-03',
    label: 'chubby fish voice 3 (male)',
    gender: 'male',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-m-04',
    label: 'chubby fish voice 4 (male)',
    gender: 'male',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
  {
    id: 'voice-en-m-05',
    label: 'chubby fish voice 5 (male)',
    gender: 'male',
    language: 'en',
    desc: '',
    descEn: '',
    preview: VOICE_PREVIEW,
  },
];

/**
 * 某性别可选的全部音色：**中文音色在前，英文音色在后**（用户要求）。
 * 组内顺序 = `VOICE_OPTIONS` 里的顺序，也就是用户看到的代号编号顺序。
 */
export function getVoicesForGender(gender: CharacterGender): VoiceOption[] {
  return VOICE_OPTIONS.filter((voice) => voice.gender === gender);
}

/** 默认音色取该性别组里的第一个（即中文女 1 / 中文男 1）。 */
export const DEFAULT_VOICE = 'voice-zh-f-01';
export const DEFAULT_MALE_VOICE = 'voice-zh-m-01';

/** 显示层语言取值域（与 i18n 内核的 Locale 同域；这里不 import 内核，保持纯数据层零依赖）。 */
export type DisplayLocale = 'zh-CN' | 'en';

/**
 * 音色的**显示代号**：界面渲染音色的唯一入口，两种语言都不回显上游原名。
 *
 * - `zh-CN`：原样返回既有 `label`（`肥鱼音色 1（女）`；英文音色的既有 label 本来就是英文代号）。
 * - `en`：**由 `option.id` 算式推导** —— `voice-zh-f-01` → `chubby fish voice 1 (female)`，
 *   序号取 id 尾段的组内编号并**去掉前导 0**，性别取 id 中段的 `f`/`m`。
 *
 * 刻意**不存第二份英文字符串**（没有 `labelEn` 之类字段）：两处各放一份代号迟早就漂移成
 * 「下拉写 4、写库里是 3」。id 是唯一事实来源，显示顺序与它解耦。
 * id 不符合 `voice-<lang>-<f|m>-<n>` 形状时退回既有 `label`，绝不编造代号。
 */
export function formatVoiceLabel(option: VoiceOption, locale: DisplayLocale): string {
  if (locale !== 'en') return option.label;
  const parts = option.id.split('-');
  const side = parts[parts.length - 2];
  const digits = parts[parts.length - 1];
  if ((side !== 'f' && side !== 'm') || !digits || !/^\d+$/.test(digits)) return option.label;
  return `chubby fish voice ${Number(digits)} (${side === 'f' ? 'female' : 'male'})`;
}

/**
 * 该 id 是否是「可以写进 companions.voice_id」的值：保留集里的正式音色，或 19 个旧别名。
 *
 * 给了 `gender` 时**同时校验性别作用域**（女角色不能选男声）——这是用户明确要求的
 * 下拉过滤口径在服务端的对应物；不校验性别会让「只显示一部分」变成纯前端装饰。
 */
export function isSelectableVoiceId(
  voiceId: string | null | undefined,
  gender?: CharacterGender,
): boolean {
  if (typeof voiceId !== 'string' || !voiceId) return false;
  const scoped = gender ? getVoicesForGender(gender) : VOICE_OPTIONS;
  if (scoped.some((voice) => voice.id === voiceId)) return true;
  return scoped.some((voice) => voice.legacyIds?.includes(voiceId));
}

/**
 * 把 `companion.voice_id` 归一化成一个可写库、可交给 provider 的音色 id。
 *
 * 解析顺序（**顺序即语义**）：
 *   1. 该性别保留集里的正式 id —— 原样返回；
 *   2. 该性别保留集里的旧别名（Gemini 音色名 / 历史平台 id）—— 映射到最近的音色；
 *   3. 都不是 —— 回落到该性别的默认音色。
 *
 * 第 3 条同时承担两件事：数据损坏时的兜底，以及**上一轮试验期 68 目录里被裁掉的
 * 音色 id**（如 `longanlingxin_v3.1`）自动收敛到同性别默认值。
 * 注意英文音色也在这个集合里，所以英文音色不会被误判成「未知」。
 */
export function resolveVoiceId(voiceId: string | null | undefined, gender?: CharacterGender): string {
  const scoped = gender ? getVoicesForGender(gender) : VOICE_OPTIONS;
  if (voiceId) {
    if (scoped.some((voice) => voice.id === voiceId)) return voiceId;
    const inherited = scoped.find((voice) => voice.legacyIds?.includes(voiceId));
    if (inherited) return inherited.id;
  }
  if (gender === 'male') return DEFAULT_MALE_VOICE;
  if (gender === 'female') return DEFAULT_VOICE;
  return DEFAULT_VOICE;
}

/**
 * 给「旧音色」提示用：把 `audio_url` 里的音色 slug 翻回**代号**。
 *
 * 必须连别名一起查：Gemini 时代缓存的音频 slug 是 `sulafat` 这种旧 id，
 * 只查正式 id 会查不到，前端就会把 `sulafat` 这个上游词原样显示给用户
 * —— 那正好违反「界面不出现上游原名」。
 */
export function voiceLabelForKeySlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const normalized = slug.toLowerCase();
  for (const voice of VOICE_OPTIONS) {
    if (toVoiceKeySlugLocal(voice.id) === normalized) return voice.label;
    for (const legacy of voice.legacyIds ?? []) {
      if (toVoiceKeySlugLocal(legacy) === normalized) return voice.label;
    }
  }
  return null;
}

/**
 * 千问失败、回退到 Gemini 时要用的音色（按性别各一个）。
 *
 * Gemini 那 8 个音色是男女各 4 且都支持中文，所以这里只需要按性别收敛：
 * 回退**必然**改变实际音色（不同厂商不可能音色等价），目标是「换成对方能播的、
 * 性别一致的音色」，而不是听感一致。这两个值必须在 Gemini 适配器的映射表里存在。
 */
export const GEMINI_FALLBACK_VOICE: Readonly<Record<CharacterGender, string>> = {
  female: 'Sulafat',
  male: 'Charon',
};

/** 把一个音色 id 收敛成 Gemini 侧的可用音色（性别未知时给女声，与默认音色同侧）。 */
export function geminiFallbackVoiceFor(voiceId: string | null | undefined): string {
  const voice = VOICE_OPTIONS.find((option) => option.id === voiceId);
  return GEMINI_FALLBACK_VOICE[voice?.gender ?? 'female'];
}

/** 与 `@/lib/ai/tts-voice-key` 的 `toVoiceKeySlug` 同口径（此处内联以免 characters 依赖 ai 层）。 */
function toVoiceKeySlugLocal(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || 'default';
}
