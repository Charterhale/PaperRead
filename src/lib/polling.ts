import {readLocal} from './storage';
/** Keep running jobs responsive without waking an idle reader every few seconds. */
export function startJobPolling(work:()=>Promise<boolean|void>){
 let stopped=false,running=false,active=false,again=false,timer:ReturnType<typeof setTimeout>;
 function schedule(){clearTimeout(timer);if(stopped)return;const saving=readLocal<string>('energy-mode','auto')==='saving';const delay=document.hidden?(saving?120000:60000):active?(saving?5000:2400):(saving?120000:30000);timer=setTimeout(()=>void poll(),delay);}
 async function poll(){if(stopped)return;if(running){again=true;return;}clearTimeout(timer);running=true;try{active=!!await work();}finally{running=false;if(again){again=false;if(!stopped)void poll();}else schedule();}}
 const visible=()=>{if(!document.hidden)void poll();};
 const changed=()=>schedule(),jobsChanged=()=>void poll();document.addEventListener('visibilitychange',visible);window.addEventListener('paperlens-reading-preferences',changed);window.addEventListener('paperlens-jobs-changed',jobsChanged);void poll();
 return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('paperlens-reading-preferences',changed);window.removeEventListener('paperlens-jobs-changed',jobsChanged);};
}
