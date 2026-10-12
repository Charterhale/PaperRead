import { useEffect } from 'react';
import { backupPreferences, runAutomaticBackup, type BackupStatus } from '../lib/automaticBackup';
import { listPapers, readLocal, writeLocal } from '../lib/storage';
export function useAutomaticBackup(){
  useEffect(()=>{
    const initial=readLocal<BackupStatus>('auto-backup-status',{});if(initial.running)writeLocal('auto-backup-status',{...initial,running:false});
    let attempt=0,disposed=false;
    const check=async()=>{
      const now=Date.now(),last=readLocal<BackupStatus>('auto-backup-status',{}).lastSuccess||0;
      if(!backupPreferences().enabled||now-last<86400000||now-attempt<3600000)return;
      attempt=now;
      try{if((await listPapers(true)).length&&!disposed)await runAutomaticBackup();}catch{/* Visible in Backup Manager; retry after one hour. */}
    };
    const start=setTimeout(()=>void check(),30000),timer=setInterval(()=>void check(),60000);
    return()=>{disposed=true;clearTimeout(start);clearInterval(timer);};
  },[]);
}
