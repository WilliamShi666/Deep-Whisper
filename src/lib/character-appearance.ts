import { getCharacter, type AppearanceAsset, type AppearanceStyle, type CharacterPreset } from './characters';

export const APPEARANCE_STYLES = ['chibi', 'normal'] as const satisfies readonly AppearanceStyle[];

export interface ResolvedCharacterAppearance extends AppearanceAsset {
  characterKey: string;
  style: AppearanceStyle;
  character: CharacterPreset;
}

export function isAppearanceStyle(value: unknown): value is AppearanceStyle {
  return typeof value === 'string' && APPEARANCE_STYLES.includes(value as AppearanceStyle);
}

export function normalizeAppearanceStyle(value: unknown): AppearanceStyle {
  return isAppearanceStyle(value) ? value : 'chibi';
}

export function resolveCharacterAppearance(characterKey: string, style: AppearanceStyle): ResolvedCharacterAppearance {
  const character = getCharacter(characterKey);
  if (!character) throw new Error(`Unknown character: ${characterKey}`);
  if (!isAppearanceStyle(style)) throw new Error(`Unsupported appearance style: ${String(style)}`);
  return { characterKey: character.key, style, character, ...character.appearanceAssets[style] };
}

export function getCharacterAvatar(characterKey: string, value?: unknown): string | null {
  const character = getCharacter(characterKey);
  if (!character) return null;
  return character.appearanceAssets[normalizeAppearanceStyle(value)].avatar;
}

/**
 * 服装约束：**默认与参考图保持一致**。
 *
 * 我们本来就是图生图，脸能对上说明参考图确实在起作用；问题出在这条指令过去无条件
 * 授予「允许改变服装」——于是模型每次都换一套衣服，用户看到的角色风格就不连贯了
 * （2026-09-19 反馈：同一角色两次出图的旗袍款式与场景都不一致）。
 * 现在改为：服装以参考图为准，**只有当「场景」里明确写了别的服装**（即用户明确要求换装）
 * 时才随之改变。
 *
 * 此前按「比例 × 性别」分流的泳装／内衣／比基尼清单已移除：它既导致角色换装，
 * 也是上游内容审核的触发源。尺度口径改由 system prompt 承担，这条只管「衣服跟参考图走」。
 *
 * 底线不变：全裸、露点、性器官与性行为一律不出现。
 */
const CLOTHING_DIRECTION = '服装与参考图保持一致，可改变场景与表情（仅当场景明确要求换装时才改变服装）';

export function buildAppearanceIdentityPrompt(appearance: ResolvedCharacterAppearance, scene: string): string {
  const genderLabel = appearance.character.gender === 'male' ? '男性' : '女性';
  const lines = [
    `角色身份固定为 ${appearance.character.defaultName}（${appearance.characterKey}）。`,
    // 显式写明性别：此前只靠外形锚点让上游分类器猜，猜错即误拦。
    `角色性别为${genderLabel}，是明确成年的原创插画角色。`,
    `必须保持这些身份锚点：${appearance.identityAnchors.join('、')}。`,
    appearance.proportionPrompt,
    `场景：${scene}`,
    `保持蓝白鲸鱼主题的原创插画风；${CLOTHING_DIRECTION}，但不得改变脸型、发色、瞳色或身份配饰。`,
  ];
  return lines.join('\n');
}

export interface PhotoIdentitySnapshot {
  readonly characterKey: string;
  readonly style: AppearanceStyle;
  readonly referencePath: string;
  readonly referenceBytes: Uint8Array;
  readonly mediaType: string;
  readonly identityPrompt: string;
}

export function createPhotoIdentitySnapshot(
  appearance: ResolvedCharacterAppearance,
  referenceBytes: Uint8Array,
  mediaType: string,
): PhotoIdentitySnapshot {
  return Object.freeze({
    characterKey: appearance.characterKey,
    style: appearance.style,
    referencePath: appearance.referenceImage,
    referenceBytes: new Uint8Array(referenceBytes),
    mediaType,
    identityPrompt: buildAppearanceIdentityPrompt(appearance, '{{SCENE}}'),
  });
}

export function buildPhotoPromptFromSnapshot(snapshot: PhotoIdentitySnapshot, scene: string): string {
  return snapshot.identityPrompt.replace('{{SCENE}}', scene);
}
