'use client';

/**
 * palette 的**浏览器边界**（t5）。
 *
 * 只放三件必须碰浏览器的东西：localStorage 读写、写库请求、`usePaletteSurface` hook。
 * 纯解析逻辑一律在 `./palette`，本文件不得自行判断优先级。
 *
 * 服务端路由**不得** import 本文件（会把 `apiFetch` 与 React hook 带进 route）。
 * hydration 约定：`usePaletteSurface` 的初始值只能是页面默认表面（服务端与首帧一致），
 * localStorage 与访客档案只在挂载后的 effect 里读取 —— 禁止在 render 期访问 `window`。
 */

import { useEffect, useState } from 'react';

import { apiFetch } from './api';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, parseLocale, type Locale } from './i18n/locale';
import { localizeApiError } from './i18n/errors';
import { MESSAGES, translate } from './i18n/messages';
import {
  PALETTE_STORAGE_KEY,
  PAGE_PALETTE_DEFAULT,
  PALETTE_SURFACE,
  parsePalettePreference,
  resolvePalettePreference,
  type PalettePage,
  type PalettePreference,
  type PaletteSurface,
  type PaletteValue,
} from './palette';

/** 设备镜像里的当前语言（t51）：错误文案要在**抛错那一刻**就本地化，这里不能依赖 React。 */
function deviceLocale(): Locale {
  try {
    return parseLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** 读设备级镜像。没有 `window`、存储被禁用、值非法，一律回落 `null`，不抛。 */
export function readPalettePreference(): PalettePreference {
  if (typeof window === 'undefined') return null;
  try {
    return parsePalettePreference(window.localStorage.getItem(PALETTE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 写设备级镜像：`null` = 清键（回到「未选择」），同样不抛。 */
export function writePalettePreference(value: PalettePreference): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(PALETTE_STORAGE_KEY);
    else window.localStorage.setItem(PALETTE_STORAGE_KEY, value);
  } catch {
    // 无痕模式 / 存储配额满：样式镜像写不进去不影响主流程。
  }
}

/**
 * 写库（唯一写入口 `PATCH /api/visitor`）**成功之后**才写本地镜像。
 *
 * 非乐观：失败时抛错，localStorage 与界面状态都不变（调用方 toast 服务端文案）。
 */
export async function savePalettePreference(value: PaletteValue): Promise<void> {
  const response = await apiFetch('/api/visitor', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ palette: value }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    // t51：原 fallback 是硬编码中文 `'切换失败'`，英文态会经调用方的 `toast.error(error.message)` 上屏。
    // 改走 t8 的 `localizeApiError`（§6.6 服务端 wire → 文案的唯一映射层）；fallback 与
    // `palette-switch.tsx` 的 `t('core.palette.switch_failed')` 同一份字典 ⇒ 错误码与兜底都不出中文。
    const locale = deviceLocale();
    throw new Error(localizeApiError(locale, data, { fallback: translate(MESSAGES[locale], 'core.palette.switch_failed') }));
  }
  writePalettePreference(value);
}

/**
 * 页面**解析后的风格值**：与 `usePaletteSurface` 完全同一条链
 * （访客档案 > localStorage > 页面默认，非法值不短路 localStorage）。
 * **永不返回 `null`** —— 页面默认是这条链的末端兜底（`PAGE_PALETTE_DEFAULT[page]`），
 * 所以它是一个具体的 `PaletteValue`。
 *
 * 为什么要把这个值单独暴露出来：入口页的角色强调色要按当前表面派生
 * （`resolveEntryAccent`），而页面手上唯一的权威值就是这条链的结果。
 * 若页面改用「访客档案值」自己去派生，就没有把 localStorage 那一档算进去 ——
 * 一个只在设备上选过梦幻蓝的访客会拿到「蓝表面 + 玫瑰强调色」的分叉，
 * 正是用户 2026-09-27 反馈的那类 bug。`usePaletteSurface` 也实现为它的派生值，
 * 两者因此在同一帧内不可能不一致。
 *
 * 首帧恒等于该页默认（服务端与 hydration 一致）；localStorage 与档案只在挂载后的
 * effect 里读，禁止在 render 期访问 `window`。
 */
export function useResolvedPalette(page: PalettePage, profileValue?: unknown): PaletteValue {
  const [resolved, setResolved] = useState<PaletteValue>(() => PAGE_PALETTE_DEFAULT[page]);

  useEffect(() => {
    setResolved(resolvePalettePreference(profileValue, readPalettePreference()) ?? PAGE_PALETTE_DEFAULT[page]);
  }, [page, profileValue]);

  return resolved;
}

/**
 * 页面表面取值 hook：入口三页与支付两页各自只调用这一个入口。
 *
 * 首帧恒等于该页默认表面（服务端渲染与 hydration 一致）；挂载后再用
 * 「访客档案 → localStorage → 页面默认」这条链解析，档案或本地值变化时同步。
 *
 * @param page 页面归属（`entry` 默认玫瑰 / `billing` 默认梦幻蓝）
 * @param profileValue 访客档案里的 `visitor.palette`（拿不到就传 `undefined`）
 */
export function usePaletteSurface(page: PalettePage, profileValue?: unknown): PaletteSurface {
  return PALETTE_SURFACE[useResolvedPalette(page, profileValue)];
}
