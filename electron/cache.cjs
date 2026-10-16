const {readFile,writeFile,rename,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const DAY=86400000;
const PERIODS=new Set([0,1,7,30]);
/** Only Chromium HTTP cache is disposable. Never clear storage, documents or jobs. */
function createCacheManager({session,directory,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onChange=()=>{}}){
 const file=path.join(directory,'cache-preferences.json');
 let state={intervalDays:0,anchorAt:0,lastClearedAt:0},timer,closed=false,queue=Promise.resolve();
 const ready=(async()=>{try{const saved=JSON.parse(await readFile(file,'utf8'));if(PERIODS.has(saved.intervalDays))state={intervalDays:saved.intervalDays,anchorAt:Number.isFinite(saved.anchorAt)&&saved.anchorAt>0?saved.anchorAt:now(),lastClearedAt:Number.isFinite(saved.lastClearedAt)&&saved.lastClearedAt>0?saved.lastClearedAt:0};}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}})();
 const nextAt=()=>state.intervalDays?state.anchorAt+state.intervalDays*DAY:null;
 async function persist(next){await mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,file);state=next;}
 function schedule(retry=false){clearTimer(timer);if(closed||!state.intervalDays)return;const delay=Math.min(2147483647,Math.max(retry?3600000:1000,nextAt()-now()));timer=setTimer(()=>{void run(async()=>{if(nextAt()&&now()>=nextAt())await clear();else schedule();}).catch(()=>schedule(true));},delay);timer?.unref?.();}
 function run(work){const task=queue.then(()=>ready).then(work);queue=task.catch(()=>{});return task;}
 async function status(){return {bytes:await session.getCacheSize(),intervalDays:state.intervalDays,lastClearedAt:state.lastClearedAt||null,nextClearingAt:nextAt()};}
 async function clear(){const before=await session.getCacheSize();await session.clearCache();const stamp=now();await persist({...state,anchorAt:stamp,lastClearedAt:stamp});schedule();onChange();return {...await status(),clearedBytes:before};}
 return {
  start:()=>run(()=>schedule()),
  status:()=>run(status),
  clear:()=>run(clear),
  setIntervalDays:days=>run(async()=>{if(!PERIODS.has(days))throw Error('请选择关闭、每天、每周或每月');await persist({...state,intervalDays:days,anchorAt:now()});schedule();onChange();return status();}),
  resume:()=>run(()=>schedule()),
  close:()=>{closed=true;clearTimer(timer);return queue;},
 };
}
module.exports={createCacheManager};
