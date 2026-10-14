import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_CHAT_THEME_BY_CHARACTER,
  getDefaultChatThemeId,
} from '../src/lib/character-default-theme';
import { CHAT_THEMES, getChatTheme } from '../src/lib/chat-themes';
import {
  LEGACY_CHARACTER_KEY_MAP,
  getCharacter,
  resolveCanonicalCharacterKey,
  type AppearanceStyle,
} from '../src/lib/characters';
import { DEEPSEEK_WALLPAPER_PLAN_BY_ID } from './support/deepseek-wallpaper-plan';

/**
 * 角色默认壁纸：新伴侣第一次进入对话时应该用哪张壁纸。
 *
 * 事实只有一份 —— `src/lib/character-default-theme.ts` 的 16 个槽位（8 角色 ×
 * {normal, chibi}）。`characters.ts` 刻意**不**新增壁纸字段（避免双源），
 * 素材归属仍由 `tests/support/deepseek-wallpaper-plan.ts` 声明，本文件做**反向**
 * 交叉断言，防止运行时映射与素材计划各自漂移（规格 §5.1.1）。
 *
 * 这里刻意硬编码一份期望表，而不是复用实现里的常量：复用会让断言恒真。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/**
 * 计划 §3 的映射表（正常比例在前，Q 版在后）。
 *
 * 唯一一格**偏离 §3 字面值**：`deepseek_m_04.normal` 取 `deepseek-mn12` 而非 §3 写的 `mn10`
 * —— 依据队长裁决 **R7**：§3 自述规则「一律取该角色名下 env 那张」+ 规格 §4.1 判据 2
 * （`composition === 'env'`）都指向 env，而权威素材表里 `mn10` = `close`、`mn12` = `env`。
 * 该格由下面单独的 known-conflict 测试写死（素材表与映射任意一边被改都会红）。
 */
const EXPECTED_DEFAULT_THEME_BY_CHARACTER: Record<string, Record<AppearanceStyle, string>> = {
  deepseek_f_01: { normal: 'deepseek-fn03', chibi: 'deepseek-fq01' },
  deepseek_f_02: { normal: 'deepseek-fn06', chibi: 'deepseek-fq03' },
  deepseek_f_03: { normal: 'deepseek-fn07', chibi: 'deepseek-fq05' },
  deepseek_f_04: { normal: 'deepseek-fn12', chibi: 'deepseek-fq07' },
  deepseek_m_01: { normal: 'deepseek-mn01', chibi: 'deepseek-mq01' },
  deepseek_m_02: { normal: 'deepseek-mn06', chibi: 'deepseek-mq03' },
  deepseek_m_03: { normal: 'deepseek-mn07', chibi: 'deepseek-mq05' },
  deepseek_m_04: { normal: 'deepseek-mn12', chibi: 'deepseek-mq07' },
};

const CANONICAL_CHARACTER_KEYS = Object.keys(EXPECTED_DEFAULT_THEME_BY_CHARACTER);
const APPEARANCE_STYLES = ['normal', 'chibi'] as const satisfies readonly AppearanceStyle[];

/** 实现侧同一张表的宽类型视图（`as const` 的字面量类型不允许用 string 下标）。 */
const actualDefaults: Record<string, Record<AppearanceStyle, string>> = DEFAULT_CHAT_THEME_BY_CHARACTER;

test('locks the 16-slot character default wallpaper mapping verbatim', () => {
  assert.deepEqual(DEFAULT_CHAT_THEME_BY_CHARACTER, EXPECTED_DEFAULT_THEME_BY_CHARACTER);
  assert.equal(Object.keys(DEFAULT_CHAT_THEME_BY_CHARACTER).length, 8);

  for (const canonicalKey of CANONICAL_CHARACTER_KEYS) {
    assert.deepEqual(
      Object.keys(actualDefaults[canonicalKey]).sort(),
      ['chibi', 'normal'],
      canonicalKey + ' must carry exactly the two appearance slots',
    );
  }

  // 16 个槽位必须是 16 张不同的壁纸（同角色 normal / chibi 也不许重合）。
  const ids = CANONICAL_CHARACTER_KEYS.flatMap((key) => Object.values(actualDefaults[key]));
  assert.equal(new Set(ids).size, 16);
});

test('every default wallpaper is a real theme matching the character gender and the appearance style', () => {
  for (const canonicalKey of CANONICAL_CHARACTER_KEYS) {
    const character = getCharacter(canonicalKey);
    assert.ok(character, canonicalKey + ' must be a canonical character preset');
    assert.equal(character.key, canonicalKey);

    for (const style of APPEARANCE_STYLES) {
      const id = actualDefaults[canonicalKey][style];
      const theme = CHAT_THEMES.find((candidate) => candidate.id === id);
      assert.ok(theme, `${canonicalKey}/${style}: ${id} must exist in CHAT_THEMES`);
      assert.equal(getChatTheme(id), theme, `${id} must resolve through getChatTheme`);
      assert.equal(theme.gender, character.gender, `${id} gender must match ${canonicalKey}`);
      assert.notEqual(id, 'default');

      // id 前缀的 n/q 必须与 appearance_style 对应（规格 §4.1 判据 2）。
      const slot = /^deepseek-[fm]([nq])\d{2}$/.exec(id)?.[1];
      assert.equal(slot, style === 'normal' ? 'n' : 'q', `${id} id prefix must encode ${style}`);
    }
  }
});

test('every default wallpaper comes from that character’s own env wallpapers in the plan', () => {
  for (const canonicalKey of CANONICAL_CHARACTER_KEYS) {
    const owned = [...DEEPSEEK_WALLPAPER_PLAN_BY_ID.values()].filter(
      (entry) => entry.characterKey === canonicalKey,
    );
    assert.equal(owned.length, 5, canonicalKey + ' owns exactly 5 planned wallpapers');

    for (const style of APPEARANCE_STYLES) {
      const id = actualDefaults[canonicalKey][style];
      const entry = DEEPSEEK_WALLPAPER_PLAN_BY_ID.get(id);
      assert.ok(entry, `${id} must be a planned wallpaper`);
      assert.equal(entry.characterKey, canonicalKey, `${id} must belong to ${canonicalKey}`);
      assert.equal(entry.style, style, `${id} planned style must be ${style}`);
      assert.ok(
        owned.some((candidate) => candidate.id === id),
        `${id} must come from ${canonicalKey}'s own 5 wallpapers`,
      );

      // 15 个槽位照常断言 env；唯一一格（deepseek_m_04.normal）留给下面单独的
      // known-conflict 测试，那里三条事实逐条写死（队长裁决 R7），不是 blanket 例外。
      if (canonicalKey === 'deepseek_m_04' && style === 'normal') continue;
      assert.equal(entry.composition, 'env', `${id} must be an env composition`);
    }
  }
});

test('records the §3 凌潮 cell conflict: m_04/normal is the env mn12, never the close mn10 (队长裁决 R7)', () => {
  const mn10 = DEEPSEEK_WALLPAPER_PLAN_BY_ID.get('deepseek-mn10');
  const mn12 = DEEPSEEK_WALLPAPER_PLAN_BY_ID.get('deepseek-mn12');
  assert.ok(mn10 && mn12, 'both candidates must be planned wallpapers');

  // 两个候选 id 都出自凌潮名下 5 张（而不是别角色的素材）。
  assert.equal(mn10.characterKey, 'deepseek_m_04');
  assert.equal(mn12.characterKey, 'deepseek_m_04');
  // 权威素材表的真值：与计划 §3 那一格的字面值相反。
  assert.equal(mn10.composition, 'close');
  assert.equal(mn12.composition, 'env');
  // 映射必须取 env 的那一张。
  assert.equal(actualDefaults.deepseek_m_04.normal, 'deepseek-mn12');
});

test('getDefaultChatThemeId resolves canonical keys, legacy keys, and refuses unknown input', () => {
  for (const canonicalKey of CANONICAL_CHARACTER_KEYS) {
    for (const style of APPEARANCE_STYLES) {
      assert.equal(
        getDefaultChatThemeId(canonicalKey, style),
        EXPECTED_DEFAULT_THEME_BY_CHARACTER[canonicalKey][style],
        `${canonicalKey}/${style}`,
      );
    }
  }

  // 10 个旧 key 必须先经 resolveCanonicalCharacterKey 归一化再查表。
  assert.equal(Object.keys(LEGACY_CHARACTER_KEY_MAP).length, 10);
  for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_CHARACTER_KEY_MAP)) {
    assert.equal(resolveCanonicalCharacterKey(legacyKey), canonicalKey, legacyKey);
    assert.equal(getDefaultChatThemeId(legacyKey, 'normal'), EXPECTED_DEFAULT_THEME_BY_CHARACTER[canonicalKey].normal);
    assert.equal(getDefaultChatThemeId(legacyKey, 'chibi'), EXPECTED_DEFAULT_THEME_BY_CHARACTER[canonicalKey].chibi);
  }
  assert.equal(getDefaultChatThemeId('lin_wanxing', 'normal'), 'deepseek-fn03');

  // 未知 key / 非法比例 → null（不猜、不抛），调用方据此落回「默认纯色」。
  assert.equal(getDefaultChatThemeId('', 'normal'), null);
  assert.equal(getDefaultChatThemeId('not_a_character', 'normal'), null);
  assert.equal(getDefaultChatThemeId('deepseek_f_09', 'chibi'), null);
  assert.equal(getDefaultChatThemeId('deepseek_f_01', 'weird' as AppearanceStyle), null);
  assert.equal(getDefaultChatThemeId('deepseek_f_01', '' as AppearanceStyle), null);
  assert.equal(getDefaultChatThemeId('deepseek_f_01', 'CHIBI' as AppearanceStyle), null);
  assert.equal(getDefaultChatThemeId('deepseek_f_01', undefined as unknown as AppearanceStyle), null);
  assert.equal(getDefaultChatThemeId('deepseek_f_01', null as unknown as AppearanceStyle), null);
  assert.doesNotThrow(() => getDefaultChatThemeId('deepseek_f_01', {} as unknown as AppearanceStyle));
});

test('the mapping is the single source of truth: characters.ts carries none, and the module never imports tests/', () => {
  const moduleSource = read('src/lib/character-default-theme.ts');
  assert.match(moduleSource, /DEFAULT_CHAT_THEME_BY_CHARACTER/);
  assert.match(moduleSource, /export function getDefaultChatThemeId/);
  assert.doesNotMatch(moduleSource, /from\s+['"][^'"]*tests\//, 'runtime code must not import test fixtures');
  assert.doesNotMatch(moduleSource, /\.\.\/tests\//);

  // 队长裁决 R2：不给 characters.ts 加第二份壁纸表（避免双源 / 漂移）。
  const charactersSource = read('src/lib/characters.ts');
  assert.doesNotMatch(charactersSource, /deepseek-[fm][nq]\d{2}/, 'characters.ts must not carry wallpaper ids');
});

test('POST /api/companions persists the resolved default theme instead of a literal null', () => {
  const route = read('src/app/api/companions/route.ts');
  assert.match(route, /theme_id:\s*getDefaultChatThemeId\(/);
  assert.doesNotMatch(route, /theme_id:\s*null/);
  // 请求体不得新增 theme_id 字段：默认壁纸只由「角色 + 外观比例」决定，不给覆盖口子。
  assert.doesNotMatch(route, /theme_id\?:/);
});
