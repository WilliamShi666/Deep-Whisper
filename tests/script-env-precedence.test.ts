import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCRIPT_ENV_PRECEDENCE,
  mergeScriptEnv,
  readEnvLayer,
} from '../scripts/lib/load-script-env';

/** Scripts share the application's environment precedence. Test fixtures use
 * reserved example domains rather than any deployed project's address. */
test('script env precedence matches Next: development.local wins over .env', () => {
  assert.deepEqual([...SCRIPT_ENV_PRECEDENCE], ['.env', '.env.local', '.env.development.local']);
  const index = (name: string) => SCRIPT_ENV_PRECEDENCE.indexOf(name);
  assert.ok(index('.env.development.local') > index('.env.local'), 'development.local 必须最后加载');
  assert.ok(index('.env.local') > index('.env'), '.env.local 必须覆盖 .env');
});

test('the real repo layering resolves to the local stack, not the remote project', () => {
  const remote = 'https://remote-project.example.invalid';
  const merged = mergeScriptEnv({}, [
    { SUPABASE_URL: remote },
    { SUPABASE_URL: remote },
    { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PROJECT_REF: 'local', APP_ENV: 'development' },
  ]);
  assert.equal(merged.SUPABASE_URL, 'http://127.0.0.1:54321');
  assert.equal(merged.SUPABASE_PROJECT_REF, 'local');
  assert.equal(merged.APP_ENV, 'development');
});

test('a real environment variable still beats every file', () => {
  const merged = mergeScriptEnv(
    { APP_ENV: 'production', SUPABASE_URL: 'https://real.example.com' },
    [{ APP_ENV: 'development' }, { SUPABASE_URL: 'http://127.0.0.1:54321' }],
  );
  assert.equal(merged.APP_ENV, 'production');
  assert.equal(merged.SUPABASE_URL, 'https://real.example.com');
});

test('an undefined inherited value never erases a file value', () => {
  // process.env 的属性可以存在但为 undefined；这不该覆盖文件里的取值。
  const merged = mergeScriptEnv({ DATABASE_URL: undefined, PGUSER: 'from-env' }, [
    { DATABASE_URL: 'postgresql://postgres@127.0.0.1:54322/postgres' },
  ]);
  assert.equal(merged.DATABASE_URL, 'postgresql://postgres@127.0.0.1:54322/postgres');
  assert.equal(merged.PGUSER, 'from-env');
});

test('a missing env file is an empty layer, not a crash', () => {
  assert.deepEqual(readEnvLayer('/definitely/not/a/file.env'), {});
  assert.deepEqual(readEnvLayer('/nope/deeper/also-missing'), {});
});
