import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';import test from 'node:test';
function sourceFiles(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{const file=path.join(root,entry.name);return entry.isDirectory()?sourceFiles(file):/\.(ts|tsx|mjs|cjs|js)$/.test(file)?[file]:[];});}
test('personal active code has no commercial SDK imports or database provider imports',()=>{
 const violations:string[]=[];
 for(const file of [...sourceFiles('src'),...sourceFiles('scripts')]){
  const content=readFileSync(file,'utf8');
  if(/(?:from|import\s*\(|require\s*\()\s*['"](?:@supabase\/|@waffo\/|mem0ai|pg['"]|coze-coding)/.test(content))violations.push(file);
 }
 assert.deepEqual(violations,[]);
});
test('personal dependency and configuration templates have no inherited commercial credentials',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 assert.equal(pkg.dependencies['@supabase/supabase-js'],undefined);assert.equal(pkg.dependencies['@waffo/pancake-ts'],undefined);assert.equal(pkg.dependencies.mem0ai,undefined);assert.equal(pkg.dependencies.pg,undefined);
 for(const file of ['.env.example','.env.advanced.example'])assert.doesNotMatch(readFileSync(file,'utf8'),/SUPABASE_|WAFFO_|MEM0_API_KEY|DATABASE_URL|TURNSTILE_|CRON_SECRET/);
});
