// Explicit opt-in integration test: synthetic materials only, account subscription.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'paperlens-codex-live-'));
let deepseekCalls=0;
const options={port:0,production:true,jobDir:path.join(dir,'jobs'),backupDir:path.join(dir,'backups'),fetchImpl:()=>{deepseekCalls++;throw new Error('No DeepSeek call permitted');}};
let server=await startServer(options),url='http://127.0.0.1:'+server.address().port;
const provider={provider:'codex',model:'codex-auto'},report={passed:[],deepseekCalls:0};
const post=async(route,body)=>{const r=await fetch(url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await r.json();assert.equal(r.ok,true,JSON.stringify(value));return value;};
try{
 const status=await(await fetch(url+'/api/codex/status')).json();assert.equal(status.billing,'subscription');report.passed.push('真实订阅登录');
 const pages=['DEMO ONLY: software test with synthetic values. Figure 1a is a bar chart. Control value 3; Treatment value 6. X: Group; Y: Relative expression (a.u.). No biological sample size, error bars or statistical test supplied. Page 2 is a scan of the test description.',''];
 const images=[];for(const [i,name] of ['chart','scan'].entries())images.push({page:i+1,dataUrl:'data:image/png;base64,'+(await readFile('artifacts/codex-test-'+name+'.png')).toString('base64')});
 const job=await post('jobs',{...provider,paperId:'synthetic-live-test',title:'DEMO ONLY software test',pages,images,pipelineVersion:2,expectedVisualPages:[1,2],visualPlan:{version:1,pages:[{page:1,kind:'raster',reasons:['Test bar chart']},{page:2,kind:'scan',reasons:['Test scanned description']}]}});
 console.log('已创建真实 Codex 读图后台测试（2 页虚构测试材料）');
 let current,last;
 for(let i=0;i<300;i++){current=await server.jobs.get(job.id);if(current.message!==last){console.log(current.status,current.progress,current.message);last=current.message;}if(['completed','failed'].includes(current.status))break;await new Promise(r=>setTimeout(r,2000));}
 assert.equal(current.status,'completed',current.error);assert.deepEqual(current.result.coverage.visualPages,[1,2]);
 const figures=current.result.sections.flatMap(s=>s.figures);assert(figures.length>0,'must retain image analysis');const panel=figures.flatMap(f=>f.panels)[0];assert(panel);assert.match(panel.xAxis,/组|Group|Control|Treatment/i);assert.match(panel.yAxis,/表达|expression|a\.u\./i);
 report.passed.push('真实后台文字、柱状图、扫描页完整覆盖与坐标解析');
 const detail=await post('figure',{...provider,pages,figure:{...figures[0],page:1},pageImage:images[0].dataUrl});assert(detail.panels.length);assert(detail.panels[0].readout||detail.panels[0].explanation);report.passed.push('真实 Figure 精读详细字段');
 const answer=await post('ask',{...provider,pages,analysis:current.result,question:'仅根据软件测试材料，Treatment 与 Control 的数值关系是什么？'});assert.match(answer.answer,/2|两|二|倍/);report.passed.push('真实文献问答');
 const translation=await post('translate',{...provider,text:'The study compared two groups.'});assert(translation.translation&&Array.isArray(translation.terms)&&translation.explanation);report.passed.push('真实三部分划词翻译');
 const archive=await server.jobs.archive();assert.equal(archive.records[0].input.provider,'codex');await server.jobs.close();await new Promise(r=>{server.close(r);server.closeAllConnections?.();});server=await startServer(options);url='http://127.0.0.1:'+server.address().port;const restored=(await server.jobs.list())[0];assert.deepEqual(restored.result,current.result);report.passed.push('真实任务重启保留完整解析');assert.equal(deepseekCalls,0);report.deepseekCalls=deepseekCalls;
 await writeFile('artifacts/codex-live-verification.json',JSON.stringify({...report,finishedAt:new Date().toISOString(),analysis:current.result,detail,answer,translation},null,2));console.log(JSON.stringify(report,null,2));
}finally{await server.jobs.close();await new Promise(r=>{server.close(r);server.closeAllConnections?.();});await rm(dir,{recursive:true,force:true});}
