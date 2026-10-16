import {useEffect,useRef} from 'react';
import type {Paper,Settings} from '../types';
import {aiRequest} from '../lib/aiSettings';
const pending=new Map<string,Promise<string>>();
export function translateTitle(p:Paper,settings:Settings):Promise<string>{
 if(p.titleTranslation?.original===p.title)return Promise.resolve(p.titleTranslation.text);
 const key=p.id+'\n'+p.title+'\n'+settings.provider;const existing=pending.get(key);if(existing)return existing;
 const task=(async()=>{const r=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:p.title,mode:'title',...aiRequest(settings)}),signal:AbortSignal.timeout(120000)}),v=await r.json();if(!r.ok)throw Error(v.error||'标题翻译失败');if(typeof v.translation!=='string'||!v.translation.trim()||v.translation.length>5000)throw Error('标题译文格式错误');return v.translation.trim();})();
 pending.set(key,task);void task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>{});return task;
}
/** Import-time work runs serially and never switches the visible title. */
export function useTitleTranslation(papers:Paper[],settings:Settings,onReady:(p:Paper,text:string)=>Promise<unknown>){
 const latest=useRef({papers,settings,onReady});latest.current={papers,settings,onReady};const active=useRef(false),attempted=useRef(new Set<string>());
 useEffect(()=>{if(active.current)return;active.current=true;(async()=>{try{while(true){const p=latest.current.papers.find(p=>p.autoTranslateTitle!==false&&!p.deletedAt&&p.titleTranslation?.original!==p.title&&!attempted.current.has(p.id+'\n'+p.title));if(!p)break;attempted.current.add(p.id+'\n'+p.title);if(/[\p{Script=Han}]/u.test(p.title))continue;const config=latest.current.settings;if(config.provider==='deepseek'&&!config.apiKey)continue;try{const text=await translateTitle(p,config);await latest.current.onReady(p,text);}catch{/* Manual translation remains available; no repeated background spending. */}}}finally{active.current=false;}})();},[papers,settings]);
}
