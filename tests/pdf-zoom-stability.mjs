import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.TEST_URL || 'http://127.0.0.1:5178';
const diagnostic = process.env.ZOOM_DIAGNOSTIC === '1';
const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const reports=[];
try {
 for(const density of [1,2]) {
  const page=await browser.newPage({viewport:{width:1200,height:960},deviceScaleFactor:density});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/pdf-zoom-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>html,body{margin:0;height:100%;font-family:system-ui}#test-root{width:700px;height:960px}</style></head><body><div id="test-root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {default:PdfViewer}=await import('/src/components/PdfViewer.tsx');const data=new Uint8Array(await(await fetch('/demo.pdf')).arrayBuffer());
function App(){const [page,setPage]=React.useState(1);const ref=React.useRef(null);window.testViewer=ref;return React.createElement(PdfViewer,{ref,data,page,onPageChange:setPage});}createRoot(document.getElementById('test-root')).render(React.createElement(App));
</script></body></html>`}));
  await page.goto(origin+'/pdf-zoom-harness');
  await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');await page.getByLabel('手形拖动 PDF').click();
  const settled=async(number)=>{await page.waitForFunction(n=>{const el=document.querySelector('[data-pdf-page="'+n+'"]');return el&&el.querySelector('canvas')&&!el.querySelector('.pdf-page-loading');},number);};
  const scenario=async(name,number,steps,{synchronous=false,clamped=false}={})=>{
   await settled(number);
   const report=await page.evaluate(async({name,number,steps,synchronous,clamped})=>{
    const root=document.querySelector('.pdf-scroll'),target=document.querySelector('[data-pdf-page="'+number+'"]');
    const rootBox=root.getBoundingClientRect();const clientX=rootBox.left+root.clientWidth*.5,clientY=rootBox.top+root.clientHeight*.48;
    let rect=target.getBoundingClientRect();const anchor={x:(clientX-rect.left)/rect.width,y:(clientY-rect.top)/rect.height};
    const initialWidth=rect.width,frames=[];let done=false;
    const frame=()=>{rect=target.getBoundingClientRect();const canvas=target.querySelector('canvas');const canvasRect=canvas?.getBoundingClientRect();frames.push({dx:rect.left+rect.width*anchor.x-clientX,dy:rect.top+rect.height*anchor.y-clientY,width:rect.width,scrollTop:root.scrollTop,page:Number(document.querySelector('[aria-label="PDF 页码"]').value),canvas:!!canvas,loading:!!target.querySelector('.pdf-page-loading'),canvasGap:canvasRect?Math.max(Math.abs(canvasRect.width-rect.width),Math.abs(canvasRect.height-rect.height)):null});if(!done)requestAnimationFrame(frame);};requestAnimationFrame(frame);
    const wheel=deltaY=>root.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX,clientY,deltaY}));
    for(const delta of steps){wheel(delta);if(!synchronous)await new Promise(resolve=>requestAnimationFrame(resolve));}
    await new Promise(resolve=>setTimeout(resolve,550));done=true;await new Promise(resolve=>requestAnimationFrame(resolve));
    const maxAbs=key=>Math.max(...frames.map(f=>Math.abs(f[key])));const widths=frames.map(f=>f.width);
    return {name,number,initialWidth,finalWidth:target.getBoundingClientRect().width,expectedRatio:Math.exp(-steps.reduce((sum,value)=>sum+value,0)*.0025),actualRatio:target.getBoundingClientRect().width/initialWidth,maxDx:maxAbs('dx'),maxDy:maxAbs('dy'),missingCanvasFrames:frames.filter(f=>!f.canvas).length,loadingFrames:frames.filter(f=>f.loading).length,maxCanvasGap:Math.max(...frames.map(f=>f.canvasGap||0)),widthReversals:widths.slice(1).filter((w,i)=>steps.every(d=>d<=0)?w<widths[i]-.05:steps.every(d=>d>=0)?w>widths[i]+.05:false).length,pageValues:[...new Set(frames.map(f=>f.page))],frameCount:frames.length,clamped};
   },{name,number,steps,synchronous,clamped});
   reports.push({density,...report});
   if(!diagnostic){assert.equal(report.missingCanvasFrames,0,name+' should keep a painted canvas');assert.equal(report.loadingFrames,0,name+' should not flash loading over existing page');assert.ok(report.maxCanvasGap<2,name+' should stretch the retained canvas to the page');assert.equal(report.widthReversals,0,name+' must not reverse zoom direction');if(!clamped){assert.ok(report.maxDx<2,name+' horizontal anchor drift '+report.maxDx);assert.ok(report.maxDy<2,name+' vertical anchor drift '+report.maxDy);}assert.ok(Math.abs(report.actualRatio-report.expectedRatio)<.01,name+' lost wheel increments '+report.actualRatio+' vs '+report.expectedRatio);}
  };
  await scenario('fit to horizontal overflow',1,Array(12).fill(-12));
  await page.getByLabel('PDF 页码',{exact:true}).fill('3');await page.getByLabel('PDF 页码',{exact:true}).press('Enter');
  await page.locator('.pdf-scroll').evaluate(el=>el.scrollTop+=180);
  await scenario('page 3 continuous zoom',3,Array(14).fill(-8));
  await scenario('page 3 same-tick wheel burst',3,Array(12).fill(-6),{synchronous:true});
  await scenario('page 3 zoom back across fit',3,Array(20).fill(25));
  await scenario('rapid wheel direction changes',3,[-20,15,-30,10,-15,25,-10,5],{synchronous:true});
  await page.evaluate(()=>window.testViewer.current.goToPage(1));await settled(1);
  const navigation=await page.evaluate(async()=>{
   const root=document.querySelector('.pdf-scroll'),rootBox=root.getBoundingClientRect();const x=rootBox.left+root.clientWidth*.5,y=rootBox.top+300;
   const wheel=()=>root.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:x,clientY:y,deltaY:-10}));
   wheel();window.testViewer.current.goToPage(3);
   const target=document.querySelector('[data-pdf-page="3"]');let box=target.getBoundingClientRect();const anchor={x:(x-box.left)/box.width,y:(y-box.top)/box.height};const width=box.width;
   wheel();await new Promise(resolve=>setTimeout(resolve,450));box=target.getBoundingClientRect();
   return {dx:box.left+box.width*anchor.x-x,dy:box.top+box.height*anchor.y-y,ratio:box.width/width,page:Number(document.querySelector('[aria-label="PDF 页码"]').value)};
  });
  reports.push({density,name:'navigation cancels an unfinished wheel gesture',...navigation});
  if(!diagnostic){assert.ok(Math.abs(navigation.dx)<2&&Math.abs(navigation.dy)<2,'Navigation must start a new cursor anchor: '+JSON.stringify(navigation));assert.ok(Math.abs(navigation.ratio-Math.exp(.025))<.01,'Navigation must discard the prior queued scale increment');}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify({diagnostic,reports},null,2));
}finally{await browser.close();}
