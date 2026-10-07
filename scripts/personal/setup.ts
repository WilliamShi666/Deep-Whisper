import {existsSync,copyFileSync,mkdirSync} from 'node:fs';import path from 'node:path';
export function setupPersonal(root=process.cwd()):void {
 if(!existsSync(path.join(root,'.env.local')))copyFileSync(path.join(root,'.env.example'),path.join(root,'.env.local'));
 mkdirSync(path.join(root,'data'),{recursive:true,mode:0o700});
}
if(process.argv[1]?.endsWith('/setup.ts')||process.argv[1]?.endsWith('\\setup.ts')){setupPersonal();console.info('Setup ready. Fill .env.local, then run pnpm run doctor. Existing files were preserved.');}
