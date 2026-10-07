import assert from 'node:assert/strict';
import test from 'node:test';

import { createProfileTimeZoneResolver } from '../src/lib/memory/time-zone-resolver';
import { DEFAULT_TIME_ZONE } from '../src/lib/memory/time-source';

test('T-14 consumer side: the stored profile time zone is what every write uses', async () => {
  const seen: string[] = [];
  const resolve = createProfileTimeZoneResolver({
    async load(visitorId) {
      seen.push(visitorId);
      return 'America/New_York';
    },
  });

  assert.equal(await resolve('visitor-1'), 'America/New_York');
  assert.deepEqual(seen, ['visitor-1']);
});

test('T-14 consumer side: missing, blank or unparsable zones fall back to Asia/Shanghai', async () => {
  for (const stored of [null, '', '   ', 'Not/AZone']) {
    const resolve = createProfileTimeZoneResolver({
      async load() {
        return stored;
      },
    });
    assert.equal(await resolve('visitor-1'), DEFAULT_TIME_ZONE);
  }
});

test('T-14 consumer side: a profile read outage degrades to the default zone instead of throwing', async () => {
  const resolve = createProfileTimeZoneResolver({
    async load() {
      throw new Error('simulated profile outage');
    },
  });

  assert.equal(await resolve('visitor-1'), DEFAULT_TIME_ZONE);
});
