import type { AnalysisCoverage as Coverage } from '../types';

export default function AnalysisCoverage({coverage,onPage}:{coverage:Coverage;onPage?:(page:number)=>void}) {
  return <details className="analysis-coverage"><summary>页面处理记录 · {coverage.totalPages} 页 / {coverage.batches.length} 批</summary>
    <p>原图读取 {coverage.visualPages.length} 页 · 纯文字 {coverage.textOnlyPages.length} 页 · 批次已合并</p>
    <div className="coverage-pages">{coverage.pages.map(p=><button key={p.page} type="button" disabled={!onPage} className={p.mode==='visual'?'visual':''} title={`第 ${p.page} 页 · ${p.mode==='visual'?'已读取原图':'已读取文字'} · ${p.batchIds.length} 批`} onClick={()=>onPage?.(p.page)}>{p.page}</button>)}</div>
    <small>紫色为原图读取页。此记录核对页面是否进入解析；细小文字或模糊子图可使用框选精读进一步放大。</small>
  </details>;
}
