import { ArrowUpRight, ChevronDown, Crop, Crosshair, LoaderCircle, PencilLine, Pin, Sparkles } from 'lucide-react';
import type { Figure, Panel, Paper, Section } from '../types';
import { readingText } from '../lib/analysisEditing';
import { readLocal } from '../lib/storage';
import ReadingDisclosure from './ReadingDisclosure';
import ReadingMarkdown from './ReadingMarkdown';
import CompactMarkdown from './CompactMarkdown';
import ActionMenu from './ActionMenu';
import ReadingTitle from './ReadingTitle';
import SectionDetails from './SectionDetails';
import { readingGroups, methodBrief, sectionTitle, panelReading, chapterSummary } from '../lib/readingStructure';

const MD = ({ text }: { text: string }) => <ReadingMarkdown>{readingText(text)}</ReadingMarkdown>;
type Props = {
  paper: Paper; active: string; focus: boolean; figureBusy: string;
  onGo: (id: string, page: number, figureId?: string) => void;
  onPreview: (figure: Figure) => void;
  onPin:(figure:Figure,panel?:Panel)=>void;
  onBind:(section:Section,figure?:Figure)=>void;
  onCrop: (id: string, figure: Figure, panel?: Panel) => void;
  onDeepFigure: (id: string, figure: Figure) => void;
  onSectionEdit: (section: Section) => void;
  onPanelEdit: (value: { sectionId: string; figureId: string; index: number; panel: Panel }) => void;
};

export default function AnalysisSections({ paper, active, focus, figureBusy, onGo, onPreview, onPin, onBind, onCrop, onDeepFigure, onSectionEdit, onPanelEdit }: Props) {
  const groups = readingGroups(paper.analysis?.sections || [], paper.category);
  const isActive = (ids: Section[]) => ids.some(s => s.id === active);
  return <div className="reader-section-list">{groups.map((group, i) => {
    if (group.methods) return <ReadingDisclosure key={paper.id + ':methods'} paperId={paper.id} foldId="methods-overview-v1" className={'reader-section reader-methods ' + (isActive(group.sections) ? 'is-active' : '')} hidden={focus && !isActive(group.sections)}>
      <summary><span className="section-number">{i + 1}</span><h2>研究方法</h2><ChevronDown size={15}/></summary>
      <div className="method-brief-list">{group.sections.map((s, index) => <div key={s.id} id={'section-' + s.id} className="method-brief">
        <div className="method-brief-heading"><span>{index + 1}.</span><h3 title={s.title}>{sectionTitle(s).replace(/^方法[：: ]*/, '')}</h3><button className="icon-btn tiny" title="查看方法原文" onClick={() => onGo(s.id, s.page)}><ArrowUpRight size={14}/></button><button className="icon-btn tiny" title="查看或编辑完整方法解析" onClick={() => onSectionEdit(structuredClone(s))}><PencilLine size={14}/></button></div>
        {methodBrief(s) && <p>{methodBrief(s)}</p>}
      </div>)}</div>
    </ReadingDisclosure>;
    const s = group.sections[0];
    return (
    <ReadingDisclosure paperId={paper.id} foldId={'section:' + s.id} key={paper.id + s.id}
      className={'reader-section ' + (isActive(group.sections) ? 'is-active' : '')} id={'section-' + s.id}
      hidden={focus && !isActive(group.sections)}
      initiallyOpen={!readLocal<Record<string, boolean>>('collapsed-' + paper.id, {})[s.id]}>
      <summary><span className="section-number">{i + 1}</span><h2><ReadingTitle title={group.themed || group.sections.length > 1 ? group.title : s.title} fallback={group.title} referenceTitles={group.sections.map(s=>s.title)}/></h2>
        <div className="section-actions">
          <button className="icon-btn tiny" title="校准小节原文位置" onClick={e=>{e.preventDefault();e.stopPropagation();onBind(s);}}><Crosshair size={14}/></button><button className="icon-btn tiny" title="编辑小节正文" onClick={e => { e.preventDefault(); e.stopPropagation(); onSectionEdit(structuredClone(s)); }}><PencilLine size={14}/></button>
          <button className="icon-btn tiny" title={'定位原文第 ' + s.page + ' 页'} onClick={e => { e.preventDefault(); e.stopPropagation(); onGo(s.id, s.page); }}><ArrowUpRight size={14}/></button>
          <ChevronDown size={15}/>
        </div>
      </summary>
      <div className="reader-section-body">
        <div className="reader-summary"><small>{s.proves?'主要发现':'本节概述'}</small><CompactMarkdown key={s.id+':result'} text={chapterSummary(group)}/></div>
        {group.sections.map((s, partIndex) => s.figures.length ? <div key={s.id} id={partIndex ? 'section-' + s.id : undefined} className="reader-section-part">
        {s.figures.map(f => <ReadingDisclosure paperId={paper.id} foldId={'figure:' + s.id + ':' + f.id} key={f.id}
          id={'figure-' + f.id} className="reader-figure" initiallyOpen>
          <summary><span className="figure-badge">图</span><h3><ReadingTitle title={f.title} fallback="图表"/></h3><div className="reader-figure-tools" onClick={e=>{e.preventDefault();e.stopPropagation();}}><button className="icon-btn" title="看原图" aria-label="看原图" onClick={() => onPreview(f)}><ArrowUpRight size={15}/></button><button className="icon-btn" title="框选精读" aria-label="框选精读" onClick={() => onCrop(s.id, f)}><Crop size={15}/></button><ActionMenu label="更多图表工具"><button onClick={() => onPin(f)}><Pin size={14}/>固定看图</button><button title="框选对应原文区域，以后点击可直达此处" onClick={()=>onBind(s,f)}><Crosshair size={14}/>校准定位</button><button disabled={!!figureBusy} onClick={() => onDeepFigure(s.id, f)}>{figureBusy === f.id ? <LoaderCircle size={14} className="spin"/> : <Sparkles size={14}/>}逐图细读</button></ActionMenu></div><ChevronDown size={15}/></summary>
          <div className="reader-figure-body">

            {f.panels.map((p, index) => {
              const panelKey = s.id + ':' + f.id + ':' + index;
              return <ReadingDisclosure paperId={paper.id} foldId={'panel:' + panelKey} key={index} id={'panel-'+s.id+'-'+f.id+'-'+index} className="reader-panel" initiallyOpen={false}>
                <summary><span className="panel-letter">{p.label.replace(/^(Figure|Fig\.)\s*/i, '')}</span><span className="panel-heading-copy"><strong>{p.type}</strong>{(p.takeaway || p.result) && <span className="panel-preview">{readingText(p.takeaway || p.result || '').replace(/[*#`]/g, '')}</span>}</span><div className="panel-actions" onClick={e=>{e.preventDefault();e.stopPropagation();}}><button className="icon-btn tiny" title="固定对照" aria-label="固定对照" onClick={()=>onPin(f,p)}><Pin size={14}/></button><button className="icon-btn tiny" title="子图精读" aria-label="子图精读" onClick={() => onCrop(s.id, f, p)}><Crop size={14}/></button><button className="icon-btn tiny" title="编辑解析" aria-label="编辑解析" onClick={() => onPanelEdit({ sectionId: s.id, figureId: f.id, index, panel: structuredClone(p) })}><PencilLine size={14}/></button></div><ChevronDown size={13}/></summary>
                <div className="reader-panel-body">
                  {p.image && <button className="panel-crop-button" title={'打开子图 ' + p.label + ' 精读'} onClick={() => onCrop(s.id, f, p)}><img className="panel-crop-thumb" src={p.image} alt={p.label}/></button>}
                  {panelReading(p) && <div className="panel-reading-block"><small>怎么看</small><CompactMarkdown text={panelReading(p)}/></div>}
                  <div className="panel-reading-block panel-outcome"><small>结果</small><CompactMarkdown text={[p.result, p.takeaway].filter((v, i, all) => v?.trim() && all.indexOf(v) === i).join('\n\n') || p.explanation || p.question || ''}/></div>
                  {p.explanation && p.explanation !== p.result && p.explanation !== p.takeaway && <ReadingDisclosure paperId={paper.id} foldId={'explanation-v2:' + panelKey} className="reader-detail-group panel-explanation-group"><summary><span>补充讲解</span><ChevronDown size={14}/></summary><div className="prose panel-explanation"><MD text={p.explanation}/></div></ReadingDisclosure>}

                </div>
              </ReadingDisclosure>;
            })}
            {f.caption && <ReadingDisclosure paperId={paper.id} foldId={'caption:' + s.id + ':' + f.id} className="reader-detail-group figure-caption-group">
              <summary><span>图注</span><ChevronDown size={14}/></summary><div className="figure-caption prose"><MD text={f.caption}/></div>
            </ReadingDisclosure>}
          </div>
        </ReadingDisclosure>)}
        </div> : null)}
        {group.sections.some(s=>s.markdown||s.summary||s.proves) && <ReadingDisclosure paperId={paper.id} foldId={'body:' + group.id} className="reader-detail-group section-detail">
          <summary><span>正文说明</span><ChevronDown size={14}/></summary>
          {group.sections.map((s,partIndex)=><div key={s.id} id={partIndex && !s.figures.length ? 'section-' + s.id : undefined} className="merged-prose-part">
            {partIndex>0&&<div className="continuation-tools"><button className="icon-btn tiny" title="编辑本段解析" onClick={()=>onSectionEdit(structuredClone(s))}><PencilLine size={14}/></button><button className="icon-btn tiny" title={'定位本段原文第 ' + s.page + ' 页'} onClick={()=>onGo(s.id,s.page)}><ArrowUpRight size={14}/></button></div>}
            {(partIndex>0?s.proves||s.summary:s.proves&&s.summary)&&<div className="prose"><MD text={partIndex>0?s.proves||s.summary:s.summary}/></div>}
            {partIndex>0&&s.proves&&s.summary&&s.summary!==s.proves&&<div className="prose"><MD text={s.summary}/></div>}
            {s.markdown&&<SectionDetails paperId={paper.id} sectionId={s.id} text={s.markdown}/>}
          </div>)}
        </ReadingDisclosure>}
      </div>
    </ReadingDisclosure>);
  })}</div>;
}
