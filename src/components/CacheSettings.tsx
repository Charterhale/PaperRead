import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
export type CacheStatus={bytes:number;intervalDays:number;lastClearedAt:number|null;nextClearingAt:number|null;clearedBytes?:number};
function size(bytes:number){if(bytes<1024)return bytes+' B';if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB';return (bytes/1048576).toFixed(1)+' MB';}
function date(stamp:number|null){return stamp?new Date(stamp).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'尚未清理';}
export default function CacheSettings(){
 const bridge=window.paperReadDesktop;
 const available=!!(bridge?.getCacheStatus&&bridge?.clearCache&&bridge?.setCacheInterval);
 const [status,setStatus]=useState<CacheStatus|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(!available)return;let closed=false;const refresh=()=>{void bridge!.getCacheStatus!().then(v=>{if(!closed){setStatus(v);setError('');}}).catch(e=>{if(!closed)setError(e.message);});};refresh();const off=bridge?.onCacheChanged?.(refresh);window.addEventListener('focus',refresh);return()=>{closed=true;off?.();window.removeEventListener('focus',refresh);};},[available,bridge]);
 async function action(work:()=>Promise<CacheStatus>,clearing=false){setBusy(true);setError('');setMessage('');try{const value=await work();setStatus(value);if(clearing)setMessage('已清理 '+size(value.clearedBytes||0)+' 临时缓存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="setting-group cache-settings"><h3>缓存与节能</h3><div className="cache-size-row"><span>临时缓存 <strong aria-label="缓存大小">{status?size(status.bytes):available?'读取中…':'仅桌面版支持'}</strong></span><div><button className="icon-btn tiny" title="刷新缓存大小" aria-label="刷新缓存大小" disabled={!available||busy} onClick={()=>void action(()=>bridge!.getCacheStatus!())}><RefreshCw size={15}/></button><button className="subtle-button" disabled={!status||busy} onClick={()=>void action(()=>bridge!.clearCache!(),true)}>{busy?'处理中…':'立即清理'}</button></div></div>
 <label>定时清理<select aria-label="定时清理缓存" value={status?.intervalDays||0} disabled={!status||busy} onChange={e=>void action(()=>bridge!.setCacheInterval!(Number(e.target.value)))}><option value={0}>关闭 · 手动清理</option><option value={1}>每天</option><option value={7}>每周</option><option value={30}>每 30 天</option></select></label>
 {status&&<p className="form-hint">上次：{date(status.lastClearedAt)}{status.nextClearingAt?' · 下次：'+date(status.nextClearingAt):''}</p>}
 <p className="form-hint">只清理可重新下载的临时资源，保留 PDF、MD、解析、笔记和对话。到期时若软件未运行，下次打开后清理。</p>
 {message&&<p className="form-hint" role="status">{message}</p>}{error&&<p className="form-hint" role="alert">缓存操作失败：{error}，请重试。</p>}
 </div>;
}
