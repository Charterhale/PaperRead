import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceReadingGroups as readingGroups, readingGroups as readingChapters, readingLogic, paperOutline, isBackMatterTitle } from '../src/lib/readingStructure.ts';
const s=(id,title,page=1)=>({id,title,shortTitle:title,page,summary:'保留概述 '+id,proves:'保留结论 '+id,markdown:'保留正文 '+id,figures:[]});
test('continuations and fragment labels join their parent without mutating source IDs or content',()=>{
 const sections=[s('r','细胞互作与下游 GO'),s('fragment','片段末尾可见部分'),s('other','不同组织的细胞比较'),s('d','讨论'),...Array.from({length:7},(_,i)=>s('c'+i,'续',i+2)),s('named','Discussion (continued)',9),s('ack','致谢、作者贡献与参考文献',10),s('methods','方法：组织处理',11),s('mc','续',12)];
 const original=JSON.stringify(sections),groups=readingGroups(sections);
 assert.deepEqual(groups.map(g=>g.title),['细胞互作与下游 GO','不同组织的细胞比较','讨论','研究方法']);
 assert.deepEqual(groups[0].sections.map(s=>s.id),['r','fragment']);assert.equal(groups[2].sections.length,9);assert.deepEqual(groups.at(-1).sections.map(s=>s.id),['methods','mc']);assert.equal(JSON.stringify(sections),original);
});
test('named continuations and repeated headings merge conservatively while distinct results remain separate',()=>{
 const sections=[s('a','结果：细胞组成'),s('b','结果：炎症表达'),s('d','Discussion'),s('d2','讨论（续2）'),s('d3','Discussion'),s('d4','续（1）')];
 assert.deepEqual(readingGroups(sections).map(g=>g.sections.map(s=>s.id)),[['a'],['b'],['d','d2','d3','d4']]);
 assert.equal(readingGroups([s('orphan','续')])[0].title,'研究内容');
});
test('only administrative headings are hidden, including continuation tails; scientific reference comparisons survive',()=>{
 for(const title of ['致谢','作者贡献','参考文献','致谢、作者贡献与参考文献','Acknowledgments','Author contributions and references','References (continued)','致谢（续）'])assert.ok(isBackMatterTitle(title),title);
 for(const title of ['参考文献支持的机制','参考文献比较结果','作者贡献评分与结局的关联'])assert.equal(isBackMatterTitle(title),false,title);
 assert.deepEqual(readingGroups([s('r','结果'),s('a','参考文献'),s('cont','续'),s('new','方法：测序')]).map(g=>g.id),['r','new']);
});
test('logic projections merge nodes, redirect custom edges and mainline selection without editing stored graph',()=>{
 const sections=[s('r','结果'),s('d','讨论'),s('c','续'),s('a','致谢')],nodes=sections.map(s=>({id:'n'+s.id,sectionId:s.id,title:s.title}));
 const logic={nodes,edges:[{id:'e1',from:'nr',to:'nc',label:'结果解释'},{id:'e2',from:'nd',to:'nc'},{id:'e3',from:'nc',to:'na'}],mainNodeIds:['nr','nc','na']},original=JSON.stringify(logic);
 const display=readingLogic({sections},logic);assert.deepEqual(display.nodes.map(n=>n.sectionId),['r']);assert.deepEqual(display.edges,[]);assert.deepEqual(display.mainNodeIds,['nr']);assert.equal(JSON.stringify(logic),original);
});
test('PDF outline uses the same continuation grouping and excludes back matter',()=>{
 const paper={outline:[{title:'Results',page:1},{title:'Discussion',page:2},{title:'Discussion (continued)',page:3},{title:'续',page:4},{title:'Acknowledgements',page:5},{title:'Author contributions',page:5},{title:'References',page:6}],pages:[],analysis:{sections:[]}};
 const original=JSON.stringify(paper);assert.deepEqual(paperOutline(paper).map(o=>[o.title,o.page]),[['研究结果',1],['讨论',2]]);assert.equal(JSON.stringify(paper),original);
});

import { readingText } from '../src/lib/analysisEditing.ts';
test('evidence nature heading blocks and labeled paragraphs disappear while actual results and source remain intact',()=>{
 const original='## 主要结果\n\n处理组表达升高。\n\n### 证据性质\n\n观察性关联说明哨兵。\n\n#### 补充限定\n\n限定哨兵。\n\n### 怎么读图\n\n横轴是年龄，纵轴是表达量。\n\n**证据性质：** 相关性提示哨兵。\n\n实际结果继续保留。';
 const result=readingText(original);assert.doesNotMatch(result,/证据性质|哨兵|补充限定/);assert.match(result,/处理组表达升高/);assert.match(result,/横轴是年龄/);assert.match(result,/实际结果继续保留/);
 assert.equal(readingText('**证据性质**\n\n关联性提示。\n\n真实结果保留。'),'真实结果保留。');
 assert.equal(readingGroups([s('a','结果'),s('b','证据性质')]).length,1);
 assert.match(original,/证据性质/);
});

test('distinct Results subsections retain original order and Chinese headings without a chapter limit',()=>{
 const sections=[s('intro','引言'),...Array.from({length:12},(_,i)=>s('result-'+i,'结果：细胞状态变化'+(i+1),i+2)),s('d','讨论'),s('m','方法：测序')];
 const original=JSON.stringify(sections),groups=readingChapters(sections,'基础医学');
 assert.equal(groups.length,15);assert.deepEqual(groups.map(g=>g.id),sections.map(s=>s.id));assert.deepEqual(groups.map(g=>g.title),sections.map(s=>s.id==='m'?'研究方法':s.id==='intro'?'研究背景':s.title));assert.equal(JSON.stringify(sections),original);
});
test('all five categories preserve different Results subsections even when keywords overlap; methods move last',()=>{
 const sections=[s('intro','研究背景'),s('m1','方法：测序'),s('atlas1','滑膜整体细胞图谱'),s('atlas2','FLS亚群与分布'),s('m2','方法：统计分析'),s('state1','免疫细胞状态变化'),s('state2','免疫细胞状态变化与年龄的关联'),s('signal','细胞互作与下游通路'),s('validate','干预与实验验证'),s('d','讨论'),s('c','续'),s('ack','致谢')];
 const original=JSON.stringify(sections);
 for(const category of ['基础医学','生信分析','纳米材料','临床研究','综述 / Meta']){
  const groups=readingChapters(sections,category);
  assert.deepEqual(groups.map(g=>g.id),['intro','atlas1','atlas2','state1','state2','signal','validate','d','m1'],category);
  assert.deepEqual(groups.at(-2).sections.map(s=>s.id),['d','c']);assert.deepEqual(groups.at(-1).sections.map(s=>s.id),['m1','m2']);
 }
 assert.equal(JSON.stringify(sections),original);
});
test('logic keeps each genuine result node, edges and mainline selection rather than merging by topic',()=>{
 const sections=[s('a','细胞图谱'),s('b','细胞亚群图谱'),s('c','细胞状态变化'),s('d','细胞状态变化的验证')];
 const logic={nodes:sections.map(s=>({id:'n-'+s.id,sectionId:s.id,title:s.title})),edges:[{id:'ab',from:'n-a',to:'n-b'},{id:'bc',from:'n-b',to:'n-c'},{id:'cd',from:'n-c',to:'n-d'}],mainNodeIds:['n-a','n-b','n-c','n-d']};
 const before=JSON.stringify(logic);assert.deepEqual(readingLogic({sections,category:'生信分析'},logic),logic);assert.equal(JSON.stringify(logic),before);
});

import { SCIENTIFIC_SYSTEM, ANALYSIS_SCHEMA } from '../server/prompts.mjs';
test('new analysis follows original Results subsections with intro prioritized and brief methods last',()=>{
 assert.match(SCIENTIFIC_SYSTEM,/全文解析重点是引言和结果/);assert.match(SCIENTIFIC_SYSTEM,/按照原文各小节的逻辑、顺序和数量/);assert.match(SCIENTIFIC_SYSTEM,/研究方法统一放在全文最后/);assert.doesNotMatch(SCIENTIFIC_SYSTEM,/控制为5至7节|自主归纳少量中文主题/);assert.match(ANALYSIS_SCHEMA,/不合并不同结果小节/);
});

import { chineseTitle } from '../src/lib/readingStructure.ts';
test('result-only route hides structural sections in both route modes without altering saved source',()=>{
 const sections=[s('intro','研究背景（Introduction 前段与摘要）'),s('gap','研究缺口'),s('a','图谱构建'),s('b','功能验证'),s('d','讨论与结论'),s('m','研究方法'),s('supp','补充结果'),s('limit','研究局限'),s('data','Data availability'),s('fund','Funding'),s('ack','致谢')];
 const logic={nodes:sections.map(s=>({id:'n'+s.id,title:s.title,sectionId:s.id})),edges:[{id:'ab',from:'na',to:'nb',label:'验证'}],mainNodeIds:sections.map(s=>'n'+s.id)};
 const original=JSON.stringify({sections,logic}),display=readingLogic({sections,logic},logic);
 assert.deepEqual(display.nodes.map(n=>n.sectionId),['a','b']);assert.deepEqual(display.mainNodeIds,['na','nb']);assert.deepEqual(display.edges,logic.edges);assert.equal(JSON.stringify({sections,logic}),original);
 assert.equal(chineseTitle('研究背景（Introduction 前段与摘要）'),'研究背景');assert.equal(chineseTitle('年龄相关的细胞核组成变化，及延伸数据'),'年龄相关的细胞核组成变化');assert.equal(chineseTitle('DLPFC 跨生命周期的重塑，及相关补充图'),'DLPFC 跨生命周期的重塑');assert.equal(chineseTitle('细胞图谱（Fig. 1d、1e、1f、1g）'),'细胞图谱');
 assert.match(SCIENTIFIC_SYSTEM,/研究主线（逻辑图、路线节点）只串联 Results/);assert.match(SCIENTIFIC_SYSTEM,/不附带图号/);
});

test('discussion continuations with trailing topic descriptions join the discussion instead of creating a continuation heading',()=>{
 const sections=[s('a','细胞组成'),s('d0','DISCUSSION/CONCLUSION（片段末尾可见部分）'),s('b','功能验证'),s('d1','DISCUSSION（讨论）—— 机制'),s('d2','DISCUSSION（续）—— 来源'),s('d3','DISCUSSION（续）—— 主要局限'),s('m','研究方法')],before=JSON.stringify(sections);
 const groups=readingChapters(sections);assert.deepEqual(groups.map(g=>g.id),['a','b','d0','m']);assert.equal(groups[2].title,'讨论');assert.deepEqual(groups[2].sections.map(s=>s.id),['d0','d1','d2','d3']);assert.equal(JSON.stringify(sections),before);
});
