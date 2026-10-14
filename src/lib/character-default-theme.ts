/**
 * 角色的默认壁纸 —— 新伴侣创建时按「角色 + 外观比例」落库的那一张。
 *
 * 为什么单独一个模块（队长裁决 R2）：`characters.ts` **不**新增壁纸字段，
 * 否则「角色默认壁纸」会有两份事实（角色预设 + 素材计划），迟早漂移。
 * 这里只放运行时映射；素材归属仍以 `tests/support/deepseek-wallpaper-plan.ts`
 * 为准，由 `tests/character-default-wallpaper.test.ts` **反向**交叉断言两边一致。
 *
 * 16 个槽位（8 角色 × {normal, chibi}）的每一对取值都满足（规格 §4.1 判据 2）：
 *   - 该 id 存在于 `CHAT_THEMES`，且 `getChatTheme(id)` 非 undefined；
 *   - 壁纸 `gender` 与该角色性别一致；
 *   - id 里的 `n` / `q` 前缀与 `appearance_style` 的 normal / chibi 一致；
 *   - 出自该角色名下 5 张里的 `composition === 'env'` 那一张（计划 §3）。
 */

import { isAppearanceStyle } from './character-appearance';
import { resolveCanonicalCharacterKey, type AppearanceStyle } from './characters';

export const DEFAULT_CHAT_THEME_BY_CHARACTER = {
  deepseek_f_01: { normal: 'deepseek-fn03', chibi: 'deepseek-fq01' }, // 澜汐 · 雨窗暖灯 / 鲸月栈桥
  deepseek_f_02: { normal: 'deepseek-fn06', chibi: 'deepseek-fq03' }, // 知沫 · 蓝港长阶 / 雨窗咖啡
  deepseek_f_03: { normal: 'deepseek-fn07', chibi: 'deepseek-fq05' }, // 予澄 · 月夜阅室 / 鲸月夜读
  deepseek_f_04: { normal: 'deepseek-fn12', chibi: 'deepseek-fq07' }, // 星寻 · 星城露台 / 星港灯塔
  deepseek_m_01: { normal: 'deepseek-mn01', chibi: 'deepseek-mq01' }, // 砚深 · 蓝时温室 / 鲸月书房
  deepseek_m_02: { normal: 'deepseek-mn06', chibi: 'deepseek-mq03' }, // 沧越 · 晨海栈道 / 灯塔夜港
  deepseek_m_03: { normal: 'deepseek-mn07', chibi: 'deepseek-mq05' }, // 知澜 · 海崖温室 / 星台观测
  /**
   * 凌潮 · 正常比例 = `deepseek-mn12` 月海观测 —— **刻意偏离计划 §3 字面值 `mn10`**，依据队长裁决 R7。
   *
   * 证据（可复核）：① §3 自述规则「上表一律取该角色名下 env（环境构图）那张」（它正是以此把星寻
   * 定为 `fn12`）与 t3 规格 §4.1 判据 2「`composition === 'env'`」两条独立权威都指向 env；
   * ② 权威素材表 `tests/support/deepseek-wallpaper-plan.ts:55,57`：`mn10` = `close`、`mn12` = `env`，
   * m_04 三张 normal = mn10 close / mn11 close / mn12 env，且该表 40 行的 composition 矩阵是规律的
   * （角色 1/3 = env,close,env；2/4 = close,close,env）—— 与 m_04 同构的 f_04 在 §3 里取的正是 env 的 `fn12`；
   * ③ 研究文档 `05-character-wallpaper-mapping.md:93` 把 mn10 记成 env、mn12 记成 close，是 40 行里唯一
   * 破规律的一行，§3 沿用了它 —— 即 §3 这一格与它自己的规则矛盾，不是用户在 mn10 / mn12 之间的取舍。
   *
   * 该格被 `tests/character-default-wallpaper.test.ts` 的 known-conflict 断言写死：素材表或本映射
   * 任意一边被改动都会红。chibi 槽位不受影响（`deepseek-mq07` 本就是 env）。
   */
  deepseek_m_04: { normal: 'deepseek-mn12', chibi: 'deepseek-mq07' }, // 凌潮 · 月海观测 / 鲸光书房
} as const satisfies Record<string, Record<AppearanceStyle, string>>;

type CanonicalCharacterKey = keyof typeof DEFAULT_CHAT_THEME_BY_CHARACTER;

/**
 * 解析某角色的默认壁纸 id。
 *
 * - 入参先经 `resolveCanonicalCharacterKey()` 归一化，10 个旧 key 同样可解析
 *   （例如 `lin_wanxing` → `deepseek_f_01` → `deepseek-fn03`）；
 * - 未知 key / 非法 `appearance_style` → `null`（**不抛异常、不猜**）。调用方据此
 *   保持「无壁纸」语义：`theme_id = NULL` → `getChatTheme(null)` 为 undefined →
 *   渲染角色原生纯色氛围。
 *
 * 单向依赖：本模块 import `characters.ts` / `character-appearance.ts`，反向禁止。
 */
export function getDefaultChatThemeId(
  characterKey: string,
  appearanceStyle: AppearanceStyle,
): string | null {
  if (!isAppearanceStyle(appearanceStyle)) return null;
  const canonicalKey = resolveCanonicalCharacterKey(characterKey);
  if (!canonicalKey) return null;
  const slots = DEFAULT_CHAT_THEME_BY_CHARACTER[canonicalKey as CanonicalCharacterKey] as
    | Record<AppearanceStyle, string>
    | undefined;
  if (!slots) return null;
  return slots[appearanceStyle];
}
