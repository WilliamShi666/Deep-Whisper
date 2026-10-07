'use client';

/**
 * 语言开关：**一个按钮**，显示「点它会切到的那个语言」（契约 §5）。
 *
 * 与 `src/components/palette-switch.tsx` 同构的形态：
 *   - 受控（`value` 不给时退回 Provider 当前语言）；
 *   - `data-locale-value` = **点击将应用的值**（不是当前值），与 palette 的单控件语义一致；
 *   - `persist='server'` 走非乐观写（Provider 的 `setLocale`：先 `PATCH /api/visitor`，成功后才动界面
 *     与设备镜像）；失败时 toast 兜底文案且**什么都不变**；
 *   - `persist='local'` 只写设备镜像、零请求（档案行还没确认时用这一档）。
 *
 * ## 为什么它不动 `palette-toggle` 的不变量
 *
 * 本组件不渲染任何 `palette-toggle`，也不包裹/替换 `PaletteSwitch`：它是 `PaletteSwitch` 片段的
 * **前一个兄弟节点**（挂载点上与 `<PaletteSwitch …>` 同级、排在它前面）。
 * 于是：`palette-toggle` 的唯一渲染点仍在 `palette-switch.tsx`，各页面的计数（入口两页 1、
 * 聊天头部 1、装扮弹窗 0、`/` 与支付页 0、`/love` 1）都不变；`palette-unset-hint` 与圆点的
 * 相邻关系也不变（两者仍在 `PaletteSwitch` 片段内部）。
 *
 * ## 可访问性
 *
 *   - 原生 `<button type="button">`，键盘可达、支持 `disabled`（写库中）；
 *   - `aria-label` 描述**将要发生的动作**（`切换到 English` / `Switch to 中文`），由字典拼装；
 *   - 可见文字恒为**目标语言的自称徽标**（中文态显示 `EN`、英文态显示 `中文`）；
 *   - 焦点环用语义色；过渡属性**逐项列出**，不用 `transition-all`
 *     （`transition-all` 会把 `outline-*` 也一起过渡，`Tab` 之后读到的是过渡起始帧 —— `palette-toggle` 踩过这个坑）。
 */

import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import { useLocale, useT } from '@/lib/i18n-client';
import { localeBadge, localeSelfName, nextLocale, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

/**
 * 切换成功后的提示文案：**按切换后的语言**渲染。
 *
 * 为什么不能直接用组件里的 `t()`：`apply()` 是点击那一帧创建的函数，闭包里的 `t` 属于**切换前**
 * 的语言。于是「中文 → 英文」成功后会弹出一句中文 toast（`已切换到「English」`）——正是
 * 中英混排。这里按 `target` 显式取值（与切换结束后界面所处的语言一致），两态输出：
 *   - `localeChangedToast('zh-CN')` → `已切换到「中文」`（中文态逐字符不变）；
 *   - `localeChangedToast('en')`    → `Switched to English`。
 *
 * 失败提示**不**走这里：失败时语言没有变，用当前帧的 `t('core.locale.switch_failed')` 才是对的。
 *
 * 备注（契约 §3.2.5）：组件用的是**聚合层** `MESSAGES` + `translate`，不是 `messages/en*` 那一份
 * 语言表；`useT()`/`useLocale()` 之外的组件才被禁止直接 import 具体语言表，本组件两者都用。
 */
export function localeChangedToast(locale: Locale): string {
  return translate(MESSAGES[locale], 'core.locale.changed', { name: localeSelfName(locale) });
}

export interface LocaleSwitchProps {
  /**
   * 持久化级别：
   *   - `'server'`（默认）= 写库（非乐观 PATCH）并镜像到设备：聊天页 / 已确认档案行的入口页；
   *   - `'local'` = 只写设备镜像，零服务端写入：入口页在档案行未确认时（`PATCH` 必然 0 行命中）。
   */
  persist?: 'server' | 'local';
  /** 该页已解析好的语言（受控）；不给时用 Provider 当前语言。 */
  value?: Locale;
  /** 切换成功后的回调（页面据此即时生效）。 */
  onChange?: (value: Locale) => void;
  /** 外部禁用（与内部「切换中」、Provider 的写库中合并）。 */
  disabled?: boolean;
  /** 定位用 className（入口两页传 fixed 定位）。 */
  className?: string;
}

/** 语言开关。 */
export function LocaleSwitch({
  persist = 'server',
  value: controlled,
  onChange,
  disabled = false,
  className,
}: LocaleSwitchProps): ReactElement {
  const { locale: contextLocale, pending, setLocale, setLocaleLocally } = useLocale();
  const t = useT();
  /** 只有写库那一档会用到：请求未回来之前按钮 disabled。 */
  const [switching, setSwitching] = useState(false);

  const current = controlled ?? contextLocale;
  const next = nextLocale(current);
  const busy = disabled || switching || pending;

  const apply = async (target: Locale) => {
    if (busy) return;

    if (persist === 'server') {
      setSwitching(true);
      try {
        // 非乐观：Provider 的 setLocale 先写库，成功之后才动界面与设备镜像。
        await setLocale(target);
        onChange?.(target);
        // 成功：按**切换后**的语言提示（不能用这一帧的 t，见 localeChangedToast 的说明）。
        toast.success(localeChangedToast(target));
      } catch {
        // 失败什么都不变：不写镜像、不改界面，只提示 —— 语言没变，所以用当前帧的 t 才是对的。
        toast.error(t('core.locale.switch_failed'));
      } finally {
        setSwitching(false);
      }
      return;
    }

    // 'local'：只写设备镜像，零请求（未建立档案行的访客 PATCH 只会 500）。
    setLocaleLocally(target);
    onChange?.(target);
    toast.success(localeChangedToast(target));
  };

  return (
    <button
      type="button"
      data-testid="locale-switch"
      // 契约 §5.2：这里是**点击将应用的值**（与 palette-toggle 的 data-palette-value 同语义）。
      data-locale-value={next}
      // 描述将要发生的动作，不是当前状态。
      aria-label={t('core.locale.switch', { name: localeSelfName(next) })}
      disabled={busy}
      onClick={() => void apply(next)}
      className={cn(
        'h-6 min-w-6 shrink-0 rounded-full px-2 text-[11px] leading-6 font-medium',
        'text-foreground/70 hover:bg-foreground/10 hover:text-foreground/90',
        // 过渡属性逐项列出（不用 transition-all）：焦点环必须是即时生效的。
        'transition-[transform,scale,background-color,color,opacity]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      {localeBadge(next)}
    </button>
  );
}
