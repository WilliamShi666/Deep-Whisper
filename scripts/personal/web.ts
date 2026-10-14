import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { getPersonalConfig } from '../../src/lib/config/runtime';
import { registerInstanceProcess, watchInstanceOwnership } from '../../src/lib/personal/instance-lock';
const require = createRequire(import.meta.url);

async function main() {
  const mode = process.argv[2];
  if (mode !== 'dev' && mode !== 'start') throw new Error('Expected dev or start');
  const config = getPersonalConfig(process.env, { strict: false });
  await registerInstanceProcess(config.dataDir, 'web-wrapper');
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, ...process.argv.slice(3), '--hostname', config.host, '--port', String(config.port)], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  const unwatch = watchInstanceOwnership(config.dataDir, () => { child.kill('SIGKILL'); process.exit(1); });
  // The actual Next server self-registers in instrumentation before readiness.
  const stop = () => { child.kill('SIGTERM'); const hardStop = setTimeout(() => child.kill('SIGKILL'), 3000); hardStop.unref(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { process.exitCode = await new Promise<number>(resolve => { child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1)); }); }
  finally { unwatch(); }
}
main().catch(error => { console.error('[web] failed', error instanceof Error ? error.message : 'Unknown error'); process.exitCode = 1; });
