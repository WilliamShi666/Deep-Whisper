'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useApiError, useLocale, useT } from '@/lib/i18n-client';

type Preference={in_app_enabled:boolean;email_enabled:boolean;email_address:string|null;email_status:'enabled'|'paused'|'suppressed'|'unsubscribed';timezone:string;is_default:boolean};
type Letter={id:string;companion_name:string;subject:string;body:string;created_at:string;read_at:string|null};
type PreferencesResponse={preference?:Preference;email?:{enabled:boolean};error?:string};
export function CompanionLetterSettings({open}:{open:boolean}) {
 const t=useT();const apiError=useApiError();const {locale}=useLocale();
 const generation=useRef(0);const savingRef=useRef(false);
 const [preference,setPreference]=useState<Preference|null>(null);
 const [emailAvailable,setEmailAvailable]=useState(false);
 const [email,setEmail]=useState('');const [timezone,setTimezone]=useState('Asia/Shanghai');
 const [letters,setLetters]=useState<Letter[]>([]);const [expanded,setExpanded]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState<string|null>(null);const [restoreOpen,setRestoreOpen]=useState(false);
 const load=useCallback(async()=>{
  const current=++generation.current;setLoading(true);setError(null);
  try {
   const [settingsRes,inboxRes]=await Promise.all([apiFetch('/api/letters/preferences',{signal:AbortSignal.timeout(15_000)}),apiFetch('/api/letters',{signal:AbortSignal.timeout(15_000)})]);
   const settings=await settingsRes.json() as PreferencesResponse;const inbox=await inboxRes.json() as {letters?:Letter[]};
   if(generation.current!==current)return;
   if(!settingsRes.ok||!settings.preference||!inboxRes.ok||!inbox.letters)throw new Error('Unable to load letters');
   setPreference(settings.preference);setEmailAvailable(!!settings.email?.enabled);setEmail(settings.preference.email_address??'');
   setTimezone(settings.preference.is_default?Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai':settings.preference.timezone);setLetters(inbox.letters);
  }catch {if(generation.current===current)setError(t('chat.letters.load_failed'));}
  finally{if(generation.current===current)setLoading(false);}
 },[t]);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 useEffect(()=>{if(open)void load();else setRestoreOpen(false);return invalidate;},[open,load,invalidate]);
 const update=async(patch:Record<string,unknown>)=>{
  if(!open||!preference||savingRef.current||loading||error)return;
  const current=generation.current;savingRef.current=true;setSaving(true);
  try {const res=await apiFetch('/api/letters/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch),signal:AbortSignal.timeout(15_000)});const data=await res.json() as PreferencesResponse;
   if(current!==generation.current)return;
   if(!res.ok||!data.preference){toast.error(apiError(data,{feature:'letters',fallback:t('chat.letters.save_failed')}));return;}
   setPreference(data.preference);setEmail(data.preference.email_address??'');setTimezone(data.preference.timezone);setRestoreOpen(false);toast.success(t('chat.letters.personal_saved'));
  }catch{if(current===generation.current)toast.error(t('chat.letters.save_failed'));}
  finally{savingRef.current=false;setSaving(false);}
 };
 const read=async(letter:Letter)=>{
  setExpanded(expanded===letter.id?null:letter.id);if(letter.read_at)return;
  try {const response=await apiFetch(`/api/letters/${encodeURIComponent(letter.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({read:true})});const data=await response.json() as {letter?:Letter};if(response.ok&&data.letter)setLetters(prior=>prior.map(value=>value.id===letter.id?data.letter!:value));}catch{toast.error(t('chat.letters.read_failed'));}
 };
 const disabled=!preference||loading||saving||!!error;const terminal=preference?.email_status==='unsubscribed'||preference?.email_status==='suppressed';
 return <section className="rounded-xl border border-border bg-card/60 p-3" data-testid="companion-letter-settings">
  <div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4 text-primary"/>{t('chat.letters.title')}{loading&&<Loader2 className="size-3.5 animate-spin"/>}</h3><p className="mt-1 text-xs text-muted-foreground">{t('chat.letters.personal_inapp_hint')}</p></div>
   <Switch checked={!!preference?.in_app_enabled} disabled={disabled} onCheckedChange={checked=>void update({in_app_enabled:checked,timezone})} aria-label={t('chat.letters.switch_aria')}/></div>
  <div className="mt-3 flex items-center gap-2"><label className="text-xs text-muted-foreground" htmlFor="letter-timezone">{t('chat.letters.timezone')}</label><Input id="letter-timezone" value={timezone} onChange={event=>setTimezone(event.target.value)} disabled={disabled} className="h-8 min-w-0 text-xs"/><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={()=>void update({timezone})}>{t('chat.letters.save')}</Button></div>
  <div className="mt-3 border-t border-border pt-3"><div className="flex items-center justify-between gap-2"><label htmlFor="letter-email-copy" className="text-xs font-medium">{t('chat.letters.email_copy')}</label><Switch id="letter-email-copy" checked={!!preference?.email_enabled} disabled={disabled||(!emailAvailable&&!preference?.email_enabled)||(!email.trim()&&!preference?.email_enabled)} onCheckedChange={checked=>checked&&terminal?setRestoreOpen(true):void update({email_enabled:checked,email_address:email})}/></div>
   <p className="mt-1 text-xs text-muted-foreground">{emailAvailable?t('chat.letters.email_copy_hint'):t('chat.letters.email_not_configured')}</p>
   {terminal&&<p className="mt-1 text-xs text-muted-foreground">{t('chat.letters.email_stopped')}</p>}
   <div className="mt-2 flex gap-2"><Input type="email" value={email} onChange={event=>setEmail(event.target.value)} disabled={disabled} placeholder={t('chat.letters.email_placeholder')} aria-label={t('chat.letters.email_copy')}/><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={()=>void update({email_address:email||null})}>{t('chat.letters.save')}</Button></div>
  </div>
  <div className="mt-3 border-t border-border pt-3" data-testid="letter-inbox"><h4 className="text-xs font-medium">{t('chat.letters.inbox')}</h4>{!letters.length&&!loading&&<p className="mt-1 text-xs text-muted-foreground">{t('chat.letters.inbox_empty')}</p>}<div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{letters.map(letter=><article key={letter.id} className="rounded-lg bg-muted/40 p-2"><button type="button" className="w-full text-left" onClick={()=>void read(letter)} aria-expanded={expanded===letter.id}><span className="block text-xs font-medium">{!letter.read_at&&'● '}{letter.subject}</span><span className="block text-[11px] text-muted-foreground">{letter.companion_name} · {new Date(letter.created_at).toLocaleDateString(locale)}</span></button>{expanded===letter.id&&<p className="mt-2 whitespace-pre-wrap text-sm">{letter.body}</p>}</article>)}</div></div>
  <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('chat.letters.restore_title')}</AlertDialogTitle><AlertDialogDescription>{t('chat.letters.restore_body')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('chat.letters.restore_cancel')}</AlertDialogCancel><AlertDialogAction disabled={disabled} onClick={()=>void update({email_enabled:true,email_address:email,reconsent:true})}>{t('chat.letters.restore_confirm')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  {error&&<div className="mt-2 text-xs text-destructive">{error}<Button type="button" size="sm" variant="ghost" onClick={()=>void load()}>{t('chat.letters.reload')}</Button></div>}
 </section>;
}
