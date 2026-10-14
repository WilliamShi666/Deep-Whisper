import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 全量单元测试入口。
 *
 * 用目录扫描而不是在 package.json 里手写文件名清单：手写清单漏掉新文件时，
 * 测试会静默地不跑（本项目曾有 15 个 *.test.ts 不在任何脚本里，包括
 * deepseek-romance-prompt、opening-memory、photo-tag-stream）。
 * *.integration.test.ts 需要真实数据库，故意排除。
 */
function collectUnitTests(): string[] {
  const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests');
  return readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.ts') && !name.endsWith('.integration.test.ts'))
    .sort()
    .map((name) => join('tests', name));
}

const files = collectUnitTests();

function main(): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('tsx/cli'), '--require', './tests/helpers/server-only.cjs', '--test', ...files], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Unit tests failed (${signal ?? code ?? 'unknown'}) across ${files.length} files`));
    });
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unit test runner failed');
  process.exitCode = 1;
});
