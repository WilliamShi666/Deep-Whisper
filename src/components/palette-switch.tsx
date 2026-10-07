'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { errorCopy } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n-client';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate, type MessageKey } from '@/lib/i18n/messages';
import { PALETTE_PREVIEW_COLOR, type PalettePreference, type PaletteValue } from '@/lib/palette';
import { readPalettePreference, savePalettePreference, writePalettePreference } from '@/lib/palette-client';
import { cn } from '@/lib/utils';

/**
 * 「氛围」开关：**一颗圆圈，零可见文字**（契约 t30；用户 2026-09-27 直接指令「把原点放到右上角，
 * 不要留任何文字，就留圆圈，而且不要放两个圆圈，就放一个」）。
 *
 * 这里只有一颗圆点：它**显示当前所处的氛围**（用那条氛围的预览色），点一下**切到另一边**。
 * 卡片外壳（`rounded-xl border bg-card p-4`）与可见标题「界面风格」都已删除 —— 页面需要定位时
 * 通过 `className` 传（入口两页传 `fixed right-4 top-4 …`，聊天头部保持内联）。
 *
 * ## 一条规则走三处上下文（入口 / 支付 / 聊天）
 *
 * `resolved` = 该页**已经解析好的**氛围（入口/支付：`档案 ?? 设备镜像 ?? 页面默认`；
 * 聊天页把 `native` 也交进来，视作「非 rose」）。由纯函数 `resolvePaletteToggle` 给出：
 *   - 颜色 = `resolved === 'rose' ? PALETTE_PREVIEW_COLOR.rose : PALETTE_PREVIEW_COLOR.blue`；
 *   - **点击应用 `next = resolved === 'rose' ? 'blue' : 'rose'`**（`next` 恒为「另一边」）。
 * 于是三种上下文都自洽：入口页（默认玫瑰）点一下变蓝；支付页（默认蓝）点一下变玫瑰；
 * 聊天页未选择（native）点一下变玫瑰（native 下「切到 blue」等于没有视觉变化，切到 rose 才是
 * 用户能感知的动作）。
 *
 * ## `data-palette-value` 的**语义变更**（旧语义不再成立）
 *
 * 两点控件时期它是「某个选项的值」；单圆圈时期它是**点击将应用的值（`next`）** ——
 * 单控件下这是 e2e 唯一能表达「点它会切到蓝」的方式：
 * `[data-testid="palette-toggle"][data-palette-value="blue"]`。
 *
 * ## 可访问性（零文字 ≠ 零语义）
 *
 *   - 圆点是原生 `<button type="button">`（键盘可达、支持 `disabled`），24×24px（WCAG 2.5.8）；
 *   - `aria-label` 描述**将要发生的动作**（`切换到梦幻蓝` / `Switch to Dream Blue`），文案由
 *     字典的 `core.palette.switch_to` + `core.palette.{rose,blue}` 拼出（按当前 locale 渲染）；
 *   - 焦点环用语义色（`focus-visible:outline-foreground`；刻意用 `outline` 而不是 `ring` ——
 *     圆圈底色走 inline `box-shadow` 泛光，class 级 ring 会被 inline 覆盖）；
 *     三条 `focus-visible:outline-*` **必须是即时生效**的，所以过渡属性刻意**逐项列出**、
 *     不用 `transition-all`：`transition-all` 会把 `outline-width/offset/color` 也一起过渡，
 *     于是 `Tab` 之后的 150ms 内读到的计算值仍是**过渡起始帧**
 *     （实测 `3px / 0px / --ring@0.5`，而承诺是 `2px / 2px / var(--foreground)`）——
 *     t44 的端到端就是这样复现出 F1 的（详见 e2e/palette-focus-ring.spec.ts 的说明）。
 *   - hover 轻微放大作为「可交互」提示；**不**使用可见文字或 `title` tooltip（用户要求零文字）；
 *   - 圆点**之外**保留一条 `sr-only` 说明（`core.palette.unset_hint`），只在「从没选过」时渲染，
 *     圆点的 `aria-describedby` 也**条件化**指向它（避免悬空引用）。
 *
 * ## 挂载范围
 *
 * 入口两页（`/onboarding` 两个渲染出口、`/login`，视口右上角 fixed）与**聊天头部**
 * （紧邻「聊天装扮」按钮的左侧）。支付两页与聊天装扮弹窗**不再**托管它（用户 2026-09-27
 * 第五轮指令：「不需要在装扮弹窗以及支付页里面再放置这两个圈圈」）。
 * 每处的持久化档位由页面按「档案行是否已确认存在」判定（`palettePersistMode`）：
 * 行存在 ⇒ `persist="server"`（非乐观 PATCH，成功后才写设备镜像 + 回调 + toast）；
 * 行不存在 ⇒ `persist="local"`（只写设备镜像，零服务端写入 —— `PATCH` 会 0 行命中 → 500）。
 * 入口骨架屏 `/` 不挂（1–2 帧内就 `router.replace` 走）。
 */
export interface PaletteToggleResolution {
  /** 圆圈当前显示的颜色（= 当前氛围的预览色）。 */
  color: string;
  /** 点击后将应用的值（同时是 `data-palette-value` 与 aria-label 的宾语）。 */
  next: PaletteValue;
  /** 动作式 accessible name（`切换到…`）—— 描述将要发生什么，而不是当前是什么。 */
  actionLabel: string;
  /** 是否「从没选过」（`null`/`undefined`）：决定 sr-only 说明的渲染与条件化引用。 */
  unset: boolean;
}

/**
 * 单圆圈的解析（纯函数，零 IO）：当前氛围 → 颜色 + 点击将应用的值 + 动作文案 + 是否未选择。
 *
 * 非 `'rose'` 的一切（`'blue'`、聊天页的 `'native'`、`null`、脏值）都走「非玫瑰」分支 ——
 * 与 `resolveChatPalette` 的口径一致（只有 `'rose'` 才切玫瑰）。
 *
 * `locale` 缺省 `zh-CN`（**兼容既有调用点与单测**，它们断言的是规格里的中文字面量
 * `切换到梦幻蓝`）；真正的调用点（组件内部）总把当前 locale 传进来。
 */
export function resolvePaletteToggle(resolved: unknown, locale: Locale = DEFAULT_LOCALE): PaletteToggleResolution {
  const isRose = resolved === 'rose';
  const next: PaletteValue = isRose ? 'blue' : 'rose';
  return {
    color: isRose ? PALETTE_PREVIEW_COLOR.rose : PALETTE_PREVIEW_COLOR.blue,
    next,
    actionLabel: paletteActionLabel(locale, next),
    unset: resolved === null || resolved === undefined,
  };
}

/** 圆点之外那条说明的 id（`aria-describedby` 条件化指向它）。 */
export const PALETTE_UNSET_HINT_ID = 'palette-unset-hint';

/**
 * 氛围名与两条动作文案的**字典 key**（唯一来源：`core` area 的 `palette.*`）。
 *
 * 这里刻意**不再存字符串**：标签的唯一定义在字典里（`tests/palette-surfaces.test.ts` 仍钉住
 * 「`src/` 下 `梦幻玫瑰` / `梦幻蓝` 各恰好出现 1 次」—— 那一次现在落在 zh 字典上），
 * 组件只持有 key，英文态因此不会漏出中文（t17 评审 U6 的 F2）。
 */
export const PALETTE_LABEL_KEY: Readonly<Record<PaletteValue, MessageKey>> = {
  rose: 'core.palette.rose',
  blue: 'core.palette.blue',
};

/** 氛围名的当前语言取值（纯函数：给 `resolvePaletteToggle` 与组件共用）。 */
export function paletteLabel(locale: Locale, value: PaletteValue): string {
  return translate(MESSAGES[locale], PALETTE_LABEL_KEY[value]);
}

/** 动作式 accessible name（`切换到梦幻蓝` / `Switch to Dream Blue`）。 */
function paletteActionLabel(locale: Locale, next: PaletteValue): string {
  return translate(MESSAGES[locale], 'core.palette.switch_to', { name: paletteLabel(locale, next) });
}

export interface PaletteSwitchProps {
  /** 切换成功后的回调（页面/弹窗用它即时生效）。 */
  onChange?: (value: PaletteValue) => void;
  /**
   * 持久化级别：
   *   - `'server'`（默认）= 写库（非乐观 PATCH）并镜像到设备：支付两页 / 装扮弹窗 / 入口页已确认档案行时；
   *   - `'local'` = 只写设备镜像，零服务端写入：入口页在档案行未确认时（`PATCH` 必然 500）。
   */
  persist?: 'server' | 'local';
  /**
   * 该页**解析好的**氛围：`'rose'` / `'blue'`（入口、支付），或聊天页的 `'native'` / `null`。
   * 不给（未受控）时退回设备镜像；两者都没有 → 按「非 rose」渲染（蓝圆圈）—— 支付页与聊天弹窗的
   * 默认面都正是它。
   */
  value?: PalettePreference | 'native';
  /** 外部禁用（与内部「切换中」合并）：圆点 `disabled`，保留键盘可达语义。 */
  disabled?: boolean;
  /** 圆点的额外 className：入口两页用 `fixed right-4 top-4 …` 定位到视口右上角。 */
  className?: string;
}

/** 页面级 / 弹窗级的氛围开关：一颗圆圈 +（圆点之外的）sr-only 说明。 */
export function PaletteSwitch({
  onChange,
  persist = 'server',
  value: controlled,
  disabled = false,
  className,
}: PaletteSwitchProps) {
  /** 非受控模式下的当前值（设备镜像）；受控模式由 `value` 覆盖。 */
  const [stored, setStored] = useState<PalettePreference>(null);
  /** 只有 `'server'` 档会用到：写库期间圆点 disabled。 */
  const [switching, setSwitching] = useState(false);
  /** 当前语言：文案（动作式 aria-label / toast / sr-only 说明）全部按它渲染。 */
  const { locale } = useLocale();
  const t = useT();

  useEffect(() => {
    // 设备级样式镜像只在挂载后读：服务端没有 localStorage，render 期读会造成 hydration 不一致。
    setStored(readPalettePreference());
  }, []);

  const resolved = controlled === undefined ? stored : controlled;
  // 动作文案与颜色都按**当前语言**解析（`resolvePaletteToggle` 的第二参）。
  const { color, next, actionLabel, unset } = resolvePaletteToggle(resolved, locale);

  const apply = async (target: PaletteValue) => {
    if (switching || disabled) return;

    if (persist === 'server') {
      setSwitching(true);
      try {
        // 非乐观：先写库，成功之后才动界面状态与设备镜像。
        await savePalettePreference(target);
        setStored(target);
        onChange?.(target);
        toast.success(t('core.palette.changed', { name: paletteLabel(locale, target) }));
      } catch (error) {
        // 失败时语言没变，所以服务端原文/当前语言的兜底都是对的。
        toast.error(errorCopy(error, t, t('core.palette.switch_failed')));
      } finally {
        setSwitching(false);
      }
      return;
    }

    if (persist === 'local') {
      // 入口页在档案行未确认时用这一档：只写设备镜像，零服务端写入。
      // 未建立档案的访客 PATCH /api/visitor 只会 500，所以这里绝不碰 savePalettePreference。
      writePalettePreference(target);
      setStored(target);
      onChange?.(target);
      toast.success(t('core.palette.changed', { name: paletteLabel(locale, target) }));
    }
  };

  return (
    <>
      {/*
        唯一文本：圆点**之外**的 sr-only 说明（只在「从没选过」时渲染，引用也随之条件化）。
        刻意排在圆点**之前** —— 聊天头部里这颗圆点必须是「聊天装扮」按钮的**前一个兄弟**
        （用户：「切换按钮需要放在调色板图标的左边」），说明若排在圆点之后就会插进两者中间。
      */}
      {unset ? (
        <p id={PALETTE_UNSET_HINT_ID} data-testid="palette-unset-hint" className="sr-only">
          {t('core.palette.unset_hint', { entry: paletteLabel(locale, 'rose') })}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="palette-toggle"
        // 契约 t30：**点击将应用的值**（旧语义「某个选项的值」已随两点结构作废）。
        data-palette-value={next}
        // 描述**将要发生的动作**，不是当前状态。
        aria-label={actionLabel}
        aria-describedby={unset ? PALETTE_UNSET_HINT_ID : undefined}
        disabled={disabled || switching}
        onClick={() => void apply(next)}
        // 圆圈底色 = 当前氛围的预览色（单一定义）；泛光取同一枚颜色，不引入第二种颜色。
        style={{ backgroundColor: color, boxShadow: `0 0 10px 1px ${color}` }}
        className={cn(
          'h-6 w-6 shrink-0 rounded-full',
          // 过渡属性**逐项列出**（不用 `transition-all`）：焦点环不允许被过渡 ——
          // `outline-width/offset/color` 一旦参与过渡，`Tab` 之后要等 150ms 才变成承诺值，
          // 任何「立即读计算值」的验收（含 e2e/palette-focus-ring.spec.ts）都会读到起始帧。
          //
          // 清单 = 本控件真正会变的那几个属性（都已逐一到服务端 CSS 的编译产物核对过）：
          //   - `scale`：Tailwind v4 的 `hover:scale-110` 落在**独立属性 `scale`** 上
          //     （编译成 `scale: var(--tw-scale-x) var(--tw-scale-y)`，hover 时 computed
          //     `scale: 1.1` / `transform: none`）—— t87 只写了 `transform`，把悬停放大
          //     退化成瞬间跳变，t91 补上；`transform` 一并保留（调用点可用 `className` 传自己的位移）。
          //   - `box-shadow` / `background-color`：内联的泛光与底色，切换风格时也要平滑。
          //   - `opacity`：`disabled:opacity-60` 的变淡。
          // 已核对**未用到**的 v4 独立属性：`translate` / `rotate` / `filter` / `backdrop-filter`
          // （class 清单里没有对应工具类；真机 computed 在未 hover / hover 两态都是 `none`）。
          'transition-[transform,scale,box-shadow,opacity,background-color]',
          'hover:scale-110',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      />
    </>
  );
}
