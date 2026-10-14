import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseEnv } from 'dotenv';

/**
 * 脚本用的 .env 加载器 —— 复刻 Next.js 的优先级，而不是"先到先得"。
 *
 * Next 的优先级（高 → 低）：
 *   .env.development.local > .env.local > .env.development > .env
 * 并且**真实环境变量优先于任何文件**。
 *
 * app、worker和维护命令共用此契约；test模式不继承.env.local。
 */

/** 低 → 高优先级；靠后的文件覆盖靠前的。 */
export const SCRIPT_ENV_PRECEDENCE: readonly string[] = [
  '.env',
  '.env.local',
  '.env.development.local',
];

type EnvRecord = Record<string, string | undefined>;

function definedOnly(record: EnvRecord): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * 纯合并：`layers` 按**低 → 高**优先级排列，`inherited`（真实环境变量）最高。
 * 抽成纯函数是为了能直接钉住"本仓库 .env 指向远端、.env.development.local 指向本地"
 * 这个真实场景 —— 这正是之前踩的坑。
 */
export function mergeScriptEnv(
  inherited: EnvRecord,
  layers: readonly EnvRecord[],
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const layer of layers) Object.assign(merged, definedOnly(layer));
  return { ...merged, ...definedOnly(inherited) };
}

/** 读文件为 record（不存在或读不动 → 空层，与 dotenv 的 quiet 行为一致）。 */
export function readEnvLayer(filePath: string): EnvRecord {
  try {
    if (!existsSync(filePath)) return {};
    return parseEnv(readFileSync(filePath));
  } catch {
    return {};
  }
}

/** 把结果写回 process.env（只设置、不删除）。 */
export function loadScriptEnv(root = process.cwd(), fileNames?: readonly string[]): void {
  const inherited = { ...process.env };
  const mode = process.env.NODE_ENV || 'development';
  const names = fileNames ?? ['.env', `.env.${mode}`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}.local`];
  const layers = names.map((name) => readEnvLayer(path.join(root, name)));
  const resolved = mergeScriptEnv(inherited, layers);
  for (const [key, value] of Object.entries(resolved)) process.env[key] = value;
}
