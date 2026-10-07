import { NextResponse } from 'next/server';
import { getSqlite } from '@/storage/database/db';
import { requireOwner, OwnerAccessError } from '@/lib/personal/owner';
import { markLetterRead } from '@/lib/letters/personal-repository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}) {
 let owner:string;try {owner=requireOwner(request);}catch(error){return NextResponse.json({error:'Owner access required',code:error instanceof OwnerAccessError?error.code:'OWNER_ACCESS_REQUIRED'},{status:error instanceof OwnerAccessError?error.status:401});}
 let body:unknown;try{body=await request.json();}catch{return NextResponse.json({error:'Invalid read action',code:'LETTERS_READ_INVALID'},{status:400});}
 if(!body||typeof body!=='object'||Object.keys(body).length!==1||(body as {read?:unknown}).read!==true)return NextResponse.json({error:'Only marking a letter read is supported',code:'LETTERS_READ_INVALID'},{status:400});
 try {const {id}=await context.params;const letter=markLetterRead(getSqlite(),owner,id);return letter?NextResponse.json({letter:{...letter,created_at:new Date(letter.created_at).toISOString(),read_at:new Date(letter.read_at!).toISOString()}}):NextResponse.json({error:'Letter not found',code:'LETTERS_NOT_FOUND'},{status:404});}
 catch{return NextResponse.json({error:'Unable to mark letter read',code:'LETTERS_READ_FAILED'},{status:500});}
}
