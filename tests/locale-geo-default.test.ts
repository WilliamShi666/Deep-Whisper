import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_LOCALE,
  GEO_CHINESE_COUNTRIES,
  localeForCountry,
  parseLocale,
  resolveLocale,
} from '../src/lib/i18n/locale';

/**
 * **地理默认语言**（t67 / 用户 2026-10-04 直接需求）。
 *
 * 规则：可信网络国家 ∈ {中国大陆, 香港, 台湾, 新加坡, 澳门} ⇒ `zh-CN`；其余**有值** ⇒ `en`；
 * **取不到国家值** ⇒ `DEFAULT_LOCALE`（`zh-CN`）。
 *
 * 为什么「取不到」必须落中文而不是英文：那是「**未知**」而不是「**非中文地区**」。
 * 本地开发、单测、非 Vercel 环境都没有 `x-vercel-ip-country`，把它们的默认翻成英文
 * 会污染所有本地与测试场景（既有中文断言会莫名变红），也会让「本地看到什么」与「线上看到什么」分叉。
 *
 * 门禁强度：删掉 `localeForCountry`（或把它改成恒返回 `DEFAULT_LOCALE`）⇒ 本文件必红（见交付读数）。
 */

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const stripJsComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('地理默认接在解析链末端，且不改变链的顺序语义（档案 > 设备镜像 > 默认）', () => {
  // 末端换成地理默认：两个信号都缺席时才用它。
  assert.equal(resolveLocale(null, null, 'en'), 'en');
  assert.equal(resolveLocale(null, null, 'zh-CN'), 'zh-CN');
  // 顺序不变：档案 > 设备镜像 > 末端。
  assert.equal(resolveLocale('zh-CN', 'en', 'en'), 'zh-CN', '档案优先');
  assert.equal(resolveLocale(null, 'en', 'zh-CN'), 'en', '设备镜像优先于默认');
  assert.equal(resolveLocale(null, null), DEFAULT_LOCALE, '不传末端时行为与 t67 之前逐字符一致');
  assert.equal(resolveLocale('en-US', 'en', 'zh-CN'), 'en', '脏档案值不短路，继续看设备镜像');
  assert.equal(
    resolveLocale('en-US', 'de', 'us'),
    DEFAULT_LOCALE,
    '三个槽全非法时回落 DEFAULT_LOCALE（不抛）',
  );
  // 脏末端值同样回落 DEFAULT_LOCALE，而不是抛出。
  assert.equal(resolveLocale(null, null, 'us'), DEFAULT_LOCALE);
  assert.equal(parseLocale('us'), null);
});


test('客户端与服务端同解，且地理默认绝不当真实值（不写设备镜像）', () => {
  const client = stripJsComments(read('src/lib/i18n-client.tsx'));

  // 客户端也拿地理默认：只问那个只读端点（不在客户端重写规则）。
  assert.match(client, /const GEO_DEFAULT_ENDPOINT = '\/api\/locale-default';/);
  assert.doesNotMatch(client, /GEO_CHINESE_COUNTRIES|localeForCountry/, '客户端不得二次实现规则');

  // 末端是地理默认。
  assert.match(client, /const resolved = resolveLocale\(profile, deviceLocale, geoDefault\);/);

  // 「页面值只是地理默认」不算声明（否则美国访客会压过自己显式选择的设备镜像）。
  assert.match(client, /pageLocale !== DEFAULT_LOCALE && pageLocale !== geoDefault/, '地理默认不是声明');

  // 解析完全来自地理默认时**一个字都不许写进设备镜像**。
  assert.match(
    client,
    /const fromGeoDefaultOnly =[\s\S]{0,160}?profile === null && resolved === geoDefault;/,
    '地理默认只是默认值，不得落设备镜像',
  );
  assert.match(client, /if \(ownsDeviceWrite && !fromGeoDefaultOnly &&/, '写镜像必须排除「纯地理默认」');
});


test('personal default follows supported Accept-Language order without geo or writes',async()=>{
 const {personalDefaultLocale}=await import('../src/lib/personal/locale');
 assert.equal(personalDefaultLocale('en-US,en;q=0.9,zh-CN;q=0.5'),'en');
 assert.equal(personalDefaultLocale('zh;q=0,en;q=0.8'),'en');
 assert.equal(personalDefaultLocale('fr,de;q=0.8'),'zh-CN');
 const server=stripJsComments(read('src/lib/i18n-server.ts'));
 assert.match(server,/personalDefaultLocale/);
 assert.doesNotMatch(server,/x-vercel-ip-country|lib\/billing/);
 const endpoint=stripJsComments(read('src/app/api/locale-default/route.ts'));
 assert.match(endpoint,/personalDefaultLocale/);
 assert.doesNotMatch(endpoint,/coreRepository|cookie|updateVisitor/);
});
