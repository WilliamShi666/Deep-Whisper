import {getSqlite} from '@/storage/database/db';
import {DEFAULT_LOCALE,parseLocale,type Locale} from './locale';
export async function loadVisitorLocale(visitorId:string|null|undefined):Promise<Locale>{
 if(!visitorId)return DEFAULT_LOCALE;
 try{const row=getSqlite().prepare('SELECT locale FROM visitors WHERE id=?').get(visitorId) as {locale:string|null}|undefined;return parseLocale(row?.locale)??DEFAULT_LOCALE;}catch{return DEFAULT_LOCALE;}
}
