import { Check, Clock3, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { BackgroundJob } from '../types';
import AnalysisCoverage from './AnalysisCoverage';
const labels:Record<BackgroundJob['status'],string>={preparing:'准备页面',queued:'等待中',running:'正在解析',paused:'已暂停',completed:'已完成',failed:'未完成',cancelled:'已取消'};
type Props={jobs:BackgroundJob[];preparingIds?:string[];onClose:()=>void;onCancel:(id:string)=>void;onRetry:(id:string)=>void;onDelete:(id:string)=>void;onOpen:(paperId:string)=>void;onApply:(job:BackgroundJob)=>void};
export default function JobsDrawer({jobs,preparingIds=[],onClose,onCancel,onRetry,onDelete,onOpen,onApply}:Props){
 return <div className="modal-backdrop"><div className="modal reader-modal jobs-modal"><button className="modal-close icon-btn" title="关闭后台任务" onClick={onClose}><X size={18}/></button><h2>后台解析任务</h2><p className="muted">检查页面 → 分批准备原图 → 后台解析 → 合并全文。可以继续阅读其他文献；退出后保留已保存的原图和已完成批次，下次可继续。</p>
 {!jobs.length?<div className="jobs-empty"><Clock3 size={27}/><p>还没有解析任务</p><span>导入文献后点击“开始深度解析”，或在文献库中批量加入。</span></div>:jobs.map(j=>{
  const active=['queued','running'].includes(j.status)||preparingIds.includes(j.id);
  const pending=j.status==='preparing'&&!active;
  return <div className="job-card" key={j.id}><div className="job-card-title"><strong>{j.title}</strong><span className={'job-status '+j.status}>{active?<LoaderCircle size={12} className="spin"/>:j.status==='completed'?<Check size={12}/>:null}{pending?'等待继续':labels[j.status]}</span></div><div className="progress-track"><span style={{width:j.progress+'%'}}/></div><p>{j.error||j.message}</p>{j.provider&&<small className="job-coverage-hint">使用 {j.provider==='codex'?'Codex · '+(j.model==='codex-auto'?'自动模型':j.model||'自动模型')+' · '+({low:'低',medium:'中',high:'高'}[j.reasoningEffort||'medium'])+'推理':'DeepSeek · API'} · 继续任务时沿用此服务</small>}
   {j.preparation&&j.status!=='completed'&&<small className="job-coverage-hint">原图已保存 {j.preparation.receivedPages.length} / {j.preparation.expectedPages.length} 页{pending?' · 继续时只补充剩余页面':''}</small>}
   {j.result?.coverage&&<AnalysisCoverage coverage={j.result.coverage}/>}
   <div className="job-card-actions"><small>{Math.round(j.progress)}% · {new Date(j.updatedAt).toLocaleString()}</small><button className="subtle-button" onClick={()=>onOpen(j.paperId)}>打开文献</button>{j.status==='completed'&&j.result&&<button className="subtle-button" onClick={()=>onApply(j)}>应用此解析</button>}{active?<button className="subtle-button" onClick={()=>onCancel(j.id)}>取消</button>:<>{j.status!=='completed'&&<button className="subtle-button" onClick={()=>onRetry(j.id)}><RotateCcw size={12}/>继续 / 重试</button>}{pending?<button className="subtle-button" onClick={()=>onCancel(j.id)}>取消</button>:<button title="删除任务记录" className="icon-btn" onClick={()=>onDelete(j.id)}><Trash2 size={13}/></button>}</>}</div></div>;
 })}</div></div>;
}
