'use client';

import { writeCompanionHint } from '@/lib/startup';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CHARACTER_PRESETS, type AppearanceStyle, type CharacterPreset } from '@/lib/characters';
import { characterDisplayName } from '@/lib/character-display';
import { getCharacterAvatar } from '@/lib/character-appearance';
import { apiFetch, ensureVisitorIdentity, errorCopy } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiError, useLocale, useT } from '@/lib/i18n-client';
import type { Locale } from '@/lib/i18n/locale';
import { resolveEntryAccent, palettePersistMode, type PaletteValue } from '@/lib/palette';
import { usePaletteSurface, useResolvedPalette } from '@/lib/palette-client';
import { cn } from '@/lib/utils';
import { LocaleSwitch } from '@/components/locale-switch';
import { PaletteSwitch } from '@/components/palette-switch';
import { PaletteSurfaceProvider } from '@/components/palette-surface-context';
import { PersonaEnhancer } from '@/components/chat/persona-enhancer';
import { ImportantDatesEditor, MyBirthdayField } from '@/components/chat/companion-important-dates';
import {
  IMPORTANT_DATES_MERGE_MODE,
  buildImportantDatesPayload,
} from '@/lib/profile/important-dates';
import type { ImportantDate } from '@/lib/types';
import { OnboardingTimeZoneField } from '@/components/onboarding-time-zone-field';
import { readBrowserTimeZone } from '@/lib/time-zone-client';
import { isValidTimeZone } from '@/lib/memory/time-source';
import { DEFAULT_ONBOARDING_TIME_ZONE, initialOnboardingTimeZone, onboardingTimeZonePatch } from '@/lib/personal/onboarding-time-zone';

/**
 * `/onboarding` 的**客户端岛**（t53 从 `page.tsx` 逐字搬来；`page.tsx` 现在是服务端页面，
 * 负责按语言出 metadata —— 客户端组件不允许导出 `generateMetadata`）。
 *
 * 页内那层 `Suspense` 边界仍在（`useSearchParams` 要求），只是现在住在客户端岛里。
 */
/**
 * 开屏四步流程（欢迎 → 关于你 → 选角色 → 捏人）。
 *
 * ## 双语（U2 / t6）
 *
 * 全部用户可见文案走字典 `entry` area（标签 / placeholder / `aria-label` / 图片 `alt` / 按钮 /
 * 错误提示）。语言来自 `LocaleProvider`（`src/app/layout.tsx` 包住全站），本页**不自行判断**
 * 优先级（契约 §3.2.1）—— 首帧恒为服务端值 zh-CN，挂载后由 Provider 按
 * 「访客档案 > 设备镜像 > 默认」解析一次并写回镜像。
 *
 * 角色的名字与气质文案**不进字典**（契约 §2.5）：它们住在 `src/lib/characters.ts`（t3 的
 * `nameRoman` / `en.*`），并且只能经两个唯一入口取用（契约 §10.3）：
 *   - **双名场合**（角色卡的标题、捏人步的引导句）→ `characterDisplayName(preset, locale)`
 *     （zh `澜汐` / en `Lanxi · Marina`）；
 *   - **单串场合**（名字预填、写库的 `name`/`occupation`、图片 alt）→ `nameRoman`（en）/ `defaultName`（zh），
 *     由本文件的 `singleNameOf` 收口，别处不得各拼一遍。
 * 中文态下这两条链的取值与改造前逐字符一致（H1/H4）。
 */

type Step = 0 | 1 | 2 | 3 | 4;

/** 双名场合用的显示名（唯一入口，见 `src/lib/character-display.ts`）。 */
function displayNameOf(preset: CharacterPreset, locale: Locale): string {
  return characterDisplayName(preset, locale);
}

/**
 * 单串场合用的名字（契约 §10.3 第二行）：`en` 用拼音、`zh-CN` 用中文名。
 *
 * 用于名字输入框的预填值、`companions.name` 与图片 `alt` —— 这些都是**给数据或读屏用**的，
 * 不出现 `Lanxi · Marina` 那种双名写法。
 */
function singleNameOf(preset: CharacterPreset, locale: Locale): string {
  return locale === 'en' ? preset.nameRoman : preset.defaultName;
}

/**
 * 角色档案里**按语言取值**的文案字段：zh 读顶层中文字段（一字不改），en 读 t3 的英文档案。
 *
 * 四个字段都是**用户可见**的（角色卡 tagline/description/traits、捏人步预填的交流风格标签与性格），
 * 所以英文态必须读 `en.*` —— 否则英文界面会直接显示中文角色文案（H1/H2）。
 */
function characterCopy(preset: CharacterPreset, locale: Locale) {
  return locale === 'en'
    ? {
        tagline: preset.en.tagline,
        description: preset.en.description,
        traits: preset.en.traits,
        occupation: preset.en.occupation,
        persona: preset.en.persona,
      }
    : {
        tagline: preset.tagline,
        description: preset.description,
        traits: preset.traits,
        occupation: preset.occupation,
        persona: preset.persona,
      };
}

export function OnboardingClient() {
  /**
   * Suspense fallback 也属于「同一套表面」：开屏页是入口表面（默认梦幻玫瑰）。
   *
   * 这层 fallback 渲染在 `OnboardingInner` **之外**（为了 `useSearchParams` 而必须存在的
   * Suspense 边界），所以它自己取一次 surface —— 同一个页面归属、同一条解析链，且在它
   * 真正可见的那段时间里内层还没读到访客档案，所以两者取值一致。它唯一的作用是消除从
   * 聊天页进 repick 时先闪一下 `.dark` 暖褐底（研究 R4）。首帧恒等于页面默认，hydration 安全。
   */
  const surface = usePaletteSurface('entry');
  return (
    <Suspense
      fallback={
        <div data-surface={surface} className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useAuth();
  const { locale } = useLocale();
  const t = useT();
  const apiError = useApiError();
  /** 已登录用户无需再看「已有账号？直接登录」入口（点了会在 /login 与 /onboarding 间来回弹） */
  const isAuthed = status === 'authed';
  useEffect(() => { if (status === 'guest') router.replace('/login'); }, [status, router]);
  /** repick=1：从聊天页进来「重新遇见 TA」，跳过欢迎与性别步骤，直接选角色 */
  const repick = searchParams.get('repick') === '1';
  /** from=love：落地页的主按钮已经表达过「开始」，直接从「关于你」这一步起 */
  const fromLove = searchParams.get('from') === 'love';
  const [step, setStep] = useState<Step>(fromLove && !repick ? 1 : 0);
  /** repick 模式下需先拉取已有访客档案（取向），就绪前显示加载态 */
  const [repickReady, setRepickReady] = useState(!repick);
  /**
   * 访客档案里的风格偏好，同时也是**入口页开关写入的目标**（队长 2026-09-27：「复用它」）。
   * 三个写入者：
   *   1. repick 分支既有的 `GET /api/visitor` 回包（就是下面那次请求）里带整行访客，
   *      顺手取 `visitor.palette` —— **不为 palette 新增请求**；
   *   2. `PaletteSwitch` 的 `onChange`：`canPersistToProfile` 为真时走 server 档（写库 + 镜像），
   *      否则只写设备镜像（尚无档案行的访客 `PATCH /api/visitor` 必然 500）；
   *   3. 完整流程（非 repick）没有档案读取 → 初始 `null`，交给 localStorage / 页面默认。
   *
   * 类型刻意写成 `string | null`（与 `VisitorDTO.palette` 同形）：库里的列是自由 varchar，
   * 页面不做任何本地判断，原值直通共享解析链，非法值由 `parsePalettePreference` 统一回落。
   */
  const [profilePalette, setProfilePalette] = useState<string | null>(null);
  /**
   * 入口页开关该走哪一档持久化的**唯一判据**：档案行是否已确认存在（队长 2026-09-27 F1）。
   *
   * 只有 repick 分支的 `GET /api/visitor` 真的回传了 `visitor` 行时才置 true（由纯函数
   * `palettePersistMode` 判定，id 非空 ⇔ 行存在）：行存在 ⇒ `PATCH /api/visitor`
   * （`.update().eq('id',…).select().single()`）不会 0 行命中 ⇒ 写库安全；而且只有写库才能让
   * 入口页的选择**真正落到访客级**，不会在下次读到档案时被静默覆盖。
   * 普通开屏流程与 repick 加载态没有档案证据 → 保持 false（零请求零副作用）。
   *
   * 刻意不用「是否带 `?repick=1`」当信号：手动粘 URL 也带该参数，但未必有行。
   * **氛围与语言共用这一个判据**（契约 §5.3.1）：两处各写一份「行是否存在」的判断，
   * 正是它们会分叉的地方。
   */
  const [canPersistToProfile, setCanPersistToProfile] = useState(false);
  /**
   * 解析后的偏好（访客档案 > localStorage > 页面默认）：角色强调色按它派生。
   * 与 `usePaletteSurface` 同一条链（后者就是它的派生值），所以强调色与 `data-surface`
   * 在同一帧内不可能分叉 —— 只在设备上选过梦幻蓝的访客也不会拿到「蓝表面 + 玫瑰强调色」。
   */
  const palettePreference = useResolvedPalette('entry', profilePalette);
  /** repick 就绪前的加载态与主容器共用同一个 surface（第三个出口见外层 Suspense fallback）。 */
  const surface = usePaletteSurface('entry', profilePalette);

  // Step 1: 关于你
  const [gender, setGender] = useState<'male' | 'female' | 'other' | null>(null);
  const [orientation, setOrientation] = useState<'male' | 'female' | null>(null);

  // Step 2: 选角色
  const [character, setCharacter] = useState<CharacterPreset | null>(null);

  // Step 3: 捏人
  const [name, setName] = useState('');
  const [userTitle, setUserTitle] = useState('');
  const [occupation, setOccupation] = useState('');
  const [persona, setPersona] = useState('');
  const [appearanceStyle, setAppearanceStyle] = useState<AppearanceStyle>('chibi');
  /** 我的生日（user_profiles.birthday）与重要日期：创建时一并提交，无需进聊天后再补。 */
  const [birthday, setBirthday] = useState('');
  const [importantDates, setImportantDates] = useState<ImportantDate[]>([]);
  const [timeZone, setTimeZone] = useState(DEFAULT_ONBOARDING_TIME_ZONE);
  const [savedTimeZone, setSavedTimeZone] = useState(false);
  useEffect(() => { setTimeZone(initialOnboardingTimeZone(readBrowserTimeZone)); }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const creationRef = useRef<{ fingerprint: string; key: string; companionId?: string } | null>(null);
  const submittingRef = useRef(false);

  // repick 模式：拉取已有档案（性别/取向），直接进入选角色步骤
  useEffect(() => {
    if (!repick) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureVisitorIdentity();
        const res = await apiFetch('/api/visitor', { signal: AbortSignal.timeout(15_000) });
        // 技术性标记（不是文案）：这条例外只被下面的 catch 吞掉、从不上屏，所以按 `src/lib/i18n-client.tsx`
        // 的同款口径写成英文短句，而不是塞进字典（字典只承载用户可见文案，契约 §2.5）。
        // 注意：这里**不能**用 `t()` —— 那个 effect 的依赖是 `[repick]`，引入 t 会让切语言时重跑一次档案读取。
        if (!res.ok) throw new Error('profile read failed');
        const data = (await res.json()) as {
          visitor?: { id?: string; gender?: string | null; orientation?: string | null; palette?: string | null } | null;
        };
        const profileRes = await apiFetch('/api/profile', { signal: AbortSignal.timeout(15_000) });
        if (!profileRes.ok) throw new Error('profile read failed');
        const profileData = await profileRes.json() as { profile?: { timezone?: string | null } | null };
        if (!cancelled && profileData.profile?.timezone && isValidTimeZone(profileData.profile.timezone)) {
          setTimeZone(profileData.profile.timezone);
          setSavedTimeZone(true);
        }
        // 回包里的 visitor 行非空（id 非空）⇒ 档案行确实存在 ⇒ PATCH 不会 0 行命中 ⇒ 开关可以走
        // server 档，让选择真正落到访客级。行不存在（回包 null）⇒ 保持 local 档，零写入。
        if (!cancelled) {
          setCanPersistToProfile(palettePersistMode(data.visitor) === 'server');
          // 风格偏好与取向同一次回包带回来：档案是 palette 的第一优先级来源。
          setProfilePalette(data.visitor?.palette ?? null);
        }
        if (!cancelled && data.visitor?.orientation) {
          setGender((data.visitor.gender as 'male' | 'female' | 'other' | null) ?? 'other');
          setOrientation(data.visitor.orientation as 'male' | 'female');
          setStep(2);
        }
      } catch {
        // 拉取失败则回退为完整流程
      } finally {
        if (!cancelled) setRepickReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repick]);

  const candidates = useMemo(
    () => CHARACTER_PRESETS.filter((c) => !orientation || c.gender === orientation),
    [orientation],
  );

  /**
   * 选中角色：**按当前语言**预填名字 / 交流风格标签 / 性格。
   *
   * 这三条都是会写进库（`companions.name` / `occupation` / `persona`）且**随后被用户看见**的值，
   * 所以必须与界面语言一致（计划 §2 第 4 行「提示词语言 = 界面语言」；用户的英文界面里出现一段
   * 中文人设正是 H1/H2 要防的事）。语言切换发生在本步之后时不会回头改写已预填的文本 ——
   * 那是用户已开始编辑的字段，静默覆盖比留下旧语言更糟。
   */
  const pickCharacter = (c: CharacterPreset) => {
    const copy = characterCopy(c, locale);
    setCharacter(c);
    setName(singleNameOf(c, locale));
    setOccupation(copy.occupation);
    setPersona(copy.persona);
    setAppearanceStyle('chibi');
    setStep(3);
  };

  const start = async () => {
    if (!character || !gender || !orientation || submittingRef.current) return;
    if ((!repick || !savedTimeZone) && !isValidTimeZone(timeZone.trim())) { setError(t('entry.onboarding.timezone.invalid')); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    const copy = characterCopy(character, locale);
    try {
      // 0. 确认访客身份（localStorage 持久化，避免 cookie 被拦截导致身份丢失）
      const visitorId = await ensureVisitorIdentity();
      const companionPayload = {
        character_key: character.key,
        name: name.trim() || singleNameOf(character, locale),
        persona: persona.trim() || undefined,
        occupation: occupation.trim() || copy.occupation,
        user_title: userTitle.trim() || undefined,
        appearance_style: appearanceStyle,
      };
      const fingerprint = JSON.stringify([visitorId, companionPayload]);
      const attemptStorageKey = `dw:onboarding:${visitorId}`;
      if (!creationRef.current) {
        try {
          const saved = JSON.parse(window.sessionStorage.getItem(attemptStorageKey) ?? 'null') as {
            fingerprint?: string; key?: string; companionId?: string;
          } | null;
          if (saved?.fingerprint === fingerprint && typeof saved.key === 'string'
            && /^[0-9a-f-]{36}$/i.test(saved.key)) {
            creationRef.current = { fingerprint, key: saved.key,
              ...(typeof saved.companionId === 'string' ? { companionId: saved.companionId } : {}) };
          }
        } catch { /* optional retry recovery */ }
      }
      if (creationRef.current?.fingerprint !== fingerprint) {
        creationRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      const creation = creationRef.current!;
      const saveAttempt = () => {
        try { window.sessionStorage.setItem(attemptStorageKey, JSON.stringify(creation)); } catch { /* in-memory retry still works */ }
      };
      saveAttempt();
      const signal = AbortSignal.timeout(60_000);

      // 1. 保存访客档案
      const visitorRes = await apiFetch('/api/visitor', {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gender, orientation }),
      });
      if (!visitorRes.ok) throw new Error(t('entry.onboarding.error.profile_save'));

      // 2. 生日与重要日期（可选）。必须排在访客档案之后：
      //    PUT /api/profile 依赖 getVisitorId()，访客不存在时它会 401。
      //
      //    这个编辑器**从空列表起步**，用户在这里只是「补充」。所以必须用
      //    important_dates_mode='merge'：PUT 对 important_dates 的缺省语义是整列
      //    替换，走「重新遇见 TA」的老用户在这里只填一次生日，就会把此前保存的
      //    纪念日、考试全部静默清空（审查 F-1）。
      //
      //    生日同理：只有真的填了才提交 birthday，空值表示「不改」而不是「清除」。
      //    提交空串会被服务端写成 null，把用户已有的生日删掉。
      const currentProfileRes = await apiFetch('/api/profile', { signal });
      if (!currentProfileRes.ok) throw new Error(t('entry.onboarding.error.dates_save'));
      const currentProfile = await currentProfileRes.json() as { profile: { timezone?: string | null; updated_at: string } | null };
      const timeZonePatch = onboardingTimeZonePatch({ repick, timeZone, profile: currentProfile.profile });
      if (timeZonePatch.timezone || birthday || importantDates.length > 0) {
        const profileRes = await apiFetch('/api/profile', {
          signal,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(birthday ? { birthday } : {}),
            ...timeZonePatch,
            important_dates: buildImportantDatesPayload(birthday, importantDates),
            important_dates_mode: IMPORTANT_DATES_MERGE_MODE,
          }),
        });
        if (!profileRes.ok) throw new Error(t('entry.onboarding.error.dates_save'));
      }

      // 3. 捏人
      if (!creation.companionId) {
        const companionRes = await apiFetch('/api/companions', {
          signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...companionPayload, creation_id: creation.key }),
        });
        const companionData = (await companionRes.json()) as {
          companion?: { id: string };
          error?: string;
        };
        if (!companionRes.ok || !companionData.companion) {
          throw new Error(apiError(companionData, { fallback: t('entry.onboarding.error.companion_create') }));
        }
        creation.companionId = companionData.companion.id;
        saveAttempt();
      }

      // 4. 创建首个会话
      const convRes = await apiFetch('/api/conversations', {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companion_id: creation.companionId, creation_id: creation.key }),
      });
      if (!convRes.ok) throw new Error(t('entry.onboarding.error.conversation_create'));
      try { window.sessionStorage.removeItem(attemptStorageKey); } catch { /* optional recovery */ }

      // 本机记下「已经有 TA」：落地页据此把主按钮换成「回到 TA 身边」。
      try { writeCompanionHint(window.localStorage, true); } catch { /* 存储被禁用：只是少一个提示 */ }
      router.replace('/chat');
    } catch (e) {
      setError(errorCopy(e, t, t('entry.onboarding.error.generic')));
      setSubmitting(false);
    } finally {
      submittingRef.current = false;
    }
  };

  if (!repickReady) {
    return (
      <div data-surface={surface} className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        {/* 语言开关（契约 §5.4 挂载点 1）：本出口与主容器是同一处挂载的两个分支，同一时刻只出一个。
            档案行还没确认 ⇒ local 档（零写入），确认后这里会自然切到 server 档。 */}
        <LocaleSwitch
          className="fixed right-12 top-4 z-20"
          value={locale}
          persist={canPersistToProfile ? 'server' : 'local'}
        />
        {/* 氛围圆圈（契约 t30）：视口右上角一颗圆点，零可见文字；档位与语言开关同一个判据。 */}
        <PaletteSwitch
          className="fixed right-4 top-4 z-20"
          value={palettePreference}
          persist={canPersistToProfile ? 'server' : 'local'}
          onChange={setProfilePalette}
        />
      </div>
    );
  }

  return (
    <div data-surface={surface} className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div aria-hidden className={`${surface}-aurora pointer-events-none absolute inset-0`} />
      {/* 氛围光斑 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--primary), transparent 70%)' }}
      />

      {/* 语言开关（契约 §5.4 挂载点 1）：与氛围圆圈**同排**、排在它**左侧**；
          两者是兄弟节点而不是包裹关系 —— `palette-toggle` 的渲染点与计数都不变（契约 §5.5）。 */}
      <LocaleSwitch
        className="fixed right-12 top-4 z-20"
        value={locale}
        persist={canPersistToProfile ? 'server' : 'local'}
      />

      {/* 氛围圆圈（契约 t30）：**视口右上角**一颗圆点，零可见文字、不引入任何文案，也不占内容列宽。
          `value` 传解析后的氛围（`useResolvedPalette('entry', …)`），所以圆圈显示当前那一边、
          点一下切到另一边；档位由 `canPersistToProfile` 派生（档案行已确认存在 → server）。 */}
      <PaletteSwitch
        className="fixed right-4 top-4 z-20"
        value={palettePreference}
        persist={canPersistToProfile ? 'server' : 'local'}
        onChange={setProfilePalette}
      />

      {/* 顶部进度 */}
      {step > 0 && step < 4 && (
        <div className="relative z-10 mx-auto flex w-full max-w-lg items-center gap-3 px-6 pt-8">
          <button
            onClick={() => {
              if (repick && step <= 2) {
                router.push('/chat');
                return;
              }
              setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
            }}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('entry.onboarding.back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-1 gap-1.5">
            {(repick ? [2, 3] : [1, 2, 3]).map((i) => (
              <div
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-500',
                  step >= i ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col px-6 pb-10">
        {step === 0 && <WelcomeStep onNext={() => setStep(1)} isAuthed={isAuthed} />}

        {step === 1 && (
          <AboutYouStep
            gender={gender}
            orientation={orientation}
            onGender={setGender}
            onOrientation={setOrientation}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <CharacterStep
            candidates={candidates}
            palettePreference={palettePreference}
            onPick={pickCharacter}
          />
        )}

        {step === 3 && character && (
          /*
            ── 本页面向 **portal 浮层** 的唯一表面出口（用户 2026-09-27 裁决①：
               「跟页面同族 —— 玫瑰页面里的日历也是玫瑰」）

            捏人步里的日期选择器是 Popover，会被 **portal 到 `document.body`**，从而脱离本页根容器
            那枚 `data-surface` 的子树；不给表面它会退回 context 缺省值（蓝族），于是在玫瑰底的
            开屏页上弹出蓝色深色日历（t66 F1 真机实测：页面根 `dream-rose` / 弹层 `dream-blue`）。
            这里的值**必须与页面根 `data-surface` 同源同值** —— 就是同一个 `surface` 变量，
            不另起推导、不写字面量；本页**将来新增任何 portal 浮层，都必须落在这一层之下**。
          */
          <PaletteSurfaceProvider surface={surface}>
            <CustomizeStep
              palettePreference={palettePreference}
              character={character}
              name={name}
              userTitle={userTitle}
              occupation={occupation}
              persona={persona}
              appearanceStyle={appearanceStyle}
              birthday={birthday}
              importantDates={importantDates}
              timeZone={timeZone}
              confirmTimeZone={!repick || !savedTimeZone}
              onName={setName}
              onUserTitle={setUserTitle}
              onOccupation={setOccupation}
              onPersona={setPersona}
              onAppearanceStyle={setAppearanceStyle}
              onBirthday={setBirthday}
              onImportantDates={setImportantDates}
              onTimeZone={setTimeZone}
              onSubmit={start}
              submitting={submitting}
              error={error}
            />
          </PaletteSurfaceProvider>
        )}
      </main>
    </div>
  );
}

/* ---------- Step 0: 欢迎页 ---------- */
function WelcomeStep({ onNext, isAuthed }: { onNext: () => void; isAuthed: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="anim-fade-in-up">
        <BrandLogo priority decorative className="anim-heartbeat mx-auto size-28" />
      </div>
      <h1
        className="anim-fade-in-up mt-8 font-serif text-4xl font-semibold tracking-wide"
        style={{ animationDelay: '0.15s' }}
      >
        Deep Whisper
      </h1>
      <p
        className="anim-fade-in-up mt-4 text-base leading-relaxed text-muted-foreground"
        style={{ animationDelay: '0.3s' }}
      >
        {t('entry.onboarding.welcome.headline')}
        <br />
        {t('entry.onboarding.welcome.subline')}
      </p>
      <Button
        size="lg"
        onClick={onNext}
        className="anim-fade-in-up mt-10 rounded-full px-10 text-base"
        style={{ animationDelay: '0.45s' }}
      >
        {t('entry.onboarding.welcome.cta')}
        <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
      {!isAuthed && (
        <p
          className="anim-fade-in-up mt-6 text-sm text-muted-foreground"
          style={{ animationDelay: '0.6s' }}
        >
          {t('entry.onboarding.welcome.login_prompt')}
          <Link
            href="/login"
            className="ml-1 text-primary underline-offset-4 transition-colors hover:underline"
          >
            {t('entry.onboarding.welcome.login_link')}
          </Link>
        </p>
      )}
    </div>
  );
}

/* ---------- Step 1: 关于你 ---------- */
function AboutYouStep({
  gender,
  orientation,
  onGender,
  onOrientation,
  onNext,
}: {
  gender: string | null;
  orientation: string | null;
  onGender: (g: 'male' | 'female' | 'other') => void;
  onOrientation: (o: 'male' | 'female') => void;
  onNext: () => void;
}) {
  const t = useT();
  /** 选项的取值是**数据**（写库的 `gender`/`orientation`），标签才是文案 —— 标签永不参与判断。 */
  const genderOptions: ReadonlyArray<{ value: 'male' | 'female' | 'other'; label: string }> = [
    { value: 'male', label: t('entry.onboarding.about.gender_male') },
    { value: 'female', label: t('entry.onboarding.about.gender_female') },
    { value: 'other', label: t('entry.onboarding.about.gender_other') },
  ];
  const orientationOptions: ReadonlyArray<{ value: 'male' | 'female'; label: string }> = [
    { value: 'female', label: t('entry.onboarding.about.orientation_female') },
    { value: 'male', label: t('entry.onboarding.about.orientation_male') },
  ];

  return (
    <div className="anim-fade-in-up flex flex-1 flex-col pt-10">
      <h2 className="font-serif text-2xl font-semibold">{t('entry.onboarding.about.title')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('entry.onboarding.about.subtitle')}</p>

      <div className="mt-10">
        <p className="text-sm font-medium text-foreground/80">{t('entry.onboarding.about.gender_label')}</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {genderOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => onGender(o.value)}
              className={cn(
                'rounded-xl border px-4 py-3.5 text-sm transition-all duration-300',
                gender === o.value
                  ? 'border-primary bg-primary/15 text-foreground shadow-sm'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium text-foreground/80">
          {t('entry.onboarding.about.orientation_label')}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {orientationOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => onOrientation(o.value)}
              className={cn(
                'rounded-xl border px-4 py-3.5 text-sm transition-all duration-300',
                orientation === o.value
                  ? 'border-primary bg-primary/15 text-foreground shadow-sm'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-10">
        <Button
          size="lg"
          className="w-full rounded-full"
          disabled={!gender || !orientation}
          onClick={onNext}
        >
          {t('entry.onboarding.next')}
        </Button>
      </div>
    </div>
  );
}

/* ---------- Step 2: 选角色 ---------- */
function CharacterStep({
  candidates,
  palettePreference,
  onPick,
}: {
  candidates: CharacterPreset[];
  /** 解析后的风格偏好：tagline 的颜色按当前表面派生（玫瑰表面不出现蓝字）。 */
  palettePreference: PaletteValue;
  onPick: (c: CharacterPreset) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="anim-fade-in-up flex flex-1 flex-col pt-10">
      <h2 className="font-serif text-2xl font-semibold">{t('entry.onboarding.character.title')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('entry.onboarding.character.subtitle')}</p>

      <div className="mt-8 flex flex-col gap-4 overflow-y-auto pb-4">
        {candidates.map((c, i) => {
          const copy = characterCopy(c, locale);
          const singleName = singleNameOf(c, locale);
          return (
            <button
              key={c.key}
              onClick={() => onPick(c)}
              className="group anim-fade-in-up relative overflow-hidden rounded-2xl border border-border bg-card text-left transition-all duration-300 hover:border-primary/50 hover:shadow-lg"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <div className="flex gap-4 p-4">
                                <div className="grid h-24 w-24 shrink-0 grid-cols-2 gap-1 overflow-hidden rounded-xl bg-muted/60">
                                    <Image width={48} height={96} sizes="48px" src={c.appearanceAssets.chibi.avatar} alt={`${singleName} ${t('entry.onboarding.character.alt_chibi')}`} className="h-24 w-full object-contain object-top" />
                                    <Image width={48} height={96} sizes="48px" src={c.appearanceAssets.normal.avatar} alt={`${singleName} ${t('entry.onboarding.character.alt_normal')}`} className="h-24 w-full object-contain object-top" />
                </div>
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-serif text-lg font-semibold">{displayNameOf(c, locale)}</h3>
                    <span className="text-xs text-muted-foreground">
                      DeepSeek AI
                    </span>
                  </div>
                  <p
                    className="mt-1 line-clamp-1 text-xs font-medium"
                    style={{ color: resolveEntryAccent(c.theme, palettePreference) }}
                  >
                    {copy.tagline}
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {copy.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {copy.traits.slice(0, 3).map((trait) => (
                      <span
                        key={trait}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Step 3: 捏人 ---------- */
function CustomizeStep({
  character,
  palettePreference,
  name,
  userTitle,
  occupation,
  persona,
  appearanceStyle,
  birthday,
  importantDates,
  timeZone,
  confirmTimeZone,
  onName,
  onUserTitle,
  onOccupation,
  onPersona,
  onAppearanceStyle,
  onBirthday,
  onImportantDates,
  onTimeZone,
  onSubmit,
  submitting,
  error,
}: {
  character: CharacterPreset;
  /** 解析后的风格偏好：头像描边按当前表面派生（玫瑰表面不出现蓝描边）。 */
  palettePreference: PaletteValue;
  name: string;
  userTitle: string;
  occupation: string;
  persona: string;
  appearanceStyle: AppearanceStyle;
  birthday: string;
  importantDates: ImportantDate[];
  timeZone: string;
  confirmTimeZone: boolean;
  onName: (v: string) => void;
  onUserTitle: (v: string) => void;
  onOccupation: (v: string) => void;
  onPersona: (value: string) => void;
  onAppearanceStyle: (value: AppearanceStyle) => void;
  onBirthday: (value: string) => void;
  onImportantDates: (value: ImportantDate[]) => void;
  onTimeZone: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="anim-fade-in-up flex flex-1 flex-col pt-8">
      <div className="flex items-center gap-4">
                <Image width={64} height={64} sizes="64px"
          src={getCharacterAvatar(character.key, appearanceStyle) ?? character.avatar}
          alt={singleNameOf(character, locale)}
          className="h-16 w-16 rounded-full border-2 object-cover object-top"
          style={{ borderColor: resolveEntryAccent(character.theme, palettePreference) }}
        />
        <div>
          <h2 className="font-serif text-2xl font-semibold">{t('entry.onboarding.customize.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('entry.onboarding.customize.intro', { name: displayNameOf(character, locale) })}
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-5 overflow-y-auto pb-4">
        <div>
          <label htmlFor="onboarding-companion-name" className="text-sm font-medium text-foreground/80">
            {t('entry.onboarding.customize.name_label')}
          </label>
          <Input
            id="onboarding-companion-name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            maxLength={12}
            className="mt-2"
            placeholder={singleNameOf(character, locale)}
          />
        </div>

        <div>
          <label htmlFor="onboarding-user-title" className="text-sm font-medium text-foreground/80">
            {t('entry.onboarding.customize.user_title_label')}
          </label>
          <Input
            id="onboarding-user-title"
            value={userTitle}
            onChange={(e) => onUserTitle(e.target.value)}
            maxLength={12}
            className="mt-2"
            placeholder={t('entry.onboarding.customize.user_title_placeholder')}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">{t('entry.onboarding.customize.user_title_hint')}</p>
        </div>

        <div>
          <label htmlFor="onboarding-occupation" className="text-sm font-medium text-foreground/80">
            {t('entry.onboarding.customize.occupation_label')}
          </label>
          <Input
            id="onboarding-occupation"
            value={occupation}
            onChange={(e) => onOccupation(e.target.value)}
            maxLength={16}
            className="mt-2"
            placeholder={t('entry.onboarding.customize.occupation_placeholder')}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-foreground/80">{t('entry.onboarding.style.label')}</label>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(['chibi', 'normal'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => onAppearanceStyle(style)}
                className={cn(
                  'rounded-xl border p-2 text-left transition-all',
                  appearanceStyle === style
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40',
                )}
                aria-pressed={appearanceStyle === style}
              >
                                <Image width={160} height={112} sizes="(max-width: 640px) 40vw, 160px" src={getCharacterAvatar(character.key, style) ?? ''} alt={style === 'chibi' ? t('entry.onboarding.style.chibi_preview_alt') : t('entry.onboarding.style.normal_preview_alt')} className="h-28 w-full rounded-lg bg-muted/60 object-contain object-top" />
                <span className="mt-1.5 block text-xs font-medium">
                  {style === 'chibi' ? t('entry.onboarding.style.chibi') : t('entry.onboarding.style.normal')}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="onboarding-persona" className="text-sm font-medium text-foreground/80">
            {t('entry.onboarding.customize.persona_label')}
          </label>
          <Textarea id="onboarding-persona" value={persona} onChange={(event) => onPersona(event.target.value)} maxLength={600} rows={5} className="mt-2" />
          <div className="mt-1 text-right text-[11px] text-muted-foreground">{persona.length}/600</div>
          <PersonaEnhancer value={persona} onAdopt={onPersona} />
          <p className="mt-2 text-xs text-muted-foreground">{t('entry.onboarding.customize.voice_note')}</p>
        </div>

        {/*
          生日与重要日期：创建角色时就能填，不必先进入聊天再补。
          这里用的是纯受控编辑器（不发请求）——此刻访客档案还没建立，
          直接调 /api/profile 会 401。真正的写入在 start() 里与捏人同批提交。
        */}
        {confirmTimeZone && <OnboardingTimeZoneField value={timeZone} onChange={onTimeZone} disabled={submitting} />}
        <MyBirthdayField value={birthday} onChange={onBirthday} disabled={submitting} />
        <ImportantDatesEditor value={importantDates} onChange={onImportantDates} disabled={submitting} />
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-auto pt-6">
        <Button
          size="lg"
          className="w-full rounded-full"
          disabled={!name.trim() || submitting || (confirmTimeZone && !isValidTimeZone(timeZone.trim()))}
          onClick={onSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('entry.onboarding.customize.submitting')}
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {t('entry.onboarding.customize.submit')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
