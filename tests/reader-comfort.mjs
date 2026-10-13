import { clickTool } from './helpers/menu.mjs';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1080 } });
const errors = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
const visibleSection = () => page.locator('.reader-section:not([hidden])');
async function jump(id) { await page.getByLabel('选择阅读小节').selectOption(id); await page.waitForTimeout(400); }
try {
  await page.route('**/api/jobs', r => r.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/jobs/archive', r => r.fulfill({ json: { format: 'paperlens-jobs', version: 1, exportedAt: 1, records: [] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { configured: false } }));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5178');
  await page.waitForSelector('.reader-section:not([hidden])');
  const original = await page.evaluate(async () => {
    const { demoPaper } = await import('/src/lib/demo.ts');
    const paper = structuredClone(demoPaper), template = paper.analysis.sections[1];
    paper.analysis.sections = Array.from({ length: 39 }, (_, i) => ({ ...structuredClone(template), id: 'long-' + i, title: '第 ' + (i + 1) + ' 个研究问题：细胞状态与年龄阶段的关系', shortTitle: '研究步骤 ' + (i + 1), page: i % 6 + 1, figures: template.figures.map(f => ({ ...structuredClone(f), id: 'long-figure-' + i, page: i % 6 + 1 })) }));
    paper.analysis.subtitle = '很长的文章标题与原始引用信息 '.repeat(15);
    paper.analysis.overview = '全文概览完整保留。'.repeat(50);
    for (const s of paper.analysis.sections) {
      s.markdown += '\n\n正文最后一句完整保留。' + '详细正文和引用。'.repeat(60);
      for (const p of s.figures[0].panels) for (const key of ['question', 'method', 'groups', 'xAxis', 'yAxis', 'readout', 'result', 'statistics', 'takeaway', 'explanation']) p[key] += '\n\n' + key + ' 末尾标记：内容全部保留。';
    }
    paper.notes = '# 原有研究笔记\n\n必须保留的想法。'; paper.analysisEdited = true;
    localStorage.setItem('pl-demo-paper', JSON.stringify(paper));
    localStorage.setItem('paperlens-pdf-preservation', JSON.stringify({ highlights: [{ id: 'h', text: '原有高亮', color: '#aa33cc', rectangles: [{ x: .1, y: .2, width: .2, height: .03 }] }] }));
    return paper;
  });
  await page.reload(); await page.waitForSelector('.pdf-page-wrap canvas'); await jump('long-0');
  await expect(visibleSection()).toHaveCount(1);
  await expect(page.getByRole('button', { name: '逐节阅读', exact: true })).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await page.locator('.reader-section').count(), 39);
  assert.equal(await page.locator('.reader-overview').getAttribute('open'), null);
  assert.equal(await visibleSection().locator('.section-detail').getAttribute('open'), null);
  const panel = visibleSection().locator('.reader-panel').first();
  await panel.locator(':scope > summary').click();
  await expect(panel.locator('[data-panel-field="takeaway"]')).toBeVisible();
  await expect(panel.locator('[data-panel-field="xAxis"]')).toBeHidden();
  passed.push('39 节长文默认只读当前节，结论先显示，长文与细节分层');

  await panel.locator('.panel-detail-group').first().locator('summary').click();
  await expect(panel.locator('[data-panel-field="xAxis"]')).toBeVisible();
  await expect(panel.locator('[data-panel-field="readout"]')).toContainText('readout 末尾标记');
  await page.getByTitle('下一节', { exact: true }).click(); await page.waitForTimeout(450);
  assert.equal(await page.getByLabel('PDF 页码').inputValue(), '2');
  await expect(visibleSection()).toHaveAttribute('id', 'section-long-1');
  await page.getByTitle('上一节', { exact: true }).click(); await page.waitForTimeout(450);
  await expect(panel.locator('[data-panel-field="xAxis"]')).toBeVisible();
  await page.reload(); await page.waitForSelector('.reader-section:not([hidden])'); await expect(visibleSection()).toHaveAttribute('id', 'section-long-0');
  await expect(panel.locator('[data-panel-field="xAxis"]')).toBeVisible();
  passed.push('上一节、下一节联动 PDF，子图折叠状态跨小节与重启保留');

  await page.getByTitle('折叠所有章节和子图').click();
  await expect(visibleSection()).not.toHaveAttribute('open', '');
  await page.locator('.nav-figures').nth(2).locator('summary').click();await page.locator('.nav-figure').nth(2).click(); await page.waitForTimeout(500);
  await expect(visibleSection()).toHaveAttribute('id', 'section-long-2');
  await expect(visibleSection()).toHaveAttribute('open', '');
  await expect(visibleSection().locator('.reader-figure')).toHaveAttribute('open', '');
  assert.equal(await page.getByLabel('PDF 页码').inputValue(), '3');
  await page.getByTitle('展开所有章节和子图').click();
  assert.equal(await visibleSection().locator('details:not([open])').count(), 0);
  passed.push('折叠后目录直达图与 PDF，一键展开包含所有读图字段');

  await page.getByTitle('返回研究主线').click(); await page.waitForTimeout(400);
  await expect(page.locator('.logic-node').first()).toBeVisible();
  await page.locator('.logic-node').first().click(); await page.waitForTimeout(450);
  await expect(visibleSection()).toHaveAttribute('id', 'section-long-0');
  await page.getByRole('button', { name: '全文浏览', exact: true }).click();
  await expect(visibleSection()).toHaveCount(39);
  await page.locator('.reader-overview > summary').click();
  await page.getByTitle('编辑文章概览').click(); await page.getByTitle('关闭概览编辑').click();
  await page.getByRole('button', { name: '逐节阅读', exact: true }).click();
  await expect(visibleSection()).toHaveCount(1);
  passed.push('主线跳转、概览编辑和全文浏览保留全部 39 节');

  await page.getByRole('button', { name: '全文浏览', exact: true }).click();
  await page.locator('.analysis-scroll').evaluate(e => e.scrollTo({ top: 350, behavior: 'instant' }));
  const previousTop = await page.locator('.analysis-scroll').evaluate(e => e.scrollTop);
  await jump('long-1');
  await page.getByRole('button', { name: '逐节阅读', exact: true }).click();
  await page.getByTitle('返回上一阅读位置').click(); await page.waitForTimeout(450);
  await expect(visibleSection()).toHaveCount(39);
  assert.ok(Math.abs(await page.locator('.analysis-scroll').evaluate(e => e.scrollTop) - previousTop) < 2);
  await page.getByTitle('前进阅读位置').click(); await page.waitForTimeout(450);
  await expect(visibleSection()).toHaveCount(1);
  await expect(visibleSection()).toHaveAttribute('id', 'section-long-1');
  await jump('long-0');
  passed.push('返回与前进同时恢复阅读模式和滚动位置，同一 PDF 页上的小节可准确续读');

  // Switching presentation does not rewrite original analysis, notes, or annotations.
  const preserved = await page.evaluate(() => ({ paper: JSON.parse(localStorage.getItem('pl-demo-paper')), marks: JSON.parse(localStorage.getItem('paperlens-pdf-preservation')) }));
  assert.deepEqual(preserved.paper.analysis, original.analysis); assert.equal(preserved.paper.notes, original.notes);
  assert.equal(preserved.marks.highlights[0].color, '#aa33cc');
  const archive = await page.evaluate(async () => { const s = await import('/src/lib/storage.ts'); const a = await s.inspectBackup((await s.exportBackup()).blob); return a.local; });
  assert.ok(archive['pl-reader-folds-' + original.id]); assert.equal(archive['pl-reader-mode'], '"focus"');
  const md = await page.evaluate(async () => { const { exportMarkdown } = await import('/src/lib/markdown.ts'); return exportMarkdown(JSON.parse(localStorage.getItem('pl-demo-paper'))); });
  assert.match(md, /第 39 个研究问题/); for (const field of ['question', 'method', 'groups', 'xAxis', 'yAxis', 'readout', 'result', 'statistics', 'takeaway', 'explanation']) assert.ok(md.includes(field + ' 末尾标记'));
  passed.push('切换和折叠不改解析、笔记及高亮，完整导出与备份保留细节');

  await page.locator('.reader-overview > summary').click(); await page.locator('.reader-route > summary').click();
  await page.getByTitle('折叠所有章节和子图').click();
  await jump('long-0'); await visibleSection().locator('.reader-figure > summary').click(); await panel.locator(':scope > summary').click();
  await page.screenshot({ path: 'artifacts/reader-comfort-light.png' });
  await clickTool(page,'切换明暗主题'); await page.screenshot({ path: 'artifacts/reader-comfort-dark.png' }); await clickTool(page,'切换明暗主题');
  await panel.getByRole('button', { name: '编辑解析', exact: true }).click();
  await page.getByLabel('如何读这张图').fill('编辑后仍可完整展开查看。'); await page.getByRole('button', { name: '保存子图解析', exact: true }).click();
  await panel.locator('.panel-detail-group').first().locator('summary').click();
  await expect(panel.locator('[data-panel-field="readout"]')).toHaveText(/编辑后仍可完整展开查看/);
  await clickTool(page,'编辑历史与恢复'); await expect(page.locator('.revision-row')).toHaveCount(1); await page.getByTitle('关闭编辑历史').click();
  passed.push('子图编辑、版本恢复入口和全部明暗样式保持可用');

  await page.setViewportSize({ width: 1060, height: 820 });
  await page.getByTitle('自适应解析宽度').click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.reader-content').evaluate(e => Number(e.style.zoom)), 1);
  assert.equal(await panel.locator('[data-panel-field="question"] .prose').evaluate(e => getComputedStyle(e).fontSize), '14px');
  for (const title of ['自适应解析宽度', ...Array(6).fill('放大解析')]) {
    await page.getByTitle(title).click();
    const dims = await page.locator('.reader-content').evaluate(e => ({ scroll: e.scrollWidth, width: e.clientWidth }));
    assert.ok(dims.scroll <= dims.width + 2, JSON.stringify(dims));
    assert.ok(await panel.locator('.prose').evaluateAll(nodes => nodes.every(e => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1)));
  }
  await page.screenshot({ path: 'artifacts/reader-comfort-narrow.png' });
  passed.push('窄栏自适应保持 14px 正文，缩放后完整换行且无嵌套滚动框');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, errors }, null, 2));
} finally { await browser.close(); }
