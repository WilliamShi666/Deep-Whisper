import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shouldPersistTimeZone } from '../src/lib/time-zone-client';

/**
 * 时区采集（第五轮 U6 / 契约 t25 的姊妹任务 t39）：
 * 仅在档案 `user_profiles.timezone` 为空或非法时，把**浏览器真实时区**写一次。
 *
 * 判据来源：`docs/specs/2026-09-27-chat-layout-dots-and-voice-upsell.md` §4.10 判据 3/5。
 *
 * 本文件零 mock、零 DOM：决策落在纯函数 `shouldPersistTimeZone` 上，其余是源码契约断言
 * （先 `stripComments` 再扫，照本项目 spec-test 传统）。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const TIME_ZONE_CLIENT = 'src/lib/time-zone-client.ts';
const PROFILE_ROUTE = 'src/app/api/profile/route.ts';

// ── §4.10 判据 3：纯函数真值表 ──

test('shouldPersistTimeZone: 只有「档案空或非法」且「浏览器值合法」才写', () => {
  const BROWSER = 'Europe/Berlin';

  // 档案为空（null / undefined / 空串 / 纯空白）→ 需要写一次
  for (const emptyProfile of [null, undefined, '', '   ']) {
    assert.equal(
      shouldPersistTimeZone(emptyProfile, BROWSER),
      true,
      `档案为 ${JSON.stringify(emptyProfile)} 时应当写一次`,
    );
  }

  // 档案是非法时区 → 也应当写（它现在只会被 resolveUserTimeZone 回退掉，等于没设置）
  for (const invalidProfile of ['Not/AZone', 'garbage', 'Asia/Shanghai; DROP', '9999']) {
    assert.equal(
      shouldPersistTimeZone(invalidProfile, BROWSER),
      true,
      `档案值 ${JSON.stringify(invalidProfile)} 非法时应当写一次`,
    );
  }

  // 档案已是**合法显式值** → 不覆盖（包括带空白与大小写不同的合法写法）
  for (const validProfile of ['America/New_York', '  Asia/Tokyo  ', 'UTC', 'Europe/Paris']) {
    assert.equal(
      shouldPersistTimeZone(validProfile, BROWSER),
      false,
      `档案值 ${JSON.stringify(validProfile)} 合法时不得覆盖`,
    );
  }

  // 浏览器值非法 / 缺失 → 一律不写（宁可不写，也不写脏值）
  for (const badBrowser of ['Not/AZone', '', '   ', null, undefined, 0, 123, true, {}, []]) {
    assert.equal(
      shouldPersistTimeZone(null, badBrowser),
      false,
      `浏览器值 ${JSON.stringify(badBrowser)} 非法时不得写`,
    );
    assert.equal(
      shouldPersistTimeZone('Not/AZone', badBrowser),
      false,
      `档案非法 + 浏览器非法时也不得写（${JSON.stringify(badBrowser)}）`,
    );
  }
});

test('shouldPersistTimeZone 是纯函数：同样的输入永远给同样的答案，且不抛', () => {
  for (const [profile, browser] of [
    [null, 'Asia/Shanghai'],
    ['Not/AZone', 'Asia/Shanghai'],
    ['Asia/Shanghai', 'Europe/Berlin'],
    [{ timezone: 'Asia/Tokyo' }, 'Europe/Berlin'],
    [[], 'Europe/Berlin'],
  ] as Array<[unknown, unknown]>) {
    assert.doesNotThrow(() => shouldPersistTimeZone(profile, browser));
    assert.equal(shouldPersistTimeZone(profile, browser), shouldPersistTimeZone(profile, browser));
  }
  // 非字符串、又非 null/undefined 的档案值（例如误传了整行对象）视为「不可判定」→ 不写：
  // 「不覆盖用户显式值」优先于「尽量补一个值」，宁可少写一次也不要把用户设的时区冲掉。
  assert.equal(shouldPersistTimeZone({ timezone: 'Asia/Tokyo' }, 'Europe/Berlin'), false);
  assert.equal(shouldPersistTimeZone([], 'Europe/Berlin'), false);
  assert.equal(shouldPersistTimeZone(0, 'Europe/Berlin'), false);
});

// ── §4.10 判据 3/5：写库侧的形状（不抛、被判定包住、只发 PUT） ──

test('the browser time zone is written once, behind the guard, and never throws', () => {
  const source = stripComments(read(TIME_ZONE_CLIENT));

  // 决策必须来自纯函数（不允许在客户端模块里另写一套等价的隐式判断）
  assert.match(source, /export function shouldPersistTimeZone\(/);
  assert.match(source, /if \(!shouldPersistTimeZone\(/);

  // 唯一写库调用：PATCH/PUT /api/profile + body 里带 timezone
  assert.match(source, /apiFetch\(\s*'\/api\/profile'/);
  assert.match(source, /method: 'PUT'/);
  assert.match(source, /JSON\.stringify\(\{\s*timezone/);

  // 浏览器时区取自 Intl（真实时区，不是偏移猜测）
  assert.match(source, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);

  // 失败不得抛出：要么整块 try/catch，要么不 rethrow；模块内不得出现裸 throw
  assert.match(source, /try \{[\s\S]*?\} catch \(/);
  assert.doesNotMatch(source, /\bthrow\b/, '采集失败只允许记日志，不得把错误抛到调用方');

  // 不得在 import 期产生副作用（必须在被显式调用时才跑）
  assert.doesNotMatch(source, /^persistBrowserTimeZone/m);
  assert.doesNotMatch(source, /^void persistBrowserTimeZone/m);

  // SSR 安全：没有 window 时给 null，不抛
  assert.match(source, /typeof window === 'undefined'/);
});

test('稳态 boot 零请求：按身份去重，确认写入后才保存同步标记', () => {
  const source = stripComments(read(TIME_ZONE_CLIENT));

  // 记忆 = 设备级 key，存「上一次已确认过的浏览器时区值」。
  assert.match(source, /export const TIME_ZONE_SYNC_STORAGE_KEY = 'vl_tz_synced';/);
  assert.match(source, /export function readSyncedTimeZone\(/);
  assert.match(source, /export function writeSyncedTimeZone\(/);
  assert.match(source, /export function clearSyncedTimeZone\(/);

  // 「记忆命中 → 零请求」的可判定形态：命中分支必须在**第一次 apiFetch 之前**就返回。
  const memoryHit = source.indexOf("if (readSyncedTimeZone(visitorId) === browserTimeZone) return 'already-synced';");
  const firstRequest = source.indexOf('apiFetch(');
  assert.ok(memoryHit >= 0, '必须有「记忆命中」的短路分支');
  assert.ok(firstRequest > memoryHit, '记忆命中必须在发第一个请求之前返回（否则每次 boot 都会发 GET）');

  // Deduplication is scoped to visitor and identity generation.
  assert.match(source, /const inFlight = new Map<string, Promise<TimeZoneSyncOutcome>>\(\);/);
  assert.match(source, /const key = `\$\{visitorId\}:\$\{generation\}`/);
  assert.match(source, /if \(pending\) return pending;/);
  assert.match(source, /inFlight.set\(key, value\)/);
  const putCall = source.indexOf("method: 'PUT'");
  const confirmedWrite = source.indexOf('writeSyncedTimeZone(browserTimeZone, visitorId);', putCall);
  assert.ok(confirmedWrite > putCall, '只有 PUT 成功后才写同步标记');
  assert.match(source, /if \(!saved.ok\)/);
  assert.match(source, /generation !== getIdentityGeneration\(\)/);
  assert.match(source, /profile_updated_at:/, '写入必须校验所读档案版本');

});

test('挂载点是 chat/page.tsx 的瘦壳，逻辑零外泄、不碰 chat-shell', () => {
  const page = read('src/app/chat/page.tsx');
  const shell = read('src/components/time-zone-sync.tsx');

  // 服务端页面把瘦壳挂上（语义上就是「聊天 boot 后」）。
  assert.match(page, /import \{ TimeZoneSync \} from '@\/components\/time-zone-sync';/);
  assert.match(page, /<TimeZoneSync \/>/);
  assert.match(page, /<ChatShell \/>/);

  // 瘦壳：只有一个 useEffect + 一次调用，**判断逻辑一行都不放组件里**。
  assert.match(shell, /'use client';/);
  assert.match(shell, /if \(status === 'loading'\) return;/);
  assert.match(shell, /\[status, user\?\.id\]/);
  assert.match(shell, /window.addEventListener\(VISITOR_IDENTITY_EVENT/);
  assert.match(shell, /window.removeEventListener\(VISITOR_IDENTITY_EVENT/);
  assert.match(shell, /if \(!cancelled\) return persistBrowserTimeZoneOnce\(\)/);
  assert.doesNotMatch(shell, /shouldPersistTimeZone/, '判定必须在 lib 里，不在组件里');
  assert.doesNotMatch(shell, /localStorage/, '记忆读写必须在 lib 里');
  assert.doesNotMatch(shell, /apiFetch/, '网络调用必须在 lib 里');

  // 不碰热点文件：chat-shell 里不得出现时区采集的接线（那是 t38 的文件）。
  const chatShell = read('src/components/chat/chat-shell.tsx');
  assert.doesNotMatch(chatShell, /TimeZoneSync|time-zone-client|persistBrowserTimeZone/);
});

test('profile validates the parsed timezone before SQLite persistence',()=>{
 const route=stripComments(read(PROFILE_ROUTE));
 const guard=route.indexOf('!isValidTimeZone(update.timezone)');
 const write=route.lastIndexOf('repo.saveProfile(');
 assert.ok(guard>=0&&write>guard);
 assert.match(route,/coreError\(400, 'INVALID_TIME_ZONE'\)/);
});
