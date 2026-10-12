import { exportBackup, readLocal, writeLocal } from './storage';
export type BackupEntry={id:string;createdAt:number;bytes:number;paperCount:number};
export type BackupStatus={lastSuccess?:number;error?:string;running?:boolean};
let active:Promise<BackupEntry>|null=null;
export function backupPreferences(){return readLocal('auto-backup',{enabled:true,keep:7});}
function status(value:BackupStatus){writeLocal('auto-backup-status',value);window.dispatchEvent(new Event('paperlens-backup-status'));}
export function runAutomaticBackup():Promise<BackupEntry>{
  if(active)return active;
  const previous=readLocal<BackupStatus>('auto-backup-status',{});
  status({...previous,error:undefined,running:true});
  active=(async()=>{
    try{
      const backup=await exportBackup();
      const response=await fetch('/api/backups?keep='+backupPreferences().keep,{method:'POST',headers:{'Content-Type':'application/gzip'},body:backup.blob,redirect:'error'});
      const entry=await response.json();if(!response.ok)throw new Error(entry.error||'自动备份未能保存');
      status({lastSuccess:entry.createdAt});return entry;
    }catch(e){status({...previous,running:false,error:(e as Error).message});throw e;}
    finally{active=null;}
  })();return active;
}
