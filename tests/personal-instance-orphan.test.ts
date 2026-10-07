import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';
import path from 'node:path';
import { claimInstanceLock, registerInstanceProcess, InstanceOwnershipLost } from '../src/lib/personal/instance-lock';

test('S11 dead supervisor cannot be reclaimed while a registered writer still lives', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-orphan-lock-'));
  const file = path.join(dir, 'private', 'instance.json');
  mkdirSync(path.dirname(file));
  const record = { version: 2, pid: 2147483647, token: 'lost-supervisor', children: [{ pid: process.pid, role: 'worker' }] };
  writeFileSync(file, JSON.stringify(record));
  try {
    assert.throws(() => claimInstanceLock(dir), /child|writer|process.*running/i);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), record);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('S11 dead legacy holder without a child inventory requires explicit offline inspection', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-legacy-lock-'));
  const file = path.join(dir, 'private', 'instance.json');
  mkdirSync(path.dirname(file));
  writeFileSync(file, JSON.stringify({ pid: 2147483647, token: 'legacy-no-inventory' }));
  try { assert.throws(() => claimInstanceLock(dir), /inventory|legacy|Stop all/i); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/storage/database/db';
import { createCoreRepository } from '../src/lib/personal/core-repository';
import { CHARACTER_PRESETS } from '../src/lib/characters';
import { enqueueOrganizerJob } from '../src/lib/memory/sqlite-jobs';
import { processLetterJobs } from '../src/lib/letters/personal-scheduler';
import { createSqliteRecallSnapshotStore } from '../src/lib/memory/sqlite-snapshot';
import { enableLetterCopies, personalLettersFixture, LETTER_TEST_NOW, LETTER_TEST_SMTP, letterTestDraft } from './support/personal-letters';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitFor(predicate: () => boolean, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture readiness/convergence timed out'); await new Promise(resolve => setTimeout(resolve, 25)); }
}
function seed(dir: string) {
  const db = openDatabase({ dataDir: dir });
  const owner = (db.prepare('SELECT id FROM visitors WHERE owner_slot=1').get() as { id: string }).id;
  const repo = createCoreRepository(db);
  const companion = repo.createCompanion(owner, { character_key: CHARACTER_PRESETS[0].key, name: 'Synthetic', appearance_style: 'normal', theme_id: null, persona: null, occupation: null, user_title: null, voice_id: null });
  const conversation = repo.createConversation(owner, companion.id, { title: 'Synthetic' });
  const user = repo.insertMessage(owner, conversation.id, { role: 'user', content: 'Synthetic user text' });
  const assistant = repo.insertMessage(owner, conversation.id, { role: 'assistant', content: 'Synthetic assistant text' });
  const exchange = { visitorId: owner, companionId: companion.id, conversationId: conversation.id, userMessageId: user.id, userText: user.content!, assistantMessageId: assistant.id, assistantText: assistant.content!, observedAt: assistant.created_at };
  const job = enqueueOrganizerJob(db, exchange);
  db.close(); return { exchange, job };
}
function record(dir: string): { pid: number; token: string; children: Array<{ pid: number; role: string }> } {
  return JSON.parse(readFileSync(path.join(dir, 'private', 'instance.json'), 'utf8'));
}
function state(dir: string, id: string) {
  const db = new Database(path.join(dir, 'deep-whisper.sqlite'), { readonly: true });
  try { return (db.prepare('SELECT state FROM memory_jobs WHERE id=?').get(id) as { state: string }).state; } finally { db.close(); }
}
function startFixture(dir: string, script: string, args: string[] = [], cwd = dir, extra: Record<string, string> = {}) {
  mkdirSync(path.join(dir, 'private'), { recursive: true });
  const file = path.join(dir, 'parent.mjs');
  writeFileSync(file, `import {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';const token='fixture-owned-token';writeFileSync(${JSON.stringify(path.join(dir, 'private', 'instance.json'))},JSON.stringify({version:2,pid:process.pid,token,children:[]}));const child=spawn(process.execPath,['--conditions=react-server',${JSON.stringify(tsx)},'--tsconfig',${JSON.stringify(path.join(root, 'tsconfig.json'))},${JSON.stringify(script)},...${JSON.stringify(args)}],{cwd:${JSON.stringify(cwd)},env:{...process.env,DW_INSTANCE_TOKEN:token},stdio:['ignore',process.stdout,process.stderr]});console.log('WRAPPER_PID '+child.pid);setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, [file], { cwd, env: { PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test', APP_ACCESS_MODE: 'local', HOST: '127.0.0.1', PORT: '5000', APP_BASE_URL: 'http://127.0.0.1:5000', APP_DATA_DIR: dir, E2E_MOCK_PROVIDERS: '1', MEMORY_RETRIEVAL_MODE: 'keyword', EMAIL_PROVIDER: 'none', LETTER_DELIVERY: 'in-app', NEXT_TELEMETRY_DISABLED: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
  return { child, output: () => output };
}
async function killParent(child: ChildProcess) { await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); }); }
async function cleanFixture(dir: string, fixture: ReturnType<typeof startFixture>) {
  let pids: number[] = [];
  try { pids = record(dir).children.map(child => child.pid); } catch { /* fixture may fail before registration */ }
  const wrapper = fixture.output().match(/WRAPPER_PID (\d+)/); if (wrapper) pids.push(Number(wrapper[1]));
  if (fixture.child.pid) pids.push(fixture.child.pid);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* already reaped */ }
  await waitFor(() => pids.every(pid => !alive(pid))).catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
}

test('S11 actual worker registers itself; SIGKILL parent cannot migrate over delayed IO; old worker cannot commit or consume a new job', { skip: process.platform === 'win32' ? 'POSIX signal harness; native Windows lifecycle acceptance remains separate' : false }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-worker-orphan-'));
  const seeded = seed(dir);
  const bootstrap = path.join(dir, 'worker-bootstrap.ts');
  writeFileSync(bootstrap, `import {writeFileSync,existsSync} from 'node:fs';import {E2EMockChatProvider} from ${JSON.stringify(path.join(root, 'src/lib/ai/providers/e2e-mock-providers'))};const original=E2EMockChatProvider.prototype.complete;E2EMockChatProvider.prototype.complete=async function(input){writeFileSync(${JSON.stringify(path.join(dir, 'io-started'))},'1');while(!existsSync(${JSON.stringify(path.join(dir, 'io-release'))}))await new Promise(resolve=>setTimeout(resolve,10));return original.call(this,input);};void import(${JSON.stringify(path.join(root, 'scripts/personal/worker.ts'))});`);
  const fixture = startFixture(dir, bootstrap);
  try {
    await waitFor(() => existsSync(path.join(dir, 'io-started')));
    const before = record(dir); const worker = before.children.find(child => child.role === 'worker'); assert.ok(worker);
    assert.equal(state(dir, seeded.job), 'running');
    process.kill(worker.pid, 'SIGSTOP'); await killParent(fixture.child);
    assert.throws(() => claimInstanceLock(dir), /child writer.*running/i);
    const migration = spawnSync(process.execPath, [tsx, '--tsconfig', path.join(root, 'tsconfig.json'), path.join(root, 'scripts/personal/data.ts'), 'migrate'], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test', APP_DATA_DIR: dir }, encoding: 'utf8', timeout: 10000 });
    assert.equal(migration.status, 1); assert.match(migration.stderr, /child writer.*running/i); assert.equal(record(dir).token, before.token);
    writeFileSync(path.join(dir, 'io-release'), '1'); process.kill(worker.pid, 'SIGCONT');
    await waitFor(() => !alive(worker.pid));
    assert.equal(state(dir, seeded.job), 'running');
    const release = claimInstanceLock(dir);
    const db = openDatabase({ dataDir: dir }); const repo = createCoreRepository(db);
    const nextAssistant = repo.insertMessage(seeded.exchange.visitorId, seeded.exchange.conversationId, { role: 'assistant', content: 'New owner reply' });
    const nextJob = enqueueOrganizerJob(db, { ...seeded.exchange, assistantMessageId: nextAssistant.id, assistantText: nextAssistant.content!, observedAt: nextAssistant.created_at }); db.close();
    await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(state(dir, nextJob), 'queued'); release();
    const recoveredMigration = spawnSync(process.execPath, [tsx, '--tsconfig', path.join(root, 'tsconfig.json'), path.join(root, 'scripts/personal/data.ts'), 'migrate'], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test', APP_DATA_DIR: dir }, encoding: 'utf8', timeout: 10000 });
    assert.equal(recoveredMigration.status, 0, recoveredMigration.stderr); assert.match(recoveredMigration.stdout, /Backup:.*\nDatabase ready at version 3/);
  } catch (error) { console.error(fixture.output()); throw error; }
  finally { await cleanFixture(dir, fixture); }
});

async function unusedPort(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
test('S11 actual Next web server self-registers before requests and orphaned delayed reply cannot commit', { skip: process.platform === 'win32' ? 'POSIX signal harness; native Windows lifecycle acceptance remains separate' : false }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-web-orphan-')); const seeded = seed(dir);
  const app = path.join(dir, 'app'); mkdirSync(path.join(app, 'src', 'app', 'api', 'probe'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  symlinkSync(path.join(root, 'src', 'lib'), path.join(app, 'src', 'lib'), 'dir');
  symlinkSync(path.join(root, 'src', 'storage'), path.join(app, 'src', 'storage'), 'dir');
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'isolated-web-orphan-fixture', private: true }));
  writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
  writeFileSync(path.join(app, 'src', 'instrumentation.ts'), readFileSync(path.join(root, 'src', 'instrumentation.ts')));
  writeFileSync(path.join(app, 'src', 'proxy.ts'), readFileSync(path.join(root, 'src', 'proxy.ts')));
  writeFileSync(path.join(app, 'src', 'app', 'layout.tsx'), 'export default function Layout({children}){return <html><body>{children}</body></html>}');
  writeFileSync(path.join(app, 'src', 'app', 'api', 'probe', 'route.ts'), `import {writeFileSync} from 'node:fs';import {getSqlite} from '@/storage/database/db';import {createCoreRepository} from '@/lib/personal/core-repository';export const runtime='nodejs';export async function GET(){const repo=createCoreRepository(getSqlite());writeFileSync(${JSON.stringify(path.join(dir, 'web-io-started'))},'1');await new Promise(resolve=>setTimeout(resolve,1000));repo.finishReply(${JSON.stringify({ ...seeded.exchange, assistantText: 'Must never persist after parent death', observedAt: new Date().toISOString() })});return Response.json({ok:true});}`);
  const port = await unusedPort(); const fixture = startFixture(dir, path.join(root, 'scripts/personal/web.ts'), ['dev', '--webpack'], app, { NODE_ENV: 'development', PORT: String(port), APP_BASE_URL: `http://127.0.0.1:${port}` });
  try {
    await waitFor(() => fixture.output().includes('Ready'), 45000);
    const pending = fetch(`http://127.0.0.1:${port}/api/probe`).catch(() => null);
    await waitFor(() => existsSync(path.join(dir, 'web-io-started')), 45000);
    const before = record(dir); assert.ok(before.children.some(child => child.role === 'web-server'));
    for (const child of before.children) process.kill(child.pid, 'SIGSTOP'); await killParent(fixture.child);
    assert.throws(() => claimInstanceLock(dir), /child writer.*running/i);
    for (const child of before.children) if (alive(child.pid)) process.kill(child.pid, 'SIGCONT');
    await waitFor(() => before.children.every(child => !alive(child.pid)));
    await pending;
    const db = new Database(path.join(dir, 'deep-whisper.sqlite'), { readonly: true });
    assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE content='Must never persist after parent death'").get() as { n: number }).n, 0); db.close();
    const release = claimInstanceLock(dir); release();
  } catch (error) { console.error(fixture.output()); throw error; }
  finally { await cleanFixture(dir, fixture); }
});

test('S11 registration rejects dead/replaced ownership before a child can become a writer and malformed inventories fail closed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-register-fence-'));
  mkdirSync(path.join(dir, 'private')); const file = path.join(dir, 'private', 'instance.json');
  try {
    writeFileSync(file, JSON.stringify({ version: 2, pid: 2147483647, token: 'dead', children: [] }));
    await assert.rejects(registerInstanceProcess(dir, 'worker', { DW_INSTANCE_TOKEN: 'dead' }), InstanceOwnershipLost);
    writeFileSync(file, JSON.stringify({ version: 2, pid: process.pid, token: 'replacement', children: [] }));
    await assert.rejects(registerInstanceProcess(dir, 'worker', { DW_INSTANCE_TOKEN: 'old' }), InstanceOwnershipLost);
    writeFileSync(file, JSON.stringify({ version: 2, pid: 2147483647, token: 'bad', children: [{ pid: 0, role: 'worker' }] }));
    assert.throws(() => claimInstanceLock(dir), /malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('S11 lost token after letter generation or email acceptance cannot finalize old-worker SQLite state', async () => {
  for (const boundary of ['generation', 'submission'] as const) {
    const dir = mkdtempSync(path.join(tmpdir(), 'dw-letter-instance-')); mkdirSync(path.join(dir, 'private'));
    const seeded = personalLettersFixture(); enableLetterCopies(seeded.db, seeded.owner);
    await seeded.db.backup(path.join(dir, 'deep-whisper.sqlite')); seeded.db.close();
    const db = new Database(path.join(dir, 'deep-whisper.sqlite')); db.pragma('foreign_keys=ON');
    const file = path.join(dir, 'private', 'instance.json'); const previous = process.env;
    const writeToken = (token: string) => writeFileSync(file, JSON.stringify({ version: 2, pid: process.pid, token, children: [{ pid: process.pid, role: 'worker' }] }));
    writeToken('owned'); process.env = { NODE_ENV: 'test', DW_INSTANCE_TOKEN: 'owned' };
    try {
      await assert.rejects(processLetterJobs(db, { now: LETTER_TEST_NOW, env: { ...LETTER_TEST_SMTP, APP_DATA_DIR: dir }, writeLetter: async input => {
        if (boundary === 'generation') writeToken('replacement'); return letterTestDraft(input);
      }, send: async () => { writeToken('replacement'); return { provider: 'smtp', providerMessageId: 'synthetic-accepted' }; } }), InstanceOwnershipLost);
      const letterCount = (db.prepare('SELECT count(*) n FROM letters').get() as { n: number }).n;
      assert.equal(letterCount, boundary === 'generation' ? 0 : 1);
      assert.equal((db.prepare("SELECT count(*) n FROM letter_outbox WHERE status='accepted'").get() as { n: number }).n, 0);
      assert.equal((db.prepare(`SELECT status FROM ${boundary === 'generation' ? 'letter_jobs' : 'letter_outbox'}`).get() as { status: string }).status, boundary === 'generation' ? 'running' : 'sending');
    } finally { process.env = previous; db.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('S11 proxy immediately rejects a replaced instance before owner or handler work', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-proxy-instance-')); mkdirSync(path.join(dir, 'private'));
  const previous = process.env;
  process.env = { NODE_ENV: 'test', APP_ENV: 'test', APP_DATA_DIR: dir, APP_ACCESS_MODE: 'local', DW_INSTANCE_TOKEN: 'old' };
  writeFileSync(path.join(dir, 'private', 'instance.json'), JSON.stringify({ version: 2, pid: process.pid, token: 'replacement', children: [{ pid: process.pid, role: 'web-server' }] }));
  try {
    const response = proxy(new NextRequest('http://127.0.0.1:5000/api/capabilities', { headers: { host: '127.0.0.1:5000' } }));
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'INSTANCE_OWNERSHIP_LOST');
  } finally { process.env = previous; rmSync(dir, { recursive: true, force: true }); }
});

test('S11 a recall snapshot retained across external IO cannot write after losing its instance token', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dw-snapshot-instance-')); const seeded = seed(dir); mkdirSync(path.join(dir, 'private'));
  const db = new Database(path.join(dir, 'deep-whisper.sqlite')); const previous = process.env;
  const store = createSqliteRecallSnapshotStore(db, seeded.exchange); await store.read();
  process.env = { NODE_ENV: 'test', DW_INSTANCE_TOKEN: 'old' };
  writeFileSync(path.join(dir, 'private', 'instance.json'), JSON.stringify({ version: 2, pid: process.pid, token: 'replacement', children: [{ pid: process.pid, role: 'web-server' }] }));
  try {
    await assert.rejects(store.write({ memories: [], refreshedAt: new Date().toISOString(), turnsSinceRefresh: 0 }), InstanceOwnershipLost);
    assert.equal((db.prepare('SELECT count(*) n FROM memory_recall_snapshots').get() as { n: number }).n, 0);
  } finally { process.env = previous; db.close(); rmSync(dir, { recursive: true, force: true }); }
});
