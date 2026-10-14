import {cpSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** A new file-only candidate; never carries the commercial repository's Git history. */
export function exportPersonalCandidate(root:string,target:string):{files:number} {
  root=path.resolve(root);target=path.resolve(target);
  if(existsSync(target)||target===root||target.startsWith(root+path.sep))throw new Error('Choose a new export directory outside this checkout');
  const requiredDocuments=['docs/opensource/README.md','docs/opensource/01-plan.md','docs/opensource/02-architecture.md','docs/opensource/03-spec.md','docs/opensource/04-environment.md','docs/opensource/implementation/acceptance-ledger.md','docs/opensource/implementation/api-contracts.md','docs/opensource/implementation/api-contracts-letters.md'];
  for(const file of requiredDocuments){const source=path.join(root,file);if(!existsSync(source)||!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw new Error(`Required public artifact is missing or unsafe: ${file}`);}
  const names=['src','public','scripts','tests','e2e','.github','package.json','pnpm-lock.yaml','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs','eslint.config.mjs','stylelint.config.mjs','components.json','playwright.config.ts','drizzle.config.ts','.gitignore','.dockerignore','.env.example','.env.advanced.example','README.md','README.en.md','AGENTS.md','DESIGN.md','Dockerfile','compose.yaml','LICENSE','ASSETS.md','THIRD_PARTY_NOTICES.md'];
  // Runtime outputs can exist even when Git ignores them. Only product static
  // assets belong in an export; the retired commercial landing page is unused.
  const excluded=['public/uploads','public/images','public/tts','public/tts-preview','public/landing','tests/fixtures/billing','scripts/docker-loopback-bin'];
  const files:string[]=[];
  function collect(relative:string) {
    if(excluded.some(prefix=>relative===prefix||relative.startsWith(prefix+'/')))return;
    const source=path.join(root,relative);if(!existsSync(source))return;
    const info=lstatSync(source);if(info.isSymbolicLink())throw new Error(`Export rejects symbolic paths: ${relative}`);
    if(info.isDirectory()){for(const child of readdirSync(source))collect(path.posix.join(relative,child));}
    else if(info.isFile())files.push(relative);
  }
  for(const name of names)collect(name);
  for(const name of ['README.md','01-plan.md','02-architecture.md','03-spec.md','04-environment.md','dependency-licenses.json'])collect('docs/opensource/'+name);
  for(const name of ['implementation/acceptance-ledger.md','implementation/api-contracts.md','implementation/api-contracts-letters.md'])collect('docs/opensource/'+name);
  for(const name of ['portability-provider-contracts.md','runbooks/ai-provider-live-canaries.md'])collect('docs/'+name);
  // Source scans are a review aid. Asset rights and a human publication checklist remain required.
  for(const file of files){
    if(!/\.(?:ts|tsx|js|mjs|cjs|json|md|yaml|yml)$/.test(file))continue;
    const content=readFileSync(path.join(root,file),'utf8');
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content))throw new Error(`Private key material detected in ${file}`);
  }
  mkdirSync(target,{recursive:false,mode:0o700});const manifest:Record<string,string>={};
  for(const file of files.sort()){
    const destination=path.join(target,file);mkdirSync(path.dirname(destination),{recursive:true});cpSync(path.join(root,file),destination);
    manifest[file]=createHash('sha256').update(readFileSync(destination)).digest('hex');
  }
  const docRoot=path.join(target,'docs','opensource');
  for(const file of ['README.md','01-plan.md','02-architecture.md','03-spec.md','04-environment.md']){
    const p=path.join(docRoot,file);if(!existsSync(p))continue;
    const text=readFileSync(p,'utf8').replace(/\[[^\]]*\]\((?:05-discovery|06-review)\.md\)/g,'内部探索与审查证据（公开包不含商业项目记录）');writeFileSync(p,text);
    manifest['docs/opensource/'+file]=createHash('sha256').update(text).digest('hex');
  }
  writeFileSync(path.join(target,'EXPORT-MANIFEST.json'),JSON.stringify({format:1,gitHistoryIncluded:false,assetPublicationApproved:false,files:manifest},null,2));
  return {files:files.length};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/personal/export.ts')){
  try{const target=process.argv[2];if(!target)throw new Error('Usage: pnpm export:personal <new-directory>');console.info(exportPersonalCandidate(process.cwd(),target));}
  catch(error){console.error(error instanceof Error?error.message:'Export failed');process.exitCode=1;}
}
