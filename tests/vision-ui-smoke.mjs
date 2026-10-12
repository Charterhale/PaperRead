import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { makeVisualPagesFixture } from './fixtures/pdf-visual-pages.mjs';

const url = process.env.TEST_URL || 'http://127.0.0.1:5178';
const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1080 } });
const errors = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
const { bytes, expected } = await makeVisualPagesFixture();
const expectedPages = expected.filter(item => item.kind !== 'text').map(item => item.page);
const successfulUploads = [], attemptedUploads = [], starts = [], stages = [], retries = [];
let job, failThirdBatch = true, releaseFirstUpload, markFirstUploadStarted;
const firstUploadStarted = new Promise(resolve => { markFirstUploadStarted = resolve; });
const firstUploadGate = new Promise(resolve => { releaseFirstUpload = resolve; });
const allBatches = expectedPages.reduce((groups, pageNumber, index) => {
  if (index % 4 === 0) groups.push([]); groups.at(-1).push(pageNumber); return groups;
}, []);
const coverage = {
  pipelineVersion: 2, totalPages: 36, expectedVisualPages: expectedPages, visualPages: expectedPages,
  textOnlyPages: [1, 18, 36],
  batches: allBatches.map((imagePages, index) => ({ id: `visual-${index + 1}`, pages: imagePages, imagePages, status: 'completed' })),
  pages: expected.map(item => ({ page: item.page, mode: item.kind === 'text' ? 'text-only' : 'visual', batchIds: item.kind === 'text' ? ['text-1'] : [`visual-${Math.floor(expectedPages.indexOf(item.page) / 4) + 1}`] })),
};
const result = {
  title: '36 页完整图像解析测试', subtitle: '分批解析与合并', category: '基础医学', overview: '全部 33 个视觉页面均已完成，正文页单独保留。',
  sections: [{ id: 'complete-visuals', title: '完整结果', shortTitle: '完整结果', page: 2, summary: '逐批读取每一张含图或扫描页面。', proves: '任务已完成所有预定页面。', markdown: '分批结果已合并。', figures: [] }],
  limitations: [], coverage,
};
function copyJob() { return JSON.parse(JSON.stringify(job)); }
await page.route('**/api/health', route => route.fulfill({ json: { configured: false } }));
await page.route('https://api.deepseek.com/**', () => { throw new Error('Smoke tests must not contact DeepSeek'); });
await page.route('**/api/jobs', route => route.fulfill({ json: { jobs: job ? [copyJob()] : [] } }));
await page.route('**/api/jobs/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
  if (path.endsWith('/stage')) {
    stages.push(body);
    const now = Date.now();
    job = { id: 'vision-resume-job', paperId: body.paperId, title: body.title, status: 'preparing', progress: 0, message: '正在准备页面图片（0/33）', createdAt: now, updatedAt: now, pipelineVersion: 2, preparation: { expectedPages: body.expectedVisualPages, receivedPages: [] }, visualPlan: body.visualPlan };
    return route.fulfill({ status: 202, json: copyJob() });
  }
  if (path.endsWith('/images')) {
    const numbers = body.images.map(image => image.page);
    attemptedUploads.push(numbers);
    assert.ok(numbers.length >= 1 && numbers.length <= 4, 'Every image upload must stay within 4 pages');
    assert.ok(body.images.every(image => image.dataUrl.startsWith('data:image/jpeg;base64,')));
    const byteCount = body.images.reduce((sum, image) => sum + Buffer.from(image.dataUrl.split(',')[1], 'base64').length, 0);
    assert.ok(byteCount <= 8 * 1024 * 1024, 'Every image upload must stay within 8 MiB');
    if (attemptedUploads.length === 1) { markFirstUploadStarted(); await firstUploadGate; }
    if (attemptedUploads.length === 3 && failThirdBatch) {
      failThirdBatch = false;
      return route.fulfill({ status: 503, json: { error: '测试：第 3 批上传中断，已保存前 8 页' } });
    }
    successfulUploads.push(numbers);
    job = { ...job, updatedAt: Date.now(), preparation: { ...job.preparation, receivedPages: [...new Set([...job.preparation.receivedPages, ...numbers])].sort((a, b) => a - b) } };
    job.message = `已保存页面图片 ${job.preparation.receivedPages.length} / 33`;
    return route.fulfill({ json: copyJob() });
  }
  if (path.endsWith('/retry')) {
    retries.push(body);
    job = { ...job, status: 'preparing', updatedAt: Date.now(), message: '继续准备剩余原图' };
    return route.fulfill({ status: 202, json: copyJob() });
  }
  if (path.endsWith('/start')) {
    starts.push(body);
    assert.deepEqual(job.preparation.receivedPages, expectedPages, 'Must not start until all expected image pages have been saved');
    job = { ...job, status: 'running', progress: 15, updatedAt: Date.now(), message: '按批次解析全部原图' };
    return route.fulfill({ status: 202, json: copyJob() });
  }
  if (path.endsWith('/cancel')) {
    job = { ...job, status: 'cancelled', updatedAt: Date.now(), message: '已取消' };
    return route.fulfill({ json: copyJob() });
  }
  throw new Error('Unexpected mocked job path: ' + path);
});

async function enterKey() {
  await page.waitForSelector('.app-settings');await page.getByLabel('AI 阅读服务').selectOption('deepseek');
  await page.locator('input[type=password]').fill('sk-smoke-test-only-never-real');
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
try {
  await page.route('**/api/codex/status',r=>r.fulfill({json:{available:false,authenticated:false,message:'模拟离线'}}));await page.goto(url);
  await page.waitForSelector('.logic-node');
  await page.locator('input[type=file]').first().setInputFiles({ name: '36-page-mixed-visuals.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForSelector('.analysis-empty');
  await page.getByRole('button', { name: '开始深度解析', exact: true }).click();
  await enterKey();
  await page.getByRole('button', { name: '开始深度解析', exact: true }).click();
  await firstUploadStarted;
  assert.equal(stages.length, 1);
  assert.equal(stages[0].pages.length, 36);
  assert.deepEqual(stages[0].expectedVisualPages, expectedPages);
  assert.deepEqual(stages[0].visualPlan.pages.map(({ page, kind }) => ({ page, kind })), expected);
  passed.push('36 页文献在前端识别到 33 个实际视觉页面，正文图号引用页保持纯文字');
  await page.getByTitle('关闭后台任务').click();
  await page.locator('.demo-item').click();
  await page.waitForSelector('.logic-node');
  assert.match(await page.locator('.document-heading').innerText(), /非真实研究数据/);
  assert.equal(job.status, 'preparing');
  releaseFirstUpload();
  passed.push('原图准备与上传期间可以切换文献继续阅读');
  await page.getByTitle('后台解析任务').click();
  await page.getByText('测试：第 3 批上传中断，已保存前 8 页', { exact: true }).first().waitFor();
  assert.equal(starts.length, 0);
  assert.deepEqual(job.preparation.receivedPages, expectedPages.slice(0, 8));
  passed.push('上传中断后保留已保存页面，缺少图片时没有提前启动解析');
  await page.reload();
  await page.waitForSelector('.logic-node');
  await page.getByTitle('后台解析任务').click();
  await page.getByRole('button', { name: /继续.*重试/ }).click();
  await enterKey();
  await page.getByRole('button', { name: /继续.*重试/ }).click();
  await page.waitForSelector('.job-status.running', { timeout: 30_000 });
  assert.equal(stages.length, 1, 'Resume must retain the same staged task');
  assert.equal(retries.length, 1);
  assert.equal(starts.length, 1);
  assert.deepEqual(successfulUploads.flat(), expectedPages);
  assert.deepEqual(successfulUploads.map(batch => batch.length), [4, 4, 4, 4, 4, 4, 4, 4, 1]);
  assert.deepEqual(attemptedUploads[3], expectedPages.slice(8, 12));
  passed.push('刷新后从第 9 个待处理视觉页续传，已保存的 8 页不重复上传，9 个成功批次覆盖全部 33 页');
  job = { ...job, status: 'completed', progress: 100, message: '全部页面处理完成，结果已合并', updatedAt: Date.now(), result };
  await page.waitForSelector('.job-status.completed', { timeout: 10_000 });
  await page.getByRole('button', { name: '打开文献', exact: true }).click();
  await page.waitForSelector('#section-complete-visuals');
  assert.match(await page.locator('.reader-content').innerText(), /分批结果已合并/);
  const stored = await page.evaluate(async () => {
    const { listPapers } = await import('/src/lib/storage.ts');
    return (await listPapers()).find(paper => paper.fileName === '36-page-mixed-visuals.pdf')?.analysis?.coverage;
  });
  assert.deepEqual(stored.visualPages, expectedPages);
  assert.equal(stored.totalPages, 36);
  await page.getByTitle('后台解析任务').click();
  // The compact completion audit belongs with the task rather than every paragraph.
  const coverageToggle = page.locator('.analysis-coverage summary').first();
  await coverageToggle.waitFor();
  await coverageToggle.click();
  assert.match(await page.locator('.jobs-modal').innerText(), /33/);
  assert.match(await page.locator('.jobs-modal').innerText(), /36/);
  await page.getByTitle('关闭后台任务').click();
  await page.getByRole('button',{name:'处理记录',exact:true}).click();
  await page.locator('.reader-modal .analysis-coverage summary').click();
  assert.equal(await page.locator('.coverage-pages button').count(),36);
  await page.locator('.coverage-pages button').getByText('34',{exact:true}).click();
  await page.waitForTimeout(400);assert.match(await page.locator('.reading-progress').innerText(),/第 34 页/);
  passed.push('合并结果保存到原文献，任务和正文均可核对页面记录，并可跳到原PDF');
  await page.screenshot({ path: 'artifacts/vision-batches-complete.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, expectedVisualPages: expectedPages, successfulBatches: successfulUploads, errors }, null, 2));
} catch (error) {
  console.error(await page.locator('body').innerText());
  console.error(JSON.stringify({ stageCount: stages.length, attemptedUploads, successfulUploads, starts: starts.length, job }, null, 2));
  throw error;
} finally { releaseFirstUpload(); await browser.close(); }
