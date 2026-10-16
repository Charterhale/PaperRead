import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1, acceptDownloads: true });
const results = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const currentPage = () => page.getByLabel('PDF 页码');
const waitPage = number => page.waitForFunction(value => document.querySelector('input[aria-label="PDF 页码"]')?.value === String(value), number);
const selectFirstText = async () => {
  await page.locator('[data-pdf-page="1"] .pdf-text-layer span').first().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
};

try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5179');
  await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');
  const textMetrics = await page.locator('[data-pdf-page="1"] .pdf-text-layer span').first().evaluate(element => ({ fontSize: parseFloat(getComputedStyle(element).fontSize), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
  assert.ok(textMetrics.fontSize > 0 && textMetrics.width > 0 && textMetrics.height > 0);
  results.push('Canvas and selectable text layer render with nonzero glyph geometry');

  await page.getByRole('button', { name: '下一页', exact: true }).click(); await waitPage(2);
  const geometry = await page.locator('[data-pdf-page="2"]').evaluate(element => ({ top: element.getBoundingClientRect().top, rootTop: element.closest('.pdf-scroll').getBoundingClientRect().top }));
  assert.ok(Math.abs(geometry.top - geometry.rootTop - 22) < 3);
  await page.getByRole('button', { name: '上一页', exact: true }).click(); await waitPage(1);
  await currentPage().fill('5'); await currentPage().press('Enter'); await waitPage(5);
  await currentPage().fill('1'); await currentPage().press('Enter'); await waitPage(1);
  results.push('Next, previous and page input navigate to correctly aligned pages');

  await page.getByRole('button', { name: '搜索 PDF 文字', exact: true }).click();
  await page.getByLabel('搜索 PDF 原文', { exact: true }).fill('Figure');
  await page.waitForFunction(() => /[1-9]\d* 处/.test(document.querySelector('.pdf-search-count')?.textContent || ''));
  const searchText = await page.locator('.pdf-search-count').innerText();
  const firstMatch = await currentPage().inputValue();
  await page.getByRole('button', { name: '下一个匹配页', exact: true }).click();
  assert.notEqual(await currentPage().inputValue(), firstMatch);
  await page.getByRole('button', { name: '关闭 PDF 搜索', exact: true }).click();
  await currentPage().fill('1'); await currentPage().press('Enter'); await waitPage(1);
  results.push(`Text search finds ${searchText} and cycles through matching pages`);

  const beforeZoom = (await page.locator('[data-pdf-page="1"]').boundingBox()).width;
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
  await page.waitForFunction(value => document.querySelector('[data-pdf-page="1"]').getBoundingClientRect().width > value + 20, beforeZoom);
  await page.getByRole('button', { name: '缩小 PDF', exact: true }).click();
  await page.getByRole('button', { name: '旋转 PDF', exact: true }).click();
  await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer[data-main-rotation="90"] span');
  await selectFirstText();
  const rotatedSelection = await page.evaluate(() => { const selection = window.getSelection(); const rect = selection.getRangeAt(0).getBoundingClientRect(); return { text: selection.toString(), width: rect.width, height: rect.height }; });
  assert.ok(rotatedSelection.text.length > 0 && rotatedSelection.width > 0 && rotatedSelection.height > 0);
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: '旋转 PDF', exact: true }).click();
  await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer[data-main-rotation="0"] span');
  results.push('Zoom changes the page dimensions; rotated text remains selectable');

  await page.getByRole('button', { name: '收藏当前页', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '收藏当前页', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '高亮选中文字', exact: true }).click();
  await selectFirstText();
  await page.waitForSelector('.pdf-highlight-rect');
  await page.reload();
  await page.waitForSelector('[data-pdf-page="1"] .pdf-text-layer span');
  assert.equal(await page.getByRole('button', { name: '收藏当前页', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('.pdf-highlight-rect').count() > 0);
  await page.getByRole('button',{name:'阅读标记',exact:true}).click();
  assert.equal(await page.locator('.pdf-mark-row').count(), 2);
  await page.getByRole('button', { name: '删除高亮', exact: true }).click();
  await page.getByRole('button', { name: '删除第 1 页书签', exact: true }).click();
  assert.equal(await page.locator('.pdf-highlight-rect').count(), 0);
  results.push('Bookmarks and highlights persist across reload and can be deleted');

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载原始 PDF', exact: true }).click();
  const download = await downloaded;
  assert.match(download.suggestedFilename(), /\.pdf$/i);
  const downloadedBytes = await readFile(await download.path());
  const sourceBytes = await readFile(new URL('../public/demo.pdf', import.meta.url));
  assert.deepEqual(downloadedBytes, sourceBytes);
  results.push('PDF download is byte-for-byte identical to the source document');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results, errors }, null, 2));
} finally { await browser.close(); }
