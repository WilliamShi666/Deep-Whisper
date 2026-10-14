import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import { MESSAGES, translate } from '@/lib/i18n/messages';

/**
 * 「无文字配图」占位哨兵的**唯一共享常量 + 语言感知显示**（U7 / t8，队长指派）。
 *
 * 背景（U3/t9 挖出的孤儿中文源）：用户只发一张图、不带文字时，历史实现有三处各写一遍
 * 字面量 `'[图片]'` —— `/api/chat` 落库一份、`/api/chat` 判定「只有一张图」时比对一份、
 * `chat-shell` 的乐观气泡再写一份。三处一旦不同就出现「先显示占位、回显时又变一种」，
 * 且英文态会把服务端写入的中文原样显示出来。
 *
 * 处理方式（**零数据迁移**）：
 *   - **落库哨兵只有一个、逐字符不变**：`IMAGE_PLACEHOLDER`（= 字典 zh 侧取值 `[图片]`）。
 *     存量行里的 `[图片]` 因此仍然被 `isImagePlaceholder` 认出来，**不需要任何 UPDATE**。
 *   - **显示**按当前语言走 `imagePlaceholderLabel(locale)`：英文态渲染 `[Image]`，
 *     绝不回显中文哨兵；中文态取值逐字符等于旧行为。
 *
 * 本模块零 React / 零 DOM：服务端 route 与客户端组件共用同一份判定。
 */

/** 落库哨兵（数据，不是 UI 文案）：字典 zh 侧那一条，逐字符等于既有落库值。 */
export const IMAGE_PLACEHOLDER: string = translate(MESSAGES['zh-CN'], 'chat.message.image_placeholder');

/** 这个 content 是不是「无文字配图」的落库哨兵。 */
export function isImagePlaceholder(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() === IMAGE_PLACEHOLDER;
}

/** 按语言取显示文案（zh → `[图片]`，与落库值一致；en → `[Image]`）。 */
export function imagePlaceholderLabel(locale: Locale = DEFAULT_LOCALE): string {
  return translate(MESSAGES[locale], 'chat.message.image_placeholder');
}
