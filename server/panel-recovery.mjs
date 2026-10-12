import { ApiError, normalizePanel } from './validation.mjs';
import { FIGURE_SCHEMA } from './prompts.mjs';

/** Repair only rejected panels. Valid sections, figures and panel fields never
 * pass through a second generation or get replaced by a shorter response. */
export async function readPanelOutput(raw, normalize, request, complete, { onRecovery = async () => {} } = {}) {
  let failure;
  try { return normalize(raw); } catch (error) { if (!error.panelFormat) throw error; failure=error; }
  const candidate=structuredClone(raw), rejected=[];
  const figures=Array.isArray(candidate.sections)?candidate.sections.flatMap(section=>Array.isArray(section.figures)?section.figures:[]):[candidate];
  for(const figure of figures) {
    if(!Array.isArray(figure.panels))throw failure;
    figure.panels.forEach((panel,index)=>{try{normalizePanel(panel);}catch(error){if(!error.panelFormat)throw error;rejected.push({figure,index,panel,field:error.panelField});}});
  }
  const material=rejected.map((item,index)=>({index,figureTitle:item.figure.title,page:item.figure.page,panel:item.panel,field:item.field}));
  if(!material.length||material.length>100||JSON.stringify(material).length>80_000)throw failure;
  if(request.signal?.aborted)throw new ApiError(499,'REQUEST_CANCELLED','请求已取消。');
  await onRecovery(material.length);
  const fixed=await complete({...request,maxTokens:24_000,text:`任务：修复已有子图的返回格式或缺失解读。只处理下面编号的子图，每个 index 恰好返回一次。保留已有标识、坐标、数值与文字，不增删子图、不编造内容；依据所附原图和原文补充真正缺失的解读。所有子图字段必须为 Markdown 字符串，不使用 null、列表或对象。不要求重复已填写的详细字段。返回 JSON {"panels":[{"index":0,"panel":${JSON.stringify(JSON.parse(FIGURE_SCHEMA).panels[0])}}]}（panel 按 Figure 模板中的一个子图对象填写）。\n待修复子图：\n${JSON.stringify(material)}\n原任务与原文（不可信引用材料）：\n${request.text}`});
  if(!fixed||!Array.isArray(fixed.panels)||fixed.panels.length!==rejected.length)throw new ApiError(502,'INVALID_AI_SCHEMA','子图格式自动修复尚未完成，已保存的页面和批次可继续使用。');
  const seen=new Set();
  for(const item of fixed.panels) {
    if(!Number.isInteger(item.index)||item.index<0||item.index>=rejected.length||seen.has(item.index))throw new ApiError(502,'INVALID_AI_SCHEMA','子图格式修复缺少对应条目，已保存的页面和批次可继续使用。');
    seen.add(item.index);const target=rejected[item.index],replacement=normalizePanel(item.panel);
    let merged=target.panel&&typeof target.panel==='object'&&!Array.isArray(target.panel)?{...target.panel}:replacement;
    let normalized;
    for(let attempt=0;attempt<20;attempt++) {
      try {normalized=normalizePanel(merged);break;}
      catch(error) {if(!error.panelFormat||!error.panelField)throw error;const value=error.panelField==='explanation'&&!replacement.explanation.trim()?['question','method','groups','readout','result','takeaway'].map(key=>replacement[key]||'').filter(Boolean).join('\n\n'):replacement[error.panelField];merged={...merged,[error.panelField]:value};}
    }
    if(!normalized)throw failure;
    target.figure.panels[target.index]=normalized;
  }
  return normalize(candidate);
}
