import { MESSAGES,translate } from '@/lib/i18n/messages';
import { getSqlite } from '@/storage/database/db';
import { getPrivateSecret } from '@/lib/personal/secrets';
import { verifyPersonalUnsubscribeToken } from '@/lib/email/personal-unsubscribe-token';
import { getLetterPreference, suppressEmail } from '@/lib/letters/personal-repository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Keep the signed URL out of Referer while preserving the form's same-origin Origin.
// no-referrer turns native non-CORS POST navigation into Origin:null in Chromium.
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'strict-origin','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
function render(state:'invalid'|'confirm'|'done'|'failed',token:string,english:boolean) {
 const messages=MESSAGES[english?'en':'zh-CN'];
 const title=translate(messages,'email.personal.unsubscribe_title');
 const button=translate(messages,'email.personal.unsubscribe_button');
 const copy={invalid:translate(messages,'email.personal.unsubscribe_invalid'),confirm:translate(messages,'email.personal.unsubscribe_confirm'),done:translate(messages,'email.personal.unsubscribe_done'),failed:translate(messages,'email.personal.unsubscribe_failed')};
 return `<!doctype html><html lang="${english?'en':'zh-CN'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><body><main><h1>${title}</h1><p>${copy[state]}</p>${state==='confirm'||state==='failed'?`<form method="post" action="/api/letters/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">${button}</button></form>`:''}</main></body></html>`;
}
function verified(request:Request) {
 const token=new URL(request.url).searchParams.get('token')??'';
 const owner=verifyPersonalUnsubscribeToken(token,getPrivateSecret('unsubscribe'));
 const visitor=owner?getSqlite().prepare('SELECT id,locale FROM visitors WHERE id=?').get(owner) as {id:string;locale:string|null}|undefined:undefined;
 return {token,owner:visitor?.id,english:visitor?.locale==='en'};
}
export async function GET(request:Request) {
 try {const view=verified(request);if(!view.owner)return new Response(render('invalid','',view.english),{status:400,headers});const pref=getLetterPreference(getSqlite(),view.owner);return new Response(render(pref.email_enabled?'confirm':'done',view.token,view.english),{headers});}
 catch{return new Response(render('failed','',false),{status:500,headers});}
}
export async function POST(request:Request) {
 try {const view=verified(request);if(!view.owner)return new Response(render('invalid','',view.english),{status:400,headers});const pref=getLetterPreference(getSqlite(),view.owner);suppressEmail(getSqlite(),view.owner,pref.email_status==='suppressed'?'suppressed':'unsubscribed');return new Response(render('done',view.token,view.english),{headers});}
 catch{return new Response(render('failed','',false),{status:500,headers});}
}
