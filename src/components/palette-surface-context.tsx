'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { paletteSurfaceFor, type PaletteChromeSurface } from '@/lib/palette';

/**
 * 「当前表面」的**浮层传播通道**（规格 §4.9 浮层子节；第六轮 N2）。
 *
 * ## 为什么需要它（根因）
 *
 * 聊天页的三区（侧栏 / 头部 / 输入区）各自挂 `data-surface`，于是它们**自己**的子树里
 * `--primary` / `--background` 等 token 被就地重定义成用户选的风格。但本仓所有容器型浮层
 * （对话框、确认框、弹层、下拉、抽屉…）都被 Radix / vaul **portal 到 `document.body`** ——
 * 它们**脱离了**那三个 `[data-surface]` 子树，于是直接继承 `html[data-ui-theme='…']` 的
 * `--primary`。实测：`sage-night` 的 `--primary = lab(66.09% -19.57 15.50)`（**绿**），
 * 而 `rose-night` 是 `lab(56.60% 64.76 22.44)`（玫瑰）。用户看到的「点退出登录跳出诡异的绿色弹窗」
 * 就是这么来的：`AlertDialogContent` 吃 `bg-background`、`AlertDialogAction` 吃
 * `buttonVariants()` 的 `bg-primary`，于是卡片和按钮一起变绿。
 *
 * 所以这不是「改个颜色」，而是**给浮层就地重定义整套 token** —— 而 `data-surface` 属性必须
 * 落在浮层**自己的根节点**上（属性作用域不会跟着 portal 走）。
 *
 * ## 为什么用 context 而不是「每个调用点手写 data-surface」
 *
 * React 的 context **能穿过 portal**（Context 沿 React 树传播，与 DOM 树无关），
 * 所以聊天页把「浮层该用的值」放进 Provider，任何深度的浮层都能拿到 ——
 * 逐个调用点手写则必然漏（普查时就有 4 处在用：2 个确认框 + 2 个对话框）。
 *
 * ## 为什么这里的值**恒有值**、而三区的值可能是 `undefined`（第六轮 ㉘）
 *
 * 两条原则不同，所以是两个值：
 *   - **浮层 = 修缺陷**：不写属性时浮层会吃 `html[data-ui-theme]` 的 `--primary`
 *     （sage 色调下是绿）。绿色是**缺陷**、不是任何一种用户偏好，所以「从没选过风格」
 *     不能成为「继续显示缺陷」的理由 —— 浮层**永远**给出一个体面的表面（`null` ⇒ 蓝侧）。
 *   - **三区 = 尊重偏好**：三区是用户能看见并已经表达过意见的**外观**（「没选过，那就界面
 *     不变吧」），没表达就不施加 ⇒ `palettePreference === null` 时**不写**属性。
 *
 * 两个值在 `chat-shell.tsx` 里分别叫 `overlaySurface`（这个 Provider 用）与
 * `chromeSurface`（三容器用）；**合并它们就是把绿色缺陷带回来**。
 *
 * ## 约定
 *
 *   - **浮层永远有值，永远不写 `undefined`**：Provider 的 `surface` 是**非可选**的
 *     `PaletteChromeSurface`，缺省值取**蓝侧** `'dream-blue'`（即「永不绿」——
 *     绿色是缺陷、不是偏好，见下）；
 *   - 这与**三区**的口径**刻意分叉**：三区承载的是外观偏好，`palettePreference === null`
 *     （从没选过）时 `chat-shell` 给 `undefined` ⇒ 属性整个不写、界面逐像素不变；
 *     浮层承载的是缺陷修复，`null` 时也必须落在一个体面的表面上（蓝侧）。
 *     两个值在 `chat-shell.tsx` 里分别叫 `chromeSurface`（三区）与 `overlaySurface`（浮层），
 *     **不得合并** —— 合并会把「退出登录跳出诡异绿弹窗」那个缺陷带回来；
 *   - 消费点一律把 `data-surface={ctx}` 写在 `{...props}` **之前**：显式传入的属性优先
 *     （朗读卡片那种「必须锁在深色档」的特例就是这么保留的）；
 *   - 本模块零逻辑、零 IO：只做「值 → 属性」的搬运。
 */
/*
 * 缺省值 = 蓝侧（**永不绿**）。刻意不在这里写第二份表面 id 字面量：`paletteSurfaceFor(null)`
 * 就是「没选过风格」的蓝家族取值（单一来源在 `src/lib/palette.ts`）。这个缺省只在
 * 「某处浮层漏包 Provider」时才会用到 —— 今天十个容器型原子全部挂在聊天页的 Provider 下。
 */
const PaletteSurfaceContext = createContext<PaletteChromeSurface>(paletteSurfaceFor(null));

export interface PaletteSurfaceProviderProps {
  /** 聊天页算好的浮层表面值（**非可选**：三区的「不写属性」决定不经这个通道）。 */
  surface: PaletteChromeSurface;
  children: ReactNode;
}

/** 把聊天页算出来的浮层表面值供给整棵子树（含所有被 portal 出去的浮层）。 */
export function PaletteSurfaceProvider({ surface, children }: PaletteSurfaceProviderProps) {
  return <PaletteSurfaceContext.Provider value={surface}>{children}</PaletteSurfaceContext.Provider>;
}

/**
 * 取当前浮层表面值。返回类型**不含 `undefined`**（无需容错分支）。
 *
 * 无 Provider 时 `createContext` 的缺省值是 `'dream-blue'` —— 蓝侧、永不绿。
 * 今天这些容器型原子只被聊天页挂载（Provider 恒在），这个缺省值是一层「万一漏包
 * Provider 也不会渲染出 off-brand 绿」的安全网，而不是一条会走到的业务分支。
 */
export function usePaletteSurfaceAttr(): PaletteChromeSurface {
  return useContext(PaletteSurfaceContext);
}
