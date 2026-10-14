import {expect,type APIRequestContext,type Page,type Locator} from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import {realpathSync} from 'node:fs';
import os from 'node:os';
export type Locale='zh-CN'|'en';
export const profile=process.env.E2E_PROFILE||'keyword';
export function fixtureDb(){
 if(process.env.APP_ENV!=='test'||process.env.E2E_MOCK_PROVIDERS!=='1'||!process.env.E2E_DATA_DIR)throw new Error('Synthetic runner required');
 const dir=realpathSync(process.env.E2E_DATA_DIR);
 if(!dir.startsWith(path.join(realpathSync(os.tmpdir()),'dw-e2e-')))throw new Error('Refusing non-E2E SQLite fixture');
 const db=new Database(path.join(dir,'deep-whisper.sqlite'));db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');return db;
}
export function resetFixture(){const db=fixtureDb();try{db.transaction(()=>{db.exec('DELETE FROM companions; DELETE FROM user_profiles; DELETE FROM letter_preferences;');db.prepare('UPDATE visitors SET gender=NULL,orientation=NULL,palette=NULL,locale=NULL,ui_theme=NULL').run();})()}finally{db.close()}}
export async function json(request:APIRequestContext,url:string,method='GET',data?:unknown){const r=await request.fetch(url,{method,data,headers:method==='GET'?{}:{Origin:process.env.E2E_BASE_URL!}});expect(r.ok(),`${method} ${url}: ${await r.text()}`).toBeTruthy();return r.json()}
export async function chooseLocale(page:Page,locale:Locale){const button=page.getByTestId('locale-switch');await expect(button).toBeVisible();const target=locale==='en'?'English':'中文';if((await button.getAttribute('aria-label'))?.includes(target))await button.click();await expect(button).toHaveAttribute('aria-label',locale==='en'?/中文/:/English/)}
export async function choosePalette(page:Page,value:'rose'|'blue'){const button=page.getByTestId('palette-toggle');if(await button.getAttribute('data-palette-value')===value)await button.click();await expect(button).not.toHaveAttribute('data-palette-value',value)}
export async function customize(page:Page,locale:Locale,{repick=false,index=0}:{repick?:boolean;index?:number}={}){
 await page.addInitScript(()=>{const original=window.fetch;const target=window as unknown as {e2eChatFrames:string[]};target.e2eChatFrames=[];window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/chat')&&response.headers.get('content-type')?.includes('event-stream'))void response.clone().text().then(body=>target.e2eChatFrames.push(body));return response}});
 const hydrated=page.waitForResponse(r=>r.url().endsWith('/api/visitor')&&r.status()===200);await page.goto(repick?'/onboarding?repick=1':'/onboarding');await hydrated;await chooseLocale(page,locale);
 if(!repick){await page.getByRole('button',{name:locale==='en'?'Start the story':'开始心动',exact:true}).click();await page.getByRole('button',{name:locale==='en'?'Male':'男生',exact:true}).click();await page.getByRole('button',{name:locale==='en'?'A girlfriend':'女朋友',exact:true}).click();await page.getByRole('button',{name:locale==='en'?'Next':'下一步',exact:true}).click()}
 const cards=page.locator('main button').filter({has:page.locator('h3')});await expect(cards).toHaveCount(4);await cards.nth(index).click();await expect(page.locator('#onboarding-companion-name')).toBeVisible();
}
export async function meet(page:Page,locale:Locale){await page.getByRole('button',{name:locale==='en'?'Meet them':'遇见 TA',exact:true}).click();await expect(page.getByTestId('chat-shell')).toBeVisible();await expect(page.getByTestId('message-textarea')).toBeEnabled();await expect(page.getByTestId('voice-bar').first()).toBeVisible();}
export async function send(page:Page,content:string,locale:Locale){const count=await page.evaluate(()=>(window as unknown as {e2eChatFrames:string[]}).e2eChatFrames.length);await page.getByTestId('message-textarea').fill(content);const done=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');await page.getByRole('button',{name:locale==='en'?'Send':'发送',exact:true}).click();const r=await done;expect(r.status()).toBe(200);await expect.poll(()=>page.evaluate(()=>(window as unknown as {e2eChatFrames:string[]}).e2eChatFrames.length)).toBeGreaterThan(count);const body=await page.evaluate(()=>(window as unknown as {e2eChatFrames:string[]}).e2eChatFrames.at(-1)!);expect(body).toContain('"type":"chunk"');expect(body).toContain('"type":"done"');await expect(page.getByTestId('message-textarea')).toBeEnabled();return body;}
export async function openSettings(page:Page,locale:Locale){await page.getByTestId('active-companion-header').getByRole('button',{name:locale==='en'?'Settings':'设置',exact:true}).click();await expect(page.getByTestId('companion-settings')).toBeVisible()}
export async function hitTest(locator:Locator){await locator.scrollIntoViewIfNeeded();expect(await locator.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===el||el.contains(hit)})).toBe(true)}
