'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Cake, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api';
import {
  DATE_TYPES,
  buildImportantDatesPayload,
  extractBirthday,
  visibleImportantDates,
} from '@/lib/profile/important-dates';
import type { ImportantDate } from '@/lib/types';
import { useApiError, useT } from '@/lib/i18n-client';
import type { MessageKey } from '@/lib/i18n/messages';

/**
 * 重要日期录入。
 *
 * 两类日期分开：
 *   - 「每年重复」开着 = 生日、纪念日：按「月-日」匹配，跨年仍生效。
 *   - 「每年重复」关掉 = 面试、考试：只在那一年那一天生效。
 *
 * 「我的生日」走 user_profiles.birthday 独立列（它是用户画像的一部分，会单独
 * 注入 system prompt），同时**同步**写一条 important_dates 条目 —— 来信调度只读
 * important_dates，只写独立列的话生日当天不会触发来信。两者必须一起写。
 *
 * 类型表、标签表与生日派生逻辑**全部来自 `@/lib/profile/important-dates`**：
 * 本文件此前各自维护了一份副本，导致「界面能选、服务端/提示词不认」以及
 * 生日条目被静默丢弃这类只改一处的故障。类型选择器里**不提供「生日」** ——
 * 用户自己的生日由上面的专用输入负责，家人朋友的生日用「纪念日」或「其他」记。
 *
 * 「复诊」已从选项里移除；标签表仍保留 medical 以兼容历史行读取。
 */

interface ImportantDatesEditorProps {
  value: ImportantDate[];
  onChange: (next: ImportantDate[]) => void;
  /** 受控模式：不自己发请求（创建角色流程里访客档案还没建，发请求会 401）。 */
  disabled?: boolean;
}

/**
 * 日期类型的**界面标签**（下拉与列表回显）→ 字典 key。
 *
 * 为什么不在组件里直接读 `@/lib/profile/important-dates` 的 `DATE_TYPES[].label`：
 * 那份表与 `BIRTHDAY_DESCRIPTION`（`我的生日`）同住一个文件，而后者是**要写进库的存量数据哨兵**
 * （零迁移零回填，只能兼容读），不能为了翻界面去动它。所以界面为这 6 个标签单独持有一份
 * 本地化副本，逐字符与 `DATE_TYPES[].label` / `LEGACY_TYPE_LABEL` 对齐
 * （`tests/chat-ux-contract.test.ts` 钉住两边相等）；未知类型仍原样回显（与 `typeLabel` 同口径）。
 */
/**
 * `/api/profile` 的 `PROFILE_CONFLICT` 分因（契约 §6.4.1）：同一个 code 有两条文案
 * （读后写 vs 稍后重试），只有服务端回包里的 `conflict` 字段能区分。
 * 缺字段时按「读后写」——它是该 code 的通用形态（字典的 `PROFILE_CONFLICT` 通用键）。
 */
function conflictOf(value: unknown): 'read_then_save' | 'retry_later' {
  return value === 'retry_later' ? 'retry_later' : 'read_then_save';
}

/**
 * `/api/profile` 的 `INTERNAL_ERROR` 分因（契约 §6.4.1，与 `conflictOf` 同一形态的判别字段）：
 * 该 route 的 500 发 `detail: 'brief'`，据此取字典短文案 `errors.INTERNAL_ERROR.brief`
 * （zh 逐字符 = 「服务器开了小差」）；不带这个字段的站点继续用通用长文案。
 * 只有 wire 明说 `'brief'` 才认，其余形态一律不给后缀（回落该 code 的通用键）。
 */
function detailOf(value: unknown): 'brief' | undefined {
  return value === 'brief' ? 'brief' : undefined;
}

const DATE_TYPE_KEYS: Record<string, MessageKey> = {
  anniversary: 'chat.dates.type_anniversary',
  memorial: 'chat.dates.type_memorial',
  exam: 'chat.dates.type_exam',
  other: 'chat.dates.type_other',
  birthday: 'chat.dates.type_birthday',
  medical: 'chat.dates.type_medical',
};

/**
 * 纯受控编辑器：不含任何网络请求，可被聊天设置与创建角色流程共用。
 */
export function ImportantDatesEditor({ value, onChange, disabled = false }: ImportantDatesEditorProps) {
  const t = useT();
  /** 类型标签：命中字典就用字典（两种语言都走它），未知类型原样回显。 */
  const typeText = (type: string) => {
    const key = DATE_TYPE_KEYS[type];
    return key ? t(key) : type;
  };
  const [draftDate, setDraftDate] = useState('');
  // 缺省「纪念日」而不是「生日」：生日走专用输入，不在这个选择器里
  const [draftType, setDraftType] = useState<ImportantDate['type']>('anniversary');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftRecurring, setDraftRecurring] = useState(true);

  const add = () => {
    if (!draftDate) {
      toast.error(t('chat.dates.pick_date_first'));
      return;
    }
    const entry: ImportantDate = {
      date: draftDate,
      type: draftType,
      description: draftDescription.trim(),
      // 只有显式打开才写成每年重复：缺省是一次性，避免面试被误当成每年重复。
      ...(draftRecurring ? { recurring: true } : {}),
    };
    onChange([...value, entry]);
    setDraftDate('');
    setDraftDescription('');
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3" data-testid="companion-important-dates">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <CalendarDays className="size-4 text-primary" />
        {t('chat.dates.title')}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('chat.dates.hint')}
      </p>

      {value.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.map((entry, index) => (
            <li key={`${entry.date}-${entry.description}-${index}`} className="flex items-center justify-between rounded-lg bg-muted/40 px-2 py-1.5">
              <span className="text-xs text-foreground/90">
                {entry.date}
                <span className="ml-1 text-muted-foreground">
                  {typeText(entry.type)}
                  {entry.recurring ? ' · ' + t('chat.dates.yearly_short') : ''}
                  {entry.description ? ` · ${entry.description}` : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label={t('chat.dates.remove_aria', { label: entry.description || entry.date })}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-2">
        <div className="flex gap-2">
          <DatePicker
            value={draftDate}
            onChange={setDraftDate}
            ariaLabel={t('chat.dates.title')}
            disabled={disabled}
            className="flex-1"
          />
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as ImportantDate['type'])}
            aria-label={t('chat.dates.type_aria')}
            className="rounded-md border border-border bg-card px-2 text-xs"
          >
            {DATE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{typeText(type.value)}</option>
            ))}
          </select>
        </div>
        <Input
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          maxLength={40}
          placeholder={t('chat.dates.description_placeholder')}
          aria-label={t('chat.dates.description_aria')}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-foreground/80">
            <Switch
              checked={draftRecurring}
              onCheckedChange={setDraftRecurring}
              aria-label={t('chat.dates.yearly')}
            />
            {t('chat.dates.yearly')}
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={disabled || !draftDate}
            className="rounded-full"
          >
            {t('chat.dates.add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface MyBirthdayFieldProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * 「我的生日」——写入 user_profiles.birthday（独立列），不是 important_dates 条目。
 * 生日本来就每年一次，因此不提供「每年重复」开关，固定按每年重复同步进 important_dates。
 */
export function MyBirthdayField({ value, onChange, disabled = false }: MyBirthdayFieldProps) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3" data-testid="companion-my-birthday">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Cake className="size-4 text-primary" />
        {t('chat.dates.birthday_title')}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('chat.dates.birthday_hint')}
      </p>
      <DatePicker
        value={value}
        onChange={onChange}
        ariaLabel={t('chat.dates.birthday_title')}
        disabled={disabled}
        className="mt-2"
      />
    </div>
  );
}

interface CompanionImportantDatesProps {
  open: boolean;
  visitorId: string;
}

export function CompanionImportantDates({ open, visitorId }: CompanionImportantDatesProps) {
  const t = useT();
  const apiError = useApiError();
  const [dates, setDates] = useState<ImportantDate[]>([]);
  const [birthday, setBirthday] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedVisitorId, setLoadedVisitorId] = useState<string | null>(null);
  const versionRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const savingRef = useRef(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!visitorId) return;
    const generation = ++generationRef.current;
    loadedRef.current = false;
    setLoadedVisitorId(null);
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/profile', { signal: AbortSignal.timeout(15_000) });
      const data = (await res.json()) as {
        profile?: { important_dates?: ImportantDate[] | null; birthday?: string | null; updated_at?: string };
        error?: string;
        /** `/api/profile` 的 409 判别字段（契约 §6.4.1）：同码两条文案只有它能分因。 */
        conflict?: 'read_then_save' | 'retry_later';
        /** `/api/profile` 的 500 判别字段（同 §6.4.1 形态）：`'brief'` ⇒ 短文案。 */
        detail?: string;
      };
      if (generation !== generationRef.current) return;
      if (!res.ok) {
        setError(apiError(data, {
          conflict: conflictOf(data.conflict),
          detail: detailOf(data.detail),
          fallback: t('chat.dates.load_failed'),
        }));
        return;
      }
      setDates(data.profile?.important_dates ?? []);
      setBirthday(data.profile?.birthday ?? extractBirthday(data.profile?.important_dates));
      versionRef.current = data.profile?.updated_at ?? null;
      setLoadedVisitorId(visitorId);
      loadedRef.current = true;
    } catch {
      if (generation === generationRef.current) setError(t('chat.dates.load_failed'));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [apiError, visitorId, t]);

  useEffect(() => {
    if (open) void load();
    return () => { generationRef.current += 1; loadedRef.current = false; };
  }, [open, load]);

  const persist = async (nextBirthday: string, nextDates: ImportantDate[]) => {
    if (!open || !loadedRef.current || loading || loadedVisitorId !== visitorId || savingRef.current) return false;
    const generation = generationRef.current;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await apiFetch('/api/profile', {
        signal: AbortSignal.timeout(15_000),
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birthday: nextBirthday,
          important_dates: buildImportantDatesPayload(nextBirthday, nextDates),
          profile_updated_at: versionRef.current,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        profile?: { updated_at?: string };
        conflict?: 'read_then_save' | 'retry_later';
        detail?: string;
      };
      if (generation !== generationRef.current) return false;
      if (!res.ok) {
        toast.error(apiError(data, {
          conflict: conflictOf(data.conflict),
          detail: detailOf(data.detail),
          fallback: t('chat.dates.save_failed'),
        }));
        if (res.status === 409) void load();
        return false;
      }
      setBirthday(nextBirthday);
      setDates(buildImportantDatesPayload(nextBirthday, nextDates));
      versionRef.current = data.profile?.updated_at ?? null;
      return true;
    } catch {
      toast.error(t('chat.dates.save_failed'));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /** 列表里不重复展示派生的生日条目（非规范的 birthday 条目仍需展示，见模块注释）。 */
  const visibleDates = visibleImportantDates(dates);

  return (
    <div className="flex flex-col gap-3">
      <MyBirthdayField
        value={birthday}
        disabled={saving || loading || !open || loadedVisitorId !== visitorId}
        onChange={(next) => {
          void persist(next, dates).then((ok) => {
            if (ok) toast.success(next ? t('chat.dates.saved_birthday') : t('chat.dates.cleared_birthday'));
          });
        }}
      />

      <ImportantDatesEditor
        value={visibleDates}
        disabled={saving || loading || !open || loadedVisitorId !== visitorId}
        onChange={(next) => {
          void persist(birthday, next).then((ok) => {
            if (ok) toast.success(t('chat.dates.saved'));
          });
        }}
      />

      {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {error && <button type="button" className="text-xs underline" onClick={() => void load()}>{t('chat.dates.reload')}</button>}
    </div>
  );
}
