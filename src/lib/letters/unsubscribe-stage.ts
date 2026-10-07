/**
 * 退订页（`/api/letters/unsubscribe`）的**舞台解析**：用哪张壁纸。
 *
 * 三条硬要求（用户 2026-10-07 指定）：
 *   1. **性别匹配** —— 伴侣是女生就不能给她配男性角色的画面；
 *   2. **角色匹配** —— 伴侣是「知沫」，壁纸最好就是知沫；
 *   3. **默认 Q 版** —— 壁纸默认取 Q 版那一档。
 *
 * 这三条不需要新造映射：`character-default-theme.ts` 的 16 个槽位已经是
 * 「角色 + 比例 → 该角色名下的 env 构图壁纸」，且性别、`n/q` 前缀与角色定义三重对齐
 * （由 `tests/character-default-wallpaper.test.ts` 反向交叉断言锁死）。
 * 因此这里**不新增任何事实源**，只做「取哪一档 + 取不到时怎么退」。
 *
 * 本模块是纯函数（零 IO、零 React）：route 负责读库，这里只负责选择。
 */

import { getCharacterAvatar } from '@/lib/character-appearance';
import { DEFAULT_CHAT_THEME_BY_CHARACTER, getDefaultChatThemeId } from '@/lib/character-default-theme';
import { getChatTheme, type ChatTheme } from '@/lib/chat-themes';
import type { AppearanceStyle, CharacterGender } from '@/lib/characters';
import { getCharacter, resolveCanonicalCharacterKey } from '@/lib/characters';

/**
 * 壁纸风格档。用户指定「默认需要是 Q 版」，所以这里是唯一的取值点 ——
 * 将来若要改成「跟随伴侣的 `appearance_style`」，把这一处换成入参即可，
 * 选择逻辑本身不用动。
 */
export const LETTER_STAGE_STYLE: AppearanceStyle = 'chibi';

/** 舞台素材：竖版（手机）+ 横版（宽屏），以及各自的裁切锚点。 */
export interface LetterStage {
  image: string;
  desktopImage: string;
  mobilePosition: string;
  desktopPosition: string;
}

export interface LetterStageInput {
  /** 用于稳定哈希；同一个人每次点开都是同一幅画面。 */
  visitorId: string;
  /** 写信伴侣的角色 key；未知或没有伴侣时传 null。 */
  characterKey: string | null;
  /**
   * 性别兜底：角色认不出来时（没有投递记录 / 角色的 key 已失效）用访客自己的取向
   * （`visitors.orientation`，值域与 `CharacterGender` 相同）来守住第一条要求。
   * 没有取向信息时传 null —— 那就只剩「任意 Q 版」这一档。
   */
  genderHint: CharacterGender | null;
}

/**
 * FNV-1a（32 位）。
 *
 * 为什么用哈希而不是随机/时间：退订链接会被反复点开，画面**必须**稳定 ——
 * 刷新一次换一张脸比配错角色更让人出戏。哈希只用来在多张合格素材间挑一张，
 * 不承担安全职责。
 */
function stableIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % length;
}

/** 8 个角色 → 该角色的 Q 版壁纸 id 与其性别（从运行时映射派生，不另抄一份素材表）。 */
function stageThemeIdByCharacter(): { themeId: string; gender: CharacterGender | null }[] {
  return Object.entries(DEFAULT_CHAT_THEME_BY_CHARACTER).map(([characterKey, slots]) => ({
    themeId: slots[LETTER_STAGE_STYLE],
    gender: getCharacter(characterKey)?.gender ?? null,
  }));
}

/** 全部候选（按性别分组后仍可整体使用）：先过滤掉已下架的 id。 */
function candidateThemeIds(gender: CharacterGender | null): string[] {
  const entries = stageThemeIdByCharacter().filter(
    (entry) => (gender ? entry.gender === gender : true) && getChatTheme(entry.themeId) !== undefined,
  );
  return entries.map((entry) => entry.themeId);
}

/**
 * 选壁纸 id。
 *
 * 顺序（前一条命中就不再往下走）：
 *   1. 该角色自己的 Q 版壁纸 —— 同时满足性别、角色、Q 版三条；
 *   2. 同性别的 Q 版壁纸 —— 角色认不出来时至少守住性别（性别取自角色定义，
 *      角色也没有就用访客取向 `genderHint`）；
 *   3. 任意 Q 版壁纸 —— 连性别都没有时的兜底，仍然不是纯色底。
 */
export function letterStageThemeId(input: LetterStageInput): string | null {
  const canonical = input.characterKey ? resolveCanonicalCharacterKey(input.characterKey) : null;
  if (canonical) {
    const own = getDefaultChatThemeId(canonical, LETTER_STAGE_STYLE);
    if (own && getChatTheme(own)) return own;
  }

  const gender = (canonical ? getCharacter(canonical)?.gender ?? null : null) ?? input.genderHint;
  const sameGender = candidateThemeIds(gender);
  if (sameGender.length > 0) return sameGender[stableIndex(input.visitorId, sameGender.length)];

  const fallback = candidateThemeIds(null);
  if (fallback.length === 0) return null;
  return fallback[stableIndex(input.visitorId, fallback.length)];
}

/** 把壁纸 id 变成舞台素材；id 取不到时返回 null，调用方据此渲染纯色夜色底。 */
export function letterStageFor(themeId: string | null): LetterStage | null {
  const theme: ChatTheme | undefined = getChatTheme(themeId);
  if (!theme) return null;
  const mobilePosition = theme.mobilePosition ?? '50% 50%';
  return {
    image: theme.image,
    desktopImage: theme.desktopImage ?? theme.image,
    mobilePosition,
    desktopPosition: theme.desktopPosition ?? mobilePosition,
  };
}

/** 一步到位：给访客与角色 key，拿到可直接渲染的舞台（可能为 null）。 */
export function resolveLetterStage(input: LetterStageInput): LetterStage | null {
  return letterStageFor(letterStageThemeId(input));
}

/**
 * 写信人头像。
 *
 * 刻意与壁纸同档（都用 Q 版）：Q 版壁纸配真人比例头像会像两个人。
 * 未知角色返回 null —— 调用方只渲染名字，不渲染空头像位。
 */
export function letterWriterAvatar(characterKey: string | null): string | null {
  if (!characterKey) return null;
  return getCharacterAvatar(characterKey, LETTER_STAGE_STYLE);
}
