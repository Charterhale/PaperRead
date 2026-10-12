import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1040}}),passed=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const source=process.env.TEST_URL||'http://127.0.0.1:5178';
const dimensions=()=>page.locator('[data-pdf-page="1"]').evaluate(e=>({width:e.getBoundingClientRect().width,top:e.closest('.pdf-scroll').scrollTop,left:e.closest('.pdf-scroll').scrollLeft}));
async function hoverHelp(label,expected){const button=page.getByLabel(label,{exact:true});await button.hover();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').innerText(),expected);const box=await page.getByRole('tooltip').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=1600&&box.y+box.height<=1040);}
try{
 await page.route('**/api/jobs',r=>r.fulfill({json:{jobs:[]}}));await page.route('**/api/health',r=>r.fulfill({json:{configured:false}}));
 await page.goto(source);await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');assert.equal(await page.getByLabel('鼠标指针 PDF').getAttribute('aria-pressed'),'true');
 let before=await dimensions();await page.mouse.move(430,450);await page.mouse.wheel(0,460);await page.waitForTimeout(350);let after=await dimensions();assert.ok(after.top>before.top+300);assert.ok(Math.abs(after.width-before.width)<1);passed.push('指针模式滚轮上下翻页，PDF缩放比例保持不变');
 await page.getByLabel('PDF 页码').fill('1');await page.getByLabel('PDF 页码').press('Enter');await page.mouse.move(430,450);before=await dimensions();await page.mouse.down();await page.mouse.move(330,350,{steps:5});await page.mouse.up();after=await dimensions();assert.ok(Math.abs(after.top-before.top)<2);assert.equal(await page.evaluate(()=>window.getSelection().toString()),'');passed.push('指针模式拖动不会意外平移或触发文字选择');
 await hoverHelp('鼠标指针 PDF',/滚轮上下滚动页面/);await hoverHelp('手形拖动 PDF',/拖动页面.*滚轮/s);await hoverHelp('选择 PDF 文字',/翻译.*滚轮上下翻页/s);await hoverHelp('框选子图精读',/高清子图/);await hoverHelp('高亮选中文字',/高亮|标注/);await hoverHelp('选择高亮颜色',/新高亮/);await hoverHelp('收藏当前页',/书签/);await hoverHelp('旋转 PDF',/90/);await hoverHelp('下载原始 PDF',/原始 PDF/);await hoverHelp('打印 PDF',/打印/);passed.push('PDF工具按钮悬停后显示名称和用法，提示不被面板裁切');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);
 await page.getByLabel('手形拖动 PDF').click();await page.mouse.move(430,450);before=await dimensions();await page.mouse.wheel(0,-180);await page.waitForTimeout(400);after=await dimensions();assert.ok(after.width>before.width+80);
 await page.mouse.move(500,500);before=await dimensions();await page.mouse.down();await page.mouse.move(400,400,{steps:5});await page.mouse.up();after=await dimensions();assert.ok(after.top>before.top+80);passed.push('手形模式继续支持拖动平移和指针中心滚轮缩放');
 await page.getByLabel('选择 PDF 文字').click();await page.mouse.move(430,450);before=await dimensions();await page.mouse.wheel(0,250);await page.waitForTimeout(350);after=await dimensions();assert.ok(after.top>before.top+150);assert.ok(Math.abs(after.width-before.width)<1);passed.push('文字选择模式也能滚轮翻页，不再意外缩放');
 await page.getByLabel('鼠标指针 PDF').click();await page.mouse.move(430,450);before=await dimensions();await page.keyboard.down('Meta');await page.mouse.wheel(0,-100);await page.keyboard.up('Meta');await page.waitForTimeout(350);after=await dimensions();assert.ok(after.width>before.width+30);passed.push('指针模式按住⌘滚轮仍可主动缩放');
 await page.reload();await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');assert.equal(await page.getByLabel('鼠标指针 PDF').getAttribute('aria-pressed'),'true');await page.getByLabel('手形拖动 PDF').click();await page.reload();await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');assert.equal(await page.getByLabel('手形拖动 PDF').getAttribute('aria-pressed'),'true');passed.push('操作模式跨刷新保留');
 await page.getByLabel('鼠标指针 PDF').click();await hoverHelp('鼠标指针 PDF',/滚轮/);await page.screenshot({path:'artifacts/pdf-pointer-tooltip.png'});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,errors},null,2));
}finally{await browser.close();}
