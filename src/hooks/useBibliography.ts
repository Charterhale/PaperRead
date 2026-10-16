import { useEffect, useRef, useState } from 'react';
import type { Paper } from '../types';
import { doiFromPaper, type JournalInfo, type JournalSource, type MetadataPatch } from '../lib/bibliography';
import { readLocal, writeLocal } from '../lib/storage';
export function useBibliography(papers:Paper[],onMissing:(id:string,patch:MetadataPatch)=>Promise<boolean>){
 const [journals,setJournals]=useState<Record<string,JournalInfo|null>>({}),[source,setSource]=useState<JournalSource|null>(null),[updating,setUpdating]=useState(false),[revision,setRevision]=useState(0),[error,setError]=useState('');
 const latest=useRef(papers),apply=useRef(onMissing),attempted=useRef(new Set<string>()),working=useRef(false),force=useRef(false),alive=useRef(true);latest.current=papers;apply.current=onMissing;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let cancelled=false;const controller=new AbortController();void(async()=>{
  try{const matches:Record<string,JournalInfo|null>={};for(let i=0;i<papers.length;i+=100){const r=await fetch('/api/journals/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({papers:papers.slice(i,i+100).map(p=>({id:p.id,journal:p.journal||'',issns:p.issns||[]}))}),signal:controller.signal});if(!r.ok)throw Error();const value=await r.json();Object.assign(matches,value.matches||{});if(value.source&&!cancelled)setSource(value.source);}if(!cancelled)setJournals(matches);}catch{/* Local dataset lookup retries when library metadata changes. */}
 })();return()=>{cancelled=true;controller.abort();};},[papers.map(p=>[p.id,p.journal,p.issns?.join(',')].join(':')).join('|'),revision]);
 useEffect(()=>{
  if(working.current)return;working.current=true;
  void(async()=>{try{for(;;){
   const cooldown=readLocal<Record<string,number>>('metadata-attempts-v2',{}),key=(p:Paper)=>[p.id,doiFromPaper(p),p.title].join('|');
   const target=latest.current.find(p=>!p.demo&&(force.current||!p.authors||!p.journal||!p.year||p.citationCount===undefined||Date.now()-(p.citationUpdatedAt||0)>7*86400000)&&!attempted.current.has(key(p))&&Date.now()-(cooldown[key(p)]||0)>6*3600000);if(!target||!alive.current)break;
   const id=key(target);attempted.current.add(id);setUpdating(true);
   try{const r=await fetch('/api/metadata/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:target.title,doi:doiFromPaper(target),...(force.current?{refresh:true}:{})}),signal:AbortSignal.timeout(35000)});if(!r.ok)throw Error();const value=await r.json();if(!alive.current)break;if(value.metadata){await apply.current(target.id,value.metadata);setError('');}else setError('部分文献尚未找到准确匹配，可编辑资料或稍后重试');}catch{if(alive.current)setError('部分文献资料暂未补齐，可稍后重试');}
   writeLocal('metadata-attempts-v2',{...readLocal<Record<string,number>>('metadata-attempts-v2',{}),[id]:Date.now()});
  }}finally{working.current=false;force.current=false;if(alive.current)setUpdating(false);}})();
 },[papers,revision]);
 return {journals,source,updating,error,retry:()=>{force.current=true;writeLocal('metadata-attempts-v2',{});attempted.current.clear();setError('');setRevision(n=>n+1);}};
}
