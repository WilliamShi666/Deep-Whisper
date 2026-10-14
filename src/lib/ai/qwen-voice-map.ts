/**
 * 公开音色代号 ↔ 上游 voice 参数 的**唯一对照表（服务端专用）**。
 *
 * 为什么要分两层：产品口径是「界面只出现代号，不出现上游原名」。代号写进
 * `companions.voice_id`、`<option value>`、对象存储 key 与 `audio_url`；上游参数只在
 * 服务端调用 provider 的那一瞬间出现。
 *
 * **这个模块绝对不能被客户端组件 import** —— 它就是要藏起来的那份对照表。
 * 判定已经有测试钉住（`tests/qwen-voice-map.test.ts` + client bundle 检查）。
 *
 * 副作用（刻意）：数据库不再存上游参数，于是上游改名/换供应商不再需要数据迁移。
 */

import { isQwenVoiceId } from '@/lib/ai/qwen-voices';
import { isSelectableVoiceId, resolveVoiceId } from '@/lib/characters';

/** 公开代号 → 上游 `input.voice`。顺序与 characters.ts 的 VOICE_OPTIONS 一致。 */
export const UPSTREAM_VOICE_BY_PUBLIC_ID: Readonly<Record<string, string>> = {
  // 中文女（肥鱼音色 1–7（女））
  'voice-zh-f-01': 'anyuqing_v3.1',
  'voice-zh-f-02': 'longhua_v3.1',
  'voice-zh-f-03': 'baiqinglan_v3.1',
  'voice-zh-f-04': 'yunhuanhuan_v3.1',
  'voice-zh-f-05': 'xuyanchu_v3.1',
  'voice-zh-f-06': 'xieshurou_v3.1',
  'voice-zh-f-07': 'guyunshu_v3.1',
  // 中文男（肥鱼音色 1–7（男））
  'voice-zh-m-01': 'longhan_v3.1',
  'voice-zh-m-02': 'xunanchuan_v3.1',
  'voice-zh-m-03': 'longanyang_v3.1',
  'voice-zh-m-04': 'anmingyuan_v3.1',
  'voice-zh-m-05': 'huozhuoshi_v3.1',
  'voice-zh-m-06': 'longanlang_v3.1',
  'voice-zh-m-07': 'longanchong_v3.1',
  // 英文女（chubby fish voice 1–6 (female)）
  'voice-en-f-01': 'Cally_v3.1',
  'voice-en-f-02': 'Cindy_v3.1',
  'voice-en-f-03': 'Luna_v3.1',
  'voice-en-f-04': 'Abby_v3.1',
  'voice-en-f-05': 'Ava_v3.1',
  'voice-en-f-06': 'Beth_v3.1',
  // 英文男（chubby fish voice 1–5 (male)）
  'voice-en-m-01': 'Eric_v3.1',
  'voice-en-m-02': 'Brian_v3.1',
  'voice-en-m-03': 'Andy_v3.1',
  'voice-en-m-04': 'David_v3.1',
  'voice-en-m-05': 'Luca_v3.1',
};

const PUBLIC_ID_BY_UPSTREAM_VOICE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UPSTREAM_VOICE_BY_PUBLIC_ID).map(([publicId, upstream]) => [upstream, publicId]),
);

/**
 * 上游参数 → 公开代号。给 provider 用时反向的那个函数是 `upstreamVoiceIdFor`。
 * 未知上游参数返回 null（**不抛**：它是「读旧数据」的路径，旧数据可以合法地不认识）。
 */
export function publicIdForUpstreamVoice(upstreamVoice: string | null | undefined): string | null {
  if (typeof upstreamVoice !== 'string' || !upstreamVoice) return null;
  return PUBLIC_ID_BY_UPSTREAM_VOICE[upstreamVoice] ?? null;
}

/**
 * 把**任何**历史形式的值归一化成公开代号：
 *   1. 已经是公开代号 → 原样；
 *   2. 上游 voice 参数（本轮之前的数据库值）→ 对应代号；
 *   3. 19 个历史别名（Gemini 音色名 / 旧平台 id）→ 交给 `resolveVoiceId` 解析。
 * 都不是返回 null（调用方决定是「回落默认音色」还是「400」）。
 */
export function toPublicVoiceId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw in UPSTREAM_VOICE_BY_PUBLIC_ID) return raw;
  const fromUpstream = publicIdForUpstreamVoice(raw);
  if (fromUpstream) return fromUpstream;
  // `resolveVoiceId` 对未知值会回落到默认音色，所以必须先确认它确实认识这个值。
  if (isSelectableVoiceId(raw)) return resolveVoiceId(raw);
  return null;
}

/**
 * 公开代号 → 上游 `input.voice`（**provider 唯一入口**）。
 * 未知代号直接抛：这条路径上没有「猜一个」的余地，静默发错音色比报错糟得多。
 */
export function upstreamVoiceIdFor(publicId: string | null | undefined): string {
  const upstream = typeof publicId === 'string' ? UPSTREAM_VOICE_BY_PUBLIC_ID[publicId] : undefined;
  if (!upstream) {
    throw new Error('No upstream voice mapped for public voice id: ' + String(publicId));
  }
  if (!isQwenVoiceId(upstream)) {
    throw new Error('Mapped upstream voice is not in the Qwen catalog: ' + upstream);
  }
  return upstream;
}
