import { NextResponse } from 'next/server';
import { getProviderConfig } from '@/lib/config/runtime';
import { getSqlite } from '@/storage/database/db';
import { applyPersonalDeliveryEvent } from '@/lib/letters/personal-repository';
import { deliveryStatusForEvent, verifyResendWebhook } from '@/lib/letters/webhook';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
 const secret=process.env.RESEND_WEBHOOK_SECRET?.trim();
 if(getProviderConfig().email.provider!=='resend'||!secret)return NextResponse.json({error:'Not configured'},{status:404});
 if(Number(request.headers.get('content-length')??0)>64_000)return NextResponse.json({error:'Payload too large'},{status:413});
 const body=await request.text();if(Buffer.byteLength(body)>64_000)return NextResponse.json({error:'Payload too large'},{status:413});
 const eventId=request.headers.get('svix-id');
 if(!verifyResendWebhook({id:eventId,timestamp:request.headers.get('svix-timestamp'),signature:request.headers.get('svix-signature'),body,secret}))return NextResponse.json({error:'Invalid signature'},{status:401});
 let event:{type?:unknown;data?:{email_id?:unknown}};try{event=JSON.parse(body);}catch{return NextResponse.json({error:'Invalid payload'},{status:400});}
 const status=deliveryStatusForEvent(event.type);const messageId=event.data?.email_id;
 if(!status)return NextResponse.json({ok:true});
 if(!eventId||typeof messageId!=='string'||!messageId||messageId.length>200||eventId.length>200)return NextResponse.json({error:'Invalid delivery event'},{status:400});
 try{const outcome=applyPersonalDeliveryEvent(getSqlite(),{eventId,messageId,status});return NextResponse.json({ok:true,...(outcome==='pending'?{pending:true}:{})});}
 catch{return NextResponse.json({error:'Webhook processing failed'},{status:500});}
}
