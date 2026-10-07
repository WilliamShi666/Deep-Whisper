/**
 * 拍照结果的落库状态（2026-10-01，修「照片没发出去，TA 却说照片我还留着」）。
 *
 * TA 那句「等我一下，就拍一张」是一条普通文字消息；生图成败原先只在成功时才留下痕迹，
 * 失败什么都不写，下一轮模型只看到自己的承诺、后面没有照片，就以为发出去了。
 * 现在每次拍照都落一条消息：开始前 `photo_pending`，成功改成 `image`，失败改成 `photo_failed`。
 * `messages.content_type` 是 varchar(16) 且没有 CHECK，新值不需要迁移。
 *
 * 纯函数、零 IO：路由、历史组装和界面都只从这里取口径。
 */

export const PHOTO_PENDING = 'photo_pending';
export const PHOTO_FAILED = 'photo_failed';

/** 超过这个时间还停在 pending，说明函数中途超时 / 进程被杀，catch 根本没跑到：按失败处理。 */
export const PHOTO_PENDING_STALE_MS = 5 * 60 * 1000;

export const PHOTO_FAILED_USER_COPY = '这张照片没能发出来';

/**
 * 生成前提示词扫描未通过时的用户可见文案（2026-10-02）。
 *
 * 为什么要和 `PHOTO_FAILED_USER_COPY` 分开：那句是「技术故障，再试一次」的口径。
 * 提示词被安全扫描拦下时再让用户「再要一次」，既无用又误导 —— 用户会以为是网络问题，
 * 反复重试同一句仍然失败。这里的文案只说「这个内容不合规」，不点名词库、不回显命中的类别
 * （回显命中类别等于教用户怎么绕过），也不暗示是用户的错。
 *
 * 「待人工审核」单独一句：它不是拒绝，而是需要等待（上游通常 1 小时内出结果）。
 */
export const PHOTO_SCAN_BLOCKED_USER_COPY = '这个要求不太合适，换个场景再试试？';
export const PHOTO_SCAN_REVIEW_USER_COPY = '这张照片需要再确认一下，稍后再试或换个场景？';

/** Only application-owned safe reasons may be shown from persisted state. */
export function photoFailureUserCopy(content: string | null | undefined): string {
  return content === PHOTO_SCAN_BLOCKED_USER_COPY || content === PHOTO_SCAN_REVIEW_USER_COPY
    ? content : PHOTO_FAILED_USER_COPY;
}


/** 跨会话「近期片段」里的写法：短，一句话交代清楚。 */
export const PHOTO_FAILED_EPISODE_NOTE = '（你答应发的一张照片没能发出去，对方没收到）';

const FAILED_NOTE =
  '（你上一条答应发的照片没有发出去，对方没有收到。不要说照片已经发了，也不要说还留着；可以自然地道个歉，或者问问要不要再拍一张。）';
const PENDING_NOTE = '（你答应发的照片还在生成中，对方暂时没有收到。）';

export function isPhotoStatusType(contentType: string | null | undefined): boolean {
  return contentType === PHOTO_PENDING || contentType === PHOTO_FAILED;
}

/** pending 是否已经「卡死」：按失败处理。 */
export function isPhotoPendingStale(createdAt: string | null | undefined, now: Date): boolean {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  return !Number.isFinite(created) || now.getTime() - created > PHOTO_PENDING_STALE_MS;
}

/** 这条拍照消息实际上是不是失败（显式失败，或 pending 卡死）。 */
export function isPhotoFailure(
  contentType: string | null | undefined,
  createdAt: string | null | undefined,
  now: Date,
): boolean {
  if (contentType === PHOTO_FAILED) return true;
  return contentType === PHOTO_PENDING && isPhotoPendingStale(createdAt, now);
}

/**
 * 给模型看的那一句：失败 → 明确告诉 TA 没发出去；进行中 → 告诉 TA 还没送达；
 * 其余类型返回 null，由调用方按原有口径处理。
 */
export function photoNoteForModel(
  contentType: string | null | undefined,
  createdAt: string | null | undefined,
  now: Date,
): string | null {
  if (!isPhotoStatusType(contentType)) return null;
  return isPhotoFailure(contentType, createdAt, now) ? FAILED_NOTE : PENDING_NOTE;
}
