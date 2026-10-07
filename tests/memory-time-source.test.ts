import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TIME_ZONE,
  formatLocalNowLine,
  isValidTimeZone,
  resolveUserTimeZone,
  toLocalIso,
} from '../src/lib/memory/time-source';

const LOCAL_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

const SEPTEMBER_CLOCK = new Date('2026-09-16T01:30:00.000Z');
const JANUARY_CLOCK = new Date('2026-01-15T01:30:00.000Z');
const EVENING_CLOCK = new Date('2026-09-16T12:00:00.000Z');

const ZONES = ['Asia/Shanghai', 'UTC', 'America/New_York'];

test('DEFAULT_TIME_ZONE is the documented fallback zone', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'Asia/Shanghai');
});

test('resolveUserTimeZone falls back for missing or blank input', () => {
  assert.equal(resolveUserTimeZone(undefined), DEFAULT_TIME_ZONE);
  assert.equal(resolveUserTimeZone(null), DEFAULT_TIME_ZONE);
  assert.equal(resolveUserTimeZone(''), DEFAULT_TIME_ZONE);
  assert.equal(resolveUserTimeZone('   '), DEFAULT_TIME_ZONE);
});

test('resolveUserTimeZone keeps a valid IANA zone unchanged', () => {
  assert.equal(resolveUserTimeZone('Asia/Shanghai'), 'Asia/Shanghai');
  assert.equal(resolveUserTimeZone('America/New_York'), 'America/New_York');
});

test('resolveUserTimeZone falls back for an unknown zone without throwing', () => {
  assert.doesNotThrow(() => resolveUserTimeZone('Not/AZone'));
  assert.equal(resolveUserTimeZone('Not/AZone'), DEFAULT_TIME_ZONE);
});

test('resolveUserTimeZone tolerates non-string garbage without throwing', () => {
  const numericGarbage = 42 as unknown as string;
  const objectGarbage = {} as unknown as string;
  assert.doesNotThrow(() => resolveUserTimeZone(numericGarbage));
  assert.equal(resolveUserTimeZone(numericGarbage), DEFAULT_TIME_ZONE);
  assert.doesNotThrow(() => resolveUserTimeZone(objectGarbage));
  assert.equal(resolveUserTimeZone(objectGarbage), DEFAULT_TIME_ZONE);
});

test('isValidTimeZone accepts real IANA zones', () => {
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Asia/Shanghai'), true);
});

test('isValidTimeZone rejects blank and unknown zones', () => {
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone('   '), false);
  assert.equal(isValidTimeZone('Not/AZone'), false);
});

test('toLocalIso renders a fixed clock as local time with a numeric offset', () => {
  assert.equal(
    toLocalIso(SEPTEMBER_CLOCK, 'Asia/Shanghai'),
    '2026-09-16T09:30:00+08:00',
  );
  assert.equal(toLocalIso(SEPTEMBER_CLOCK, 'UTC'), '2026-09-16T01:30:00+00:00');
  assert.equal(
    toLocalIso(SEPTEMBER_CLOCK, 'America/New_York'),
    '2026-09-15T21:30:00-04:00',
  );
});

test('toLocalIso follows the daylight-saving shift for America/New_York', () => {
  assert.equal(
    toLocalIso(JANUARY_CLOCK, 'America/New_York'),
    '2026-01-14T20:30:00-05:00',
  );
});

test('toLocalIso never emits a naked UTC Z timestamp', () => {
  const clocks = [SEPTEMBER_CLOCK, JANUARY_CLOCK, EVENING_CLOCK];
  for (const clock of clocks) {
    for (const zone of ZONES) {
      const formatted = toLocalIso(clock, zone);
      assert.match(formatted, LOCAL_ISO_PATTERN);
      assert.equal(formatted.endsWith('Z'), false);
    }
  }
});

test('formatLocalNowLine renders the Shanghai wall clock with a morning day period', () => {
  assert.equal(
    formatLocalNowLine(SEPTEMBER_CLOCK, 'Asia/Shanghai'),
    '2026年9月16日 星期三 上午 09:30',
  );
});

test('formatLocalNowLine uses the evening day period at 20:00 local time', () => {
  assert.equal(
    formatLocalNowLine(EVENING_CLOCK, 'Asia/Shanghai'),
    '2026年9月16日 星期三 晚上 20:00',
  );
});

test('toLocalIso round-trips back to the same instant for every zone', () => {
  const clocks = [SEPTEMBER_CLOCK, JANUARY_CLOCK, EVENING_CLOCK];
  for (const clock of clocks) {
    for (const zone of ZONES) {
      assert.equal(Date.parse(toLocalIso(clock, zone)), clock.getTime());
    }
  }
});