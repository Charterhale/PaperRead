import type { Paper, Panel, PdfTarget, PdfHighlight } from '../types';
import { panelFields } from './analysisEditing';
import { rotateRegion } from './preciseNavigation';
export type SearchKind='资料'|'原文'|'解析'|'子图'|'笔记'|'高亮';
export type SearchHit={id:string;paperId:string;paperTitle:string;kind:SearchKind;title:string;text:string;snippet:string;documentId:string;target?:PdfTarget;sectionId?:string;figureId?:string;panelIndex?:number;field?:string;noteOffset?:number};
export type SearchDocument=Omit<SearchHit,'snippet'>;
export function buildSearchIndex(papers:Paper[],annotationMaps:Record<string,Record<string,PdfHighlight[]>>={}):SearchDocument[]{
  const entries:SearchDocument[]=[];
  for(const p of papers.filter(p=>!p.deletedAt)){
    let seq=0;const add=(kind:SearchKind,title:string,text:string,extra:Partial<SearchDocument>={})=>{if(text?.trim())entries.push({id:p.id+':'+seq++,paperId:p.id,paperTitle:p.title,kind,title,text,documentId:'main',...extra});};
    add('资料',p.title,[p.title,p.fileName,p.authors,p.journal,p.doi,p.pmid,...(p.tags||[])].filter(Boolean).join(' · '));
    for(const d of [{id:'main',title:'正文',pages:p.pages},...(p.supplements||[])])d.pages.forEach((text,i)=>add('原文',d.title+' · 第 '+(i+1)+' 页',text,{documentId:d.id,target:{page:i+1}}));
    if(p.analysis){
      add('解析','文章概览',p.analysis.overview,{field:'overview'});
      for(const s of p.analysis.sections){
        const base={sectionId:s.id,target:s.source||{page:s.page,text:s.title}};
        for(const [field,title,text] of [['title','小节标题',s.title],['summary','这一节做了什么',s.summary],['proves','主要结果',s.proves],['markdown','详细解析',s.markdown]])add('解析',s.title+' · '+title,text,{...base,field});
        for(const f of s.figures){
          const extra={...base,figureId:f.id,target:f.source||{page:f.page,text:f.title}};
          add('解析',f.title+' · 图注',f.caption,{...extra,field:'caption'});
          f.panels.forEach((panel,index)=>{
            for(const [key,label] of [...panelFields,['label','子图编号'],['type','图形类型'],['explanation','完整讲解']] as [keyof Panel,string][]){const value=panel[key as keyof Panel];if(typeof value==='string')add('子图',f.title+' '+panel.label+' · '+label,value,{...extra,panelIndex:index,field:key,target:{page:f.page,...(panel.crop?{region:panel.crop}:{text:f.title})}});}
          });
        }
      }
    }
    let offset=0;for(const block of p.notes.split(/\n\n/)){add('笔记','我的笔记',block,{noteOffset:offset});offset+=block.length+2;}
    for(const [doc,highlights] of Object.entries(annotationMaps[p.id]||{}))for(const h of highlights){add('高亮',(h.category||'原文摘录')+' · 第 '+h.page+' 页',[h.text,h.comment].filter(Boolean).join('\n'),{documentId:doc,target:{page:h.page,text:h.text,...(h.rectangles?.[0]?{region:rotateRegion(h.rectangles[0],(360-(h.rotation||0))%360)}:{})}});}
  }
  return entries;
}
export function searchDocuments(index:SearchDocument[],query:string,kind='全部',paperId?:string):SearchHit[]{
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return [];
  return index.flatMap(entry=>{
    if((paperId&&entry.paperId!==paperId)||(kind!=='全部'&&kind!==entry.kind))return [];
    const text=entry.text.toLocaleLowerCase();if(!terms.every(t=>text.includes(t)))return [];
    const position=Math.min(...terms.map(t=>text.indexOf(t))),start=Math.max(0,position-55),snippet=(start?'…':'')+entry.text.slice(start,start+190)+(start+190<entry.text.length?'…':'');
    // Use an actual source substring for PDF positioning, including multi-item lines.
    const target=entry.kind==='原文'?{...entry.target!,text:entry.text.slice(position,position+Math.min(55,entry.text.length-position))}:entry.target;
    return [{...entry,snippet,target}];
  });
}
