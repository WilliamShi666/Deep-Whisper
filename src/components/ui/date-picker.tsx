'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';

import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDateLabel, formatDateValue, parseDateValue } from '@/lib/date-value';
import { useT } from '@/lib/i18n-client';
import { cn } from '@/lib/utils';

/**
 * 日期选择器（第六轮 N3 / 规格 §4.11）。
 *
 * 为什么不用原生日期输入：翻页 UI 由浏览器绘制，**加不了年份级按钮** ——
 * 而用户要的正是「一次跳一年」再加上年份下拉，否则回到出生年份要按月点 20–30 次。
 * 值域与原生输入**逐字兼容**（`'YYYY-MM-DD'` 或 `''`），所以数据层与 API 零改动。
 *
 * 弹层是 Radix 的默认非阻塞浮层（不传阻塞开关，点外部即可关闭）。
 *
 * 三处文案全部走字典（t36）：触发器占位符 `core.date_picker.placeholder`、弹窗左下角未选择说明
 * `core.date_picker.unset`、右下角清除按钮 `core.date_picker.clear`。原先都是硬编码中文，
 * 英文界面下弹窗里会冒中文；这个文件也因此在覆盖门禁的冻结名单里挂了很久（现已移出）。
 */
export interface DatePickerProps {
  /** `'YYYY-MM-DD'` 或 `''`（未设置）。**值域与原生 input 逐字兼容**（数据层零改动）。 */
  value: string;
  onChange: (value: string) => void;
  /** 可访问名：两处调用点分别是「我的生日」「重要日期」（既有 e2e 依赖它们）。 */
  ariaLabel: string;
  disabled?: boolean;
  fromYear?: number;
  toYear?: number;
  className?: string;
}

/** 触发器的视觉与 `ui/input.tsx` 同高（h-9）/ 同边框（border-input）/ 同圆角（rounded-md）。 */
const TRIGGER_CLASS = [
  'border-input flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-1 text-left text-base shadow-xs transition-[color,box-shadow] outline-none',
  'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
].join(' ');

export function DatePicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  fromYear = 1900,
  toYear = new Date().getFullYear() + 10,
  className,
}: DatePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const label = formatDateLabel(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(TRIGGER_CLASS, className)}
        >
          <span className={cn('truncate', !label && 'text-muted-foreground')}>
            {label || t('core.date_picker.placeholder')}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          captionLayout="label"
          selected={selected ?? undefined}
          defaultMonth={selected ?? undefined}
          startMonth={new Date(fromYear, 0, 1)}
          endMonth={new Date(toYear, 11, 31)}
          onSelect={(day) => {
            if (!day) return;
            onChange(formatDateValue(day));
            setOpen(false);
          }}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">{label || t('core.date_picker.unset')}</span>
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('core.date_picker.clear')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
