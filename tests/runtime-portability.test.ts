import assert from 'node:assert/strict';
import test from 'node:test';

import { getAppBaseUrl, getAppEnv } from '../src/lib/config/runtime';
import { getObjectStore } from '../src/lib/storage/object-store';

const STORAGE_ENV_NAMES = [
  'APP_ENV',
  'OBJECT_STORAGE_PROVIDER',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
] as const;

function withStorageEnv(
  values: Partial<Record<(typeof STORAGE_ENV_NAMES)[number], string>>,
  run: () => void,
): void {
  const original = Object.fromEntries(
    STORAGE_ENV_NAMES.map((name) => [name, process.env[name]]),
  );

  try {
    for (const name of STORAGE_ENV_NAMES) delete process.env[name];
    Object.assign(process.env, values);
    run();
  } finally {
    for (const name of STORAGE_ENV_NAMES) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('APP_ENV has priority over platform and Node environment markers', () => {
  assert.equal(
    getAppEnv({
      APP_ENV: 'test',
      VERCEL_ENV: 'production',
      NODE_ENV: 'production',
    }),
    'test',
  );
});

test('APP_BASE_URL rejects non-HTTP URL schemes', () => {
  assert.throws(
    () => getAppBaseUrl({ APP_BASE_URL: 'ftp://example.test' }, 'production'),
    /http\(s\)/,
  );
});

test('production uses private local storage without cloud credentials',()=>{
 withStorageEnv({APP_ENV:'production',OBJECT_STORAGE_PROVIDER:'local'},()=>assert.ok(getObjectStore()));
});

test('production fails closed when R2 configuration is incomplete', () => {
  withStorageEnv(
    { APP_ENV: 'production', OBJECT_STORAGE_PROVIDER: 'r2' },
    () => {
      assert.throws(
        () => getObjectStore(),
        /Missing required environment variable: R2_/,
      );
    },
  );
});
