import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type InstanceRole = 'worker' | 'web-wrapper' | 'web-cli' | 'web-server';
interface Holder { pid: number; token: string; version?: 2; children?: Array<{ pid: number; role: InstanceRole }> }
export class InstanceOwnershipLost extends Error { constructor() { super('Instance ownership was lost; stop this process before restoring or migrating data'); } }
class InstanceBusy extends Error {}
const roles = new Set<InstanceRole>(['worker', 'web-wrapper', 'web-cli', 'web-server']);
function holder(raw: string): Holder {
  try {
    const value = JSON.parse(raw) as Holder;
    if (Number.isSafeInteger(value?.pid) && value.pid > 0 && typeof value.token === 'string' && value.token.length > 0) {
      if (value.version === undefined && value.children === undefined) return value;
      if (value.version === 2 && Array.isArray(value.children) && value.children.every(child => Number.isSafeInteger(child?.pid) && child.pid > 0 && roles.has(child.role))) return value;
    }
  } catch { /* malformed holders never authorize recovery */ }
  throw new Error('Instance lock is malformed. Stop all app/worker processes, preserve the data directory, then move the bad lock aside and retry.');
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === 'ESRCH') return false; if (code === 'EPERM') return true; throw error; }
}
function privateDirectory(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (lstatSync(dataDir).isSymbolicLink()) throw new Error('Data directory must not be symbolic');
  const privateDir = path.join(dataDir, 'private');
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  if (lstatSync(privateDir).isSymbolicLink()) throw new Error('Private directory must not be symbolic');
  return privateDir;
}
function readHolder(file: string): Holder {
  if (lstatSync(file).isSymbolicLink()) throw new Error('Instance lock must not be symbolic');
  return holder(readFileSync(file, 'utf8'));
}
/** Short atomic directory guard serializes child registration, stale reclamation and claim. */
function guarded<T>(privateDir: string, work: (guard: string) => T): T {
  const guard = path.join(privateDir, 'instance-recovery.lock');
  const token = randomUUID(); const marker = path.join(guard, token);
  try { mkdirSync(guard, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (lstatSync(guard).isSymbolicLink()) throw new Error('Instance recovery directory must not be symbolic');
    const entries = readdirSync(guard).filter(entry => entry !== 'record.next');
    if (entries.length !== 1) throw new Error('Instance recovery lock is incomplete. Stop all app/worker processes and inspect private/instance-recovery.lock before retrying.');
    const previousPath = path.join(guard, entries[0]);
    const previous = readHolder(previousPath);
    if (previous.token !== entries[0]) throw new Error('Instance recovery marker is malformed. Stop all app/worker processes and inspect the recovery lock.');
    if (alive(previous.pid)) throw new InstanceBusy('Another instance lock operation is running; retry after it finishes');
    if (existsSync(path.join(guard, 'record.next'))) throw new Error('Instance recovery lock is incomplete. Stop all app/worker processes and inspect private/instance-recovery.lock before retrying.');
    unlinkSync(previousPath); rmdirSync(guard); mkdirSync(guard, { mode: 0o700 });
  }
  try { writeFileSync(marker, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 }); return work(guard); }
  finally { const pending = path.join(guard, 'record.next'); if (existsSync(pending)) unlinkSync(pending); if (existsSync(marker)) { unlinkSync(marker); rmdirSync(guard); } }
}
function replaceHolder(file: string, guard: string, value: Holder): void {
  const pending = path.join(guard, 'record.next');
  writeFileSync(pending, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  renameSync(pending, file);
}
/** Recovery requires proof that the supervisor and every registered descendant are offline. */
export function claimInstanceLock(dataDir: string): () => void {
  const privateDir = privateDirectory(dataDir); const file = path.join(privateDir, 'instance.json'); const token = randomUUID();
  guarded(privateDir, guard => {
    if (existsSync(file)) {
      const previous = readHolder(file);
      if (alive(previous.pid)) throw new Error('Stop the app before migration: another Deep Whisper instance already uses this data directory');
      if (previous.version !== 2 || !previous.children) throw new Error('Legacy instance lock has no child inventory. Stop all app/worker/web processes, preserve the data directory and manually inspect offline status before moving private/instance.json aside.');
      if (previous.children.some(child => alive(child.pid))) throw new Error('A registered child writer process is still running. Wait for all app/worker/web processes to stop before recovery or migration.');
    }
    replaceHolder(file, guard, { version: 2, pid: process.pid, token, children: [] });
  });
  let released = false;
  return () => {
    if (released) return;
    guarded(privateDir, () => {
      if (!existsSync(file)) return;
      const current = readHolder(file);
      // Keep the inventory if termination has not yet reaped every descendant.
      if (current.token === token && !current.children?.some(child => alive(child.pid))) unlinkSync(file);
    });
    released = true;
  };
}
/** Every child self-registers under the claim guard before touching SQLite or provider IO. */
export async function registerInstanceProcess(dataDir: string, role: InstanceRole, env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  if (!env.DW_INSTANCE_TOKEN) throw new InstanceOwnershipLost();
  const privateDir = privateDirectory(dataDir); const file = path.join(privateDir, 'instance.json'); const deadline = Date.now() + 5000;
  while (true) {
    try {
      guarded(privateDir, guard => {
        const current = readHolder(file);
        if (current.version !== 2 || !current.children || current.token !== env.DW_INSTANCE_TOKEN || !alive(current.pid)) throw new InstanceOwnershipLost();
        if (!current.children.some(child => child.pid === process.pid)) current.children.push({ pid: process.pid, role });
        replaceHolder(file, guard, current);
      });
      return;
    } catch (error) {
      if (!(error instanceof InstanceBusy) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
/** Synchronous transaction/provider-boundary fence. Independent offline tests have no instance token. */
export function assertInstanceOwnership(dataDir: string, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (!env.DW_INSTANCE_TOKEN) return;
  try {
    const current = readHolder(path.join(dataDir, 'private', 'instance.json'));
    if (current.version === 2 && current.token === env.DW_INSTANCE_TOKEN && alive(current.pid) && current.children?.some(child => child.pid === process.pid)) return;
  } catch { /* missing, replaced or unreadable ownership always fails closed */ }
  throw new InstanceOwnershipLost();
}
export function watchInstanceOwnership(dataDir: string, onLost: () => void = () => process.exit(1)): () => void {
  const timer = setInterval(() => { try { assertInstanceOwnership(dataDir); } catch { clearInterval(timer); onLost(); } }, 100);
  timer.unref();
  return () => clearInterval(timer);
}

/** Only a freshly claimed maintenance/supervisor owner with no live descendants can skip an online drain. */
export function ownsOfflineInstance(dataDir: string): boolean {
  try {
    const current = readHolder(path.join(dataDir, 'private', 'instance.json'));
    return current.version === 2 && current.pid === process.pid && !!current.children && current.children.every(child => !alive(child.pid));
  } catch { return false; }
}
