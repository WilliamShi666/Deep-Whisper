import type {EmailMessage} from './contracts';
import type {Locale} from '@/lib/i18n/locale';
import {DEFAULT_LOCALE} from '@/lib/i18n/locale';
import {MESSAGES,translate} from '@/lib/i18n/messages';
function escape(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}
export function buildPersonalLetterEmail(input:{to:string;fromAddress:string;replyTo?:string;companionName:string;subject:string;body:string;locale?:Locale;unsubscribeUrl?:string;siteUrl?:string;idempotencyKey?:string}):EmailMessage {
 if(!input.companionName.trim())throw new Error('Letter email requires a companion name');
 if(!input.subject.trim())throw new Error('Letter email requires a subject');
 if(!input.body.trim())throw new Error('Letter email requires a body');
 const locale=input.locale??DEFAULT_LOCALE;const english=locale==='en';
 const hint=translate(MESSAGES[locale],'email.personal.reply_hint');
 const stopCopies=translate(MESSAGES[locale],'email.personal.stop_copies');
 const url=input.unsubscribeUrl?new URL(input.unsubscribeUrl):null;
 if(url&&url.protocol!=='https:')throw new Error('Public unsubscribe URL must use HTTPS');
 const footer=url?stopCopies+': '+url.toString():'';
 return {to:input.to,from:{address:input.fromAddress,name:input.companionName.trim()},replyTo:input.replyTo,subject:input.subject.trim(),text:[input.body,hint,footer].filter(Boolean).join('\n\n'),html:`<!doctype html><html lang="${english?'en':'zh-CN'}"><body><h1>${escape(input.subject.trim())}</h1>${input.body.split(/\n+/).map(p=>'<p>'+escape(p)+'</p>').join('')}<p>${escape(hint)}</p>${url?'<p><a href="'+escape(url.toString())+'">'+escape(stopCopies)+'</a></p>':''}</body></html>`,idempotencyKey:input.idempotencyKey,...(url?{headers:{'List-Unsubscribe':`<${url.toString()}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}:{})};
}
