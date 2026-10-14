"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { addYears } from "date-fns"
import {
  DayPicker,
  getDefaultClassNames,
  useDayPicker,
  type DayButton,
  type MonthCaptionProps,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { useLocale, useT } from "@/lib/i18n-client"
import { formatDate, formatMonthShort } from "@/lib/i18n/format"

/**
 * 月份标题：在既有的 `‹` `›`（月份翻页，由 DayPicker 的 nav 渲染）之上，补**年份级**导航。
 *
 * 用户诉求（第六轮 N3）：生日/纪念日要往回点 20–30 次月份才能回到出生年份。
 * `«`/`»` 每次跳 **1 年**（`addYears`，不是 `addMonths`），年份下拉两次点击就能到位。
 * 跳转统一走 `useDayPicker().goToMonth`（不依赖包的内部组合）；可视区间由调用点传的
 * `startMonth`/`endMonth` 决定，到边界时对应的年按钮 disabled。
 *
 * **为什么标题行整条曾经点不动**（用户实测 + e2e `date-picker-year.spec.ts` 的命中测试）：
 * DayPicker 把 nav 渲染成 `<nav class="… absolute top-0 inset-x-0 …">` —— 绝对定位、横跨整行、
 * 自身没有任何点击处理，正好压在标题行上面。`«`/`»`/年份控件都在标题行里，于是它们的中心点
 * 被 `document.elementFromPoint` 判给了这个 nav，onClick 根本没机会触发（月份能切，是因为
 * 点到了 nav 自己的 `‹`/`›`）。修法见下面 classNames 里的 `nav` / `button_previous` /
 * `button_next` 三处（nav 不吃事件、两个翻页按钮自己收回事件）。
 */
function CalendarMonthCaption({ calendarMonth, className, ...props }: MonthCaptionProps) {
  const { goToMonth, dayPickerProps, formatters } = useDayPicker()
  const displayMonth = calendarMonth.date
  const currentYear = displayMonth.getFullYear()
  const t = useT()
  const fromYear = dayPickerProps.startMonth?.getFullYear() ?? currentYear - 100
  const toYear = dayPickerProps.endMonth?.getFullYear() ?? currentYear + 10

  const years: number[] = []
  for (let year = fromYear; year <= toYear; year += 1) years.push(year)

  /** 跳年：夹在 [fromYear, toYear] 内，跳转步长按「年」算（保留当前月份）。 */
  const goToYear = (nextYear: number) => {
    const target = Math.min(Math.max(nextYear, fromYear), toYear)
    goToMonth(addYears(displayMonth, target - currentYear))
  }

  return (
    <div className={cn("flex items-center justify-center gap-1", className)} {...props}>
      <button
        type="button"
        aria-label={t('core.calendar.prev_year')}
        disabled={currentYear <= fromYear}
        onClick={() => goToYear(currentYear - 1)}
        className="pointer-events-auto rounded-md px-1 text-sm leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
      >
        «
      </button>
      {/*
        年份控件是原生 `<select>`（保住「一次交互跳到 1990」），但外观必须由我们画：
        `appearance-none` 去掉浏览器默认那套上下箭头，右侧补一枚自绘的**单一** chevron
        （`pointer-events-none`，不挡点击）。用户原话：「向上向下不需要设置向上向下的按钮，
        这不符合人类的使用习惯」。
      */}
      <span className="relative inline-flex items-center">
        <select
          aria-label={t('core.calendar.year')}
          value={currentYear}
          onChange={(event) => goToYear(Number(event.target.value))}
          className="appearance-none rounded-md border border-input bg-transparent py-0.5 pr-5 pl-1.5 text-sm"
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute right-1 size-3.5 text-muted-foreground"
        />
      </span>
      <span aria-hidden="true" className="pointer-events-none text-sm font-medium">
        {formatters.formatMonthDropdown(displayMonth)}
      </span>
      <button
        type="button"
        aria-label={t('core.calendar.next_year')}
        disabled={currentYear >= toYear}
        onClick={() => goToYear(currentYear + 1)}
        className="pointer-events-auto rounded-md px-1 text-sm leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
      >
        »
      </button>
    </div>
  )
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()
  /**
   * 月份短名与 `data-day` 都必须按**界面语言**格式化（契约 §11.2 判据 11.2.1）：
   * 这里原来是 `date.toLocaleString("default", …)` —— 显式传了 options 却把 locale 留给**运行时**，
   * 于是英文界面会读出中文月份（或反过来）。取值只从 `LocaleProvider` 来（契约 §3.2.1：组件不得
   * 自建解析链），本文件是 `"use client"`，调用点是 client 组件。
   */
  const { locale } = useLocale()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) => formatMonthShort(locale, date),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "flex gap-4 flex-col md:flex-row relative",
          defaultClassNames.months
        ),
        month: cn("flex flex-col w-full gap-4", defaultClassNames.month),
        // 年份级导航的可点击性（t73 的真缺陷修复）：
        // nav 是「绝对定位 + 横跨整行」的浮层，压在标题行之上；它自身没有任何点击处理，
        // 却把 `«`/`»`/年份控件的点击全吞掉 ⇒ 整年跳转点不动。这里让 nav 自身不吃事件，
        // 只把事件收回到它自己的两个月份翻页按钮上（它们必须继续可点）。
        //
        // 选这一条而不是「把标题行提到 nav 之上（z-10）」：标题行是 `w-full`，
        // 抬到 nav 上面之后它的空白区域会反过来盖住 nav 两端那两个 `‹`/`›`，月份翻页会坏。
        nav: cn(
          "flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between pointer-events-none",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) aria-disabled:opacity-50 p-0 select-none pointer-events-auto",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) aria-disabled:opacity-50 p-0 select-none pointer-events-auto",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex items-center justify-center h-(--cell-size) w-full px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "w-full flex items-center text-sm font-medium justify-center h-(--cell-size) gap-1.5",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative has-focus:border-ring border border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] rounded-md",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute bg-popover inset-0 opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "rounded-md pl-2 pr-1 flex items-center gap-1 text-sm h-8 [&>svg]:text-muted-foreground [&>svg]:size-3.5",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] select-none",
          defaultClassNames.weekday
        ),
        week: cn("flex w-full mt-2", defaultClassNames.week),
        week_number_header: cn(
          "select-none w-(--cell-size)",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] select-none text-muted-foreground",
          defaultClassNames.week_number
        ),
        day: cn(
          "relative w-full h-full p-0 text-center [&:last-child[data-selected=true]_button]:rounded-r-md group/day aspect-square select-none",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-md"
            : "[&:first-child[data-selected=true]_button]:rounded-l-md",
          defaultClassNames.day
        ),
        range_start: cn(
          "rounded-l-md bg-accent",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("rounded-r-md bg-accent", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        MonthCaption: CalendarMonthCaption,
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()
  /**
   * `data-day` 是**数据属性**（e2e / 单测按它定位某一天），取值必须与界面语言一致：
   * 原来是 `day.date.toLocaleDateString()` —— 无参形态跟着**运行时**语言走，
   * 于是英文界面下日历格子的 `data-day` 会是中文日期形态（或反过来）。
   * 改成按界面语言显式格式化（契约 §11.2 判据 11.2.1）；**属性名与语义不变**，
   * 既有 `[data-day]` 选择器（tests/date-picker-contract / date-day-* 断言）不受影响。
   */
  const { locale } = useLocale()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={formatDate(locale, day.date)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 dark:hover:text-accent-foreground flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
