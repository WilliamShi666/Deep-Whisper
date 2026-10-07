import type {ObjectStore} from '@/lib/ai';
import {getProviderConfig} from '@/lib/config/runtime';
import {createLocalObjectStore} from './local-object-store';
import {createR2ObjectStore} from './r2-object-store';
export function getObjectStore():ObjectStore {return getProviderConfig().objectStorage.provider==='local'?createLocalObjectStore():createR2ObjectStore();}
