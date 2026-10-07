import {NextResponse} from 'next/server';
export const runtime='nodejs';
/** Scheduling is local and supervised by dev/start; there is no public cron trigger. */
export async function GET(){return NextResponse.json({error:'Not found'},{status:404});}
