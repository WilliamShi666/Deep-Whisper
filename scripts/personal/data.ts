import {loadScriptEnv} from '../lib/load-script-env';
import {getPersonalConfig} from '../../src/lib/config/runtime';
import {openDatabase,DATABASE_VERSION} from '../../src/storage/database/db';
import {createDataBackup,restoreDataBackup} from '../../src/lib/personal/backup';
import {existsSync} from 'node:fs';import path from 'node:path';
import {claimInstanceLock} from '../../src/lib/personal/instance-lock';
async function main(){loadScriptEnv();const config=getPersonalConfig(process.env,{strict:false});const command=process.argv[2];
 if(command==='backup')console.info(await createDataBackup(config.dataDir));
 else if(command==='restore'){const [backup,target]=process.argv.slice(3);if(!backup||!target)throw new Error('Usage: pnpm data:restore <backup-directory> <new-data-directory> (app offline)');await restoreDataBackup(path.resolve(backup),path.resolve(target));console.info('Restored to new directory. Set APP_DATA_DIR to it while the app is stopped.');}
 else if(command==='migrate'){
  const release=claimInstanceLock(config.dataDir);try{
  if(existsSync(path.join(config.dataDir,'deep-whisper.sqlite')))console.info('Backup:',await createDataBackup(config.dataDir));
  const db=openDatabase({dataDir:config.dataDir,allowMigrate:true});db.close();console.info(`Database ready at version ${DATABASE_VERSION}`);
  }finally{release();}
 }else throw new Error('Expected backup, restore or migrate');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Data operation failed');process.exitCode=1;});
