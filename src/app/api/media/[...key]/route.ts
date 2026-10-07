import {requireOwner,OwnerAccessError} from '@/lib/personal/owner';
import {readPrivateMedia,parseByteRange} from '@/lib/storage/local-object-store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{key:string[]}>}){
 try{
  requireOwner(request);const {key}=await context.params;const media=await readPrivateMedia(key.join('/'));
  const headers=new Headers({'Content-Type':media.mediaType,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
  const range=request.headers.get('range');
  if(range){try{const {start,end}=parseByteRange(range,media.bytes.length);headers.set('Content-Range',`bytes ${start}-${end}/${media.bytes.length}`);headers.set('Content-Length',String(end-start+1));return new Response(new Uint8Array(media.bytes.subarray(start,end+1)),{status:206,headers});}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${media.bytes.length}`}});}}
  headers.set('Content-Length',String(media.bytes.length));return new Response(new Uint8Array(media.bytes),{headers});
 }catch(e){return Response.json({error:e instanceof OwnerAccessError?e.message:'Media not found',code:e instanceof OwnerAccessError?e.code:'MEDIA_NOT_FOUND'},{status:e instanceof OwnerAccessError?e.status:404});}
}
