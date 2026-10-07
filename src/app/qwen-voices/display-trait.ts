/**
 * 官方把英文音色的「声线特质」写成了口音（英式女声 / 美式男声…）。
 * 产品要求**不显示英音/美音的区别**，所以这类值在服务端就被抹掉：
 * 只在下游渲染时过滤是不够的 —— manifest 会作为 props 序列化进 RSC payload，
 * 原值照样会出现在发给浏览器的 HTML 里。
 *
 * **本模块只能被服务端组件 import。** 客户端组件（audition-list.tsx 曾经如此）import 它会
 * 把下面这条正则整本打进浏览器 chunk —— 实测生产 chunk 里能翻到「英式」「美式」：
 * 用来抹掉口音的东西，自己泄漏了口音词。清洗只发生一次，就在 page.tsx 的数据源头。
 */
export const ACCENT_ONLY_TRAIT = /^(英式|美式)(女声|男声)$/;

export function displayTrait(trait: string): string {
  return ACCENT_ONLY_TRAIT.test(trait.trim()) ? '' : trait;
}
