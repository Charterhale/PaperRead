import { aiRequest, supportsVision } from '../lib/aiSettings';
import { useEffect, useRef, useState } from 'react';
import type { BackgroundJob, Paper, Settings } from '../types';
import { inspectPdfVisualPages, renderPdfImageBatches } from '../lib/pdf';
import {syncDocument} from '../lib/documentFiles';
import { getPdf } from '../lib/storage';

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<BackgroundJob> {
  const response = await fetch('/api/jobs/' + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal});
  const value = await response.json().catch(() => ({error:'本地解析服务暂时无法响应，请继续此任务'}));
  if (!response.ok) throw new Error(value.error || '任务操作失败');
  return value;
}
type Preparation = {controller: AbortController; job: BackgroundJob};

/** Rendering is a separate, bounded queue so changing the open paper never interrupts a job. */
export function useAnalysisPreparation(serverJobs: BackgroundJob[], refresh: () => Promise<unknown>, report: (message:string) => void) {
  const [local, setLocal] = useState<Record<string,BackgroundJob>>({});
  const controls = useRef(new Map<string,Preparation>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const callbacks = useRef({refresh,report}); callbacks.current = {refresh,report};
  useEffect(() => { mounted.current=true; return () => {mounted.current=false;for (const p of controls.current.values()) p.controller.abort();}; }, []);
  function update(paperId:string, job:BackgroundJob) {
    const entry=controls.current.get(paperId); if(entry) entry.job=job;
    if(mounted.current) setLocal(previous=>({...previous,[paperId]:job}));
  }
  function forget(paperId:string) { if(mounted.current) setLocal(previous=>{const next={...previous};delete next[paperId];return next;}); }
  function enqueue(paper:Paper, settings:Settings, existing?:BackgroundJob) {
    if(controls.current.has(paper.id)) return;
    const controller=new AbortController(), now=Date.now();
    let job:BackgroundJob=existing||{id:'local-'+paper.id,paperId:paper.id,title:paper.title,status:'preparing',progress:0,message:'等待检查 PDF 页面',createdAt:now,updatedAt:now};
    controls.current.set(paper.id,{controller,job});update(paper.id,job);
    const check=()=>controller.signal.throwIfAborted();
    const progress=(message:string,percent=job.progress)=>{job={...job,status:'preparing',error:undefined,message,progress:percent,updatedAt:Date.now()};update(paper.id,job);};
    chain.current=chain.current.catch(()=>{}).then(async()=>{
      try {
        check(); const bytes=await getPdf(paper.id);check();
        if(!bytes) throw new Error('无法读取此文献的 PDF，请重新导入后继续');
        progress('正在保存原文 Markdown，识别扫描页');
        const source=await syncDocument(paper,bytes,true);check();
        if(!existing) {
          progress('正在检查含图、矢量绘图和扫描页面');
          const pages=await inspectPdfVisualPages(bytes,(done,total)=>{check();progress(`检查页面 ${done} / ${total}`,Math.round(done/total*4));});
          check();
          const expectedVisualPages=pages.filter(p=>p.kind!=='text').map(p=>p.page);
          if(expectedVisualPages.length&&(!settings.vision||!supportsVision(settings))) throw new Error(`检测到 ${expectedVisualPages.length} 页图片、扫描内容或待确认页面。请在设置中选择支持原图的模型并开启“结合原图解析”，再继续任务。`);
          // Do not abort staging: retain its returned ID even if cancellation races the response.
          job=await post('stage',{paperId:paper.id,title:paper.title,pages:source.pages,sourceFormat:'markdown',category:paper.category,...aiRequest(settings),pipelineVersion:2,images:[],expectedVisualPages,visualPlan:{version:1,pages}});
          update(paper.id,job);
          if(controller.signal.aborted) {await post(job.id+'/cancel',{});check();}
          if(job.status!=='preparing') {await callbacks.current.refresh();forget(paper.id);return;}
        }
        check();
        const expected=job.preparation?.expectedPages||[];
        const received=new Set(job.preparation?.receivedPages||[]);
        const missing=expected.filter(page=>!received.has(page));
        progress(`准备页面原图 ${received.size} / ${expected.length}`,Math.round(received.size/Math.max(1,expected.length)*10));
        for await(const batch of renderPdfImageBatches(bytes,missing,{maxImages:4,maxBytes:8*1024*1024,maxWidth:2000,quality:.94,signal:controller.signal})) {
          check();
          job=await post(job.id+'/images',{images:batch.images},controller.signal);
          const done=job.preparation?.receivedPages.length||0;
          progress(`已保存原图 ${done} / ${expected.length}，分批准备中`,Math.round(done/Math.max(1,expected.length)*10));
        }
        check();progress('原图已备齐，正在加入后台解析',10);
        job=await post(job.id+'/start',aiRequest(settings));
        if(controller.signal.aborted) await post(job.id+'/cancel',{});
        await callbacks.current.refresh();forget(paper.id);
      } catch(error) {
        if(controller.signal.aborted) {forget(paper.id);await callbacks.current.refresh();}
        else {
          const message=error instanceof Error?error.message:'页面准备失败，请继续此任务';
          // A stage request may have saved successfully even if its response was lost.
          const refreshed=await callbacks.current.refresh();
          if(job.id.startsWith('local-')&&Array.isArray(refreshed)) {
            const saved=(refreshed as BackgroundJob[]).find(j=>j.paperId===paper.id&&['preparing','queued','running'].includes(j.status));
            if(saved)job=saved;
          }
          if(['queued','running','completed'].includes(job.status)){forget(paper.id);return;}
          update(paper.id,{...job,status:job.id.startsWith('local-')?'failed':'preparing',error:message,message,updatedAt:Date.now()});
          callbacks.current.report(paper.title+'：'+message);
        }
      } finally {controls.current.delete(paper.id);if(mounted.current)setLocal(previous=>({...previous}));}
    });
  }
  async function cancel(id:string) {
    const entry=[...controls.current.values()].find(p=>p.job.id===id);
    const job=entry?.job||Object.values(local).find(j=>j.id===id)||serverJobs.find(j=>j.id===id);
    entry?.controller.abort();
    if(job&&!id.startsWith('local-')) await post(id+'/cancel',{});
    if(job) forget(job.paperId);
    await callbacks.current.refresh();
  }
  function discard(id:string) {const job=Object.values(local).find(j=>j.id===id);if(job)forget(job.paperId);}
  // Server state wins once a job proceeds beyond preparing, including remote cancellation.
  const jobs=[...serverJobs.map(j=>local[j.paperId]?.id===j.id&&j.status==='preparing'?local[j.paperId]:j),...Object.values(local).filter(j=>!serverJobs.some(s=>s.id===j.id))].sort((a,b)=>b.createdAt-a.createdAt);
  const preparingIds=Object.values(local).filter(j=>controls.current.has(j.paperId)).map(j=>j.id);
  return {jobs,preparingIds,enqueue,cancel,discard};
}
