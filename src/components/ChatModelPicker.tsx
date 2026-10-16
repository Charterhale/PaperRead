import {useEffect,useRef,useState} from 'react';
import {Cpu,Settings2,Zap} from 'lucide-react';
import type {CodexModel,Settings} from '../types';
import ActionMenu from './ActionMenu';

// Use the installed client's real catalog; never invent an available model.
export default function ChatModelPicker({settings,onSettings,onAdvanced}:{settings:Settings;onSettings:(value:Settings)=>void;onAdvanced:()=>void}){
 const [models,setModels]=useState<CodexModel[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function load(){if(settings.provider==='deepseek'||loading)return;setLoading(true);try{const r=await fetch('/api/codex/models'),v=await r.json();if(!r.ok)throw Error(v.error||'模型列表暂不可用');if(alive.current){setModels(v.models||[]);setError('');}}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setLoading(false);}}
 const selected=models.find(m=>m.id===settings.model),efforts=selected?.efforts||['low','medium','high'];
 const fast=models.find(m=>/luna|nano|mini|spark/i.test(m.id)&&m.efforts.includes('low'))||models.find(m=>m.efforts.includes('low')&&m.id===settings.model);
 function chooseModel(model:string){const chosen=models.find(m=>m.id===model),effort=settings.reasoningEffort||'medium';onSettings({...settings,model,codexModel:settings.provider==='codex'?model:settings.codexModel,deepseekModel:settings.provider==='deepseek'?model:settings.deepseekModel,reasoningEffort:chosen&&!chosen.efforts.includes(effort)?chosen.efforts[0]||'medium':effort,quickReply:false});}
 const fastLabel=settings.provider==='deepseek'?'DeepSeek Flash':fast?.name;
 return <ActionMenu label="选择提问模型" icon={<Cpu size={16}/>} onOpen={()=>void load()} className="chat-model-picker" popupClassName="chat-model-menu">
  <label>模型<select aria-label="提问模型" value={settings.model} onChange={e=>chooseModel(e.target.value)}>{settings.provider==='deepseek'?<><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></>:<><option value="codex-auto">跟随 Codex 默认</option>{settings.model!=='codex-auto'&&!selected&&<option value={settings.model}>{settings.model} · 已保存</option>}{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</>}</select></label>
  {settings.provider!=='deepseek'&&<label>推理强度<select aria-label="提问推理强度" value={settings.reasoningEffort||'medium'} onChange={e=>onSettings({...settings,reasoningEffort:e.target.value as Settings['reasoningEffort'],quickReply:false})}>{(['low','medium','high'] as const).map((v,i)=><option key={v} value={v} disabled={!efforts.includes(v)}>{['低 · 更快','中 · 均衡','高 · 深入'][i]}</option>)}</select></label>}
  <button type="button" className="chat-quick-button" aria-pressed={!!settings.quickReply} disabled={settings.provider!=='deepseek'&&!fast} title={fastLabel?`${fastLabel} · 低推理 · 简短回答`:'等待可用模型'} onClick={()=>onSettings({...settings,model:settings.provider==='deepseek'?'deepseek-flash':fast!.id,reasoningEffort:'low',quickReply:true})}><Zap size={14}/>极速回答</button>
  <small>{loading?'正在读取模型…':error|| (fastLabel?`${fastLabel} · ${settings.provider==='deepseek'?'简短直答':'低推理，简短直答'}`:'可手动选择模型与推理强度')}</small>
  <button type="button" onClick={onAdvanced}><Settings2 size={14}/>模型设置</button>
 </ActionMenu>;
}
