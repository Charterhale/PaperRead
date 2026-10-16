import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const page=await browser.newPage({viewport:{width:1680,height:1080}});
const origin=process.env.TEST_URL||'http://127.0.0.1:5178',errors=[],passed=[];
page.on('pageerror',error=>errors.push(error.message));
const sentence='对星形胶质细胞谱系做拟时序轨迹分析，比较不同生命周期阶段的表达状态，并保留各分组与图例的具体含义。';
const paragraph=Array(30).fill(sentence).join('\n\n');
const panel={label:'d',type:'热图（带平滑趋势线的均值 z score 矩阵）',question:sentence,method:paragraph,groups:paragraph,xAxis:'拟时序 Pseudotime，左侧为 PA，右侧为 FA。',yAxis:'Psychiatric / Neurological / Other，包含多种疾病与性状。',readout:paragraph,result:paragraph,statistics:sentence,takeaway:sentence,explanation:'### 分步骤读图\n\n'+paragraph+'\n\n```text\n'+('LONG_LABEL_'.repeat(70))+'\n```\n\n| 变量 | 说明 |\n| --- | --- |\n| '+('VARIABLE_'.repeat(30))+' | '+sentence+' |',evidence:''};
await page.route('**/focus-layout-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="test-root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {default:FigureFocus}=await import('/src/components/FigureFocus.tsx');
window.mountFocus=panel=>createRoot(document.getElementById('test-root')).render(React.createElement(FigureFocus,{paper:{id:'focus-test',pages:['fixture']},figure:{id:'f',title:'Figure 1',page:1,caption:'fixture',panels:[panel]},panel,crop:{page:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD7cAAAAASUVORK5CYII=',region:{x:0,y:0,width:1,height:1}},settings:{apiKey:'',model:'deepseek-flash',vision:true},hasKey:false,onSettings:()=>{},onSave:p=>window.savedPanel=p,onClose:()=>{}}));
</script></body></html>`}));
const field=name=>page.locator('.focus-field').filter({has:page.locator('summary strong').getByText(name,{exact:true})});
const checkReading=async()=>{
 const metrics=await page.locator('.focus-reading').evaluate(element=>({horizontal:element.scrollWidth-element.clientWidth,fields:[...element.querySelectorAll('.focus-field-text')].map(e=>({horizontal:e.scrollWidth-e.clientWidth,vertical:e.scrollHeight-e.clientHeight}))}));
 assert.ok(metrics.horizontal<=1,JSON.stringify(metrics));assert(metrics.fields.every(e=>e.horizontal<=1&&e.vertical<=1),JSON.stringify(metrics));
};
const checkInputs=async()=>{
 await page.waitForTimeout(100);
 const metrics=await page.locator('.focus-reading textarea').evaluateAll(elements=>elements.filter(e=>e.getBoundingClientRect().width>0).map(e=>({label:e.getAttribute('aria-label'),scroll:e.scrollHeight,client:e.clientHeight,overflow:getComputedStyle(e).overflowY})));
 assert(metrics.length>=10);assert(metrics.every(e=>e.scroll<=e.client+1&&e.overflow==='hidden'),JSON.stringify(metrics));
};
try{
 await page.goto(origin+'/focus-layout-harness');await page.waitForFunction(()=>window.mountFocus);await page.evaluate(p=>window.mountFocus(p),panel);await page.waitForSelector('.focus-field-text');
 assert.equal(await page.getByRole('button',{name:'阅读',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.focus-reading textarea').count(),0);
 assert.equal(await field('实验 / 分析方法').count(),0);await field('怎么看').locator('.text-disclosure').click();assert.match(await field('怎么看').innerText(),/拟时序/);await checkReading();passed.push('默认阅读模式完整展示长段落、代码与表格，不产生文字区内部滚动条');
 await field('怎么看').locator('summary').click();assert.equal(await field('怎么看').getAttribute('open'),null);
 await page.getByTitle('折叠所有精读内容').click();assert.equal(await page.locator('.focus-field[open]').count(),0);
 await page.getByTitle('展开所有精读内容').click();assert.equal(await page.locator('.focus-field[open]').count(),3);passed.push('每一项与全部精读内容均可折叠展开');
 await page.getByRole('button',{name:'编辑',exact:true}).click();await checkInputs();
 const changed=paragraph+'\n\n编辑内容完整保留。';await page.getByLabel('实验 / 分析方法',{exact:true}).fill(changed);await checkInputs();assert.equal(await page.getByLabel('实验 / 分析方法',{exact:true}).inputValue(),changed);
 await page.getByTitle('折叠所有精读内容').click();await page.getByTitle('展开所有精读内容').click();await checkInputs();passed.push('编辑框按全文自动增高，折叠后重开仍完整显示');
 await page.setViewportSize({width:1000,height:720});await checkInputs();
 await page.getByRole('button',{name:'阅读',exact:true}).click();await checkReading();assert.equal(await field('实验 / 分析方法').count(),0);
 await page.locator('.focus-reading').evaluate(e=>{e.scrollTop=e.scrollHeight;});const bottom=await field('补充讲解').boundingBox();const footer=await page.locator('.figure-focus footer').boundingBox();assert.ok(bottom.y+bottom.height<=footer.y+1);assert.ok(footer.y+footer.height<=720);passed.push('窄窗口重新排版，长文字只随整体阅读区滚动，末尾与保存按钮不被遮挡');
 await page.getByRole('button',{name:'保存到子图解析',exact:true}).click();const saved=await page.evaluate(()=>window.savedPanel);assert.equal(saved.method,changed);assert.equal(saved.label,'d');assert.ok(saved.image);assert.deepEqual(saved.crop,{x:0,y:0,width:1,height:1});passed.push('阅读与编辑切换后保存全文及裁图，不丢内容');
 await page.screenshot({path:'artifacts/figure-focus-reading.png'});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,errors},null,2));
}finally{await browser.close();}
