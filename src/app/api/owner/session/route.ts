import { NextResponse } from 'next/server';
import {getPersonalConfig} from '@/lib/config/runtime';
import {validateOwnerRequest,validateOwnerSession,createOwnerSession,attemptOwnerLogin,OWNER_COOKIE,OwnerAccessError} from '@/lib/personal/owner';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function failure(error:unknown){return NextResponse.json({error:error instanceof OwnerAccessError?error.message:'Session request failed',code:error instanceof OwnerAccessError?error.code:'SESSION_ERROR'},{status:error instanceof OwnerAccessError?error.status:500});}
export async function GET(request:Request){try{validateOwnerRequest(request,process.env,{allowUnauthenticated:true});const config=getPersonalConfig(process.env,{strict:false});const cookie=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${OWNER_COOKIE}=`))?.slice(OWNER_COOKIE.length+1);return NextResponse.json({authenticated:config.accessMode==='local'||validateOwnerSession(cookie),accessMode:config.accessMode},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
  validateOwnerRequest(request,process.env,{allowUnauthenticated:true});const config=getPersonalConfig(process.env,{strict:false});
  if(config.accessMode==='local') return NextResponse.json({authenticated:true,accessMode:'local'});
  const body=await request.json();const result=attemptOwnerLogin(body.password);
  if(!result.authenticated) return NextResponse.json({error:result.status===429?'Too many attempts. Try again in 15 minutes.':'Incorrect password',code:result.status===429?'LOGIN_RATE_LIMITED':'OWNER_AUTH_REQUIRED'},{status:result.status});
  const response=NextResponse.json({authenticated:true,accessMode:config.accessMode});
  response.cookies.set(OWNER_COOKIE,createOwnerSession(),{httpOnly:true,sameSite:'strict',secure:new URL(config.appBaseUrl).protocol==='https:',path:'/',maxAge:7*24*60*60});return response;
}catch(e){return failure(e);}}
export async function DELETE(request:Request){try{validateOwnerRequest(request);const response=NextResponse.json({authenticated:false,accessMode:getPersonalConfig(process.env,{strict:false}).accessMode});response.cookies.set(OWNER_COOKIE,'',{httpOnly:true,sameSite:'strict',path:'/',maxAge:0});return response;}catch(e){return failure(e);}}
