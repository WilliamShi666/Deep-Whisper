import { NextResponse } from 'next/server';
import { getSqlite } from '@/storage/database/db';
import { requireOwner, OwnerAccessError } from '@/lib/personal/owner';
import { listPersonalLetters } from '@/lib/letters/personal-repository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {const owner=requireOwner(request);return NextResponse.json({letters:listPersonalLetters(getSqlite(),owner).map(letter=>({...letter,created_at:new Date(letter.created_at).toISOString(),read_at:letter.read_at===null?null:new Date(letter.read_at).toISOString()}))},{headers:{'Cache-Control':'no-store'}});}
 catch(error){return NextResponse.json({error:'Unable to read letters',code:error instanceof OwnerAccessError?error.code:'LETTERS_READ_FAILED'},{status:error instanceof OwnerAccessError?error.status:500});}
}
