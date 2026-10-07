import type { core as zhCore } from '../zh-CN/core';

/**
 * 通用面英文文案（**所有者：U1 / t5；`palette.*` 六条由 U4 / t29 追加**）。
 *
 * `Record<keyof typeof zhCore, string>` 是 en 侧的唯一约束写法：
 *   - 少一条 key → `TS2741`（Property … is missing）；
 *   - 多一条 key → `TS2353`（Object literal may only specify known properties）。
 * 两条都在 `pnpm ts-check` 里红，所以「中英对齐」不靠人工检查（契约 §2.3，勘误 E1）。
 *
 * `palette.*` 的英文口径：氛围名用英文诗意重命名（`Dream Rose` / `Dream Blue`，与
 * `chat-themes.ts` 的英文色调名同一路数），**不**保留拼音 —— 它是界面上的氛围名，不是角色名
 * （H1 的「拼音 · 英文名」只约束角色）。
 */
export const core: Record<keyof typeof zhCore, string> = {
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'locale.switch': 'Switch to {name}',
  'locale.changed': 'Switched to {name}',
  'locale.switch_failed': 'Could not switch the language. Please try again.',
  /* ---------- Ambience circle (Dream Rose / Dream Blue) ---------- */
  'date_picker.placeholder': 'Pick a date',
  'date_picker.unset': 'Not set',
  'date_picker.clear': 'Clear',
  'palette.rose': 'Dream Rose',
  'palette.blue': 'Dream Blue',
  'palette.switch_to': 'Switch to {name}',
  'palette.changed': 'Switched to {name}',
  'palette.switch_failed': 'Could not switch. Please try again.',
  'palette.unset_hint':
    'When nothing is chosen each page keeps its own default: entry pages use {entry}; in chat it stays their own colours.',
  // t51（F-B）：同上，en 侧
  'calendar.prev_year': 'Previous year',
  'calendar.next_year': 'Next year',
  'calendar.year': 'Year',
  // t58：身份类错误（`src/lib/api.ts`）—— 占位符集合与 zh 一致（`{status}`）。
  'identity.changed': 'Your visitor identity changed.',
  'identity.changed_retry': 'Your visitor identity changed. Please try again.',
  'identity.probe_failed': 'Could not confirm your visitor identity (HTTP {status}).',


};
