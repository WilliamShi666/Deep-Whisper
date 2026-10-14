import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, release } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDatabase } from '../src/storage/database/db';
import { createSqliteMemoryGateway, indexMemoryTokens, PERSONAL_MEMORY_APP_ID } from '../src/lib/memory/sqlite-gateway';
import { buildRecallQuery } from '../src/lib/memory/recall-query';

// Entirely synthetic temp data. No env loading, real provider or existing database.
async function main() {
const dataDir = mkdtempSync(join(tmpdir(), 'whisper-memory-bench-'));
const db = openDatabase({ dataDir });
try {
  const owner = (db.prepare('SELECT id FROM visitors').get() as { id: string }).id;
  const at = Date.now();
  db.prepare("INSERT INTO companions(id,visitor_id,character_key,name,appearance_style,created_at,updated_at) VALUES ('benchmark',?,'deepseek_f_01','synthetic','normal',?,?)").run(owner, at, at);
  db.prepare("INSERT INTO conversations(id,visitor_id,companion_id,created_at,updated_at) VALUES ('benchmark-source',?,'benchmark',?,?)").run(owner, at, at);
  const queryVector = Array.from({ length: 1024 }, (_, i) => Math.sin(i * .31));
  const vector = Buffer.alloc(4096);
  queryVector.forEach((value, i) => vector.writeFloatLE(value, i * 4));
  const insert = db.prepare(`INSERT INTO memories(id,visitor_id,companion_id,content,search_tokens,layer,bucket,domain,memory_type,importance,confidence,status,observed_at,content_version,embedding,embedding_model,embedding_dimensions,embedding_content_version,created_at,updated_at)
    VALUES (?,?,'benchmark',?,?,'L3','key_detail','event','event',.8,'explicit','active',?,1,?,'text-embedding-v4',1024,1,?,?)`);
  const source = db.prepare("INSERT INTO memory_sources(memory_id,conversation_id) VALUES (?,'benchmark-source')");
  const scope = { AND: [{ user_id: owner }, { app_id: PERSONAL_MEMORY_APP_ID }, { metadata: { companion_id: 'benchmark' } }] };
  const query = buildRecallQuery({ opening: false, content: '周五的胃镜检查我有点紧张，团子最近也不舒服' });
  console.log(JSON.stringify({ machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model,
    memoryGiB: Math.round(totalmem() / 2 ** 30), node: process.version }, dimensions: 1024,
    methodology: 'file SQLite WAL; all scoped vectors scanned; 5 warmups and 30 measured queries; provider is deterministic in-memory, no network' }));
  let inserted = 0;
  for (const size of [100, 1000, 10000]) {
    db.transaction(() => {
      while (inserted < size) {
        const id = `memory-${String(inserted++).padStart(5, '0')}`;
        const content = inserted % 17 === 0 ? `用户周五要做胃镜，养了一只叫团子的猫 ${id}` : `用户记住了散步、蓝色和日常安排 ${id}`;
        insert.run(id, owner, content, indexMemoryTokens(content), at, vector, at, at);
        source.run(id);
      }
    }).immediate();
    for (const mode of ['keyword', 'hybrid'] as const) {
      const gateway = createSqliteMemoryGateway(db, { retrievalMode: mode, embed: async () => [queryVector] });
      const timings: number[] = [];
      for (let i = 0; i < 35; i++) {
        const start = performance.now(); await gateway.search(query, scope); const elapsed = performance.now() - start;
        if (i >= 5) timings.push(elapsed);
      }
      timings.sort((a, b) => a - b);
      console.log(JSON.stringify({ size, mode, p50Ms: +timings[14].toFixed(2), p95Ms: +timings[28].toFixed(2), maxMs: +timings[29].toFixed(2), samples: 30 }));
    }
  }
} finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
}
void main();
