import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Paper, PdfHighlight } from '../types';
import { buildSearchIndex, searchDocuments, type SearchHit } from '../lib/unifiedSearch';
import { getPdf, getSupplementPdf, readLocal, writeLocal } from '../lib/storage';
import { openPdf } from '../lib/pdf';
export default function UnifiedSearch({papers,currentId,onGo,onClose}:{papers:Paper[];currentId:string;onGo:(hit:SearchHit)=>void;onClose:()=>void}){
  const [query,setQuery]=useState(''),[scope,setScope]=useState('current'),[kind,setKind]=useState('全部'),[limit,setLimit]=useState(50),[status,setStatus]=useState('正在读取高亮与批注…');
  const [maps,setMaps]=useState<Record<string,Record<string,PdfHighlight[]>>>({});
  useEffect(()=>{let cancelled=false;void(async()=>{
    const annotations:Record<string,Record<string,PdfHighlight[]>>={};let failed=0;
    for(const p of papers){
      const map=readLocal<Record<string,string>>('annotation-map-'+p.id,{});annotations[p.id]={};
      for(const id of ['main',...(p.supplements||[]).map(s=>s.id)]){
        if(cancelled)return;
        try{
          if(!map[id]){const bytes=p.demo?new Uint8Array(await(await fetch('/demo.pdf')).arrayBuffer()):id==='main'?await getPdf(p.id):await getSupplementPdf(p.id,id);if(bytes){const task=openPdf(bytes);try{const doc=await task.promise;map[id]='paperlens-pdf-'+doc.fingerprints[0];}finally{await task.destroy();}writeLocal('annotation-map-'+p.id,map);}}
          const value=JSON.parse(localStorage.getItem(map[id])||'{}');annotations[p.id][id]=Array.isArray(value.highlights)?value.highlights:[];
        }catch{failed++;}
      }
    }
    if(!cancelled){setMaps(annotations);setStatus(failed?failed+' 份 PDF 的高亮暂未读入，其他内容可搜索':'');}
  })();return()=>{cancelled=true;};},[papers]);
  const deferred=useDeferredValue(query),index=useMemo(()=>buildSearchIndex(papers,maps),[papers,maps]);
  const hits=useMemo(()=>searchDocuments(index,deferred,kind,scope==='current'?currentId:undefined),[index,deferred,kind,scope,currentId]);
  useEffect(()=>setLimit(50),[query,scope,kind]);
  return <div className="modal-backdrop"><section className="unified-search" role="dialog" aria-label="统一搜索"><header><Search size={19}/><input autoFocus aria-label="搜索全文、解析、笔记和批注" placeholder="搜索原文、图解、笔记或批注…" value={query} onChange={e=>setQuery(e.target.value)}/><button className="icon-btn" title="关闭统一搜索" onClick={onClose}><X size={18}/></button></header><div className="search-filters"><select aria-label="搜索范围" value={scope} onChange={e=>setScope(e.target.value)}><option value="current">当前文献</option><option value="all">整个文献库</option></select><select aria-label="搜索内容类型" value={kind} onChange={e=>setKind(e.target.value)}>{['全部','资料','原文','解析','子图','笔记','高亮'].map(k=><option key={k}>{k}</option>)}</select><small>{query?hits.length+' 个结果':'输入关键词，空格分隔多个关键词'}</small></div><div className="search-results">{hits.slice(0,limit).map(h=><button className="search-result" key={h.id} onClick={()=>onGo(h)}><div><span>{h.kind}</span><strong>{h.title}</strong></div><p>{h.snippet}</p><small>{h.paperTitle}</small></button>)}{query&&!hits.length&&<p className="muted">没有匹配结果。扫描 PDF 的原文检索需要文字识别结果；已有解析仍可搜索。</p>}{hits.length>limit&&<button className="subtle-button" onClick={()=>setLimit(n=>n+50)}>显示更多结果</button>}</div><footer>{status||'点击结果直达内容；对应折叠项会自动展开。'} <kbd>⌘ K</kbd></footer></section></div>;
}
