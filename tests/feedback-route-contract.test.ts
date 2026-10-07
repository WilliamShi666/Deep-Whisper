import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('personal feedback preserves GET/POST, owner guard and derived message scope',()=>{
 const source=read('src/app/api/feedback/route.ts');
 assert.match(source,/export function GET/);
 assert.match(source,/export function POST/);
 assert.match(source,/ownerRoute\(request/);
 assert.match(source,/getOwnedMessage\(owner/);
 assert.match(source,/role !== 'assistant'/);
 assert.doesNotMatch(source,/body\.conversation_id|body\.companion_id|supabase/);
 assert.match(read('src/lib/personal/core-repository.ts'),/ON CONFLICT\(message_id,visitor_id\)/);
});
test('team admin and payment surfaces are absent from the personal edition',()=>{
 for(const path of ['src/app/api/admin/feedback/route.ts','src/app/api/admin/session/route.ts','src/app/admin/feedback/page.tsx']) assert.equal(existsSync(new URL('../'+path,import.meta.url)),false);
});
