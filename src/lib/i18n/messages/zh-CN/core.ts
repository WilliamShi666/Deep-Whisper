/**
 * 通用面文案（**所有者：U1 / t5；`palette.*` 六条由 U4 / t29 追加**）：全站复用的按钮词、加载态、
 * 语言开关自身的文案，以及氛围圆圈（`palette-switch.tsx`）的 accessible name 与 toast。
 *
 * 这里也是「字典怎么长」的样板：扁平对象 + `as const`，键名遵循契约 §2.2
 * （`^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,2}$`，小写 + 点分层级）；插值占位符用 `{name}`，
 * 中英同一条 key 的占位符集合必须相同（`tests/i18n-messages.test.ts` 钉住）。
 *
 * `palette.*` 的由来（t17 评审 U6 的 F2）：那两个氛围名与「切换到…／已切换到…」原先只以中文字面量
 * 存在于 `palette-switch.tsx` 里（当时该文件还在覆盖门禁的冻结豁免名单里），于是**英文态仍显示中文**
 * —— `/love?lang=en` 的 DOM 里唯一的汉字属性就是 `aria-label="切换到梦幻玫瑰"`。
 * 现在文案进字典、按 locale 渲染，该文件也从 `tests/support/i18n-frozen-zh.ts` 移除了
 * （门禁对它真正生效：文件里再出现中文就会变红）。
 */
export const core = {
  'common.save': '保存',
  'common.cancel': '取消',
  'common.retry': '重试',
  'common.loading': '加载中…',
  'locale.switch': '切换到 {name}',
  'locale.changed': '已切换到「{name}」',
  'locale.switch_failed': '切换语言失败，请重试',
  /* ---------- 日期选择器（`components/ui/date-picker.tsx`） ---------- */
  'date_picker.placeholder': '选择日期',
  /** 弹窗左下角：既没选也没 label 时的说明。 */
  'date_picker.unset': '未选择',
  /** 弹窗右下角：清除当前值。 */
  'date_picker.clear': '清除',
  /* ---------- 氛围圆圈（梦幻玫瑰 / 梦幻蓝） ---------- */
  'palette.rose': '梦幻玫瑰',
  'palette.blue': '梦幻蓝',
  /** 动作式 accessible name：**没有**空格（原实现就是 `切换到${名}`，逐字符保留）。 */
  'palette.switch_to': '切换到{name}',
  'palette.changed': '已切换到「{name}」',
  'palette.switch_failed': '切换失败，请重试',
  /** 「从没选过」那条 sr-only 说明：两个氛围名由上面两条 key 插值进来（不再有第二份字面量）。 */
  'palette.unset_hint': '未选择时跟随页面默认：入口页{entry}；聊天保持 TA 的原色。',
  // t51（F-B）：日历年份导航的 accessible name（原为 calendar.tsx 的中文字面量，曾被快照豁免）
  'calendar.prev_year': '上一年',
  'calendar.next_year': '下一年',
  'calendar.year': '年份',
  /* ---------- 身份类错误（`src/lib/api.ts`；t58） ---------- */
  /**
   * 这三条原先以中文字面量写在 `src/lib/api.ts` 里，经 `e.message` **直接上屏**
   * （onboarding 的 `start()`、chat-shell 的多个 toast、palette-switch、主题/性格/语音弹窗），
   * 于是英文态漏中文。现在 api.ts 抛出的 Error 同时带「当前语言的字典文案」与稳定 key，
   * 上屏点用 `errorCopy()` 按 key 取词（字典是唯一文案源，不另造映射）。
   * zh 取值与原字面量**逐字符相同**（含 `访客身份探测失败: HTTP {status}` 的拼法）。
   */
  'identity.changed': '访客身份已变更',
  'identity.changed_retry': '访客身份已变更，请重试',
  'identity.probe_failed': '访客身份探测失败: HTTP {status}',


} as const;
