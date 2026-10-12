import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.mjs';

const KEY = 'job-secret-must-never-be-persisted';
const request = { paperId: 'paper-1', title: 'Background paper', category: '生信分析', model: 'deepseek-flash', apiKey: KEY, pages: ['First result'] };
function analysis(page = 1) {
  return { title: 'Background paper', subtitle: '', overview: '研究设计与结果。', sections: [{ id: 'model-id', title: `结果 ${page}`, shortTitle: '结果', page, summary: '本节结果。', proves: '得出结论。', markdown: '详细解析。', figures: [] }], evidenceTable: [{ id: 'untrusted-id', label: '供者数', value: `${page * 3} 位供者`, page }], limitations: [] };
}
function response(value) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
}
function hanging(signal, onAbort = () => {}) {
  return new Promise((resolve, reject) => {
    const abort = () => { onAbort(); reject(new DOMException('Aborted', 'AbortError')); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
async function start(directory, fetchImpl) {
  const server = await startServer({ port: 0, jobDir: directory, apiKey: '', fetchImpl });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    server,
    async call(route, body, method = body === undefined ? 'GET' : 'POST') {
      const result = await fetch(`${base}/${route}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
      return { status: result.status, value: await result.json() };
    },
    async close() { await server.jobs.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); },
  };
}
async function waitFor(read, predicate, name = 'condition') {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${name}`);
}
async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'paperlens-jobs-'));
  try { await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('background job completes, returns evidence table, persists atomically, and never persists credentials', async () => {
  await withDirectory(async directory => {
    let submitted;
    const app = await start(directory, async (_, options) => { submitted = JSON.parse(options.body); return response(analysis()); });
    try {
      const created = await app.call('jobs', { ...request, arbitrarySecret: KEY, internal: { apiKey: KEY } });
      assert.equal(created.status, 202);
      assert.equal(created.value.status, 'queued');
      const id = created.value.id;
      const done = await waitFor(async () => (await app.call(`jobs/${id}`)).value, job => job.status === 'completed');
      assert.equal(done.progress, 100);
      assert.equal(done.result.evidenceTable[0].label, '供者数');
      assert.equal(done.result.sections.length, 1);
      assert.match(submitted.messages[0].content, /供者/);
      const list = (await app.call('jobs')).value.jobs;
      assert.equal(list.length, 1);
      assert.deepEqual(list[0].result, done.result);
      await waitFor(async () => JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')), record => record.job.status === 'completed');
      const disk = await readFile(path.join(directory, `${id}.json`), 'utf8');
      assert(!disk.includes(KEY));
      assert(!disk.includes('apiKey'));
      assert(!JSON.stringify(list).includes('First result'));
      assert(!JSON.stringify(list).includes(KEY));
      assert.deepEqual((await app.call(`jobs/${id}`, undefined, 'DELETE')).value, { ok: true });
      assert.equal((await app.call(`jobs/${id}`)).status, 404);
      assert.deepEqual(await readdir(directory), []);
    } finally { await app.close(); }
  });
});

test('failed multi-chunk jobs retry saved checkpoints and retain every category table row', async () => {
  await withDirectory(async directory => {
    const calls = [];
    const app = await start(directory, async (_, options) => {
      calls.push(JSON.parse(options.body));
      if (calls.length === 1) return response(analysis(1));
      if (calls.length === 2) return new Response('provider internal secret ' + KEY, { status: 500 });
      if (calls.length === 3) return response(analysis(2));
      return response({ title: 'Background paper', subtitle: '', overview: '完整研究。', orderedSectionIds: ['part-1-section-1', 'part-2-section-1'], limitations: [] });
    });
    try {
      const created = (await app.call('jobs', { ...request, pages: ['A'.repeat(30_000), 'B'.repeat(30_000)] })).value;
      const failed = await waitFor(async () => (await app.call(`jobs/${created.id}`)).value, job => job.status === 'failed');
      assert.equal(failed.progress, 45);
      assert(!failed.error.includes(KEY));
      assert.equal((await app.call(`jobs/${created.id}/retry`, {})).status, 401);
      assert.equal((await app.call(`jobs/${created.id}/retry`, { apiKey: KEY })).status, 202);
      const done = await waitFor(async () => (await app.call(`jobs/${created.id}`)).value, job => job.status === 'completed');
      assert.equal(calls.length, 4);
      assert(calls[2].messages[1].content.includes('B'.repeat(30_000)));
      assert(!calls[2].messages[1].content.includes('A'.repeat(30_000)));
      assert.deepEqual(done.result.evidenceTable.map(row => row.value), ['3 位供者', '6 位供者']);
      assert.deepEqual(done.result.sections.map(section => section.page), [1, 2]);
      assert.equal((await app.call(`jobs/${created.id}/retry`, { apiKey: KEY })).status, 409);
    } finally { await app.close(); }
  });
});

test('restart pauses interrupted and queued jobs, retains checkpoints, and resumes without repeating completed chunks', async () => {
  await withDirectory(async directory => {
    let firstCalls = 0;
    let aborted = false;
    const first = await start(directory, async (_, options) => {
      firstCalls += 1;
      if (firstCalls === 1) return response(analysis(1));
      return hanging(options.signal, () => { aborted = true; });
    });
    const created = (await first.call('jobs', { ...request, pages: ['A'.repeat(30_000), 'B'.repeat(30_000)] })).value;
    await waitFor(async () => firstCalls, count => count === 2);
    const queued = (await first.call('jobs', { ...request, paperId: 'paper-2' })).value;
    assert.equal((await first.call(`jobs/${queued.id}`)).value.status, 'queued');
    await first.close();
    assert.equal(aborted, true);
    // Simulate abrupt termination too: startup must recover a running record
    // even if the previous process could not write its paused status.
    const filename = path.join(directory, `${created.id}.json`);
    const record = JSON.parse(await readFile(filename, 'utf8'));
    record.job.status = 'running';
    await writeFile(filename, JSON.stringify(record));
    const resumedCalls = [];
    const second = await start(directory, async (_, options) => {
      resumedCalls.push(JSON.parse(options.body));
      if (resumedCalls.length === 1) return response(analysis(2));
      return response({ title: 'Background paper', subtitle: '', overview: '完整研究。', orderedSectionIds: ['part-1-section-1', 'part-2-section-1'], limitations: [] });
    });
    try {
      const list = (await second.call('jobs')).value.jobs;
      assert(list.every(job => job.status === 'paused'));
      assert.equal(resumedCalls.length, 0);
      assert.equal((await second.call(`jobs/${created.id}/retry`, { apiKey: KEY })).status, 202);
      const done = await waitFor(async () => (await second.call(`jobs/${created.id}`)).value, job => job.status === 'completed');
      assert.equal(resumedCalls.length, 2);
      assert(resumedCalls[0].messages[1].content.includes('B'.repeat(30_000)));
      assert.equal(done.result.sections.length, 2);
      assert.equal((await second.call(`jobs/${queued.id}`)).value.status, 'paused');
    } finally { await second.close(); }
  });
});

test('queue runs one provider job at a time; cancel and delete abort running work and preserve other jobs', async () => {
  await withDirectory(async directory => {
    let calls = 0;
    let aborted = 0;
    const app = await start(directory, async (_, options) => { calls += 1; return hanging(options.signal, () => { aborted += 1; }); });
    try {
      const first = (await app.call('jobs', request)).value;
      await waitFor(async () => calls, value => value === 1);
      const second = (await app.call('jobs', { ...request, paperId: 'paper-2' })).value;
      assert.equal((await app.call('jobs', request)).status, 409);
      assert.equal((await app.call(`jobs/${second.id}`)).value.status, 'queued');
      assert.equal(calls, 1);
      assert.equal((await app.call(`jobs/${second.id}/cancel`, {})).value.status, 'cancelled');
      assert.equal((await app.call(`jobs/${first.id}/cancel`, {})).value.status, 'cancelled');
      await waitFor(async () => aborted, value => value === 1);
      assert.equal(calls, 1);
      assert.equal((await app.call(`jobs/${second.id}/retry`, { apiKey: KEY })).status, 202);
      await waitFor(async () => calls, value => value === 2);
      assert.equal((await app.call(`jobs/${second.id}`, undefined, 'DELETE')).status, 200);
      assert.equal(aborted, 2);
      assert.equal((await app.call('jobs')).value.jobs.length, 1);
      assert.equal((await app.call(`jobs/${first.id}`)).value.status, 'cancelled');
    } finally { await app.close(); }
  });
});

test('job archive transfers running and queued work with checkpoints, omits keys, and restores paused until explicit retry', async () => {
  await withDirectory(async sourceDirectory => {
    await withDirectory(async targetDirectory => {
      let sourceCalls = 0;
      const source = await start(sourceDirectory, async (_, options) => {
        sourceCalls += 1;
        if (sourceCalls === 1) return response(analysis(1));
        return hanging(options.signal);
      });
      let targetCalls = 0;
      const target = await start(targetDirectory, async (_, options) => {
        targetCalls += 1;
        const body = JSON.parse(options.body);
        if (targetCalls === 1) {
          assert(body.messages[1].content.includes('B'.repeat(30_000)));
          assert(!body.messages[1].content.includes('A'.repeat(30_000)));
          return response(analysis(2));
        }
        return response({ title: 'Background paper', subtitle: '', overview: '完整研究。', orderedSectionIds: ['part-1-section-1', 'part-2-section-1'], limitations: [] });
      });
      try {
        const first = (await source.call('jobs', { ...request, pages: ['A'.repeat(30_000), 'B'.repeat(30_000)] })).value;
        await waitFor(async () => sourceCalls, value => value === 2);
        const second = (await source.call('jobs', { ...request, paperId: 'paper-2' })).value;
        const exported = await source.call('jobs/archive');
        assert.equal(exported.status, 200);
        const archive = exported.value;
        assert.equal(archive.format, 'paperlens-jobs');
        assert.equal(archive.version, 1);
        assert.equal(archive.records.length, 2);
        assert.equal(archive.records[0].checkpoints.length, 1);
        assert.equal(archive.records[0].input.pages[1], 'B'.repeat(30_000));
        assert(!JSON.stringify(archive).includes(KEY));
        assert(!JSON.stringify(archive).includes('apiKey'));
        const restored = await target.call('jobs/restore', { archive, conflicts: 'skip' });
        assert.equal(restored.status, 200);
        assert.deepEqual(restored.value, { restored: 2, skipped: 0, replaced: 0 });
        const list = (await target.call('jobs')).value.jobs;
        assert(list.every(job => job.status === 'paused'));
        assert.equal(targetCalls, 0);
        assert.equal((await target.call(`jobs/${first.id}/retry`, {})).status, 401);
        assert.equal((await target.call(`jobs/${first.id}/retry`, { apiKey: KEY })).status, 202);
        const done = await waitFor(async () => (await target.call(`jobs/${first.id}`)).value, job => job.status === 'completed');
        assert.equal(targetCalls, 2);
        assert.deepEqual(done.result.sections.map(section => section.id), ['part-1-section-1', 'part-2-section-1']);
        assert.equal((await target.call(`jobs/${second.id}`)).value.status, 'paused');
      } finally { await source.close(); await target.close(); }
    });
  });
});

test('archive restore validates the full payload before writing and filters credential properties at every supported level', async () => {
  await withDirectory(async directory => {
    const app = await start(directory, async () => response(analysis()));
    try {
      const created = (await app.call('jobs', request)).value;
      await waitFor(async () => (await app.call(`jobs/${created.id}`)).value, job => job.status === 'completed');
      const pristine = (await app.call('jobs/archive')).value;
      const invalids = [];
      function invalid(edit) { const copy = structuredClone(pristine); edit(copy); invalids.push(copy); }
      invalid(value => { value.version = 99; });
      invalid(value => { delete value.records; });
      invalid(value => { value.records.push(structuredClone(value.records[0])); });
      invalid(value => { value.records[0].job.id = '../../outside-file'; });
      invalid(value => { delete value.records[0].input.pages; });
      invalid(value => { delete value.records[0].input.model; });
      invalid(value => { delete value.records[0].job.result; });
      invalid(value => { value.records[0].job.createdAt = 'yesterday'; });
      invalid(value => { value.records[0].input.images = [{ page: 1, dataUrl: 'https://evil.invalid/image.png' }]; });
      invalid(value => { value.records[0].job.result.sections[0].page = 999; });
      invalid(value => { value.records[0].job.result.evidenceTable[0].value = { malicious: true }; });
      invalid(value => {
        const otherwiseValid = structuredClone(value.records[0]);
        otherwiseValid.job.id = '00000000-0000-4000-8000-000000000001';
        value.records.unshift(otherwiseValid);
        value.records[1].job.result.sections = [];
      });
      for (const archive of invalids) {
        const result = await app.call('jobs/restore', { archive, conflicts: 'replace' });
        assert.equal(result.status, 400);
        assert.equal(result.value.code, 'INVALID_JOB_ARCHIVE');
        assert.equal((await app.call('jobs')).value.jobs.length, 1);
        assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, 1);
      }
      assert.equal((await app.call('jobs/restore', { archive: pristine, conflicts: 'erase' })).status, 400);
      const injected = structuredClone(pristine);
      injected.apiKey = KEY;
      const record = injected.records[0];
      record.apiKey = KEY;
      record.input.apiKey = KEY;
      record.input.headers = { Authorization: KEY };
      record.job.apiKey = KEY;
      record.job.result.apiKey = KEY;
      record.job.result.sections[0].apiKey = KEY;
      record.job.result.evidenceTable[0].apiKey = KEY;
      const restored = await app.call('jobs/restore', { archive: injected, conflicts: 'replace' });
      assert.equal(restored.status, 200);
      assert.deepEqual(restored.value, { restored: 0, skipped: 0, replaced: 1 });
      const disk = await readFile(path.join(directory, `${created.id}.json`), 'utf8');
      assert(!disk.includes(KEY));
      assert(!disk.includes('apiKey'));
      assert(!disk.includes('Authorization'));
      const reexported = await app.call('jobs/archive');
      assert(!JSON.stringify(reexported.value).includes(KEY));
      assert(!JSON.stringify(reexported.value).includes('apiKey'));
      assert.equal(reexported.value.records[0].job.result.sections[0].id, pristine.records[0].job.result.sections[0].id);
    } finally { await app.close(); }
  });
});

test('archive conflict skip/replace never overwrites or cancels an active original task', async () => {
  await withDirectory(async directory => {
    let calls = 0;
    let aborted = false;
    const app = await start(directory, async (_, options) => { calls += 1; return hanging(options.signal, () => { aborted = true; }); });
    try {
      const created = (await app.call('jobs', request)).value;
      await waitFor(async () => calls, value => value === 1);
      const archive = (await app.call('jobs/archive')).value;
      archive.records[0].job.title = 'Backup title';
      for (const conflicts of ['skip', 'replace']) {
        const restored = await app.call('jobs/restore', { archive, conflicts });
        assert.equal(restored.status, 200);
        assert.deepEqual(restored.value, { restored: 0, skipped: 1, replaced: 0 });
      }
      assert.equal((await app.call(`jobs/${created.id}`)).value.title, request.title);
      assert.equal(aborted, false);
      await app.call(`jobs/${created.id}/cancel`, {});
      await waitFor(async () => aborted, value => value);
      const replaced = await app.call('jobs/restore', { archive, conflicts: 'replace' });
      assert.deepEqual(replaced.value, { restored: 0, skipped: 0, replaced: 1 });
      const job = (await app.call(`jobs/${created.id}`)).value;
      assert.equal(job.title, 'Backup title');
      assert.equal(job.status, 'paused');
      assert.equal(calls, 1);
    } finally { await app.close(); }
  });
});

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=';
function stagedRequest(count = 30, overrides = {}) {
  const pages = Array.from({ length: count }, () => '');
  const expectedVisualPages = pages.map((_, i) => i + 1);
  return { ...request, pipelineVersion: 2, pages, images: [], expectedVisualPages,
    visualPlan: { version: 1, pages: expectedVisualPages.map(page => ({ page, kind: 'scan', reasons: ['扫描页没有文字层'] })) }, ...overrides };
}
const uploadPages = pages => ({ images: pages.map(page => ({ page, dataUrl: TINY_PNG })) });

test('stages over 24 scanned pages in small uploads and starts only after every visual page is durable', async () => {
  await withDirectory(async directory => {
    const submitted = [];
    const app = await start(directory, async (_, options) => {
      const body = JSON.parse(options.body);
      submitted.push(body);
      const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(item => item.type === 'image_url') : []);
      if (images.length) {
        assert(images.length <= 6);
        const first = (submitted.length - 1) * 6 + 1;
        const value = analysis(first);
        value.sections = Array.from({ length: images.length }, (_, index) => ({ ...analysis(first + index).sections[0], id: `model-${first + index}`, figures: [{ id: `figure-${first + index}`, title: `Figure ${first + index}`, page: first + index, caption: '扫描原图', panels: [] }] }));
        return response(value);
      }
      return response({ title: 'Background paper', subtitle: '', overview: '完整扫描文献。', orderedSectionIds: [], limitations: [] });
    });
    try {
      const staged = await app.call('jobs/stage', stagedRequest());
      assert.equal(staged.status, 202);
      assert.equal(staged.value.status, 'preparing');
      const id = staged.value.id;
      assert.equal((await app.call('jobs/stage', stagedRequest())).value.code, 'JOB_ALREADY_ACTIVE');
      assert.equal((await app.call(`jobs/${id}/start`, {})).value.code, 'VISUAL_PAGES_MISSING');
      const pages = stagedRequest().expectedVisualPages;
      for (let offset = 0; offset < pages.length; offset += 4) {
        const uploaded = await app.call(`jobs/${id}/images`, uploadPages(pages.slice(offset, offset + 4)));
        assert.equal(uploaded.status, 200);
        assert.equal(uploaded.value.preparation.receivedPages.length, Math.min(offset + 4, pages.length));
        assert.equal(submitted.length, 0, 'the provider must not see an incomplete document');
      }
      const duplicate = await app.call(`jobs/${id}/images`, uploadPages([29, 30]));
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.value.preparation.receivedPages.length, 30);
      const disk = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
      assert.equal(disk.input.images.length, 30);
      assert.equal(disk.input.pipelineVersion, 2);
      assert.deepEqual(disk.input.expectedVisualPages, pages);
      assert.equal(disk.input.visualPlan.pages.length, 30);
      assert(!JSON.stringify(disk).includes(KEY));
      assert.equal((await app.call(`jobs/${id}/start`, {})).status, 202);
      const done = await waitFor(async () => (await app.call(`jobs/${id}`)).value, job => ['completed', 'failed'].includes(job.status));
      assert.equal(done.status, 'completed', done.error);
      assert.equal(submitted.length, 6);
      assert.deepEqual(done.result.coverage.visualPages, pages);
      assert.deepEqual(done.result.sections.flatMap(section => section.figures.map(figure => figure.page)), pages);
      const archive = (await app.call('jobs/archive')).value;
      assert.equal(archive.records[0].job.result.coverage.visualPages.length, 30);
      assert.deepEqual(archive.records[0].input.visualPlan, disk.input.visualPlan);
      assert(!JSON.stringify(archive).includes(KEY));
      archive.records[0].job.result.coverage.apiKey = KEY;
      archive.records[0].input.visualPlan.apiKey = KEY;
      archive.records[0].input.visualPlan.pages[0].apiKey = KEY;
      const restored = await app.call('jobs/restore', { archive, conflicts: 'replace' });
      assert.equal(restored.status, 200);
      const reexported = (await app.call('jobs/archive')).value;
      assert(!JSON.stringify(reexported).includes(KEY));
      assert.deepEqual(reexported.records[0].job.result.coverage.visualPages, pages);
    } finally { await app.close(); }
  });
});

test('partial image preparation survives restart, backup/restore, and cancel/retry without lost pages', async () => {
  await withDirectory(async directory => {
    await withDirectory(async targetDirectory => {
      let calls = 0;
      const fetchImpl = async () => { calls += 1; return response(analysis()); };
      const first = await start(directory, fetchImpl);
      const staged = (await first.call('jobs/stage', stagedRequest(8))).value;
      await first.call(`jobs/${staged.id}/images`, uploadPages([1, 2, 3]));
      await first.close();
      const second = await start(directory, fetchImpl);
      const target = await start(targetDirectory, fetchImpl);
      try {
        const recovered = (await second.call(`jobs/${staged.id}`)).value;
        assert.equal(recovered.status, 'preparing');
        assert.deepEqual(recovered.preparation.receivedPages, [1, 2, 3]);
        assert.equal((await second.call(`jobs/${staged.id}/retry`, {})).status, 401);
        assert.equal((await second.call(`jobs/${staged.id}/retry`, { apiKey: KEY })).value.status, 'preparing');
        const archive = (await second.call('jobs/archive')).value;
        assert.equal(archive.records[0].input.images.length, 3);
        assert.equal((await target.call('jobs/restore', { archive, conflicts: 'skip' })).status, 200);
        assert.equal((await target.call(`jobs/${staged.id}`)).value.status, 'paused');
        assert.equal((await target.call(`jobs/${staged.id}/retry`, { apiKey: KEY })).value.status, 'preparing');
        assert.equal((await target.call(`jobs/${staged.id}/images`, uploadPages([4, 5]))).status, 200);
        const cancelled = (await target.call(`jobs/${staged.id}/cancel`, {})).value;
        assert.equal(cancelled.status, 'cancelled');
        assert.deepEqual(cancelled.preparation.receivedPages, [1, 2, 3, 4, 5]);
        assert.equal((await target.call(`jobs/${staged.id}/images`, uploadPages([6]))).status, 409);
        const retry = (await target.call(`jobs/${staged.id}/retry`, { apiKey: KEY })).value;
        assert.equal(retry.status, 'preparing');
        assert.deepEqual(retry.preparation.receivedPages, [1, 2, 3, 4, 5]);
        assert.equal((await target.call(`jobs/${staged.id}/start`, {})).value.code, 'VISUAL_PAGES_MISSING');
        assert.equal(calls, 0);
      } finally { await second.close(); await target.close(); }
    });
  });
});

test('concurrent uploads are serialized, repeated pages are idempotent, and conflicting or unexpected images do not mutate progress', async () => {
  await withDirectory(async directory => {
    const app = await start(directory, async () => response(analysis()));
    try {
      const staged = (await app.call('jobs/stage', stagedRequest(10))).value;
      const id = staged.id;
      const uploaded = await Promise.all([
        app.call(`jobs/${id}/images`, uploadPages([1, 2, 3, 4])),
        app.call(`jobs/${id}/images`, uploadPages([5, 6, 7, 8])),
        app.call(`jobs/${id}/images`, uploadPages([1, 9])),
      ]);
      assert(uploaded.every(result => result.status === 200));
      assert.deepEqual((await app.call(`jobs/${id}`)).value.preparation.receivedPages, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const conflicting = { images: [{ page: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAAB' }] };
      assert.equal((await app.call(`jobs/${id}/images`, conflicting)).value.code, 'IMAGE_PAGE_CONFLICT');
      assert.equal((await app.call(`jobs/${id}/images`, uploadPages([11]))).value.code, 'UNEXPECTED_IMAGE_PAGE');
      assert.equal((await app.call(`jobs/${id}/images`, uploadPages([1, 2, 3, 4, 5]))).value.code, 'INVALID_UPLOAD_BATCH');
      assert.equal((await app.call(`jobs/${id}/images`, { images: [{ page: 10, dataUrl: 'https://example.invalid/image.png' }] })).status, 400);
      assert.deepEqual((await app.call(`jobs/${id}`)).value.preparation.receivedPages, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.equal((await app.call(`jobs/${id}/start`, {})).status, 409);
    } finally { await app.close(); }
  });
});

test('legacy disk checkpoints keep the legacy pipeline after upgrade and resume only their remaining text chunks', async () => {
  await withDirectory(async directory => {
    const id = '00000000-0000-4000-8000-000000000017';
    const old = { version: 1, job: { id, paperId: 'legacy-paper', title: request.title, status: 'paused', progress: 33, message: '等待继续', createdAt: Date.now(), updatedAt: Date.now() }, input: { title: request.title, category: request.category, model: request.model, pages: ['A'.repeat(30_000), 'B'.repeat(30_000)], images: [] }, checkpoints: [analysis(1)] };
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify(old));
    const submitted = [];
    const app = await start(directory, async (_, options) => {
      const body = JSON.parse(options.body);
      submitted.push(body);
      if (submitted.length === 1) return response(analysis(2));
      return response({ title: request.title, subtitle: '', overview: '完整研究', orderedSectionIds: ['part-1-section-1', 'part-2-section-1'], limitations: [] });
    });
    try {
      assert.equal((await app.call(`jobs/${id}`)).value.pipelineVersion, 1);
      const archive = (await app.call('jobs/archive')).value;
      assert.equal(archive.records[0].input.pipelineVersion, 1);
      assert.equal((await app.call(`jobs/${id}/retry`, { apiKey: KEY })).status, 202);
      const done = await waitFor(async () => (await app.call(`jobs/${id}`)).value, job => ['completed', 'failed'].includes(job.status));
      assert.equal(done.status, 'completed', done.error);
      assert.equal(submitted.length, 2);
      assert(JSON.stringify(submitted[0]).includes('B'.repeat(30_000)));
      assert(!JSON.stringify(submitted[0]).includes('A'.repeat(30_000)));
      assert.equal(done.result.sections.length, 2);
      assert.equal(JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')).input.pipelineVersion, 1);
    } finally { await app.close(); }
  });
});

test('upload byte limits fail before saving any new page and retain the resumable preparation', async () => {
  await withDirectory(async directory => {
    let calls = 0;
    const app = await start(directory, async () => { calls += 1; return response(analysis()); });
    try {
      const id = (await app.call('jobs/stage', stagedRequest(4))).value.id;
      await app.call(`jobs/${id}/images`, uploadPages([1]));
      const bytes = Buffer.alloc(3 * 1024 * 1024, 1);
      bytes.set([255, 216, 255]);
      const dataUrl = 'data:image/jpeg;base64,' + bytes.toString('base64');
      const rejected = await app.call(`jobs/${id}/images`, { images: [2, 3, 4].map(page => ({ page, dataUrl })) });
      assert.equal(rejected.status, 413);
      assert.equal(rejected.value.code, 'UPLOAD_BATCH_TOO_LARGE');
      assert.deepEqual((await app.call(`jobs/${id}`)).value.preparation.receivedPages, [1]);
      assert.deepEqual(JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')).input.images.map(image => image.page), [1]);
      assert.equal(calls, 0);
    } finally { await app.close(); }
  });
});

test('archive checkpoints are bound to exact visual pages and plan identity before any import is written', async () => {
  await withDirectory(async directory => {
    await withDirectory(async targetDirectory => {
      let calls = 0;
      const source = await start(directory, async (_, options) => {
        calls += 1;
        return calls === 1 ? response(analysis()) : hanging(options.signal);
      });
      const target = await start(targetDirectory, async () => response(analysis(7)));
      try {
        const id = (await source.call('jobs/stage', stagedRequest(8))).value.id;
        await source.call(`jobs/${id}/images`, uploadPages([1, 2, 3, 4]));
        await source.call(`jobs/${id}/images`, uploadPages([5, 6, 7, 8]));
        await source.call(`jobs/${id}/start`, {});
        await waitFor(async () => calls, count => count === 2);
        const archive = (await source.call('jobs/archive')).value;
        const checkpoint = archive.records[0].checkpoints[0];
        assert.equal(checkpoint._batch.pipelineVersion, 2);
        assert.equal(checkpoint._batch.batchId, 'batch-1');
        assert.match(checkpoint._batch.planId, /^[a-f0-9]{64}$/);
        const invalids = [
          value => { value.records[0].checkpoints[0]._batch.batchId = 'batch-2'; },
          value => { delete value.records[0].checkpoints[0]._batch; },
          value => { value.records[0].input.images[0].dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAAB'; },
          value => { value.records[0].input.images.pop(); },
        ];
        for (const edit of invalids) {
          const copy = structuredClone(archive);
          edit(copy);
          const result = await target.call('jobs/restore', { archive: copy, conflicts: 'skip' });
          assert.equal(result.status, 400);
          assert.equal(result.value.code, 'INVALID_JOB_ARCHIVE');
          assert.deepEqual((await target.call('jobs')).value.jobs, []);
        }
        archive.records[0].checkpoints[0]._batch.apiKey = KEY;
        assert.equal((await target.call('jobs/restore', { archive, conflicts: 'skip' })).status, 200);
        const exported = (await target.call('jobs/archive')).value;
        assert.deepEqual(exported.records[0].checkpoints[0]._batch, { pipelineVersion: 2, planId: checkpoint._batch.planId, batchId: 'batch-1' });
        assert(!JSON.stringify(exported).includes(KEY));
      } finally { await source.close(); await target.close(); }
    });
  });
});

test('staged jobs require a complete per-page detection plan, including uncertain and text-only pages', async () => {
  await withDirectory(async directory => {
    let calls = 0;
    const app = await start(directory, async () => { calls += 1; return response(analysis()); });
    try {
      const absent = stagedRequest(2);
      delete absent.visualPlan;
      assert.equal((await app.call('jobs/stage', absent)).value.code, 'VISUAL_PLAN_REQUIRED');
      const incomplete = stagedRequest(2);
      incomplete.visualPlan.pages.pop();
      assert.equal((await app.call('jobs/stage', incomplete)).value.code, 'INVALID_VISUAL_PLAN');
      const omitted = stagedRequest(2);
      omitted.pages = ['Readable body text.', 'Readable body text.'];
      omitted.visualPlan.pages[1].kind = 'uncertain';
      omitted.expectedVisualPages = [1];
      assert.equal((await app.call('jobs/stage', omitted)).value.code, 'VISUAL_PLAN_MISMATCH');
      const textOnly = stagedRequest(2, { pages: ['Readable text.', 'Readable text.'], expectedVisualPages: [], visualPlan: { version: 1, pages: [1, 2].map(page => ({ page, kind: 'text', reasons: ['无图像或图形对象'] })) } });
      const valid = await app.call('jobs/stage', textOnly);
      assert.equal(valid.status, 202);
      assert.equal(valid.value.status, 'preparing');
      assert.deepEqual(valid.value.preparation, { expectedPages: [], receivedPages: [] });
      assert.equal(calls, 0);
      assert.equal((await app.call(`jobs/${valid.value.id}/start`, {})).status, 202);
      const completed = await waitFor(async () => (await app.call(`jobs/${valid.value.id}`)).value, job => job.status === 'completed');
      assert.deepEqual(completed.result.coverage.textOnlyPages, [1, 2]);
      assert.equal(calls, 1);
    } finally { await app.close(); }
  });
});
