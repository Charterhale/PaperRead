import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { inspectDocumentVisualPages, batchDocumentPageImages, imageDataUrlBytes } from '../src/lib/pdfVisualInspection.ts';
import { makeVisualPagesFixture } from './fixtures/pdf-visual-pages.mjs';

test('36-page mixed PDF detects actual small rasters, vector-only plots, scans and scans with OCR; prose references stay text', async () => {
  const { bytes, expected } = await makeVisualPagesFixture();
  const task = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const doc = await task.promise, progress = [];
    const result = await inspectDocumentVisualPages(doc, (done, total) => progress.push([done, total]));
    assert.deepEqual(result.map(({ page, kind }) => ({ page, kind })), expected);
    assert.equal(result.filter(page => page.kind !== 'text').length, 33);
    assert.equal(progress.length, 36); assert.deepEqual(progress.at(-1), [36, 36]);
    assert.ok(result.every(page => page.reasons.length));
    const numbers = result.filter(page => page.kind !== 'text').map(page => page.page);
    const rendered = [], batches = [];
    for await (const batch of batchDocumentPageImages(doc, numbers, async (document, number) => {
      const page = await document.getPage(number), viewport = page.getViewport({ scale: .5 });
      const canvas = createCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      rendered.push(number); page.cleanup();
      return canvas.toDataURL('image/jpeg', .9);
    })) batches.push(batch);
    assert.deepEqual(rendered, numbers);
    assert.deepEqual(batches.flatMap(batch => batch.images.map(image => image.page)), numbers);
    assert.equal(batches.length, 9); assert.equal(batches.at(-1).completed, 33);
    assert.ok(batches.every(batch => batch.images.length <= 4));
    assert.ok(batches.every(batch => batch.images.reduce((total, image) => total + imageDataUrlBytes(image.dataUrl), 0) <= 8 * 1024 * 1024));
  } finally { await task.destroy(); }
});

test('failed layers and sparse pages stay in the image set instead of disappearing', async () => {
  const cleanups = [];
  const doc = { numPages: 4, async getPage(number) {
    if (number === 4) throw new Error('broken page');
    return {
      getTextContent: async () => { if (number === 2) throw new Error('broken text'); return { items: number === 3 ? [] : [{ str: 'A regular page with enough characters for detection of its readable text layer.' }] }; },
      getOperatorList: async () => { if (number === 1) throw new Error('broken graphics'); return { fnArray: [], argsArray: [] }; },
      getAnnotations: async () => [], cleanup: () => cleanups.push(number),
    };
  } };
  const result = await inspectDocumentVisualPages(doc);
  assert.deepEqual(result.map(page => page.kind), ['uncertain', 'uncertain', 'uncertain', 'uncertain']);
  assert.deepEqual(result.map(page => page.page), [1, 2, 3, 4]);
  assert.deepEqual(cleanups, [1, 2, 3]);
});

test('byte-limited batches cover every page once without changing requested order', async () => {
  const image = 'data:image/jpeg;base64,' + Buffer.alloc(6).toString('base64');
  assert.equal(imageDataUrlBytes(image), 6);
  const batches = [];
  for await (const batch of batchDocumentPageImages({ numPages: 30 }, [30, 2, 18, 4, 5], async () => image, { maxBytes: 13 })) batches.push(batch);
  assert.deepEqual(batches.map(batch => batch.images.map(image => image.page)), [[30, 2], [18, 4], [5]]);
  assert.deepEqual(batches.map(batch => batch.completed), [2, 4, 5]);
});

test('bad pages, oversized pages and cancellation are explicit; no silent skip or subsequent rendering', async () => {
  const rendered = [], controller = new AbortController();
  const image = 'data:image/jpeg;base64,' + Buffer.alloc(6).toString('base64');
  const generator = batchDocumentPageImages({ numPages: 35 }, Array.from({ length: 35 }, (_, i) => i + 1), async (_, number) => { rendered.push(number); return image; }, { signal: controller.signal });
  assert.equal((await generator.next()).value.images.length, 4);
  controller.abort();
  await assert.rejects(generator.next(), { name: 'AbortError' });
  assert.deepEqual(rendered, [1, 2, 3, 4]);
  await assert.rejects(async () => { for await (const _ of batchDocumentPageImages({ numPages: 35 }, [1, 26, 27], async (_, number) => { if (number === 26) throw new Error('decode error'); return image; })) {} }, /第 26 页.*decode error/);
  await assert.rejects(async () => { for await (const _ of batchDocumentPageImages({ numPages: 35 }, [12], async () => image, { maxBytes: 5 })) {} }, /第 12 页.*未被跳过/);
  await assert.rejects(async () => { for await (const _ of batchDocumentPageImages({ numPages: 35 }, [36], async () => image)) {} }, /第 36 页不存在/);
  await assert.rejects(async () => { for await (const _ of batchDocumentPageImages({ numPages: 35 }, [1, 1], async () => image)) {} }, /页码重复/);
});
