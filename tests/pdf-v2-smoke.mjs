import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.TEST_URL || 'http://127.0.0.1:5178';
const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 960 }, deviceScaleFactor: 1 });
const errors = [], passed = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
await page.route('**/pdf-v2-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>html,body{margin:0;height:100%;font-family:system-ui}#test-root{width:700px;height:960px}</style></head><body><div id="test-root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {default:React}=await import('/node_modules/.vite/deps/react.js');
const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
const {default:PdfViewer}=await import('/src/components/PdfViewer.tsx');
const data=new Uint8Array(await(await fetch('/demo.pdf')).arrayBuffer());
window.testCrop=null;window.testSelection=null;
function App(){const [page,setPage]=React.useState(1);return React.createElement(PdfViewer,{data,page,onPageChange:setPage,onCrop:crop=>window.testCrop=crop,onSelection:selection=>window.testSelection=selection});}
createRoot(document.getElementById('test-root')).render(React.createElement(App));
</script></body></html>` }));
const box = () => page.locator('[data-pdf-page="1"]').boundingBox();
const positions = () => page.locator('.pdf-scroll').evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
const selectText = () => page.locator('[data-pdf-page="1"] .pdf-text-layer span').first().evaluate(el => {
  const range = document.createRange();range.selectNodeContents(el);const selection = window.getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
});
try {
  await page.goto(origin+'/pdf-v2-harness');
  await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');
  assert.equal(await page.getByLabel('鼠标指针 PDF').getAttribute('aria-pressed'), 'true');await page.getByLabel('手形拖动 PDF').click();assert.equal(await page.getByLabel('手形拖动 PDF').getAttribute('aria-pressed'), 'true');
  let b=await box();const x=b.x+b.width*.45,y=b.y+300;const before={nx:(x-b.x)/b.width,ny:(y-b.y)/b.height,w:b.width};
  await page.mouse.move(x,y);await page.mouse.wheel(0,-200);
  await page.waitForFunction(w=>document.querySelector('[data-pdf-page="1"]').getBoundingClientRect().width>w+100,b.width);
  b=await box();assert.ok(Math.abs((x-b.x)/b.width-before.nx)<.003);assert.ok(Math.abs((y-b.y)/b.height-before.ny)<.003);
  passed.push('Wheel zoom preserves the exact PDF point under the cursor');
  const start=await positions();await page.mouse.move(350,500);await page.mouse.down();await page.mouse.move(250,390,{steps:8});await page.mouse.up();const end=await positions();assert.ok(end.x>start.x+90&&end.y>start.y+100);assert.equal(await page.evaluate(()=>window.getSelection().toString()),'');assert.equal(await page.evaluate(()=>window.testSelection),null);
  passed.push('Hand drag pans both axes without selecting or translating text');
  await page.getByLabel('选择 PDF 文字',{exact:true}).click();await page.keyboard.down('Space');const spaceStart=await positions();await page.mouse.move(330,440);await page.mouse.down();await page.mouse.move(280,390,{steps:5});await page.mouse.up();await page.keyboard.up('Space');const spaceEnd=await positions();assert.ok(spaceEnd.y>spaceStart.y+45);passed.push('Space temporarily enables hand dragging in text selection mode');
  await page.getByLabel('适合页面宽度',{exact:true}).click();await page.getByLabel('PDF 页码',{exact:true}).fill('1');await page.getByLabel('PDF 页码',{exact:true}).press('Enter');
  await page.getByLabel('选择高亮颜色',{exact:true}).click();await page.getByLabel('粉色高亮',{exact:true}).click();await page.getByLabel('高亮选中文字',{exact:true}).click();await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');await selectText();await page.waitForSelector('.pdf-highlight-rect');assert.equal(await page.locator('.pdf-highlight-rect').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 145, 180)');
  await page.reload();await page.waitForSelector('.pdf-highlight-rect');assert.equal(await page.locator('.pdf-highlight-rect').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 145, 180)');
  await page.locator('.pdf-statusbar button').click();await page.getByLabel('修改此标注颜色').fill('#123abc');assert.equal(await page.locator('.pdf-highlight-rect').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(18, 58, 188)');await page.getByLabel('关闭阅读标记').click();passed.push('Custom highlight colors persist and existing annotations can be recolored');
  await page.getByLabel('选择 PDF 文字',{exact:true}).click();await selectText();assert.ok((await page.evaluate(()=>window.testSelection))?.text.length>0);await page.evaluate(()=>window.getSelection().removeAllRanges());passed.push('Text mode still exposes selected text and page for translation');
  await page.getByLabel('框选子图精读',{exact:true}).click();b=await box();await page.mouse.move(b.x+b.width*.2,b.y+b.height*.15);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+b.height*.45,{steps:8});assert.equal(await page.locator('.pdf-crop-region').count(),1);await page.mouse.up();await page.waitForFunction(()=>window.testCrop!==null);const crop=await page.evaluate(()=>window.testCrop);assert.equal(crop.page,1);assert.ok(Math.abs(crop.region.x-.2)<.003&&Math.abs(crop.region.width-.5)<.003);const image=await page.evaluate(async()=>{const img=new Image();img.src=window.testCrop.dataUrl;await img.decode();return {width:img.width,height:img.height};});assert.ok(image.width>1000&&image.height>500);passed.push('Pointer crop returns a high-resolution subfigure image and normalized original-page coordinates');
  await page.evaluate(()=>window.testCrop=null);await page.getByLabel('旋转 PDF',{exact:true}).click();await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer[data-main-rotation="90"] span');await page.getByLabel('框选子图精读',{exact:true}).click();b=await box();await page.mouse.move(b.x+b.width*.2,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.5,{steps:8});await page.mouse.up();await page.waitForFunction(()=>window.testCrop!==null);const rotated=await page.evaluate(()=>window.testCrop.region);assert.ok(Math.abs(rotated.x-.2)<.003&&Math.abs(rotated.y-.4)<.003&&Math.abs(rotated.width-.3)<.003&&Math.abs(rotated.height-.4)<.003);passed.push('Rotated crop maps back to the correct original orientation');
  await page.getByLabel('框选子图精读',{exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByLabel('框选子图精读',{exact:true}).getAttribute('aria-pressed'),'false');passed.push('Escape cancels crop mode');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,errors},null,2));
} catch (error) {console.error(await page.locator('body').innerText());throw error;} finally {await browser.close();}
