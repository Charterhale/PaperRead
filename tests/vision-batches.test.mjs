import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices, prepareAnalysis } from '../server/service.mjs';
import { planAnalysisBatches } from '../server/batches.mjs';
import { LIMITS, validateImages } from '../server/validation.mjs';

const key = 'test-vision-batch-key';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD7cAAAAASUVORK5CYII=';
const imagesFor = count => Array.from({ length: count }, (_, index) => ({ page: index + 1, dataUrl: image }));
const bodyFor = count => ({ apiKey: key, title: 'Article', pages: Array.from({ length: count }, (_, index) => `Page ${index + 1}`), images: imagesFor(count), category: '基础医学' });
const panel = { label: 'A', type: '散点图', xAxis: '分组', yAxis: '表达', explanation: '详细结果', evidence: '' };
function result(pages = [1], length = 10) {
  return { title: 'Article', subtitle: '', overview: 'Overview', limitations: [], sections: pages.map(page => ({ title: `Section ${page}`, shortTitle: '结果', page, summary: 'S'.repeat(length), proves: 'P'.repeat(length), markdown: `正文 ${page}`, figures: [{ title: `Figure ${page}`, page, caption: 'Caption', panels: [{ ...panel }, { ...panel, label: 'B' }] }] })) };
}
function partsIn(text) { return JSON.parse(text.slice(text.indexOf('part/totalParts 表示单页分段：\n') + 'part/totalParts 表示单页分段：\n'.length)); }
const synthesis = { title: 'Merged', subtitle: '', overview: '完整总览', orderedSectionIds: [], limitations: [] };

test('more than 24 image pages are accepted and each appears in exactly one bounded batch', async () => {
  const body = bodyFor(37), calls = [];
  const services = createServices({ complete: async request => { calls.push(request); return request.text.startsWith('任务：解析文献') ? result(request.images.map(image => image.page)) : synthesis; } });
  const analysis = await services.analyze(body);
  const visualCalls = calls.filter(call => call.images?.length);
  assert.equal(visualCalls.length, 7);
  assert(visualCalls.every(call => call.images.length <= 6));
  assert.deepEqual(visualCalls.flatMap(call => call.images.map(image => image.page)), Array.from({ length: 37 }, (_, i) => i + 1));
  assert.equal(analysis.sections.length, 37);
  assert.equal(analysis.sections.flatMap(section => section.figures).length, 37);
  assert.equal(analysis.sections.flatMap(section => section.figures).flatMap(figure => figure.panels).length, 74);
  assert.deepEqual(analysis.coverage.visualPages, Array.from({ length: 37 }, (_, i) => i + 1));
  assert.equal(analysis.coverage.batches.length, 7);
  assert.equal(analysis._batch, undefined);
});

test('all-scan document keeps every empty text page alongside its actual image', async () => {
  const body = { ...bodyFor(31), pages: Array(31).fill('') }, calls = [];
  const services = createServices({ complete: async request => {
    if (!request.text.startsWith('任务：解析文献')) return synthesis;
    calls.push(request);
    const parts = partsIn(request.text);
    assert(parts.every(part => part.text === ''));
    assert.deepEqual(parts.map(part => part.page), request.images.map(image => image.page));
    return result(request.images.map(image => image.page));
  } });
  const analysis = await services.analyze(body);
  assert.equal(calls.length, 6);
  assert.equal(analysis.coverage.pages.length, 31);
  assert(analysis.coverage.pages.every(page => page.mode === 'visual' && page.batchIds.length === 1));
});

test('mixed pages and long single pages preserve all characters without resending images', () => {
  const body = { ...bodyFor(4), pages: ['A'.repeat(79_999), 'middle', '', 'last'], images: [{ page: 1, dataUrl: image }, { page: 3, dataUrl: image }] };
  const { input, chunks } = prepareAnalysis(body);
  assert.deepEqual(chunks.flatMap(chunk => chunk.imagePages), [1, 3]);
  const parts = chunks.flatMap(chunk => chunk.parts);
  assert.deepEqual(body.pages.map((_, index) => parts.filter(part => part.page === index + 1).map(part => part.text).join('')), body.pages);
  assert(chunks.every(chunk => chunk.parts.reduce((count, part) => count + part.text.length, 0) <= LIMITS.chunkCharacters));
  assert.equal(planAnalysisBatches(input).planId, prepareAnalysis(body).planId);
});

test('a short document with many images is split even when all text fits one chunk', () => {
  const body = bodyFor(30);
  const { chunks } = prepareAnalysis(body);
  assert.equal(chunks.length, 5);
  assert.equal(chunks.flatMap(chunk => chunk.parts).length, 30);
});

test('byte limit starts a new batch before 12 MiB while document and upload limits stay separate', () => {
  const bytes = Buffer.alloc(3.5 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
  const body = { ...bodyFor(7), images: Array.from({ length: 7 }, (_, i) => ({ page: i + 1, dataUrl })) };
  const { chunks } = prepareAnalysis(body);
  assert.deepEqual(chunks.map(chunk => chunk.imagePages.length), [3, 3, 1]);
  assert(chunks.every(chunk => chunk.imageBytes <= LIMITS.batchImageBytes));
  assert.throws(() => validateImages(body.images, 7, 'deepseek-flash'), error => error.code === 'IMAGES_TOO_LARGE');
  assert.equal(validateImages(body.images, 7, 'deepseek-flash', { document: true }).length, 7);
});

test('staging accepts pending scan images, execution rejects missing expected or scanned pages', () => {
  const body = { ...bodyFor(2), pages: ['', 'text'], images: [], expectedVisualPages: [1, 2], visualPlan: { version: 1, pages: [{ page: 1, kind: 'scan', reasons: ['no text'] }, { page: 2, kind: 'vector', reasons: ['paths'] }] } };
  const staged = prepareAnalysis(body, '', { stage: true });
  assert.equal(staged.input.pipelineVersion, 2);
  assert.deepEqual(staged.input.expectedVisualPages, [1, 2]);
  assert.throws(() => prepareAnalysis(body), error => error.code === 'VISUAL_PAGES_MISSING');
  assert.throws(() => prepareAnalysis({ ...body, images: [{ page: 2, dataUrl: image }] }), error => error.code === 'VISUAL_PAGES_MISSING');
  assert.throws(() => prepareAnalysis({ ...body, expectedVisualPages: [1] }, '', { stage: true }), error => error.code === 'VISUAL_PLAN_MISMATCH');
  assert.throws(() => prepareAnalysis({ ...bodyFor(2), pages: ['text', ''], images: [] }), error => error.code === 'VISUAL_PAGES_MISSING');
});

test('failure checkpoints resume at the next exact batch and reject changed plans', async () => {
  const body = bodyFor(15);
  let checkpoints = [], attempt = 0;
  const first = createServices({ complete: async request => { attempt += 1; if (attempt === 2) throw new Error('provider disconnected'); return result(request.images.map(image => image.page)); } });
  await assert.rejects(first.analyze(body, undefined, { onCheckpoint: async parts => { checkpoints = structuredClone(parts); } }), /disconnected/);
  assert.equal(checkpoints.length, 1);
  const sent = [];
  const next = createServices({ complete: async request => { if (!request.text.startsWith('任务：解析文献')) return synthesis; sent.push(...request.images.map(image => image.page)); return result(request.images.map(image => image.page)); } });
  const merged = await next.analyze(body, undefined, { checkpoints });
  assert.deepEqual(sent, [7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(merged.sections.length, 15);
  await assert.rejects(next.analyze({ ...body, pages: ['changed', ...body.pages.slice(1)] }, undefined, { checkpoints }), error => error.code === 'CHECKPOINT_PLAN_MISMATCH');
  await assert.rejects(next.analyze(body, undefined, { checkpoints: [result()] }), error => error.code === 'CHECKPOINT_PLAN_MISMATCH');
});

test('legacy pipeline keeps old text chunk checkpoints instead of shifting them to visual batches', async () => {
  const body = { ...bodyFor(13), pipelineVersion: 1, pages: ['A'.repeat(40_000), ...Array(12).fill('x')] };
  const { chunks } = prepareAnalysis(body);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].imagePages.length, 12);
  const calls = [];
  const services = createServices({ complete: async request => { calls.push(request); return request.text.startsWith('任务：解析文献') ? result([2]) : synthesis; } });
  await services.analyze(body, undefined, { checkpoints: [{ ...result([1]), sections: [{ ...result([1]).sections[0], id: 'part-1-section-1' }] }] });
  assert.equal(calls.filter(call => call.text.startsWith('任务：解析文献')).length, 1);
});

test('large synthesis uses bounded layers and retains every section, figure and panel despite omitted IDs', async () => {
  const body = bodyFor(60), requests = [];
  const services = createServices({ complete: async request => {
    requests.push(request);
    return request.text.startsWith('任务：解析文献') ? result(request.images.map(image => image.page), 8_000) : synthesis;
  } });
  const analysis = await services.analyze(body);
  assert.equal(analysis.sections.length, 60);
  assert.equal(analysis.sections.flatMap(section => section.figures).flatMap(figure => figure.panels).length, 120);
  const summaries = requests.filter(request => !request.text.startsWith('任务：解析文献'));
  assert(summaries.length > 2);
  assert(summaries.every(request => request.text.length < LIMITS.synthesisCharacters + 20_000));
  assert.equal(analysis.coverage.pages.length, 60);
});

test('the full 160-page scan limit completes with 27 image batches and a record for the final page', async () => {
  const body = { ...bodyFor(160), pages: Array(160).fill('') };
  let batchCount = 0;
  const services = createServices({ complete: async request => {
    if (!request.text.startsWith('任务：解析文献')) return synthesis;
    batchCount += 1;
    return result(request.images.map(image => image.page));
  } });
  const analysis = await services.analyze(body);
  assert.equal(batchCount, 27);
  assert.equal(analysis.sections.length, 160);
  assert.deepEqual(analysis.coverage.pages.at(-1), { page: 160, mode: 'visual', batchIds: ['batch-27'] });
  assert.equal(analysis.coverage.textOnlyPages.length, 0);
});
