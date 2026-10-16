import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodexClient, runCodexProcess } from '../server/codex.mjs';
import { startServer } from '../server/index.mjs';
import { credentials, validateImages } from '../server/validation.mjs';
import { prepareAnalysis } from '../server/service.mjs';
import { planAnalysisBatches } from '../server/batches.mjs';
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD7cAAAAASUVORK5CYII=';
const object={title:'模拟解析',subtitle:'软件测试',overview:'概括',sections:[{title:'结果',shortTitle:'结果',page:1,summary:'概括',proves:'支持',markdown:'详细解析',figures:[]}],limitations:[]};
function fakeRunner(value,{auth='ChatGPT',failure}={}){
 return async(binary,args,options)=>{
  if(args[0]==='login')return {code:0,stdout:'Logged in using '+auth,stderr:''};
  assert(args.includes('--ignore-user-config'));assert(args.includes('--ephemeral'));assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert(args.includes('forced_login_method="chatgpt"'));assert(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  if(failure)return {code:1,stdout:JSON.stringify({type:'turn.failed',error:{message:failure}}),stderr:''};
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(value));
  return {code:0,stdout:JSON.stringify({type:'turn.completed'}),stderr:''};
 };
}
test('Codex auth requires subscription, ignores API key fields and accepts page images',()=>{
 const auth=credentials({provider:'codex',model:'codex-auto',apiKey:'never-use-me'},'env-never-use-me');assert.equal(auth.apiKey,'');assert.equal(auth.provider,'codex');assert.equal(validateImages([{page:1,dataUrl:IMAGE}],1,auth.model).length,1);
 assert.throws(()=>credentials({provider:'other'},''),{code:'INVALID_PROVIDER'});
 assert.throws(()=>credentials({provider:'codex',model:'deepseek-flash'},''),{code:'INVALID_MODEL'});
 assert.throws(()=>credentials({provider:'deepseek'},''),{code:'API_KEY_REQUIRED'});
});
test('checkpoints bind the original model and Codex provider survives durable input allowlist',()=>{
 const body={provider:'codex',model:'codex-auto',pages:['PDF content'],images:[],category:'基础医学',pipelineVersion:2};
 const {input}=prepareAnalysis(body);assert.equal(input.provider,'codex');assert(!('apiKey' in input));assert.notEqual(planAnalysisBatches(input).planId,planAnalysisBatches({...input,model:'deepseek-flash'}).planId);
});
test('images are passed through private files, page mapping is in prompt, files are cleaned',async()=>{
 let directory;
 const runner=async(binary,args,options)=>{
  if(args[0]==='login')return {code:0,stdout:'Logged in using ChatGPT',stderr:''};
  directory=options.cwd;const image=args[args.indexOf('--image')+1];assert.equal((await readFile(image)).length>0,true);assert.match(options.input,/物理页码 2/);assert(!args.some(a=>a.includes(IMAGE)));return fakeRunner({answer:'complete'})(binary,args,options);
 };
 const client=createCodexClient({executable:process.execPath,runner});assert.deepEqual(await client.complete({system:'instruction',text:'材料',images:[{page:2,dataUrl:IMAGE}]}),{answer:'complete'});await assert.rejects(readFile(path.join(directory,'result.json')),{code:'ENOENT'});
});
test('an API-key login cannot trigger inference or fall back to another paid service',async()=>{
 let calls=0;const client=createCodexClient({executable:process.execPath,runner:async(...args)=>{calls++;return fakeRunner({}, {auth:'an API key'})(...args);}});
 await assert.rejects(client.complete({text:'demo',system:'instruction'}),{code:'CODEX_LOGIN_REQUIRED'});assert.equal(calls,1);
});
test('quota errors retain actionable message and never expose model error details',async()=>{
 const client=createCodexClient({executable:process.execPath,runner:fakeRunner({}, {failure:'usage limit reached PRIVATE-PAPER-TEXT'})});await assert.rejects(client.complete({text:'demo',system:'instruction'}),error=>error.code==='CODEX_USAGE_LIMIT'&&!error.message.includes('PRIVATE'));
});
test('cancel stops the spawned process promptly',async()=>{
 const controller=new AbortController();const start=Date.now();const running=runCodexProcess('/bin/sleep',['20'],{signal:controller.signal});controller.abort();await assert.rejects(running,{code:'REQUEST_CANCELLED'});assert(Date.now()-start<2500);
});
test('queued Codex request honours cancellation without starting a second inference',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r);const controller=new AbortController();const client=createCodexClient({executable:process.execPath,runner:async(...args)=>{if(args[1][0]==='exec'){calls++;await gate;}return fakeRunner({answer:'ok'})(...args);}});
 const first=client.complete({text:'one',system:'instructions'});const second=client.complete({text:'two',system:'instructions',signal:controller.signal});const cancelled=assert.rejects(second,{code:'REQUEST_CANCELLED'});controller.abort();release();await first;await cancelled;assert.equal(calls,1);
});
test('two background reads reserve an independent interactive lane', async () => {
 let release; const gate=new Promise(resolve=>release=resolve); const started=[];
 const client=createCodexClient({executable:process.execPath,runner:async (...args)=>{
  if(args[1][0]==='exec'){const name=args[2].input.includes('interactive-question')?'ask':args[2].input.includes('background-two')?'two':'one';started.push(name);if(name!=='ask')await gate;}
  return fakeRunner({answer:'ok'})(...args);
 }});
 const one=client.complete({text:'background-one',priority:'background'}),two=client.complete({text:'background-two',priority:'background'});
 for(let i=0;i<100&&started.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(started.sort(),['one','two']);
 const interactive=await client.complete({text:'interactive-question'});
 assert.equal(interactive.answer,'ok');assert(started.includes('ask'));release();await Promise.all([one,two]);
});
test('HTTP routing defaults UI to Codex; explicit DeepSeek stays manual; durable Codex job restores',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paperlens-provider-test-'));let deepseekCalls=0;
 const options={port:0,jobDir:path.join(dir,'jobs'),backupDir:path.join(dir,'backups'),codexOptions:{executable:process.execPath,runner:fakeRunner(object)},fetchImpl:async()=>{deepseekCalls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:'DeepSeek manual'})}}]}));}};
 let server=await startServer(options);let url='http://127.0.0.1:'+server.address().port;
 const post=(route,body)=>fetch(url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const health=await(await fetch(url+'/api/health')).json();assert.equal(health.defaultProvider,'codex');const status=await(await fetch(url+'/api/codex/status')).json();assert.equal(status.billing,'subscription');
  const job=await(await post('jobs',{paperId:'p1',title:'Test',pages:['text'],provider:'codex',model:'codex-auto'})).json();
  let completed;for(let i=0;i<100;i++){completed=await server.jobs.get(job.id);if(['completed','failed'].includes(completed.status))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(completed.status,'completed',completed.error);assert.equal(completed.provider,'codex');assert.equal(deepseekCalls,0);
  const archive=await server.jobs.archive();assert.equal(archive.records[0].input.provider,'codex');assert(!JSON.stringify(archive).includes('apiKey'));
  await server.jobs.close();await new Promise(r=>{server.close(r);server.closeAllConnections?.();});server=await startServer(options);url='http://127.0.0.1:'+server.address().port;assert.equal((await server.jobs.list())[0].result.sections[0].markdown,'详细解析');
  const manual=await post('ask',{provider:'deepseek',model:'deepseek-flash',apiKey:'test-key-only',pages:['text'],question:'test'});assert.equal(manual.status,200);assert.equal(deepseekCalls,1);
 }finally{await server.jobs.close();await new Promise(r=>{server.close(r);server.closeAllConnections?.();});await rm(dir,{recursive:true,force:true});}
});

test('desktop minimal PATH still launches Node; API credentials are absent from child environment',async()=>{
 const beforePath=process.env.PATH,beforeKey=process.env.OPENAI_API_KEY;process.env.PATH='/usr/bin:/bin';process.env.OPENAI_API_KEY='test-sentinel';
 try{const result=await runCodexProcess('/usr/bin/env',['node','-e','console.log(JSON.stringify({node:!!process.version,hasApiKey:!!process.env.OPENAI_API_KEY}))']);assert.equal(result.code,0);assert.deepEqual(JSON.parse(result.stdout),{node:true,hasApiKey:false});}
 finally{process.env.PATH=beforePath;if(beforeKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=beforeKey;}
});

test('selected OpenAI model and low/medium/high effort reach Codex argv without altering subscription auth',async()=>{
 const seen=[];const client=createCodexClient({executable:process.execPath,modelReader:async()=>({models:[{id:'gpt-test-model',efforts:['low','medium','high'],inputModalities:['text','image']}]}),runner:async(binary,args,options)=>{if(args[0]==='exec')seen.push(args);return fakeRunner({answer:'ok'})(binary,args,options);}});
 for(const effort of ['low','medium','high'])await client.complete({model:'gpt-test-model',reasoningEffort:effort,system:'instructions',text:'test'});
 assert.deepEqual(seen.map(a=>a[a.indexOf('--model')+1]),['gpt-test-model','gpt-test-model','gpt-test-model']);assert.deepEqual(seen.map(a=>a.find(s=>s.startsWith('model_reasoning_effort='))),['model_reasoning_effort="low"','model_reasoning_effort="medium"','model_reasoning_effort="high"']);
 await assert.rejects(client.complete({model:'gpt-unavailable',system:'instructions',text:'test'}),{code:'CODEX_MODEL_UNAVAILABLE'});assert.equal(seen.length,3);
});
test('invalid effort is rejected and different efforts cannot reuse a checkpoint plan',()=>{
 assert.throws(()=>credentials({provider:'codex',model:'gpt-test-model',reasoningEffort:'ultra'},''),{code:'INVALID_REASONING_EFFORT'});
 const input=prepareAnalysis({provider:'codex',model:'gpt-test-model',reasoningEffort:'low',pages:['text']}).input;assert.equal(input.reasoningEffort,'low');assert.notEqual(planAnalysisBatches(input).planId,planAnalysisBatches({...input,reasoningEffort:'high'}).planId);
});

test('Codex reconnect warnings do not discard a later completed response',async()=>{
 const client=createCodexClient({executable:process.execPath,runner:async(...args)=>{const result=await fakeRunner({answer:'recovered'})(...args);if(args[1][0]==='exec')result.stdout=JSON.stringify({type:'error',message:'Reconnecting... connection reset by peer'})+'\n'+result.stdout;return result;}});
 assert.deepEqual(await client.complete({text:'test',system:'instructions'}),{answer:'recovered'});
});
test('terminal network errors are not misreported as expired authentication',async()=>{
 const client=createCodexClient({executable:process.execPath,runner:fakeRunner({}, {failure:'stream disconnected: Connection reset by peer'})});await assert.rejects(client.complete({text:'test',system:'instructions'}),{code:'CODEX_NETWORK'});
});
