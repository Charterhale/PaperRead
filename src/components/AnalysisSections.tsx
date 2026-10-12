import { ArrowUpRight, ChevronDown, Crop, Crosshair, LoaderCircle, PencilLine, Pin, Sparkles } from 'lucide-react';
import type { Figure, Panel, Paper, Section } from '../types';
import { panelFields, readingText } from '../lib/analysisEditing';
import { readLocal } from '../lib/storage';
import ReadingDisclosure from './ReadingDisclosure';
import ReadingMarkdown from './ReadingMarkdown';

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

function PanelFields({ panel, fields }: { panel: Panel; fields: (keyof Panel)[] }) {
  return <div className="panel-detail-fields">{fields.flatMap(key => {
    const text = panel[key];
    if (typeof text !== 'string' || !text.trim()) return [];
    const label = panelFields.find(([field]) => key === field)?.[1];
    return <div key={key} data-panel-field={key}><small>{label}</small><div className="prose"><MD text={text}/></div></div>;
  })}</div>;
}

export default function AnalysisSections({ paper, active, focus, figureBusy, onGo, onPreview, onPin, onBind, onCrop, onDeepFigure, onSectionEdit, onPanelEdit }: Props) {
  const sections = paper.analysis?.sections || [];
  return <div className="reader-section-list">{sections.map((s, i) =>
    <ReadingDisclosure paperId={paper.id} foldId={'section:' + s.id} key={paper.id + s.id}
      className={'reader-section ' + (active === s.id ? 'is-active' : '')} id={'section-' + s.id}
      hidden={focus && active !== s.id}
      initiallyOpen={!readLocal<Record<string, boolean>>('collapsed-' + paper.id, {})[s.id]}>
      <summary><span className="section-number">{String(i + 1).padStart(2, '0')}</span><h2>{s.title}</h2>
        <div className="section-actions">
          <button className="icon-btn tiny" title="校准小节原文位置" onClick={e=>{e.preventDefault();e.stopPropagation();onBind(s);}}><Crosshair size={14}/></button><button className="icon-btn tiny" title="编辑小节正文" onClick={e => { e.preventDefault(); e.stopPropagation(); onSectionEdit(structuredClone(s)); }}><PencilLine size={14}/></button>
          <button className="icon-btn tiny" title={'定位原文第 ' + s.page + ' 页'} onClick={e => { e.preventDefault(); e.stopPropagation(); onGo(s.id, s.page); }}><ArrowUpRight size={14}/></button>
          <ChevronDown size={15}/>
        </div>
      </summary>
      <div className="reader-section-body">
        <div className="reader-summary"><small>这一节做了什么</small><div className="prose"><MD text={s.summary}/></div>
          {s.proves && <><small>主要结果</small><div className="prose"><MD text={s.proves}/></div></>}
        </div>
        {s.markdown && <ReadingDisclosure paperId={paper.id} foldId={'body:' + s.id} className="reader-detail-group section-detail">
          <summary><span>详细解析</span><small>展开完整正文</small><ChevronDown size={14}/></summary>
          <div className="section-markdown prose"><MD text={s.markdown}/></div>
        </ReadingDisclosure>}
        {s.figures.length > 0 && <div className="section-figures-heading"><span>图解与子图精读</span><small>{s.figures.length} 张图 · {s.figures.reduce((n, f) => n + f.panels.length, 0)} 个子图</small></div>}
        {s.figures.map(f => <ReadingDisclosure paperId={paper.id} foldId={'figure:' + s.id + ':' + f.id} key={f.id}
          id={'figure-' + f.id} className="reader-figure" initiallyOpen>
          <summary><span className="figure-badge">FIG</span><h3>{f.title}</h3><ChevronDown size={15}/></summary>
          <div className="reader-figure-body">
            <div className="reader-figure-tools"><span>{f.panels.length} 个子图</span>
              <button onClick={() => onPin(f)}><Pin size={12}/>固定看图</button><button onClick={() => onPreview(f)}><ArrowUpRight size={12}/>看原图</button>
              <button title="框选对应原文区域，以后点击可直达此处" onClick={()=>onBind(s,f)}><Crosshair size={12}/>校准定位</button><button onClick={() => onCrop(s.id, f)}><Crop size={12}/>框选精读</button>
              <button disabled={!!figureBusy} onClick={() => onDeepFigure(s.id, f)}>{figureBusy === f.id ? <LoaderCircle size={12} className="spin"/> : <Sparkles size={12}/>}逐图细读</button>
            </div>
            {f.caption && <ReadingDisclosure paperId={paper.id} foldId={'caption:' + s.id + ':' + f.id} className="reader-detail-group figure-caption-group">
              <summary><span>图注与整体说明</span><ChevronDown size={14}/></summary><div className="figure-caption prose"><MD text={f.caption}/></div>
            </ReadingDisclosure>}
            {f.panels.map((p, index) => {
              const panelKey = s.id + ':' + f.id + ':' + index;
              const has = (fields: (keyof Panel)[]) => fields.some(key => typeof p[key] === 'string' && String(p[key]).trim());
              const conclusion: keyof Panel = p.takeaway?.trim() ? 'takeaway' : 'result';
              const groups: { id: string; title: string; hint: string; fields: (keyof Panel)[] }[] = [
                { id: 'guide', title: '怎么读这张图', hint: '分组、坐标与读图顺序', fields: ['groups', 'xAxis', 'yAxis', 'readout'] },
                { id: 'results', title: '实验与结果细节', hint: '方法、结果与统计', fields: conclusion === 'result' ? ['method', 'statistics'] : ['method', 'result', 'statistics'] },
              ];
              return <ReadingDisclosure paperId={paper.id} foldId={'panel:' + panelKey} key={index} id={'panel-'+s.id+'-'+f.id+'-'+index} className="reader-panel" initiallyOpen={index === 0}>
                <summary><span className="panel-letter">{p.label.replace(/^(Figure|Fig\.)\s*/i, '')}</span><strong>{p.type}</strong><ChevronDown size={13}/></summary>
                <div className="reader-panel-body">
                  {p.image && <button className="panel-crop-button" title={'打开子图 ' + p.label + ' 精读'} onClick={() => onCrop(s.id, f, p)}><img className="panel-crop-thumb" src={p.image} alt={p.label}/></button>}
                  <div className="panel-essentials"><PanelFields panel={p} fields={['question', conclusion]}/></div>
                  {groups.filter(group => has(group.fields)).map(group => <ReadingDisclosure paperId={paper.id} foldId={group.id + ':' + panelKey} key={group.id} className="reader-detail-group panel-detail-group">
                    <summary><span>{group.title}</span><small>{group.hint}</small><ChevronDown size={14}/></summary>
                    <PanelFields panel={p} fields={group.fields}/>
                  </ReadingDisclosure>)}
                  {p.explanation && <ReadingDisclosure paperId={paper.id} foldId={'explanation:' + panelKey} className="reader-detail-group panel-detail-group" initiallyOpen={!has(['question', 'takeaway', 'result'])}>
                    <summary><span>完整讲解</span><ChevronDown size={14}/></summary><div className="prose panel-explanation"><MD text={p.explanation}/></div>
                  </ReadingDisclosure>}
                  <div className="panel-actions"><button className="subtle-button" onClick={()=>onPin(f,p)}><Pin size={13}/>固定对照</button><button className="subtle-button" onClick={() => onCrop(s.id, f, p)}><Crop size={13}/>子图精读</button><button className="subtle-button" onClick={() => onPanelEdit({ sectionId: s.id, figureId: f.id, index, panel: structuredClone(p) })}><PencilLine size={13}/>编辑解析</button></div>
                </div>
              </ReadingDisclosure>;
            })}
          </div>
        </ReadingDisclosure>)}
      </div>
    </ReadingDisclosure>
  )}</div>;
}
