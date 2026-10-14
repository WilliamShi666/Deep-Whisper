import 'server-only';
import {cookies,headers} from 'next/headers';
import {personalDefaultLocale} from './personal/locale';
import {DEFAULT_LOCALE,LOCALE_COOKIE,parseLocale,type Locale} from './i18n/locale';
export async function getServerLocale():Promise<Locale>{try{return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value)??await getServerGeoDefault();}catch{return DEFAULT_LOCALE;}}
/** Compatibility name: personal default follows the browser language, without geolocation. */
export async function getServerGeoDefault():Promise<Locale>{try{return personalDefaultLocale((await headers()).get('accept-language'));}catch{return DEFAULT_LOCALE;}}
