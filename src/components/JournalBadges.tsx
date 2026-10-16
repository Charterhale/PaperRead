import type { Paper } from '../types';
import { defaultBadgeOrder, type BadgeKey, type JournalInfo } from '../lib/bibliography';
export default function JournalBadges({journal,paper,order=defaultBadgeOrder,onDetails}:{journal?:JournalInfo|null;paper:Paper;order?:BadgeKey[];onDetails:()=>void}){
 const badges:Partial<Record<BadgeKey,{label:string;tone:string;title:string}>>={};
 if(journal?.cas)badges.cas={label:`中科院 ${journal.cas.zone}区${journal.cas.top?' TOP':''}`,tone:'zone-'+journal.cas.zone,title:`${journal.cas.edition}年版中科院分区`};
 if(journal?.emerging)badges.emerging={label:`新锐 ${journal.emerging.zone}区${journal.emerging.top?' TOP':''}`,tone:'zone-'+journal.emerging.zone,title:`${journal.emerging.edition}年版新锐分区`};
 if(journal?.jcr?.quartile)badges.jcr={label:`JCR ${journal.jcr.quartile}`,tone:'zone-'+journal.jcr.quartile.slice(1),title:`${journal.jcr.edition}版 JCR；数据年份 ${journal.jcr.dataYear}`};
 if(journal?.jcr?.impactFactor&&/^\d+(\.\d+)?$/.test(journal.jcr.impactFactor))badges.impact={label:`IF ${journal.jcr.impactFactor}`,tone:'impact',title:`${journal.jcr.dataYear}年 JIF · ${journal.jcr.edition}版 JCR`};
 if(paper.citationCount!==undefined)badges.citations={label:`被引 ${paper.citationCount.toLocaleString()}`,tone:'citations',title:`Crossref 被引次数${paper.citationUpdatedAt?' · 更新于 '+new Date(paper.citationUpdatedAt).toLocaleDateString():''}`};
 const shown=order.flatMap(key=>badges[key]?[{...badges[key]!,key}]:[]);
 if(!shown.length)return <span className="journal-unmatched">—</span>;
 return <button className="journal-badges" aria-label={'查看 '+(journal?.name||paper.journal||'期刊')+' 分区详情'} title={shown.map(b=>b.label+' · '+b.title).join('\n')} onClick={e=>{e.stopPropagation();onDetails();}}>{shown.map(b=><span key={b.key} data-badge={b.key} title={b.title} className={'journal-badge '+b.tone}>{b.label}</span>)}</button>;
}
