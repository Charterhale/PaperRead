import type { Analysis, Category, LogicEdge, LogicNode, Panel, Paper, Section } from '../types';

const han = /[\p{Script=Han}]/u;
const commonTitles: [RegExp, string][] = [
  [/^(?:abstract|summary)$/i, '摘要'], [/^(?:introduction|background)$/i, '研究背景'],
  [/^results?(?: and discussion)?$/i, '研究结果'], [/^discussion$/i, '讨论'],
  [/^conclusions?$/i, '研究结论'], [/^(?:materials? and methods?|methods?|experimental procedures|experimental section|online methods)$/i, '研究方法'],
  [/^statistical analysis$/i, '统计分析'], [/^study design$/i, '研究设计'],
  [/^data availability$/i, '数据获取'], [/^code availability$/i, '代码获取'],
  [/^references$/i, '参考文献'], [/^acknowledg(?:e)?ments?$/i, '致谢'],
  [/^author contributions?$/i, '作者贡献'], [/^competing interests?$/i, '利益声明'],
  [/^supplementary (?:information|materials?)$/i, '补充材料'],
  [/^(?:preprocessing|data preprocessing)(?:\b.*)?$/i, '数据预处理'],
  [/^pseudobulk data aggregation(?:\b.*)?$/i, '样本聚合与协变量选择'],
  [/^(?:snRNA-seq|single-nucleus RNA sequencing)(?: data)? preprocessing$/i, '单核测序数据预处理'],
];

/** Display only: the original title, section IDs and analysis remain untouched. */
export function chineseTitle(title: string, fallback = '研究结果'): string {
  const text = title.replace(/^\s*\d+(?:\.\d+)*[.、\s]+/, '').trim();
  if (/^(?:研究背景|引言|introduction)(?:\s*[（(][\s\S]*[)）])?$/i.test(text)) return '研究背景';
  const known = commonTitles.find(([pattern]) => pattern.test(text));
  if (known) return known[1];
  // Chinese followed by an English gloss (including parentheses across lines).
  const withoutEnglishGloss = text.replace(/[（(]([^()（）]*)[)）]/g, (all, inner: string) => han.test(inner) ? all : '');
  if (han.test(withoutEnglishGloss)) {
    const chineseGloss = /[（(]([^()（）]*[\p{Script=Han}][^()（）]*)[)）]/u.exec(text);
    const before = text.split(/[（(]/)[0];
    const value = !han.test(before) && chineseGloss ? chineseGloss[1] : withoutEnglishGloss;
    return value.replace(/(?:(?:Extended\s+Data|Supplementary)\s+)?(?:Fig(?:ure)?\.?|Table)\s*\d+[a-z]?(?:\s*[–−-]\s*(?:\d+)?[a-z])?(?:\s*[,，、;；]\s*(?:\d+)?[a-z](?:\s*[–−-]\s*(?:\d+)?[a-z])?)*/gi, '').replace(/(?:[,，、]\s*)?(?:及|和|与)?(?:相关)?(?:延伸数据|扩展数据|补充图(?:表)?|相关补充图)\s*$/g, '').replace(/\bFigures?\b/gi, '图').replace(/^[\s·:：,，-]+|[\s·:：,，-]+$/g, '').replace(/\s+/g, ' ').trim() || fallback;
  }
  return fallback;
}

export function isMethodTitle(title: string): boolean {
  return /^(?:\d+[.、\s]+)?(?:研究方法|研究设计与方法|研究设计$|材料与方法|方法(?:[：:（(\s]|$)|实验方法|统计分析|materials? and methods?|methods?\b|online methods|experimental (?:procedures|section)|statistical analysis|study design)/i.test(title.trim());
}
export function isMethodSection(section: Section): boolean {
  return isMethodTitle(section.title) || isMethodTitle(section.shortTitle);
}
export function sectionTitle(section: Section): string {
  const short=continuationTitle(section.shortTitle);return chineseTitle(section.title, short.continuation&&!short.base?(isMethodSection(section)?'研究方法':'研究结果'):chineseTitle(section.shortTitle,isMethodSection(section)?'研究方法':'研究结果'));
}
/** Only whole administrative headings qualify; scientific uses of references do not. */
export function isBackMatterTitle(title: string): boolean {
  const text = title.replace(/^\s*\d+(?:\.\d+)*[.、\s]+/, '').replace(/[（(](?:续|continued|cont\.?)[^()（）]*[)）]/gi, '').trim();
  const labels = /证据性质|证据边界|带着边界理解结论|致谢|鸣谢|作者贡献(?:声明)?|作者分工|参考文献|引用文献|acknowledg(?:e)?ments?|author(?:s)?['’]? contributions?|contributions? of (?:the )?authors|references|bibliography/gi;
  const rest = text.replace(labels, '').replace(/\b(?:and|with)\b/gi, '').replace(/[\s、，,;；:：&/与和及。.(（)）-]/g, '');
  return labels.test(text) && !rest;
}
export function isBackMatterSection(s: Section): boolean {
  // A scientific title wins over an unrelated short label supplied by a model.
  return isBackMatterTitle(s.title) || (!s.title.trim() && isBackMatterTitle(s.shortTitle));
}
export function continuationTitle(title: string): { continuation: boolean; base: string } {
  const text = title.replace(/^\s*\d+(?:\.\d+)*[.、\s]+/, '').trim();
  if (/^(?:discussion|讨论)(?=$|[\s(/（:：与])/i.test(text)) return {continuation:true,base:'讨论'};
  const generic = /^(?:[（(]?(?:续(?:文|篇|接|上|下)?|接上(?:文|页)|continued|continuation|cont\.?|片段(?:末尾|开头)?可见部分|片段续文)[\s\d一二三四五六七八九十]*[)）]?)$/i;
  if (generic.test(text.replace(/[()（）]/g, ''))) return { continuation: true, base: '' };
  const suffix = /(?:\s*[（(]\s*(?:续|continued|cont\.?)[\s\d一二三四五六七八九十]*\s*[)）]|\s*[—–:：-]?\s+(?:续|continued|cont\.?)[\s\d]*)$/i;
  const base = text.replace(suffix, '').trim();
  return { continuation: base !== text, base };
}
export type ReadingGroup = { id: string; title: string; page: number; sections: Section[]; methods: boolean; themed?: boolean };
export function sourceReadingGroups(sections: Section[]): ReadingGroup[] {
  const groups: ReadingGroup[] = [];
  let methods: ReadingGroup | undefined, previous: ReadingGroup | undefined, administrative = false;
  const key = (value: string) => chineseTitle(continuationTitle(value).base || value, value).replace(/[\s:：、，,。.()（）-]/g, '').toLowerCase();
  for (const s of sections) {
    if (isBackMatterSection(s)) { administrative = true; previous = undefined; continue; }
    const part = continuationTitle(s.title), shortPart = continuationTitle(s.shortTitle);
    const continuation = part.continuation || (!s.title.trim() && shortPart.continuation);
    if (administrative && continuation && !part.base) continue;
    administrative = false;
    if (isMethodSection(s)) {
      if (!methods) methods = { id: s.id, title: '研究方法', page: s.page, sections: [], methods: true };
      methods.sections.push(s); previous = methods; continue;
    }
    const match = continuation && part.base ? [...groups, ...(methods ? [methods] : [])].reverse().find(g => [g.title, g.sections[0].title, g.sections[0].shortTitle].some(title => key(title) === key(part.base))) : previous;
    const repeated = previous && !previous.methods && key(s.title) === key(previous.sections[0].title);
    if ((continuation && match) || repeated) {
      const parent = (continuation && match) || previous!;
      parent.sections.push(s); previous = parent; continue;
    }
    const title = continuation ? (part.base ? chineseTitle(part.base, chineseTitle(s.shortTitle, '研究内容')) : '研究内容') : sectionTitle(s);
    const group = { id: s.id, title, page: s.page, sections: [s], methods: false };
    groups.push(group); previous = group;
  }
  if (methods) groups.push(methods);
  return groups;
}

/** Keep the paper's Results subsections in order; combine only real continuations and methods. */
export function readingGroups(sections: Section[], _category?: Category): ReadingGroup[] {
  const groups=sourceReadingGroups(sections),discussion=(g:ReadingGroup)=>/^(?:discussion|讨论)(?=$|[\s(/（:：与])/i.test(g.title);
  return [...groups.filter(g=>!g.methods&&!discussion(g)),...groups.filter(discussion),...groups.filter(g=>g.methods)];
}

export function chapterSummary(group: ReadingGroup): string {
  const conclusions = sourceReadingGroups(group.sections).map(g => g.sections[0].proves || g.sections[0].summary).filter(Boolean);
  return [...new Set(conclusions)].slice(0,2).map(text=>{
    const clean=text.replace(/[#*`]/g,'').trim(), sentence=clean.match(/^[\s\S]*?[。！？]/)?.[0]||clean;
    return sentence.length>100?sentence.slice(0,100)+'…':sentence;
  }).join(' ');
}

/** Structural headings excluded from the result-only route, without changing sections. */
export function isResultSection(section: Section): boolean {
  if (isMethodSection(section) || isBackMatterSection(section)) return false;
  const title = section.title.trim().replace(/^\d+(?:\.\d+)*[.、\s]+/, '');
  return !/^(?:实验设计|研究设计|数据预处理|数据来源|研究背景|研究缺口|研究问题|背景与|背景|引言|摘要|文章概览|讨论|结论|研究结论|研究总结|研究局限|局限性|limitations?\b|reporting\b|报告摘要|报告表|funding\b|经费支持|competing interests\b|利益声明|利益冲突|additional information\b|附加信息|open access\b|开放获取声明|方法与补充|补充(?:材料|方法|结果|图|说明)|延伸数据|扩展数据|introduction\b|background\b|abstract\b|summary\b|discussion\b|conclusions?\b|supplement(?:ary)?\b|extended data\b|data availability\b|code availability\b|数据获取|代码获取)/i.test(title);
}

/** Project saved nodes and custom edges onto reading groups without editing them. */
export function readingLogic(analysis: Analysis, logic: {nodes: LogicNode[]; edges: LogicEdge[]; mainNodeIds?: string[]}) {
  const groups = readingGroups(analysis.sections, analysis.category).filter(group => !group.methods && isResultSection(group.sections[0])), nodes: LogicNode[] = [], mapping = new Map<string, string>();
  for (const group of groups) {
    const members = logic.nodes.filter(n => group.sections.some(s => s.id === n.sectionId));
    if (!members.length) continue;
    const first = members.find(n => n.sectionId === group.id) || members[0];
    const canonical = {...first, sectionId: group.id, title: group.themed || group.methods || group.sections.length > 1 ? group.title : first.title};
    nodes.push(canonical); members.forEach(n => mapping.set(n.id, canonical.id));
  }
  if (analysis.logic) nodes.sort((a,b)=>logic.nodes.findIndex(n=>n.id===a.id)-logic.nodes.findIndex(n=>n.id===b.id));
  const seen = new Set<string>();
  const edges = logic.edges.flatMap(edge => {
    const from = mapping.get(edge.from), to = mapping.get(edge.to);
    const key = JSON.stringify([from, to, edge.label || '']);
    if (!from || !to || from === to || seen.has(key)) return [];
    seen.add(key); return [{...edge, from, to}];
  });
  return { nodes, edges, mainNodeIds: [...new Set((logic.mainNodeIds || []).map(id => mapping.get(id)).filter((id): id is string => !!id))] };
}
export function methodBrief(s: Section): string {
  // One existing sentence, with an explicit ellipsis when it has to be shortened.
  const text = (s.summary || s.proves || '').replace(/[#*`]/g, '').trim();
  const first = text.match(/^[\s\S]*?[。！？](?:\s|$)?/)?.[0]?.trim() || text;
  return first.length > 120 ? first.slice(0, 120) + '…' : first;
}
export function panelReading(p: Panel): string {
  const useful = (s?: string) => !!s?.trim() && !/^(?:不适用|未报告(?:统计信息)?|未提供|无|N\/?A)[。.!\s]*$/i.test(s.trim());
  const axes = [useful(p.xAxis) ? '横轴：' + p.xAxis : '', useful(p.yAxis) ? '纵轴：' + p.yAxis : ''].filter(Boolean).join('；');
  return [...new Set([useful(p.groups) ? p.groups!.trim() : '', axes, useful(p.readout) ? p.readout!.trim() : ''].filter(Boolean))].join('\n\n');
}
export function paperOutline(paper: Paper): { title: string; original: string; page: number }[] {
  const outline = paper.outline.length ? paper.outline : paper.pages.map((_, i) => ({ title: '第 ' + (i + 1) + ' 页', page: i + 1 }));
  let inMethods = false;
  const sections = outline.map((o, i) => {
    const exact = paper.analysis?.sections.find(s => s.title.toLowerCase() === o.title.toLowerCase());
    const related = exact || paper.analysis?.sections.find(s => s.page === o.page && !isMethodSection(s) && !isBackMatterSection(s));
    const knownOther = commonTitles.some(([pattern, name]) => pattern.test(o.title) && name !== '研究方法' && name !== '统计分析');
    const methodPage = paper.analysis?.sections.some(s => isMethodSection(s) && s.page === o.page);
    const method = !isBackMatterTitle(o.title) && (isMethodTitle(o.title) || (exact && isMethodSection(exact)) || (inMethods && methodPage && !knownOther));
    if (method) inMethods = true;
    else if (knownOther || isBackMatterTitle(o.title)) inMethods = false;
    return {id: 'outline-' + i, title: o.title, shortTitle: method ? '研究方法' : chineseTitle(o.title, related ? sectionTitle(related) : '原文章节'), page: o.page, summary: '', proves: '', markdown: '', figures: []} satisfies Section;
  });
  return sourceReadingGroups(sections).map(group => ({ title: group.methods ? '研究方法' : chineseTitle(group.title, group.sections[0].shortTitle), original: group.sections.map(s => s.title).join(' · '), page: group.page }));
}
