import { useEffect, useState } from 'react';
import { X, RotateCcw, Trash2 } from 'lucide-react';
import { listPapers, setPaperTrashed, deletePaper } from '../lib/storage';
import type { Paper } from '../types';
export default function TrashManager({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}){
  const [items,setItems]=useState<Paper[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const refresh=async()=>setItems((await listPapers(true)).filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt!-a.deletedAt!));
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
  async function action(p:Paper,permanent=false){
    if(permanent&&!confirm('永久删除「'+p.title+'」的文献库记录、PDF、解析和笔记？此操作无法在回收站撤销；已有备份仍保留。'))return;
    setBusy(true);setError('');try{if(permanent)await deletePaper(p.id);else await setPaperTrashed(p.id,false);await refresh();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="modal reader-modal" role="dialog" aria-label="回收站"><button className="modal-close icon-btn" title="关闭回收站" onClick={onClose} disabled={busy}><X size={18}/></button><h2>回收站</h2><p className="muted">保留 PDF、解析、裁图、笔记、高亮和阅读记录，不自动清空。</p>{items.map(p=><div className="trash-row" key={p.id}><div><strong>{p.title}</strong><small>{new Date(p.deletedAt!).toLocaleString()} · {p.pageCount} 页</small></div><button className="subtle-button" disabled={busy} onClick={()=>void action(p)}><RotateCcw size={13}/>恢复</button><button className="icon-btn" disabled={busy} title={'永久删除 '+p.title} onClick={()=>void action(p,true)}><Trash2 size={14}/></button></div>)}{!items.length&&<p>回收站为空。</p>}{error&&<p role="alert">{error}</p>}</section></div>;
}
