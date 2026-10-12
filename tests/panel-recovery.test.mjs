import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis, normalizePanel } from '../server/validation.mjs';
import { readPanelOutput } from '../server/panel-recovery.mjs';
import { createServices } from '../server/service.mjs';

const panel={label:'A',type:'UMAP',xAxis:'UMAP 1',yAxis:'UMAP 2',explanation:'不同颜色代表不同细胞群。',evidence:''};
const analysis=(panels=[panel])=>({title:'Test paper',subtitle:'',overview:'单细胞图谱。',limitations:[],sections:[{title:'细胞状态',shortTitle:'细胞状态',page:1,summary:'比较细胞群。',proves:'描述状态分布。',markdown:'正文。',figures:[{title:'Figure 1',page:1,caption:'各群分布。',panels}]}]});
const normalize=raw=>normalizeAnalysis(raw,32,'生信分析');
const request={apiKey:'test-only-key',model:'deepseek-flash',text:'原文与图注。',images:[]};

test('missing or empty redundant explanation does not reject detailed readable subfigures',()=>{
  for(const explanation of [undefined,null,'','   ']) {
    const result=normalizePanel({...panel,explanation,question:'有哪些细胞群？',method:'使用 UMAP 降维。',readout:'比较各颜色分布。',result:'细胞群呈现不同区域。'});
    assert.equal(result.explanation,explanation||'');
    assert.equal(result.result,'细胞群呈现不同区域。');
  }
  assert.throws(()=>normalizePanel({...panel,explanation:null}),e=>e.code==='INVALID_AI_SCHEMA'&&e.panelField==='explanation');
});

test('arrays, structured explanations, null axes and numeric details retain their content without invented interpretation',()=>{
  const result=normalizePanel({...panel,explanation:{目的:'检验响应。',步骤:['看横轴。','比较处理组。']},xAxis:null,yAxis:{变量:'表达量',单位:'counts'},statistics:{n:12,pValue:0.03},evidence:null});
  assert.match(result.explanation,/目的.*检验响应/s);assert.match(result.explanation,/看横轴。\n\n比较处理组/);
  assert.equal(result.xAxis,'未提供');assert.match(result.yAxis,/counts/);assert.match(result.statistics,/12/);assert.match(result.statistics,/0\.03/);assert.equal(result.evidence,'');
  assert.throws(()=>normalizePanel({...panel,explanation:{apiKey:'injected-secret'}}),e=>e.code==='INVALID_AI_SCHEMA');
  assert.throws(()=>normalizePanel({...panel,explanation:'X'.repeat(12_001)}),e=>e.code==='INVALID_AI_SCHEMA');
});

test('only rejected panels are repaired and valid scientific fields survive differing repair output',async()=>{
  const original=analysis([panel,{...panel,label:'B',explanation:null,result:''},{...panel,label:'C',explanation:['第三幅图说明不同分布。']}]);
  const before=structuredClone(original);let calls=0,recovered;
  const result=await readPanelOutput(original,normalize,request,async r=>{
    calls++;assert.match(r.text,/只处理下面编号/);assert.match(r.text,/"label":"B"/);assert.doesNotMatch(r.text,/"label":"C"/);
    return {panels:[{index:0,panel:{...panel,label:'SHOULD NOT REPLACE B',xAxis:'incorrect new axis',explanation:'修复后的可读解读。'}}]};
  },{onRecovery:n=>{recovered=n;}});
  assert.equal(calls,1);assert.equal(recovered,1);assert.deepEqual(original,before);
  const panels=result.sections[0].figures[0].panels;
  assert.equal(panels.length,3);assert.equal(panels[0].explanation,panel.explanation);assert.equal(panels[1].label,'B');assert.equal(panels[1].xAxis,'UMAP 1');assert.equal(panels[1].explanation,'修复后的可读解读。');assert.equal(panels[2].explanation,'第三幅图说明不同分布。');
});

test('repair cannot drop or duplicate rejected panels and never retries endlessly',async()=>{
  for(const returned of [{panels:[]},{panels:[{index:1,panel}]},{panels:[{index:0,panel:{...panel,explanation:null}}]}]){
    let calls=0;await assert.rejects(readPanelOutput(analysis([{...panel,explanation:null}]),normalize,request,async()=>{calls++;return returned;}));assert.equal(calls,1);
  }
  let calls=0;const controller=new AbortController();controller.abort();
  await assert.rejects(readPanelOutput(analysis([{...panel,explanation:null}]),normalize,{...request,signal:controller.signal},async()=>{calls++;}),e=>e.code==='REQUEST_CANCELLED');assert.equal(calls,0);
});

test('batch retry retains saved chunks and repaired results keep every subfigure',async()=>{
  const source={...request,pages:Array.from({length:32},(_,i)=>`Page ${i+1} `+'T'.repeat(7_500)),category:'生信分析',title:'Paper'};
  let saved=[],calls=0,repairCalls=0;const progress=[];
  const first=createServices({complete:async r=>{
    if(r.text.startsWith('任务：修复')){repairCalls++;return {panels:[]};}
    calls++;if(calls===6)return analysis([{...panel,explanation:null}]);return analysis();
  }});
  await assert.rejects(first.analyze(source,undefined,{onCheckpoint:async chunks=>{saved=structuredClone(chunks);}}));
  assert.equal(saved.length,5);assert.equal(calls,6);assert.equal(repairCalls,1);
  let remaining=0;const resumed=createServices({complete:async r=>{
    if(r.text.startsWith('任务：修复'))return {panels:[{index:0,panel:{...panel,explanation:['看图例。','比较组间分布。']}}]};
    if(r.text.startsWith('任务：根据'))return {title:'Merged',subtitle:'',overview:'完整总览。',orderedSectionIds:[],limitations:[]};
    remaining++;return analysis([{...panel,explanation:null}]);
  }});
  const result=await resumed.analyze(source,undefined,{checkpoints:saved,onProgress:async(_,message)=>progress.push(message)});
  assert.equal(remaining,2);assert.equal(result.sections.length,7);assert.equal(result.sections.flatMap(s=>s.figures).flatMap(f=>f.panels).length,7);assert.equal(result.coverage.totalPages,32);assert(progress.some(p=>/正在修复/.test(p)));
});
