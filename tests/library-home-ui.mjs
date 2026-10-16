import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('artifacts',{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const page=await browser.newPage({viewport:{width:1540,height:990}}),errors=[],passed=[];
page.on('pageerror',e=>errors.push(e.message));
let jobs=[],pdfRequests=0;page.on('request',r=>{if(r.url().endsWith('/demo.pdf'))pdfRequests++;});
await page.route('**/api/**',r=>r.fulfill({json:{jobs,records:[],models:[],items:[],available:true,authenticated:true}}));
try{
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port);await page.waitForSelector('.library-home');
 assert.equal(pdfRequests,0);assert.equal(await page.locator('.pdf-page-wrap,.analysis-column').count(),0);
 const original=await page.evaluate(async()=>{
  const {demoPaper}=await import('/src/lib/demo.ts'),{savePaper}=await import('/src/lib/storage.ts');
  const bytes=new Uint8Array(await(await fetch('/demo.pdf')).arrayBuffer());
  const titles=['演示 · 衰老细胞与滑膜炎症','演示 · 软骨再生的细胞图谱','演示 · 纳米材料靶向递送','演示 · 临床队列与关节结局','演示 · 单细胞通讯分析','演示 · 骨关节炎系统综述'];
  const records=[];
  for(let i=0;i<6;i++){
   const p={...structuredClone(demoPaper),demo:false,id:'home-demo-'+i,title:titles[i],authors:['Chen 等','Liu 等','Wang 等','Zhang 等','Li 等','Zhou 等'][i],journal:['教学期刊 A','教学期刊 B','教学期刊 C','教学期刊 D','教学期刊 E','教学期刊 F'][i],year:String(2020+i),addedAt:100+i,folderId:i<3?'reading':i===5?'unknown':'topic',lastReadAt:i===0?40:undefined,readingStatus:i===1?'done':i===0?'reading':'unread',fileHash:'synthetic-'+i,doi:i>3?'10.0000/synthetic-example':'',notes:'# 阅读笔记\n\n文献 '+i+' 的笔记保留。',tags:i===0?['衰老','单细胞']:[],analysisEdited:true};
   await savePaper(p,bytes);records.push(p);
  }
  localStorage.setItem('pl-folders',JSON.stringify([{id:'reading',name:'正在阅读'},{id:'topic',name:'关节课题'}]));localStorage.setItem('pl-last-paper','"home-demo-0"');localStorage.setItem('pl-page-home-demo-0','4');localStorage.setItem('pl-reading-section-home-demo-0',JSON.stringify({id:'mechanism',page:4}));localStorage.setItem('paperlens-pdf-home-test-highlights','[{"id":"old","color":"#ffaa00"}]');
  return records;
 });
 jobs=[{id:'synthetic-job',paperId:'home-demo-2',title:'教学演示后台任务',status:'running',progress:35,message:'正在解析第 2 批',createdAt:1,updatedAt:1}];
 pdfRequests=0;await page.reload();await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(6);assert.equal(pdfRequests,0);
 const storedBefore=await page.evaluate(async()=>{const {getAllRecords}=await import('/src/lib/storage.ts');return(await getAllRecords()).map(p=>({id:p.id,lastReadAt:p.lastReadAt}));});assert.deepEqual(storedBefore.map(p=>p.lastReadAt),[40,undefined,undefined,undefined,undefined,undefined]);
 await expect(page.locator('.home-task-button')).toHaveClass(/is-running/);await expect(page.getByLabel('文献正在解析')).toHaveCount(1);
 passed.push('默认只打开文献库；不加载PDF、不修改阅读时间，正在解析的文献有绿色状态');
 await page.getByLabel('搜索文献库',{exact:true}).fill('Chen');await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(1);await page.getByLabel('清除搜索').click();
 await page.getByRole('button',{name:/^重复文献/}).click();await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(2);await page.getByRole('button',{name:/^全部文献/}).click();
 await page.getByRole('button',{name:/^关节课题/}).click();await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(2);await page.getByRole('button',{name:/^全部文献/}).click();
 await page.getByLabel('文献排序',{exact:true}).selectOption('year');await expect(page.locator('.home-paper-table tbody tr').first()).toContainText('2025');await page.getByLabel('改为升序').click();await expect(page.locator('.home-paper-table tbody tr').first()).toContainText('2020');
 const first=page.locator('.home-paper-table tbody tr').filter({hasText:original[0].title});await first.locator('.home-author-cell').click();await expect(page.locator('.home-preview-title')).toHaveText(original[0].title);assert.equal(await page.locator('.pdf-page-wrap').count(),0);
 await page.getByRole('tab',{name:'笔记',exact:true}).click();await expect(page.locator('.home-preview-notes')).toContainText('文献 0 的笔记保留');
 await page.screenshot({path:'artifacts/v0.8.1-library-light.png'});
 passed.push('搜索、重复筛选、文件夹、年份升降序、单击资料与笔记预览可用');
 await first.getByTitle('打开文献精读',{exact:true}).click();await page.waitForSelector('.pdf-page-drawing canvas');await expect(page.getByLabel('PDF 页码')).toHaveValue('4');
 await page.getByLabel('PDF 页码').fill('5');await page.getByLabel('PDF 页码').press('Enter');await expect(page.getByLabel('PDF 页码')).toHaveValue('5');await page.getByRole('button',{name:'我的笔记',exact:true}).click();await expect(page.getByLabel('Markdown 笔记')).toHaveValue(original[0].notes);
 await page.getByRole('button',{name:'返回文献库',exact:true}).click();await page.waitForSelector('.library-home');assert.equal(await page.locator('.pdf-page-wrap').count(),0);
 await page.locator('.home-paper-table tbody tr').filter({hasText:original[0].title}).getByTitle('打开文献精读',{exact:true}).click();await page.waitForSelector('.pdf-page-drawing canvas');await expect(page.getByLabel('PDF 页码')).toHaveValue('5');await expect(page.getByLabel('Markdown 笔记')).toHaveValue(original[0].notes);
 await page.getByRole('button',{name:'深度解析',exact:true}).click();await page.getByLabel('选择阅读小节').selectOption('atlas');await expect(page.getByLabel('PDF 页码')).toHaveValue('3');await page.screenshot({path:'artifacts/v0.8.1-reader-light.png'});
 await page.getByRole('button',{name:'返回文献库',exact:true}).click();await page.waitForSelector('.library-home');
 passed.push('打开文献进入精读；返回后重开保留PDF页码、笔记页签，章节跳转仍可用');
 await page.getByRole('button',{name:'编辑文献资料',exact:true}).click();await page.getByLabel('文献标题',{exact:true}).fill('演示 · 重命名后的研究');await page.getByLabel('文献作者',{exact:true}).fill('Hu 等');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.home-preview-title')).toHaveText('演示 · 重命名后的研究');
 await page.getByLabel('选择当前结果全部文献').check();await page.getByLabel('批量加入文件夹').selectOption('topic');await expect(page.getByLabel('批量操作')).toHaveCount(0);await page.getByRole('button',{name:/^关节课题/}).click();await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(6);
 await page.getByRole('button',{name:/^全部文献/}).click();const removeRow=page.locator('.home-paper-table tbody tr').filter({hasText:original[1].title});await removeRow.locator('.home-author-cell').click();await page.getByRole('button',{name:'所选文献工具',exact:true}).click();await page.getByRole('button',{name:'移入回收站',exact:true}).click();await page.getByRole('dialog',{name:'删除文献',exact:true}).getByRole('button',{name:'删除',exact:true}).click();await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(5);assert.equal(await page.locator('.pdf-page-wrap').count(),0);
 await page.getByRole('button',{name:'回收站',exact:true}).click();await page.getByRole('button',{name:'恢复',exact:true}).click();await page.getByTitle('关闭回收站').click();await expect(page.locator('.home-paper-table tbody tr')).toHaveCount(6);
 passed.push('资料编辑、批量移动、移入回收站与恢复均保留完整文献');
 await page.getByLabel('切换明暗主题').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.waitForTimeout(250);await page.screenshot({path:'artifacts/v0.8.1-library-dark.png'});await page.getByLabel('切换明暗主题').click();
 await page.setViewportSize({width:1000,height:700});await page.screenshot({path:'artifacts/v0.8.1-library-compact.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.library-home')).toHaveClass(/sidebar-hidden/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'artifacts/v0.8.1-library-small.png'});
 const saved=await page.evaluate(async()=>{const {getAllRecords}=await import('/src/lib/storage.ts');return{records:await getAllRecords(),highlight:localStorage.getItem('paperlens-pdf-home-test-highlights')};});for(const old of original){const current=saved.records.find(p=>p.id===old.id);assert.deepEqual(current.analysis,old.analysis);assert.equal(current.notes,old.notes);assert.ok(current.pdf.byteLength>0);}assert.equal(saved.highlight,'[{"id":"old","color":"#ffaa00"}]');assert.deepEqual(errors,[]);
 passed.push('明暗和窄窗布局检查通过；原始解析、笔记、PDF与高亮完整保留');
 await writeFile('artifacts/v0.8.1-library-ui-checks.json',JSON.stringify({passed,errors},null,2));console.log(JSON.stringify({passed,errors},null,2));
}catch(e){await page.screenshot({path:'artifacts/v0.8.1-library-error.png'});throw e;}finally{await browser.close();await server.close();}
