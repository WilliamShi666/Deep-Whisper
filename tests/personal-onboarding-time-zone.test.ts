import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialOnboardingTimeZone, onboardingTimeZonePatch } from '../src/lib/personal/onboarding-time-zone';
import { OnboardingTimeZoneField } from '../src/components/onboarding-time-zone-field';
import { LocaleProvider, type LocaleProviderProps } from '../src/lib/i18n-client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import * as profileRoute from '../src/app/api/profile/route';
import * as companionRoute from '../src/app/api/companions/route';
import * as conversationRoute from '../src/app/api/conversations/route';
import * as visitorRoute from '../src/app/api/visitor/route';
import { getSqlite, closeDatabase } from '../src/storage/database/db';
import { createCoreRepository } from '../src/lib/personal/core-repository';
import { CHARACTER_PRESETS } from '../src/lib/characters';

test('S6 first onboarding detects an IANA zone, falls back safely and accepts an explicit choice', () => {
  assert.equal(initialOnboardingTimeZone(() => 'America/New_York'), 'America/New_York');
  assert.equal(initialOnboardingTimeZone(() => null), 'Asia/Shanghai');
  assert.equal(initialOnboardingTimeZone(() => 'invalid'), 'Asia/Shanghai');
  assert.equal(initialOnboardingTimeZone(() => { throw new Error('browser detection unavailable'); }), 'Asia/Shanghai');
  assert.deepEqual(onboardingTimeZonePatch({ repick: false, timeZone: ' Europe/Paris ', profile: null }), {
    timezone: 'Europe/Paris', profile_updated_at: null,
  });
  assert.throws(() => onboardingTimeZonePatch({ repick: false, timeZone: 'not/a/zone', profile: null }));
});

test('S6 repick preserves an existing explicit zone and fences a missing-profile fill', () => {
  const version = '2026-10-07T01:00:00.000Z';
  assert.deepEqual(onboardingTimeZonePatch({ repick: true, timeZone: 'America/New_York', profile: { timezone: 'Europe/Paris', updated_at: version } }), {});
  assert.deepEqual(onboardingTimeZonePatch({ repick: true, timeZone: 'America/New_York', profile: { timezone: null, updated_at: version } }), {
    timezone: 'America/New_York', profile_updated_at: version,
  });
});

test('S6 the first-onboarding confirmation field is editable, labelled and bilingual', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    // React supplies the required children through createElement's third argument.
    const localeProps = { initialLocale: locale } as LocaleProviderProps;
    const html = renderToStaticMarkup(createElement(LocaleProvider, localeProps,
      createElement(OnboardingTimeZoneField, { value: 'Europe/Paris', onChange: () => undefined, disabled: false })));
    assert.match(html, /data-testid="onboarding-timezone"/);
    assert.match(html, /value="Europe\/Paris"/);
    assert.match(html, /for="onboarding-timezone"/);
    assert.doesNotMatch(html, /readonly|readOnly|disabled=""/);
    assert.match(html, locale === 'en' ? /Confirm your time zone/ : /确认你的时区/);
  }
});

test('S6 successful first creation persists the confirmed zone in SQLite and repick cannot overwrite a newer manual choice', async (t) => {
  const previous = process.env;
  const dataDir = mkdtempSync(join(tmpdir(), 'dw-onboarding-tz-'));
  closeDatabase();
  process.env = { NODE_ENV: 'test', APP_ENV: 'test', APP_ACCESS_MODE: 'local', APP_DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '5000', APP_BASE_URL: 'http://127.0.0.1:5000' };
  t.after(() => { closeDatabase(); process.env = previous; rmSync(dataDir, { recursive: true, force: true }); });
  const request = (path: string, body: unknown) => new NextRequest(`http://127.0.0.1:5000/api/${path}`, {
    method: path === 'profile' ? 'PUT' : 'POST', headers: { host: '127.0.0.1:5000', origin: 'http://127.0.0.1:5000', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const save = (body: unknown) => profileRoute.PUT(request('profile', body));
  const initialPatch = onboardingTimeZonePatch({ repick: false, timeZone: 'Europe/Paris', profile: null });
  const saved = await save(initialPatch);
  assert.equal(saved.status, 200);
  const initialProfile = (await saved.json()).profile;
  assert.equal((await visitorRoute.POST(request('visitor', { gender: 'other', orientation: 'female' }))).status, 200);
  const created = await companionRoute.POST(request('companions', { character_key: CHARACTER_PRESETS[0].key, appearance_style: 'chibi' }));
  assert.equal(created.status, 200);
  const companion = (await created.json()).companion;
  assert.equal((await conversationRoute.POST(request('conversations', { companion_id: companion.id }))).status, 200);
  const db = getSqlite();
  const owner = (db.prepare('SELECT id FROM visitors WHERE owner_slot=1').get() as { id: string }).id;
  const repo = createCoreRepository(db);
  assert.equal(repo.getProfile(owner)?.timezone, 'Europe/Paris');
  assert.equal((await save({ timezone: 'America/New_York', profile_updated_at: initialProfile.updated_at })).status, 200);
  assert.equal((await save({ timezone: 'Asia/Shanghai', profile_updated_at: initialProfile.updated_at })).status, 409);
  const repickPatch = onboardingTimeZonePatch({ repick: true, timeZone: 'Asia/Shanghai', profile: repo.getProfile(owner) });
  assert.deepEqual(repickPatch, {});
  assert.equal(repo.getProfile(owner)?.timezone, 'America/New_York');
});
