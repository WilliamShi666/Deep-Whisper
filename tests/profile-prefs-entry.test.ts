import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { zhCN } from '../src/lib/i18n/messages';

/**
 * AC-17（T-27 / T-28）最小产品入口的「接线」断言。
 *
 * 这里验证的是源码接线：端点真的承载了更正 / 撤销，UI 真的调用了它，
 * 失败真的走非 2xx。它不是浏览器行为验证 —— 真实点击复现属于门禁 G3，
 * 由独立验收方在浏览器里完成。断言方式沿用本仓库既有的 T-24 写法。
 */

const routeSource = readFileSync(
  new URL('../src/app/api/profile/route.ts', import.meta.url),
  'utf8',
);
const entrySource = readFileSync(
  new URL('../src/components/chat/companion-preference-settings.tsx', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../src/components/chat/companion-settings.tsx', import.meta.url),
  'utf8',
);

/** 去掉注释后再断言，避免把「刻意不 import」这类说明文字误判成真实依赖。 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('manual preference API keeps append/revoke scope and response contract',()=>{
 assert.match(routeSource,/body\.feedback_action === 'append'/);
 assert.match(routeSource,/body\.feedback_action === 'revoke'/);
 assert.match(routeSource,/prefs_action/);
 assert.match(routeSource,/revoke_mode === 'explicit_feedback'/);
});

test('manual preference writes remain owned, bounded and CAS protected',()=>{
 assert.match(routeSource,/ownerRoute\(request/);
 assert.match(routeSource,/PREFERENCE_FEEDBACK_EMPTY/);
 assert.match(routeSource,/expectedVersion: existing\?\.updated_at/);
 assert.match(routeSource,/UNSUPPORTED_PREF_ACTION/);
});

test('AC-17 入口：撤销只清偏好字段，不触碰记忆、会话与关系历史', () => {
  assert.doesNotMatch(routeSource, /forgetConversationMemories/, '撤销不得级联遗忘记忆');
  assert.doesNotMatch(entrySource, /conversations/, '入口不得触碰会话');
  assert.doesNotMatch(entrySource, /relationship_snapshots/, '入口不得触碰关系快照');
  assert.match(entrySource, /revoke_mode/, '撤销必须显式声明范围');
});

test('AC-17 入口：手动要求追加，伴侣学习的要求单独管理', () => {
  assert.match(entrySource, /feedback_action: 'append'/, '更正必须走追加语义');
  // t9/U3：两段标题走字典，**中文取值逐字符不变**（这里钉住「两段仍在」+ 中文原文）。
  assert.match(entrySource, /t\('chat\.preference\.manual_section'\)/);
  assert.match(entrySource, /t\('chat\.preference\.learned_section'\)/);
  assert.equal(zhCN.chat['preference.manual_section'], '手动设置（所有伴侣共享）');
  assert.equal(zhCN.chat['preference.learned_section'], '这位伴侣记住的要求');
  assert.doesNotMatch(entrySource, /当前生效/, '多条独立要求不能把最后一条误标为唯一生效');
});

test('AC-17 入口：恋人设置弹窗挂载该入口（用户可达）', () => {
  assert.match(settingsSource, /CompanionPreferenceSettings/, '设置容器必须引入该入口');
  assert.match(settingsSource, /<CompanionPreferenceSettings open=\{open\} visitorId=\{visitorId\} companionId=\{companion.id\} \/>/, '必须以开合状态与当前身份挂载');
  assert.match(entrySource, /data-testid="companion-preference-settings"/, '入口必须有可被端到端定位的锚点');
});

test('AC-17 入口：客户端入口不得引入服务端模块', () => {
  const entryCode = stripComments(entrySource);
  assert.doesNotMatch(entryCode, /@\/lib\/profile\/communication-prefs/, '客户端不得 import service-role 模块');
  assert.doesNotMatch(entryCode, /supabase-client/, '客户端不得 import 管理端客户端');
});
