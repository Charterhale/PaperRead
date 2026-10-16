// One real subscription request with synthetic input. No personal PDF is sent.
import { createCodexClient } from '../server/codex.mjs';
import { createServices } from '../server/service.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const client=createCodexClient();let calls=0;
const services=createServices({complete:request=>{calls++;return client.complete(request);}});
const pages=Array.from({length:32},(_,i)=>`SYNTHETIC SOFTWARE TEST ONLY. Page ${i+1}. Routine methods. `+'Unrelated background. '.repeat(180));
pages[0]+='The dorsolateral prefrontal cortex (DLPFC) is the region used in this synthetic teaching example. No real experiments are reported.';
const analysis={overview:'软件测试材料',sections:[{id:'test',page:1,title:'Teaching example',summary:'An abbreviation definition in a software test.',markdown:'与问题无关的既往长解析。'.repeat(25000),figures:[]}]};
assert(JSON.stringify(analysis).length>180000);
const started=Date.now();
const result=await services.ask({provider:'codex',model:'codex-auto',reasoningEffort:'medium',pages,analysis,question:'DLPFC是什么？',activeSectionId:'test'},undefined);
assert.match(result.answer,/背外侧|dorsolateral/i);assert.equal(calls,1);
const report={passed:true,provider:'codex',billing:'subscription',requestCount:calls,seconds:Math.round((Date.now()-started)/100)/10,context:result.context,answer:result.answer,synthetic:true};
await writeFile('artifacts/v0.7.1-question-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
