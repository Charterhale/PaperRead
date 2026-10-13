import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { clickTool } from './helpers/menu.mjs';

const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1080 } });
const errors = [], passed = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.route('**/api/**', r => {
    const path = new URL(r.request().url()).pathname;
    const responses = {
      '/api/backups': { items: [], directory: '' }, '/api/jobs': { jobs: [] }, '/api/jobs/archive': { format: 'paperlens-jobs', version: 1, records: [], exportedAt: 1 },
      '/api/health': { configured: false }, '/api/codex/status': { available: true, authenticated: true, billing: 'subscription' },
      '/api/codex/models': { models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', isDefault: true, supportedReasoningEfforts: ['low', 'medium', 'high'] }] },
    };
    return r.fulfill({ json: responses[path] || {} });
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5180');
  await page.waitForSelector('.pdf-page-wrap canvas');
  await expect(page.getByTitle('专注阅读 · 收起两侧栏')).toBeVisible();
  await expect(page.getByTitle('完整备份与恢复')).toBeHidden();
  await clickTool(page, '完整备份与恢复');
  await expect(page.locator('.backup-manager')).toBeVisible();
  await page.getByTitle('关闭备份与恢复').click();
  await page.getByRole('button', { name: '工作台工具', exact: true }).click();
  await expect(page.getByTitle('文献库管理')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '工作台工具', exact: true })).toBeFocused();
  await expect(page.getByTitle('文献库管理')).toBeHidden();
  passed.push('次要工具集中在更多菜单，点击和键盘退出均可用');
  await page.getByTitle('返回研究主线').click();
  await page.screenshot({ path: 'artifacts/calm-layout-light.png' });
  await page.getByLabel('选择阅读小节').selectOption({ index: 2 });
  const nav = page.locator('.nav-figures');
  assert.equal(await nav.locator(':scope[open]').count(), 1);
  await page.locator('.nav-figures[open] .nav-figure').first().click();
  await expect(page.getByLabel('PDF 页码')).toHaveValue('3');
  const panel = page.locator('.reader-section:not([hidden]) .reader-panel').first();
  await expect(panel).not.toHaveAttribute('open', '');
  await panel.locator(':scope > summary').click();
  await expect(panel.locator('[data-panel-field="question"]')).toBeVisible();
  await clickTool(page, '切换明暗主题');
  await page.screenshot({ path: 'artifacts/calm-layout-dark.png' });
  await clickTool(page, '切换明暗主题');
  passed.push('目录仅展开当前章节图表，子图主动展开且保持 PDF 联动');

  const original = await page.evaluate(async () => {
    const { demoPaper } = await import('/src/lib/demo.ts');
    const p = structuredClone(demoPaper);
    p.analysisEdited = true; p.notes = '# 保留的笔记\n\n一个研究想法';
    p.analysis.sections[2].proves = '完整主要发现与具体结果。'.repeat(60) + '结尾保留标记';
    localStorage.setItem('pl-demo-paper', JSON.stringify(p));
    localStorage.setItem('paperlens-pdf-keep', JSON.stringify({ highlights: [{ color: '#1299ff', text: '已有高亮' }] }));
    return p;
  });
  await page.reload(); await page.waitForSelector('.pdf-page-wrap canvas');
  await page.getByLabel('选择阅读小节').selectOption({ index: 2 });
  const preview = page.locator('.reader-section:not([hidden]) .reader-summary .compact-markdown');
  await expect(preview).toHaveClass(/is-preview/);
  const clipped = await preview.locator('.prose').evaluate(e => e.scrollHeight > e.clientHeight);
  assert.equal(clipped, true);
  await preview.getByRole('button', { name: '展开完整说明', exact: true }).click();
  await expect(preview).not.toHaveClass(/is-preview/);
  assert.equal(await preview.locator('.prose').evaluate(e => e.scrollHeight <= e.clientHeight + 1), true);
  await expect(preview).toContainText('结尾保留标记');
  passed.push('长说明默认短预览，可展开全部内容，无内部滚动条');
  await page.getByTitle('展开所有章节和子图').click();
  assert.equal(await page.locator('.reader-section:not([hidden]) details:not([open])').count(), 0);
  assert.equal(await page.locator('.reader-section:not([hidden]) .compact-markdown.is-preview').count(), 0);
  await clickTool(page, '专用证据表'); await expect(page.locator('.evidence-table')).toBeVisible();
  await page.getByTitle('关闭专用证据表').click();
  await clickTool(page, '编辑历史与恢复'); await expect(page.getByRole('heading', { name: '编辑历史与恢复', exact: true })).toBeVisible();
  await page.getByTitle('关闭编辑历史').click();
  passed.push('一键展开包含完整正文、子图字段，证据表和历史恢复入口保留');

  const widths = await page.locator('.library,.navigation').evaluateAll(es => es.map(e => e.getBoundingClientRect().width));
  await page.getByTitle('专注阅读 · 收起两侧栏').click();
  await expect(page.locator('.library')).toHaveCount(0); await expect(page.locator('.navigation')).toHaveCount(0);
  await expect(page.getByTitle('设置', { exact: true })).toBeVisible();
  await page.reload(); await page.waitForSelector('.pdf-page-wrap canvas');
  await expect(page.locator('.library')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/calm-layout-focus.png' });
  await page.getByTitle('恢复联动布局').click();
  assert.deepEqual(await page.locator('.library,.navigation').evaluateAll(es => es.map(e => e.getBoundingClientRect().width)), widths);
  passed.push('专注模式可保存并恢复两侧栏和原有宽度，设置仍在左下角');

  const preserved = await page.evaluate(() => ({ paper: JSON.parse(localStorage.getItem('pl-demo-paper')), marks: JSON.parse(localStorage.getItem('paperlens-pdf-keep')) }));
  assert.deepEqual(preserved.paper.analysis, original.analysis); assert.equal(preserved.paper.notes, original.notes);
  assert.equal(preserved.marks.highlights[0].color, '#1299ff');
  const exported = await page.evaluate(async () => { const { exportMarkdown } = await import('/src/lib/markdown.ts'); return exportMarkdown(JSON.parse(localStorage.getItem('pl-demo-paper'))); });
  assert.match(exported, /结尾保留标记/); assert.match(exported, /保留的笔记/);
  passed.push('布局操作没有修改原解析、笔记和高亮，Markdown 保留完整细节');

  await page.setViewportSize({ width: 1100, height: 820 });
  await page.getByTitle('专注阅读 · 收起两侧栏').click();
  await page.getByTitle('展开所有章节和子图').click();
  for (let i = 0; i < 6; i++) await page.getByTitle('放大解析').click();
  assert.equal(await page.locator('.reader-content').evaluate(e => e.scrollWidth <= e.clientWidth + 2), true);
  for (const tool of ['解析工具', '文献工具', '工作台工具']) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    const box = await page.getByRole('group', { name: tool, exact: true }).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 1101 && box.y >= 0 && box.y + box.height <= 821, JSON.stringify(box));
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: 'artifacts/calm-layout-narrow.png' });
  passed.push('窄窗口、160% 解析缩放及更多菜单不溢出');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/v0.7.0-calm-layout.json', JSON.stringify({ passed, errors }, null, 2));
  console.log(JSON.stringify({ passed, errors }, null, 2));
} catch (error) { await page.screenshot({path:'artifacts/calm-layout-error.png'}); console.log(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally { await browser.close(); }
