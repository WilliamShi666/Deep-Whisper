import type {EmailProvider} from './contracts';
import {getProviderConfig,isE2EMockProviderMode} from '@/lib/config/runtime';
import {E2EMockEmailProvider} from './providers/e2e-mock-email-provider';
import {ResendEmailProvider} from './providers/resend-email-provider';
import {SmtpEmailProvider,EmailSendError} from './providers/smtp-email-provider';
export function getEmailProvider(env:Readonly<Record<string,string|undefined>>=process.env):EmailProvider {
 const provider=getProviderConfig(env).email.provider;
 if(provider==='none')return {send:async()=>{throw new EmailSendError('Email is not configured','rejected');}};
 if(isE2EMockProviderMode(env))return new E2EMockEmailProvider();
 return provider==='smtp'?new SmtpEmailProvider(env):new ResendEmailProvider(env);
}
