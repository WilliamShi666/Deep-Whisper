import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
import type {EmailMessage,EmailProvider,EmailReceipt} from '../contracts';
import {formatSender} from './resend-email-provider';
type Env=Readonly<Record<string,string|undefined>>;
type Transport={sendMail:(message:Record<string,unknown>)=>Promise<{messageId?:string;accepted?:unknown[];rejected?:unknown[]}>};
export class EmailSendError extends Error {constructor(message:string,readonly outcome:'rejected'|'unknown',readonly retryable=false){super(message);this.name='EmailSendError';}}
export class SmtpEmailProvider implements EmailProvider {
 constructor(private env:Env=process.env,private createTransport:(options:Record<string,unknown>)=>Transport=options=>nodemailer.createTransport(options)){}
 async send(message:EmailMessage):Promise<EmailReceipt> {
  const required=(key:string)=>{const value=this.env[key]?.trim();if(!value)throw new EmailSendError(`Missing ${key}`,'rejected');return value;};
  const from=required('EMAIL_FROM');const port=Number(this.env.SMTP_PORT?.trim()||'587');
  if(port!==465&&port!==587)throw new EmailSendError('SMTP_PORT must be 465 or 587','rejected');
  if(message.from.address.toLowerCase()!==from.toLowerCase()||/[\r\n]/.test(message.subject)||!message.subject.trim()||!/^\S+@\S+\.\S+$/.test(message.to))throw new EmailSendError('Invalid email envelope','rejected');
  const transport=this.createTransport({host:required('SMTP_HOST'),port,secure:port===465,requireTLS:port===587,auth:{user:required('SMTP_USER'),pass:required('SMTP_PASSWORD')},connectionTimeout:15_000,greetingTimeout:15_000,socketTimeout:message.timeoutMs??30_000});
  try {const receipt=await transport.sendMail({from:formatSender(message.from),to:message.to,subject:message.subject,text:message.text,html:message.html,replyTo:message.replyTo??this.env.EMAIL_REPLY_TO??from,headers:message.headers});
   if(receipt.rejected?.length||!receipt.accepted?.length)throw new EmailSendError('SMTP rejected recipient','rejected');
   return {provider:'smtp',providerMessageId:receipt.messageId??randomUUID(),deliveryStatus:'accepted'};
  }catch(error){if(error instanceof EmailSendError)throw error;const value=error as {code?:string;responseCode?:number;command?:string};
   if(value.responseCode&&value.responseCode>=400)throw new EmailSendError('SMTP server rejected message','rejected',value.responseCode<500);
   if(['EAUTH','ETLS','EDNS','ECONNREFUSED'].includes(value.code??'')||value.command==='CONN')throw new EmailSendError('SMTP connection or authentication failed','rejected',value.code!=='EAUTH'&&value.code!=='ETLS');
   throw new EmailSendError('SMTP submission outcome unknown','unknown');
  }
 }
}
