import {NextResponse,type NextRequest} from 'next/server';
import {getPersonalConfig} from '@/lib/config/runtime';
import {maintenanceActive} from '@/lib/personal/maintenance';
import {validateOwnerRequest,OwnerAccessError} from '@/lib/personal/owner';
import {assertInstanceOwnership,InstanceOwnershipLost} from '@/lib/personal/instance-lock';
export function proxy(request:NextRequest){
 const pathname=request.nextUrl.pathname;
 const publicEndpoint=['/api/owner/session','/api/capabilities','/api/webhooks/resend','/api/letters/unsubscribe'].includes(pathname);
 try{
  assertInstanceOwnership(getPersonalConfig(process.env,{strict:false}).dataDir);
  validateOwnerRequest((pathname==='/api/webhooks/resend'||pathname==='/api/letters/unsubscribe')?new Request(request.url,{headers:request.headers}):request,process.env,{allowUnauthenticated:publicEndpoint,allowPublicNavigation:pathname==='/api/letters/unsubscribe'&&request.method==='GET'});
  if(pathname!=='/api/owner/session'&&!['GET','HEAD','OPTIONS'].includes(request.method)&&maintenanceActive(getPersonalConfig(process.env,{strict:false}).dataDir))return NextResponse.json({error:'Data backup is in progress. Try again shortly.',code:'MAINTENANCE_IN_PROGRESS'},{status:503,headers:{'Retry-After':'5'}});
  return NextResponse.next();
 }catch(e){return NextResponse.json({error:e instanceof OwnerAccessError||e instanceof InstanceOwnershipLost?e.message:'Configuration invalid',code:e instanceof InstanceOwnershipLost?'INSTANCE_OWNERSHIP_LOST':e instanceof OwnerAccessError?e.code:'CONFIGURATION_INVALID'},{status:e instanceof InstanceOwnershipLost?503:e instanceof OwnerAccessError?e.status:500});}
}
export const config={matcher:'/api/:path*'};
