import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { access } from 'node:fs/promises';

let server, browser, url;
before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen(); url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const executablePath = await access(edge).then(() => edge, () => undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });
async function run(fn) {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.route('**/__storage-test__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage checks</title>' }));
  await page.route('**/api/jobs/archive', route => route.fulfill({ json: { format: 'paperlens-jobs', version: 1, exportedAt: Date.now(), records: [] } }));
  await page.goto(`${url}/__storage-test__`);
  await page.evaluate(async () => { window.storage = await import('/src/lib/storage.ts'); });
  try { return await page.evaluate(fn); } finally { await context.close(); }
}

test('compressed backup restores PDFs, full edited analyses, crops, revisions, notes, chats, folders and safe preferences', async () => {
  const result = await run(async () => {
    const s = window.storage;
    const analysis = { title: '研究', overview: '概述', category: '基础医学', subtitle: '', sections: [{ id: 's1', title: '结果', shortTitle: '结果', page: 1, summary: '发现', proves: '支持', markdown: '## 详细解释', figures: [{ id: 'f1', title: 'Figure 1', page: 1, caption: '说明', panels: [{ label: 'A', type: '散点图', xAxis: '组别', yAxis: '表达', explanation: '详细', evidence: '', image: 'data:image/png;base64,YWJj', crop: { x: 1, y: 2, width: 30, height: 40 } }] }] }], limitations: [], evidenceTable: [{ id: 'a', label: '模型', value: '小鼠' }], logic: { nodes: [{ id: 'n', title: '发现', sectionId: 's1' }], edges: [] } };
    const paper = { id: 'p1', title: '论文', fileName: 'paper.pdf', category: '基础医学', folderId: 'reading', addedAt: 1, pageCount: 1, pages: ['original text'], outline: [], notes: '# 笔记', starred: true, analysis, revisions: [{ id: 'r1', createdAt: 2, label: '手动编辑', analysis }], tags: ['骨关节炎'], doi: '10.1/test', readingStatus: 'done' };
    const pdf = new TextEncoder().encode('%PDF-1.7\nTest binary bytes\x00\xff');
    await s.savePaper(paper, pdf);
    localStorage.setItem('pl-settings', JSON.stringify({ apiKey: 'DO-NOT-EXPORT', model: 'deepseek', nested: { accessToken: 'ALSO-PRIVATE', harmless: 1 } }));
    localStorage.setItem('pl-secret', 'NEVER-EXPORT');
    localStorage.setItem('pl-chat-p1', JSON.stringify([{ role: 'user', content: 'Figure A?' }]));
    localStorage.setItem('pl-folders', JSON.stringify([{ id: 'reading', name: '正在阅读' }]));
    localStorage.setItem('paperlens-pdf-fingerprint', JSON.stringify({ bookmarks: [1], highlights: [{ color: '#F00', page: 1 }] }));
    localStorage.setItem('pl-jobs', JSON.stringify([{ id: 'j1', status: 'running', apiKey: 'JOB-PRIVATE' }]));
    localStorage.setItem('unrelated', 'outside');
    const backup = await s.exportBackup();
    const archive = await s.inspectBackup(backup.blob), serialized = JSON.stringify(archive);
    await s.deletePaper('p1'); localStorage.clear();
    localStorage.setItem('pl-settings', JSON.stringify({ apiKey: 'CURRENT-KEY', model: 'current' }));
    const preview = await s.previewBackup(archive);
    const restored = await s.restoreBackup(archive, { conflicts: 'replace' });
    const records = await s.getAllRecords(); const settings = JSON.parse(localStorage.getItem('pl-settings'));
    return { completePaper: JSON.stringify(records[0].analysis) === JSON.stringify(analysis), note: records[0].notes, pdf: [...records[0].pdf], originalPdf: [...pdf], revisionCount: records[0].revisions.length, exportNoSecrets: !/DO-NOT-EXPORT|ALSO-PRIVATE|NEVER-EXPORT|JOB-PRIVATE/.test(serialized), key: settings.apiKey, model: settings.model, chat: JSON.parse(localStorage.getItem('pl-chat-p1'))[0].content, annotations: JSON.parse(localStorage.getItem('paperlens-pdf-fingerprint')).highlights[0].color, job: JSON.parse(localStorage.getItem('pl-jobs'))[0].status, unrelated: localStorage.getItem('unrelated'), preview, restored, gzip: backup.fileName.endsWith('.gz') };
  });
  assert.equal(result.completePaper, true); assert.equal(result.note, '# 笔记'); assert.deepEqual(result.pdf, result.originalPdf); assert.equal(result.revisionCount, 1);
  assert.equal(result.exportNoSecrets, true); assert.equal(result.key, 'CURRENT-KEY'); assert.equal(result.model, 'deepseek'); assert.equal(result.chat, 'Figure A?'); assert.equal(result.annotations, '#F00'); assert.equal(result.job, 'paused'); assert.equal(result.unrelated, null);
  assert.equal(result.preview.paperCount, 1); assert.equal(result.preview.pdfCount, 1); assert.equal(result.preview.chatCount, 1); assert.equal(result.preview.annotationCount, 1); assert.equal(result.restored.restored, 1); assert.equal(result.gzip, true);
});

test('default restoration keeps local conflicting records and merges folders; replacement is explicit', async () => {
  const result = await run(async () => {
    const s = window.storage, pdf = new TextEncoder().encode('%PDF-1.7\nfixture');
    const make = (id, title) => ({ id, title, fileName: 'a.pdf', category: '基础医学', folderId: id, addedAt: 1, pageCount: 1, pages: ['p'], outline: [], notes: title, starred: false });
    await s.savePaper(make('p1', 'backup'), pdf); await s.savePaper(make('p2', 'new'), pdf);
    localStorage.setItem('pl-folders', JSON.stringify([{ id: 'p1', name: 'backup-folder' }, { id: 'p2', name: 'new-folder' }])); localStorage.setItem('pl-chat-p1', JSON.stringify(['backup-chat']));
    const archive = await s.inspectBackup((await s.exportBackup()).blob);
    await s.deletePaper('p2'); await s.savePaper(make('p1', 'local'));
    localStorage.setItem('pl-folders', JSON.stringify([{ id: 'p1', name: 'local-folder' }, { id: 'p3', name: 'extra-folder' }])); localStorage.setItem('pl-chat-p1', JSON.stringify(['local-chat']));
    const preview = await s.previewBackup(archive), kept = await s.restoreBackup(archive);
    const skippedTitle = (await s.listPapers()).find(p => p.id === 'p1').title, skippedChat = JSON.parse(localStorage.getItem('pl-chat-p1'))[0], merged = JSON.parse(localStorage.getItem('pl-folders'));
    const replaced = await s.restoreBackup(archive, { conflicts: 'replace' });
    return { preview, kept, skippedTitle, skippedChat, merged, replaced, title: (await s.listPapers()).find(p => p.id === 'p1').title, chat: JSON.parse(localStorage.getItem('pl-chat-p1'))[0] };
  });
  assert.equal(result.preview.conflictCount, 1); assert.equal(result.kept.restored, 1); assert.equal(result.kept.skipped, 1); assert.equal(result.skippedTitle, 'local'); assert.equal(result.skippedChat, 'local-chat');
  assert.equal(result.merged.length, 3); assert.equal(result.merged.find(f => f.id === 'p1').name, 'local-folder'); assert.equal(result.replaced.replaced, 2); assert.equal(result.title, 'backup'); assert.equal(result.chat, 'backup-chat');
});

test('corrupt PDF and unsupported archive versions fail before any data changes', async () => {
  const result = await run(async () => {
    const s = window.storage, paper = { id: 'p1', title: 'safe', fileName: 'a.pdf', category: '基础医学', folderId: 'f', addedAt: 1, pageCount: 1, pages: ['p'], outline: [], notes: 'safe-note', starred: false };
    await s.savePaper(paper, new TextEncoder().encode('%PDF-1.7\nOriginal'));
    const archive = await s.inspectBackup((await s.exportBackup()).blob);
    archive.papers[0].pdf = btoa('%PDF-1.7\nChanged!'); archive.papers[0].paper.title = 'must-not-write'; archive.local['pl-theme'] = JSON.stringify('dark');
    const errors = [];
    try { await s.restoreBackup(archive, { conflicts: 'replace' }); } catch (error) { errors.push(error.message); }
    try { await s.inspectBackup(new Blob([JSON.stringify({ ...archive, version: 500 })])); } catch (error) { errors.push(error.message); }
    return { errors, title: (await s.listPapers())[0].title, theme: localStorage.getItem('pl-theme') };
  });
  assert.match(result.errors[0], /校验失败/); assert.match(result.errors[1], /版本不受支持/); assert.equal(result.title, 'safe'); assert.equal(result.theme, null);
});

test('quota failure rolls back changed preferences and leaves original PDFs and papers intact', async () => {
  const result = await run(async () => {
    const s = window.storage, paper = { id: 'p1', title: 'original', fileName: 'a.pdf', category: '基础医学', folderId: 'f', addedAt: 1, pageCount: 1, pages: ['p'], outline: [], notes: '', starred: false };
    await s.savePaper(paper, new TextEncoder().encode('%PDF-1.7\nOriginal'));
    const archive = await s.inspectBackup((await s.exportBackup()).blob);
    archive.papers[0].paper.title = 'overwrite'; archive.local = { 'pl-theme': '"dark"', 'pl-force-quota': '"x"' };
    localStorage.setItem('pl-theme', '"light"');
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'pl-force-quota') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return originalSetItem.call(this, key, value); };
    let error;
    try { await s.restoreBackup(archive, { conflicts: 'replace' }); } catch (err) { error = err.message; } finally { Storage.prototype.setItem = originalSetItem; }
    return { error, title: (await s.listPapers())[0].title, theme: JSON.parse(localStorage.getItem('pl-theme')), quotaKey: localStorage.getItem('pl-force-quota') };
  });
  assert.match(result.error, /原有文献和设置已保留/); assert.equal(result.title, 'original'); assert.equal(result.theme, 'light'); assert.equal(result.quotaKey, null);
});

test('nested analysis validation rejects malformed sections before restoration', async () => {
  const result = await run(async () => {
    const s = window.storage, paper = { id: 'p1', title: 'safe', fileName: 'a.pdf', category: '基础医学', folderId: 'f', addedAt: 1, pageCount: 1, pages: ['p'], outline: [], notes: '', starred: false };
    await s.savePaper(paper, new TextEncoder().encode('%PDF-1.7\nOriginal'));
    const archive = await s.inspectBackup((await s.exportBackup()).blob);
    archive.papers[0].paper.analysis = { title: 'bad', overview: '', limitations: [], sections: [{ title: 'missing required figure list' }] };
    let error; try { await s.restoreBackup(archive, { conflicts: 'replace' }); } catch (e) { error = e.message; }
    return { error, title: (await s.listPapers())[0].title };
  });
  assert.match(result.error, /章节格式错误/); assert.equal(result.title, 'safe');
});

test('IndexedDB failure aborts every paper write and rolls back preference changes', async () => {
  const result = await run(async () => {
    const s = window.storage, make = (id) => ({ id, title: 'original-' + id, fileName: 'a.pdf', category: '基础医学', folderId: 'f', addedAt: 1, pageCount: 1, pages: ['p'], outline: [], notes: '', starred: false });
    await s.savePaper(make('p1'), new TextEncoder().encode('%PDF-1.7\nOriginal'));
    await s.savePaper(make('p2'), new TextEncoder().encode('%PDF-1.7\nOriginal'));
    const archive = await s.inspectBackup((await s.exportBackup()).blob);
    archive.papers.forEach(entry => entry.paper.title = 'must-not-write'); archive.local = { 'pl-theme': '"dark"' };
    localStorage.setItem('pl-theme', '"light"');
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...rest) { if (record.id === 'p2') throw new DOMException('Write failure', 'QuotaExceededError'); return originalPut.call(this, record, ...rest); };
    let error; try { await s.restoreBackup(archive, { conflicts: 'replace' }); } catch (e) { error = e.message; } finally { IDBObjectStore.prototype.put = originalPut; }
    return { error, titles: (await s.listPapers()).map(p => p.title).sort(), theme: JSON.parse(localStorage.getItem('pl-theme')) };
  });
  assert.match(result.error, /原有文献和设置已保留/); assert.deepEqual(result.titles, ['original-p1', 'original-p2']); assert.equal(result.theme, 'light');
});

test('backup includes server job checkpoints, excludes secrets, and reports partial restoration honestly', async () => {
  const result = await run(async () => {
    const s = window.storage, originalFetch = window.fetch;
    const jobArchive = { format: 'paperlens-jobs', version: 1, exportedAt: Date.now(), records: [{ job: { id: 'j1', paperId: 'p1', title: '论文', status: 'paused', progress: 45, message: '', createdAt: 1, updatedAt: 2 }, input: { title: '论文', category: '基础医学', model: 'test-model', pages: ['全文'], apiKey: 'CHECKPOINT-SECRET' }, checkpoints: [{ title: '分段结果', overview: '已完成', sections: [], limitations: [] }] }] };
    let requestBody, failRestore = true;
    window.fetch = async (url, init) => {
      if (url === '/api/jobs/archive') return Response.json(jobArchive);
      if (url === '/api/jobs/restore') { requestBody = JSON.parse(init.body); return failRestore ? Response.json({ error: 'simulated unavailable' }, { status: 503 }) : Response.json({ restored: 1, skipped: 0, replaced: 0 }); }
      return originalFetch(url, init);
    };
    const paper = { id: 'p1', title: 'paper', fileName: 'a.pdf', category: '基础医学', folderId: 'f', addedAt: 1, pageCount: 1, pages: ['p'], outline: [], notes: '', starred: false };
    await s.savePaper(paper, new TextEncoder().encode('%PDF-1.7\nOriginal'));
    const archive = await s.inspectBackup((await s.exportBackup()).blob), preview = await s.previewBackup(archive);
    await s.deletePaper('p1');
    const partial = await s.restoreBackup(archive), papersAfterPartial = await s.listPapers();
    failRestore = false;
    const retried = await s.restoreBackup(archive);
    return { checkpoint: archive.jobs.records[0].checkpoints[0].overview, leaked: JSON.stringify(archive).includes('CHECKPOINT-SECRET'), jobCount: preview.jobCount, partial, papersAfterPartial: papersAfterPartial.length, retried, policy: requestBody.conflicts, sentJobCount: requestBody.archive.records.length };
  });
  assert.equal(result.checkpoint, '已完成'); assert.equal(result.leaked, false); assert.equal(result.jobCount, 1); assert.equal(result.partial.restored, 1); assert.equal(result.papersAfterPartial, 1); assert.match(result.partial.warnings[0], /文献、PDF 和阅读设置已恢复/); assert.equal(result.retried.skipped, 1); assert.equal(result.retried.jobs.restored, 1); assert.equal(result.policy, 'skip'); assert.equal(result.sentJobCount, 1);
});

test('trash survives stale saves, backup and restore with annotations and calibrated anchors intact',async()=>{
  const result=await run(async()=>{
    const s=window.storage,p={id:'trash-paper',title:'保留文献',fileName:'x.pdf',category:'基础医学',folderId:'reading',addedAt:1,pageCount:1,pages:['原文'],outline:[],notes:'珍贵笔记',starred:true,analysis:{title:'解析',subtitle:'',overview:'完整',category:'基础医学',limitations:[],sections:[{id:'s',title:'节',shortTitle:'节',page:1,summary:'概括',proves:'结果',markdown:'长正文',figures:[],source:{page:1,region:{x:.1,y:.2,width:.3,height:.4}}}]}};
    await s.savePaper(p,new TextEncoder().encode('%PDF-1.7\ncontent'));localStorage.setItem('paperlens-pdf-trash',JSON.stringify({highlights:[{id:'h',comment:'保留批注'}]}));
    await s.setPaperTrashed(p.id,true);await s.savePaper({...p,notes:'后台保存的笔记'});const hidden=(await s.listPapers()).length===0;
    const a=await s.inspectBackup((await s.exportBackup()).blob);await s.deletePaper(p.id);await s.restoreBackup(a,{conflicts:'replace'});
    const remainsHidden=(await s.listPapers()).length===0;await s.setPaperTrashed(p.id,false);const restored=(await s.listPapers())[0];
    const {rotateRegion,matchingTextRange}=await import('/src/lib/preciseNavigation.ts');const region=p.analysis.sections[0].source.region;
    return {hidden,remainsHidden,restored,binary:new TextDecoder().decode(await s.getPdf(p.id)),annotation:JSON.parse(localStorage.getItem('paperlens-pdf-trash')),rotations:[0,90,180,270].map(r=>rotateRegion(rotateRegion(region,r),(360-r)%360)),range:matchingTextRange(['Non-linear ','gene expression',' trajectories'],'Non-linear gene expression trajectories')};
  });
  assert.ok(result.hidden&&result.remainsHidden);assert.equal(result.restored.notes,'后台保存的笔记');assert.equal(result.restored.deletedAt,undefined);assert.equal(result.annotation.highlights[0].comment,'保留批注');assert.match(result.binary,/%PDF/);assert.deepEqual(result.range,[0,1,2]);for(const r of result.rotations)for(const k of ['x','y','width','height'])assert.ok(Math.abs(r[k]-result.restored.analysis.sections[0].source.region[k])<1e-8);
});
