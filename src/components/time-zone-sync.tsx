'use client';

import { useEffect } from 'react';

import { clearSyncedTimeZone, persistBrowserTimeZoneOnce } from '@/lib/time-zone-client';
import { ensureVisitorIdentity, VISITOR_IDENTITY_EVENT } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * 浏览器时区采集的**瘦客户端壳**（第五轮 U6）。
 *
 * 只做一件事：挂载后跑一次 `persistBrowserTimeZoneOnce()`。所有判断（记忆命中、档案是否为空或
 * 非法、是否要写库）都在 `src/lib/time-zone-client.ts` 里，**组件里一行判断逻辑都不放**。
 *
 * 挂载点是 `src/app/chat/page.tsx`（服务端组件）—— 语义上就是「聊天 boot 后」；刻意不放进
 * `chat-shell.tsx`（那是 t38 的热点文件，跨任务并发写它会让判据归属说不清）。
 *
 * 副作用定义：该调用永不抛（失败只记日志），所以 `void` 掉它不会产生未处理的 rejection。
 */
export function TimeZoneSync(): null {
  const { status, user } = useAuth();
  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    const sync = () => {
      void ensureVisitorIdentity().then(() => {
        if (!cancelled) return persistBrowserTimeZoneOnce();
      }).catch((error: unknown) => {
        // 头注释的不变量：「永不抛、失败**只记日志**」——这句必须真的兑现（t63）。
        // 原先这里是 `.catch(() => undefined)`：既不上屏也不记日志，等于把业务失败静默吞掉，
        // 与注释直接矛盾。日志文案保持 ASCII（覆盖门禁会拦中文字面量）。
        console.warn('[timezone-sync] visitor identity probe failed; skipped this time-zone sync', error);
      });
    };
    const identityChanged = () => { clearSyncedTimeZone(); sync(); };
    window.addEventListener(VISITOR_IDENTITY_EVENT, identityChanged);
    sync();
    return () => { cancelled = true; window.removeEventListener(VISITOR_IDENTITY_EVENT, identityChanged); };
  }, [status, user?.id]);

  return null;
}
