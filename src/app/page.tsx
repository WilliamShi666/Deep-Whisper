'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { fetchEntryVisitor } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n-client';
import { usePaletteSurface } from '@/lib/palette-client';
import {
  ENTRY_TIMEOUT_MS,
  readCompanionHint,
  withTimeout,
  writeCompanionHint,
} from '@/lib/startup';

/**
 * 入口：根据访客状态分流到聊天页、开屏流程或落地页（/love）。
 *
 * 弱网优化（三处）：
 *   1. 冷启动只打一次访客接口 —— 由 `fetchEntryVisitor()` 承担：本地已有 id 时走
 *      apiFetch，本地没有 id 时裸发一次（让服务端先从 Cookie 认老身份），
 *      两条分支都只有一次请求，响应同时给出身份与分流依据。
 *   2. 整条链有超时兜底：超过 ENTRY_TIMEOUT_MS 就用**已知状态**分流（本地记录的
 *      「上次有没有伴侣」），而不是无条件跳捏人流程 —— 弱网下的老用户不该被丢进
 *      创建新角色的流程（审查 F-5）。
 *   3. 等待期间渲染的是目标页面的骨架（含品牌名），而不是一个孤零零的爱心 ——
 *      用户能看出「正在准备什么」，而不是「好像坏了」。
 *
 * 第三方登录失败会带着 #error=... 回到这里，必须转交登录页，不能被分流静默吞掉；
 * 该判断必须早于任何分流与超时逻辑。
 *
 * **本页不挂语言开关**（契约 §5.4 判据 5.4.1）：`/` 是 1–2 帧内就 `router.replace` 走的骨架屏，
 * 既没有 `palette-toggle`（这条也是既有不变量的一部分），也就没有「开关排在 palette-toggle
 * 左侧」的落点。语言在这两帧里由 `LocaleProvider` 的挂载后解析决定，骨架文案跟着它走即可；
 * 真正的语言选择入口在 `/onboarding` 与 `/login`（契约 §5.4 的挂载点 1）。
 */
export default function HomePage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const t = useT();
  const [entering, setEntering] = useState(false);
  /**
   * 访客档案里的风格偏好（`GET /api/visitor` 回包的整行访客里就有这一列）。
   * `usePaletteSurface` 的解析链是「访客档案 > localStorage > 页面默认」，
   * 所以这里是**第一优先级来源**；首帧仍然是页面默认（入口 = 梦幻玫瑰），
   * 档案只在挂载后的 effect 里参与解析 —— 服务端与首帧一致，无 hydration 抖动。
   *
   * 类型刻意写成 `string | null`（与 `VisitorDTO.palette` 同形）而不是
   * `PalettePreference`：库里的列是自由 varchar，页面**不做任何本地判断**，
   * 原值直通 `usePaletteSurface`，非法值由 `parsePalettePreference` 统一回落。
   */
  const [profilePalette, setProfilePalette] = useState<string | null>(null);
  const surface = usePaletteSurface('entry', profilePalette);

  useEffect(() => {
    if (status === 'loading' || status === 'error') return;

    if(status==='guest'){router.replace('/login');return;}

    let cancelled = false;
    (async () => {
      setEntering(true);
      // 超时/失败一律给出兜底去向（null 表示没能在预算内拿到结果）。
      const target = await withTimeout(
        (async () => {
          const data = await fetchEntryVisitor();
          // 回包里就带整行访客，顺手把风格偏好交给 usePaletteSurface（不再多发请求）。
          // 本页拿到结果后立刻 router.replace，所以这一档通常只在一两帧内生效；
          // 真正吃档案档的是 /onboarding?repick=1 与聊天页的 boot。
          if (!cancelled) setProfilePalette(data.visitor?.palette ?? null);
          const resolved = data.companion ? '/chat' : '/onboarding';
          // 记住这次的真实结果，供下次超时兜底使用。退出登录不清除：
          // 「这个浏览器上建过伴侣」与当前登录态无关，仍是更有用的先验。
          writeCompanionHint(window.localStorage, resolved === '/chat');
          return resolved;
        })(),
        ENTRY_TIMEOUT_MS,
        null,
      );
      if (cancelled) return;

      // 没能在预算内拿到结果 → 按已知状态分流：有伴侣回聊天页，否则进开屏流程。
      // 不再无条件跳 /onboarding：那会把弱网下的老用户丢进创建新角色的流程（F-5），
      // 也不再需要担心清空数据 —— 画像写入已是合并语义。
      let companionHint = false;
      try { companionHint = readCompanionHint(window.localStorage); } catch { /* best effort */ }
      router.replace(target ?? (companionHint ? '/chat' : '/onboarding'));
    })();

    return () => {
      cancelled = true;
    };
  }, [router, status]);

  if(status==='error')return <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6" role="alert"><p>{t('chat.boot.unreachable')}</p><button className="rounded-full border px-5 py-2" onClick={()=>void refresh()}>{t('chat.boot.retry')}</button></main>;

  return (
    <div data-surface={surface} className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div aria-hidden className={`${surface}-aurora pointer-events-none absolute inset-0`} />
      {/* 骨架屏：形状贴近捏人流程的首屏，让等待有内容可看 */}
      <div className="w-full max-w-lg" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-4 text-center">
          <Heart
            className="anim-heartbeat h-12 w-12 text-primary"
            fill="currentColor"
            strokeWidth={0}
            aria-hidden
          />
          <p className="font-serif text-2xl font-semibold tracking-wide">Deep Whisper</p>
          <p className="text-sm text-muted-foreground">
            {entering ? t('entry.splash.preparing') : t('entry.splash.entering')}
          </p>
        </div>

        <div className="mt-12 space-y-3" aria-hidden>
          <div className="h-4 w-2/5 animate-pulse rounded-full bg-muted" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-muted/70" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-muted/50" />
          <div className="h-11 w-3/4 animate-pulse rounded-xl bg-muted/40" />
        </div>
      </div>
    </div>
  );
}
