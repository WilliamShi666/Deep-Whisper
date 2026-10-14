/** Compatibility entry point for local tooling. Personal deployment uses the supervised worker. */
import {getSqlite} from '@/storage/database/db';
import {processLetterJobs} from './personal-scheduler';
import type {writeGroundedLetter} from './writer';
import type {recallLongTermMemories,rememberSentLetter} from '@/lib/memory';
import type {EmailMessage,EmailReceipt} from '@/lib/email/contracts';
import type {LetterSkipReason} from './policy';
export interface LetterSchedulerDependencies {recall?:typeof recallLongTermMemories;write?:typeof writeGroundedLetter;send?:(message:EmailMessage)=>Promise<EmailReceipt>;maxAcceptedSends?:number;remember?:typeof rememberSentLetter}
export interface LetterCronReport {scanned:number;sent:number;skipped:number;failed:number;cancelled:number;retried:number;accepted:number;confirmationRequired?:number;skipReason?:LetterSkipReason;isWindowEnd:boolean;dailyQuotaRemaining?:number;dailyCapReached?:boolean}
export async function runCompanionLetterCron(now=new Date(),dependencies:LetterSchedulerDependencies={}):Promise<LetterCronReport> {
 const report=await processLetterJobs(getSqlite(),{now,writeLetter:dependencies.write,send:dependencies.send});
 return {scanned:1,sent:report.accepted,skipped:0,failed:report.failed,cancelled:0,retried:0,accepted:report.accepted,confirmationRequired:report.unknown,isWindowEnd:false};
}
