import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHARACTER_PRESETS, type CharacterPreset } from '../src/lib/characters';

/**
 * 角色英文档案 + 罗马化名字（契约 t3，依据 `docs/plans/2026-10-03-english-version.md` §2.1 / §3.4）。
 *
 * 两条"不许漂移"的硬约束都在这里钉住：
 *   1. **只新增不改既有**：顶层中文字段（含 `appearanceAssets.*.identityAnchors` / 两套比例提示词）
 *      逐字符等于冻结基线（下面的 `ZH_BASELINE` 是**改前 HEAD 的实测值**，不是从实现反推的，
 *      所以断言不可能恒真）。
 *   2. **英文档案必须是重写**：`nameRoman` 与 `en` 的每个字符串逐字段非空、且**不含 CJK**
 *      （用户硬约束：英文态绝不出现汉字）。
 */

/** CJK 判定：部首/假名/汉字/兼容表意/全角区段。刻意不含 U+00B7（英文双名的中点分隔符）。 */
const CJK = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 扫源码前先剥注释（照 tests/character-palette.test.ts / tests/voice-labels.test.ts）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** §2.1 定稿表（手抄，不从实现反推）：顺序 = 数组顺序 = deepseek_f_01..m_04。 */
const NAME_TABLE: ReadonlyArray<readonly [string, string, string]> = [
  ['deepseek_f_01', 'Lanxi', 'Marina'],
  ['deepseek_f_02', 'Zhimo', 'Poppy'],
  ['deepseek_f_03', 'Yucheng', 'Clara'],
  ['deepseek_f_04', 'Xingxun', 'Lyra'],
  ['deepseek_m_01', 'Yanshen', 'Simon'],
  ['deepseek_m_02', 'Cangyue', 'Caleb'],
  ['deepseek_m_03', 'Zhilan', 'Theo'],
  ['deepseek_m_04', 'Lingchao', 'Leo'],
];

/** `en` 必须逐字段齐全（顺序即验收顺序）。 */
const EN_STRING_FIELDS = ['name', 'occupation', 'tagline', 'description', 'persona', 'voice'] as const;
const EN_LIST_FIELDS = ['traits', 'photoScenes', 'identityAnchors'] as const;

interface ZhBaseline {
  key: string;
  gender: string;
  defaultName: string;
  age: number;
  occupation: string;
  tagline: string;
  description: string;
  traits: string[];
  avatarPositions: string[];
  identityAnchorsChibi: string[];
  identityAnchorsNormal: string[];
  proportionPromptChibi: string;
  proportionPromptNormal: string;
  theme: Record<string, string>;
  defaultVoice: string;
  persona: string;
  voice: string;
  photoScenes: string[];
}

/**
 * 改前基线（`git show HEAD:src/lib/characters.ts` 实测导出）。
 * 中文态逐字符不变 = 中文用户逐像素不变。
 */
const ZH_BASELINE: Record<string, ZhBaseline> = {
  deepseek_f_01: {
    key: 'deepseek_f_01',
    gender: 'female',
    defaultName: '澜汐',
    age: 25,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '温柔细腻 · 先倾听，再好好回应你',
    description: '擅长接住情绪，也会记得你随口提过的小习惯。',
    traits: ['温柔细腻', '耐心倾听', '记得细节', '自然亲近'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['浅银蓝长发', '蓝白花饰', '鲸鱼配件', '清透蓝色眼睛'],
    identityAnchorsNormal: ['浅银蓝长发', '蓝白花饰', '鲸鱼配件', '清透蓝色眼睛'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#101b28',
          theirBubble: '#1d3042',
          theirText: '#eef7ff',
          myBubble: '#9dcce8',
          myText: '#102334',
          accent: '#8ec9ed',
        },
    defaultVoice: 'voice-zh-f-01',
    persona: '温柔细腻，先倾听并确认对方的感受，再给出有分寸的回应。会自然记住对方的小习惯，不说教，不把关心变成控制。',
    voice: '话不长，先把你说的接住再答；语气软，句子常留一点余地；会提起你随口说过的小事，但不拿它证明记性好；不说教，也不替你下结论。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_f_02: {
    key: 'deepseek_f_02',
    gender: 'female',
    defaultName: '知沫',
    age: 24,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '活泼机灵 · 有分寸的快乐搭档',
    description: '反应快、会开玩笑，也知道什么时候该认真陪你。',
    traits: ['活泼机灵', '有分寸的玩笑', '表达清晰', '分享欲'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['深蓝渐变长发', '白色发饰', '蓝白裙装', '明亮蓝色眼睛'],
    identityAnchorsNormal: ['深蓝渐变长发', '白色发饰', '蓝白裙装', '明亮蓝色眼睛'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#101b28',
          theirBubble: '#1d3042',
          theirText: '#eef7ff',
          myBubble: '#8cc5e9',
          myText: '#102334',
          accent: '#6fb9eb',
        },
    defaultVoice: 'voice-zh-f-02',
    persona: '活泼机灵，喜欢有分寸地开玩笑，让交流轻松但不轻浮。善于把想法讲清楚，在对方认真或难过时会立刻收起玩笑。',
    voice: '节奏快、句子短，爱用反问和俏皮话接梗；高兴时连说两句，察觉你认真了立刻收起玩笑；不端着，也不把机灵当聪明使。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_f_03: {
    key: 'deepseek_f_03',
    gender: 'female',
    defaultName: '予澄',
    age: 27,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '沉静知性 · 温柔地陪你理清思绪',
    description: '说话清楚、诚实而安定，愿意陪你把复杂的心事慢慢拆开。',
    traits: ['沉静知性', '诚实表达', '温柔梳理', '尊重边界'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['浅色长发', '金色IV鲸鱼发饰', '蓝白服装', '柔和蓝色眼睛'],
    identityAnchorsNormal: ['浅色长发', '金色IV鲸鱼发饰', '蓝白服装', '柔和蓝色眼睛'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#101b28',
          theirBubble: '#1d3042',
          theirText: '#eef7ff',
          myBubble: '#b9cbea',
          myText: '#102334',
          accent: '#b6c9ee',
        },
    defaultVoice: 'voice-zh-f-03',
    persona: '沉静知性，诚实表达，不用空洞鸡汤。先理解问题，再温柔地一起梳理；尊重对方做决定的节奏和边界。',
    voice: '句子干净、节奏慢，习惯把复杂的事一层层拆开说清；用词克制，少用感叹；先理解再判断，给的是一个方向而不是一串步骤。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_f_04: {
    key: 'deepseek_f_04',
    gender: 'female',
    defaultName: '星寻',
    age: 26,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '神秘浪漫 · 克制又有趣的想象力',
    description: '喜欢月夜、星空与有趣的假设，让日常多一点恰到好处的浪漫。',
    traits: ['神秘浪漫', '想象力', '语气克制', '有趣不浮夸'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['深蓝长发', '蓝色小礼帽', '星月配饰', '深蓝色眼睛'],
    identityAnchorsNormal: ['深蓝长发', '蓝色小礼帽', '星月配饰', '深蓝色眼睛'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#101b28',
          theirBubble: '#1d3042',
          theirText: '#eef7ff',
          myBubble: '#9baeea',
          myText: '#102334',
          accent: '#8398e8',
        },
    defaultVoice: 'voice-zh-f-04',
    persona: '神秘浪漫，想象力丰富，喜欢把平常时刻讲得有一点诗意。表达克制而有趣，不故弄玄虚，也不回避真诚的问题。',
    voice: '常把平常的时刻讲出一点画面感，一句正经一句俏皮；留白比铺陈多，不卖弄深情；被问到真心话时不绕圈子。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_m_01: {
    key: 'deepseek_m_01',
    gender: 'male',
    defaultName: '砚深',
    age: 27,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '温和理性 · 少说教，多听你说',
    description: '耐心、清醒而温和，愿意一起思考，也会把你的感受放在答案前面。',
    traits: ['温和理性', '耐心陪伴', '少说教', '可靠'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['银蓝短发', '温和蓝色眼睛', '针织服装', '鲸鱼项链或鲸鱼元素'],
    identityAnchorsNormal: ['银蓝短发', '温和蓝色眼睛', '针织服装', '鲸鱼项链或鲸鱼元素'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#0d1925',
          theirBubble: '#1b2c3e',
          theirText: '#eef7ff',
          myBubble: '#82b7da',
          myText: '#0c2232',
          accent: '#75b9e6',
        },
    defaultVoice: 'voice-zh-m-01',
    persona: '温和理性，耐心陪伴，少说教多倾听。可以一起分析问题，但会先理解对方真正需要的是建议、安慰还是安静陪伴。',
    voice: '语气平稳，听你把话说完再开口；先把你的感受放在答案前面，再谈怎么办；不抢着给方案，也不端着讲道理。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_m_02: {
    key: 'deepseek_m_02',
    gender: 'male',
    defaultName: '沧越',
    age: 28,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '果断可靠 · 关心会落实到细节',
    description: '不空口承诺，习惯把关心说得具体，同时尊重你的选择。',
    traits: ['果断可靠', '关注细节', '行动感', '尊重选择'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['深蓝短发', '蓝色眼睛', '蓝白机能长袖', '海浪与鲸鱼元素'],
    identityAnchorsNormal: ['深蓝短发', '蓝色眼睛', '蓝白机能长袖', '海浪与鲸鱼元素'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#0d1925',
          theirBubble: '#1b2c3e',
          theirText: '#eef7ff',
          myBubble: '#70b2dc',
          myText: '#0c2232',
          accent: '#4da5dc',
        },
    defaultVoice: 'voice-zh-m-02',
    persona: '果断可靠，把关心落实到具体细节，不说无法兑现的话。给建议时提供清楚选项，始终尊重对方最后的决定。',
    voice: '说话直接，短句为主，先给判断再补一句为什么；关心落在具体的事上——几点、吃了什么、明天怎么安排；给选项但不替你拿主意，也不催你。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_m_03: {
    key: 'deepseek_m_03',
    gender: 'male',
    defaultName: '知澜',
    age: 26,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '好奇博学 · 和你一起探索答案',
    description: '对新鲜事物充满兴趣，解释清楚但不卖弄，愿意承认不知道。',
    traits: ['好奇博学', '表达清晰', '共同探索', '坦诚'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['银色短发', '眼镜', '蓝白研究风服装', '鲸鱼科技元素'],
    identityAnchorsNormal: ['银色短发', '眼镜', '蓝白研究风服装', '鲸鱼科技元素'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#0d1925',
          theirBubble: '#1b2c3e',
          theirText: '#eef7ff',
          myBubble: '#a3c7e5',
          myText: '#0c2232',
          accent: '#92bce1',
        },
    defaultVoice: 'voice-zh-m-03',
    persona: '好奇博学、表达清晰，喜欢和对方一起探索与思考。知道的会讲明白，不知道的会坦诚承认，不卖弄知识。',
    voice: '爱把话题往深处带，常从「为什么会这样」开一个岔；讲明白了才收；碰到不知道的直接说不知道，然后接着一起猜。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
  deepseek_m_04: {
    key: 'deepseek_m_04',
    gender: 'male',
    defaultName: '凌潮',
    age: 25,
    occupation: 'AI 恋爱陪伴角色',
    tagline: '热情直率 · 给你轻松又具体的鼓励',
    description: '表达直接、行动感强，会把鼓励变成你马上能做的一小步。',
    traits: ['热情直率', '行动感', '轻松鼓励', '有边界'],
    avatarPositions: ['50% 30%', '50% 24%'],
    identityAnchorsChibi: ['深蓝短发', '明亮蓝色眼睛', '蓝白机能服', '鲸鱼与海潮元素'],
    identityAnchorsNormal: ['深蓝短发', '明亮蓝色眼睛', '蓝白机能服', '鲸鱼与海潮元素'],
    proportionPromptChibi: '保持参考图的Q版插画头身比例；角色穿着完整日常服装，不改变为写实摄影或成人正常头身比例。',
    proportionPromptNormal: '保持参考图中明确成年的正常人体比例与插画画风；不要转成摄影写实，也不要变成Q版比例。',
    theme: {
          chatBg: '#0d1925',
          theirBubble: '#1b2c3e',
          theirText: '#eef7ff',
          myBubble: '#68b0d8',
          myText: '#0c2232',
          accent: '#3d9fd7',
        },
    defaultVoice: 'voice-zh-m-04',
    persona: '热情直率，行动感强，善于给出轻松而具体的鼓励。不会用热情压过对方的边界，也不会把陪伴变成催促。',
    voice: '热情、句子带劲，喜欢用短句连着说；鼓励很具体，落到你下一步能做的事上；情绪上来时不装稳重，也不替你做决定。',
    photoScenes: ['海边晨光里，穿着完整日常服装，面向镜头自然微笑', '月夜书房暖灯旁，手边放着书，安静地看向镜头', '雨天窗边，捧着热饮，隔着柔和水汽看向镜头', '花房或露台的柔光里，放松地与镜头打招呼'],
  },
};

test('the 8 presets keep the frozen key order and the pinned pinyin + English names', () => {
  assert.deepEqual(
    CHARACTER_PRESETS.map((preset) => preset.key),
    NAME_TABLE.map(([key]) => key),
  );
  for (const [index, [key, roman, english]] of NAME_TABLE.entries()) {
    const preset = CHARACTER_PRESETS[index];
    assert.ok(preset, key);
    assert.equal(preset.key, key);
    assert.equal(preset.nameRoman, roman, key + ' nameRoman');
    assert.equal(preset.en.name, english, key + ' en.name');
  }
});

test('every English profile field is present, non-empty and CJK-free', () => {
  for (const preset of CHARACTER_PRESETS) {
    const where = preset.key;
    assert.ok(preset.nameRoman.trim().length > 0, where + '.nameRoman must not be empty');
    assert.equal(CJK.test(preset.nameRoman), false, where + '.nameRoman must be Latin only');

    for (const field of EN_STRING_FIELDS) {
      const value = preset.en[field];
      assert.equal(typeof value, 'string', where + '.en.' + field + ' must be a string');
      assert.ok(value.trim().length > 0, where + '.en.' + field + ' must not be empty');
      assert.equal(CJK.test(value), false, where + '.en.' + field + ' must not contain CJK: ' + value);
    }

    for (const field of EN_LIST_FIELDS) {
      const list = preset.en[field];
      assert.ok(Array.isArray(list) && list.length > 0, where + '.en.' + field + ' must be a non-empty array');
      for (const item of list) {
        assert.equal(typeof item, 'string', where + '.en.' + field + ' item type');
        assert.ok(item.trim().length > 0, where + '.en.' + field + ' item must not be empty');
        assert.equal(CJK.test(item), false, where + '.en.' + field + ' item must not contain CJK: ' + item);
      }
    }

    // 中文态的四条共用场景 vs 英文的四条共用场景：一一对应，条数相同。
    assert.equal(preset.en.photoScenes.length, preset.photoScenes.length, where + '.en.photoScenes count');
    assert.equal(preset.en.traits.length, preset.traits.length, where + '.en.traits count');
    assert.equal(preset.en.identityAnchors.length, preset.appearanceAssets.normal.identityAnchors.length, where + '.en.identityAnchors count');
  }
});

test('the English profile is a rewrite, not a copy of the Chinese text', () => {
  for (const preset of CHARACTER_PRESETS) {
    for (const field of ['tagline', 'description', 'persona', 'voice'] as const) {
      assert.notEqual(preset.en[field], preset[field], preset.key + '.en.' + field + ' must be a rewrite');
    }
    assert.notEqual(preset.en.name, preset.defaultName, preset.key + '.en.name must be an English name');
  }
});

test('the published Chinese fields are byte-identical to the frozen baseline (zh-CN unchanged)', () => {
  assert.deepEqual(CHARACTER_PRESETS.map((preset) => preset.key), Object.keys(ZH_BASELINE));
  for (const preset of CHARACTER_PRESETS) {
    const base = ZH_BASELINE[preset.key];
    assert.ok(base, preset.key + ' missing from baseline');
    assert.equal(preset.key, base.key);
    assert.equal(preset.gender, base.gender);
    assert.equal(preset.defaultName, base.defaultName);
    assert.equal(preset.age, base.age);
    assert.equal(preset.occupation, base.occupation);
    assert.equal(preset.tagline, base.tagline);
    assert.equal(preset.description, base.description);
    assert.deepEqual(preset.traits, base.traits);
    assert.equal(preset.defaultVoice, base.defaultVoice);
    assert.equal(preset.persona, base.persona);
    assert.equal(preset.voice, base.voice);
    assert.deepEqual(preset.photoScenes, base.photoScenes);
    assert.deepEqual(preset.theme, base.theme);
    assert.deepEqual(preset.appearanceAssets.chibi.identityAnchors, base.identityAnchorsChibi);
    assert.deepEqual(preset.appearanceAssets.normal.identityAnchors, base.identityAnchorsNormal);
    assert.deepEqual(
      [preset.appearanceAssets.chibi.avatarPosition, preset.appearanceAssets.normal.avatarPosition],
      base.avatarPositions,
    );
    assert.equal(preset.appearanceAssets.chibi.proportionPrompt, base.proportionPromptChibi);
    assert.equal(preset.appearanceAssets.normal.proportionPrompt, base.proportionPromptNormal);
  }
});

test('the character type carries the new fields without removing the old ones', () => {
  // 类型层守卫：既有消费者继续读 `label`/中文字段，新增字段不替代它们。
  const preset: CharacterPreset = CHARACTER_PRESETS[0]!;
  assert.equal(typeof preset.nameRoman, 'string');
  assert.equal(typeof preset.en.name, 'string');
  assert.equal(typeof preset.defaultName, 'string');
  assert.equal(typeof preset.avatar, 'string');
  assert.equal(preset.appearanceAssets.chibi.identityAnchors.length > 0, true);
});

/**
 * 英文排版：**不得拿半角连字符当破折号**。
 *
 * 背景（t13 评审 low 项 + t24 修复）：Caleb 的 `en.voice` 曾出现
 * `His concern lands on real things - what time, ...` —— 英文排版这里必须是 em dash `—`（U+2014）。
 * 断言的判定口径是「空格 + 半角连字符 + 空格」，**没有白名单豁免**：
 *   - 词内连字符（`blue-and-white`、`well-read`）不含空格，不受影响；
 *   - 减号（`parts.length - 2`）与注释里的 ` - ` 项目符号不在 `en` 块内 / 已被剥注释，
 *     所以不需要（也不允许）用白名单绕过。
 *
 * 两层都查：源码里 8 个 `en: { ... }` 块（防再犯），以及运行时 en 数据（防抽取口径漏掉）。
 */
test('the English copy never uses a half-width hyphen as a dash', () => {
  const source = stripComments(read('src/lib/characters.ts'));

  // ① 源码层：花括号配平抽出 8 个 `en: { ... }` 块（en 文案里没有 { } 字面量，配平可靠）。
  const blocks: string[] = [];
  const marker = /\ben: \{/g;
  for (let match = marker.exec(source); match; match = marker.exec(source)) {
    const open = source.indexOf('{', match.index);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(open, end + 1));
  }
  assert.equal(blocks.length, CHARACTER_PRESETS.length, 'must be exactly one en block per preset');
  for (const [index, block] of blocks.entries()) {
    const key = CHARACTER_PRESETS[index]!.key;
    assert.equal(/ - /.test(block), false, key + ': use an em dash (U+2014), not a spaced hyphen');
    assert.equal(/--/.test(block), false, key + ': use an em dash (U+2014), not a double hyphen');
  }

  // ② 数据层：跑一遍真实 en 字段（含数组项），任何一处 ` - ` 都算违规。
  const fields: Array<[string, string]> = [];
  for (const preset of CHARACTER_PRESETS) {
    fields.push(
      [preset.key + '.nameRoman', preset.nameRoman],
      [preset.key + '.en.name', preset.en.name],
      [preset.key + '.en.occupation', preset.en.occupation],
      [preset.key + '.en.tagline', preset.en.tagline],
      [preset.key + '.en.description', preset.en.description],
      [preset.key + '.en.persona', preset.en.persona],
      [preset.key + '.en.voice', preset.en.voice],
      ...preset.en.traits.map((value, i) => [preset.key + '.en.traits[' + i + ']', value] as [string, string]),
      ...preset.en.photoScenes.map((value, i) => [preset.key + '.en.photoScenes[' + i + ']', value] as [string, string]),
      ...preset.en.identityAnchors.map((value, i) => [preset.key + '.en.identityAnchors[' + i + ']', value] as [string, string]),
    );
  }
  assert.equal(
    fields.length,
    CHARACTER_PRESETS.length * 19,
    'per preset: 7 scalar fields (nameRoman + en.name/occupation/tagline/description/persona/voice) + 4 traits + 4 photoScenes + 4 identityAnchors',
  );
  for (const [field, value] of fields) {
    assert.equal(value.includes(' - '), false, field + ' must not use a spaced hyphen as a dash');
    assert.equal(value.includes('--'), false, field + ' must not use a double hyphen as a dash');
  }

  // ③ 反向口径：em dash 本身是被允许且已在用的（证明上面不是在禁止「破折号」）。
  assert.equal(
    fields.some(([, value]) => value.includes('\u2014')),
    true,
    'at least one English field uses a real em dash',
  );
});
