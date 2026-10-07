import { headers } from 'next/headers';
import type { NextResponse } from 'next/server';
import { getPersonalConfig } from '@/lib/config/runtime';
import { requireOwner } from '@/lib/personal/owner';
export const VISITOR_COOKIE='vl_visitor_id';
export const VISITOR_HEADER='x-visitor-id';
export const SESSION_HEADER='x-session';
export interface AuthIdentity {id:string;email:string|null;emailConfirmedAt?:string|null}
export interface VisitorIdentity {visitorId:string|null;isNew:boolean;authUser:AuthIdentity|null;claimed:boolean}
export async function getVisitorId():Promise<string|null> {
  const h=await headers();
  return requireOwner(new Request(`${getPersonalConfig(process.env,{strict:false}).appBaseUrl}/api/visitor`,{headers:h}));
}
export async function getVisitorIdWithAuth():Promise<{visitorId:string|null;isAuthed:boolean}> {return {visitorId:await getVisitorId(),isAuthed:true};}
export async function getOrCreateVisitorId():Promise<{visitorId:string;isNew:boolean}> {return {visitorId:(await getVisitorId())!,isNew:false};}
export async function resolveCurrentIdentity():Promise<VisitorIdentity> {return {visitorId:await getVisitorId(),isNew:false,authUser:null,claimed:false};}
export async function resolveVisitorIdentity(_createIfMissing=false):Promise<VisitorIdentity> {return resolveCurrentIdentity();}
export function attachVisitorCookie(_response:NextResponse,_visitorId:string):void {}
export async function setVisitorId(_visitorId:string):Promise<void> {}
