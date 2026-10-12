import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createPortProbe } from 'node:net';
import { makeVisualPagesFixture } from './fixtures/pdf-visual-pages.mjs';

test('browser renders all 33 selected pages in bounded batches and destroys workers on finish, iterator close and cancellation', { timeout: 90_000 }, async () => {
  let server, browser;
  try {
    const probe=createPortProbe();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    server = await createServer({ configFile:false, server: { host: '127.0.0.1', port, strictPort:true }, logLevel: 'error' });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    const executablePath = await access(edge).then(() => edge, () => undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    await page.route('**/__pdf-visual-check__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>PDF visual batch checks</title>' }));
    await page.goto(origin + '/__pdf-visual-check__');
    const { bytes, expected } = await makeVisualPagesFixture();
    const result = await page.evaluate(async data => {
      let workerCount = 0;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); workerCount += 1; this.ended = false; }
        terminate() { if (!this.ended) { workerCount -= 1; this.ended = true; } return super.terminate(); }
      };
      const { inspectPdfVisualPages, renderPdfImageBatches } = await import('/src/lib/pdf.ts');
      const pdf = new Uint8Array(data);
      const inventory = await inspectPdfVisualPages(pdf);
      const workersAfterInspection = workerCount;
      const numbers = inventory.filter(item => item.kind !== 'text').map(item => item.page);
      const batches = [], rendered = [], sizes = [];
      for await (const batch of renderPdfImageBatches(pdf, numbers)) {
        batches.push(batch.images.length);
        for (const image of batch.images) {
          rendered.push(image.page);
          const bitmap = new Image(); bitmap.src = image.dataUrl; await bitmap.decode();
          sizes.push([bitmap.width, bitmap.height]);
        }
      }
      const workersAfterFinish = workerCount;
      const short = renderPdfImageBatches(pdf, numbers);
      await short.next(); const workersDuringOpenIterator = workerCount;
      await short.return(); const workersAfterClose = workerCount;
      const controller = new AbortController();
      let cancellation;
      try {
        for await (const _ of renderPdfImageBatches(pdf, numbers, { signal: controller.signal, onProgress: count => { if (count === 1) controller.abort(); } })) {}
      } catch (error) { cancellation = error.name; }
      return { rendered, batches, sizes, workersAfterInspection, workersAfterFinish, workersDuringOpenIterator, workersAfterClose, workersAfterCancel: workerCount, cancellation };
    }, [...bytes]);
    assert.deepEqual(result.rendered, expected.filter(item => item.kind !== 'text').map(item => item.page));
    assert.deepEqual(result.batches, [4, 4, 4, 4, 4, 4, 4, 4, 1]);
    assert.ok(result.sizes.every(([width, height]) => width === 2000 && height === 2700));
    assert.equal(result.workersAfterInspection, 0); assert.equal(result.workersAfterFinish, 0);
    assert.equal(result.workersDuringOpenIterator, 1); assert.equal(result.workersAfterClose, 0);
    assert.equal(result.workersAfterCancel, 0); assert.equal(result.cancellation, 'AbortError');
  } finally { await browser?.close(); await server?.close(); }
});
