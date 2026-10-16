import {paperFolders,withFolders} from './libraryHome';
const organizationHelpers={paperFolders,withFolders};
import type { Paper, Folder } from '../types';

const DB = 'paperlens-library';
let connection: Promise<IDBDatabase> | undefined;
function db() {
  return connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('papers', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => reject(new Error('请关闭其他 PaperRead 窗口后重试。'));
  });
}
export interface PaperRecord extends Paper { pdf?: Uint8Array; supplementPdfs?: Record<string,Uint8Array>; }
export async function getAllRecords(): Promise<PaperRecord[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('papers').objectStore('papers').getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function listPapers(includeDeleted = false): Promise<Paper[]> { return (await getAllRecords()).filter(p => includeDeleted || !p.deletedAt&&!p.mergedInto).map(({ pdf: _pdf, supplementPdfs: _supplements, ...paper }) => paper).sort((a, b) => b.addedAt - a.addedAt); }
export async function savePaper(paper: Paper, pdf?: Uint8Array) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('papers', 'readwrite'), store = tx.objectStore('papers');
    const r = store.get(paper.id); r.onsuccess = () => store.put({ ...paper, ...(r.result?.deletedAt?{deletedAt:r.result.deletedAt}:{}), pdf: pdf || r.result?.pdf, supplementPdfs: r.result?.supplementPdfs });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存被中止'));
  });
}
export async function getPdf(id: string): Promise<Uint8Array | null> {
  const database = await db();
  return new Promise((resolve, reject) => { const r = database.transaction('papers').objectStore('papers').get(id); r.onsuccess = () => resolve(r.result?.pdf || null); r.onerror = () => reject(r.error); });
}
export async function saveSupplement(paper:Paper,id:string,bytes:Uint8Array){const database=await db();return new Promise<void>((resolve,reject)=>{const tx=database.transaction('papers','readwrite'),store=tx.objectStore('papers'),r=store.get(paper.id);r.onsuccess=()=>{if(!r.result){tx.abort();return;}store.put({...paper,...(r.result.deletedAt?{deletedAt:r.result.deletedAt}:{}),pdf:r.result.pdf,supplementPdfs:{...r.result.supplementPdfs,[id]:bytes}});};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('附件保存中止'));});}
export async function getSupplementPdf(paperId:string,id:string):Promise<Uint8Array|null>{const database=await db();return new Promise((resolve,reject)=>{const r=database.transaction('papers').objectStore('papers').get(paperId);r.onsuccess=()=>resolve(r.result?.supplementPdfs?.[id]||null);r.onerror=()=>reject(r.error);});}
export async function setPaperTrashed(id:string,trashed:boolean){const database=await db();return new Promise<void>((resolve,reject)=>{const tx=database.transaction('papers','readwrite'),store=tx.objectStore('papers'),r=store.getAll();r.onsuccess=()=>{const all=r.result as PaperRecord[],target=all.find(p=>p.id===id);if(!target)return;const group=all.filter(p=>p.id===id||p.mergedInto===id);for(const p of group){const next={...p};if(trashed)next.deletedAt=Date.now();else{delete next.deletedAt;if(next.id===id&&next.mergedInto){const parent=all.find(p=>p.id===next.mergedInto);if(parent)store.put({...parent,mergedPaperIds:parent.mergedPaperIds?.filter(source=>source!==id)});delete next.mergedInto;}}store.put(next);}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('回收站操作失败'));});}
export async function deletePaper(id: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => { const tx = database.transaction('papers', 'readwrite'); tx.objectStore('papers').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('删除被中止')); });
}
export function readLocal<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem('pl-' + key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
export function writeLocal(key: string, value: unknown) { localStorage.setItem('pl-' + key, JSON.stringify(value)); }

export interface BackupArchive {
  format: 'paperlens-backup'; version: 1; createdAt: string;
  papers: Array<{ paper: Paper; pdf: string | null; pdfSha256?: string; supplements?: Array<{id:string;pdf:string;pdfSha256:string}> }>;
  local: Record<string, string>;
  jobs?: { format: 'paperlens-jobs'; version: 1; exportedAt: number; records: unknown[] };
}
export interface BackupPreview { paperCount: number; pdfCount: number; annotationCount: number; chatCount: number; conflictCount: number; missingPdfCount: number; byteCount: number; createdAt: string; jobCount: number; }
export interface RestoreResult { restored: number; skipped: number; replaced: number; jobs?: { restored: number; skipped: number; replaced: number }; warnings?: string[]; }
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_PDF_BYTES = 150 * 1024 * 1024;
const CATEGORIES = ['基础医学', '生信分析', '纳米材料', '临床研究', '综述 / Meta'];
const forbiddenKey = /^(?:__proto__|prototype|constructor|api.?key|access.?token|refresh.?token|authorization|password|secret|credential)$/i;
const privateLocalKey = /(?:api.?key|access.?token|refresh.?token|authorization|password|secret|credential)/i;
function safeLocalKey(key: string) { return (key.startsWith('pl-') || key.startsWith('paperlens-pdf-') || ['paperlens-pdf-mode','paperlens-highlight-color'].includes(key)) && key.length < 300 && !privateLocalKey.test(key); }
function cleanValue(value: unknown, depth = 0): unknown {
  if (depth > 80) throw new Error('备份内容层级过深，无法安全读取。');
  if (Array.isArray(value)) return value.map(item => cleanValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value)) if (!forbiddenKey.test(key)) output[key] = cleanValue(item, depth + 1);
    return output;
  }
  return value;
}
function sanitizedLocal(raw: string): string | null {
  try { return JSON.stringify(cleanValue(JSON.parse(raw))); } catch { return null; }
}
function sanitizedPreference(key:string,raw:string){if(key==='paperlens-pdf-mode')return ['pointer','hand','text'].includes(raw)?raw:null;if(key==='paperlens-highlight-color')return /^#[a-f0-9]{6}$/i.test(raw)?raw:null;return sanitizedLocal(raw);}
function safeSettings(): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i); if (!key || !safeLocalKey(key)) continue;
    const value = sanitizedPreference(key,localStorage.getItem(key) || 'null'); if (value !== null) result[key] = value;
  }
  return result;
}
function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(''));
}
function fromBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) throw new Error('备份中的单篇 PDF 超过 150 MB。');
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value) || value.indexOf('=') !== -1 && !/^[^=]*={1,2}$/.test(value)) throw new Error('备份中的 PDF 编码已损坏。');
  const decoded = atob(value); return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function limitedBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_ARCHIVE_BYTES) throw new Error('备份解压后超过 1 GB，请分批整理文献库后备份。'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export async function exportBackup(): Promise<{ blob: Blob; fileName: string; paperCount: number }> {
  const records = await getAllRecords(), papers: BackupArchive['papers'] = [];
  for (const { pdf, supplementPdfs, ...paper } of records) {
    const bytes = pdf ? new Uint8Array(pdf) : null;
    const supplements=[];for(const item of paper.supplements||[]){const data=supplementPdfs?.[item.id];if(!data){if(paper.pdfRemoved)continue;throw new Error('补充材料缺少原始 PDF：'+item.title);}const bytes=new Uint8Array(data);supplements.push({id:item.id,pdf:toBase64(bytes),pdfSha256:await sha256(bytes)});}
    papers.push({ supplements, paper: cleanValue(paper) as Paper, pdf: bytes ? toBase64(bytes) : null, ...(bytes ? { pdfSha256: await sha256(bytes) } : {}) });
  }
  let jobs: BackupArchive['jobs'];
  try {
    const response = await fetch('/api/jobs/archive', { redirect: 'error' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    jobs = cleanValue(await response.json()) as BackupArchive['jobs']; assertJobs(jobs);
  } catch (error) { throw new Error(`后台任务档案无法读取，完整备份尚未生成。请保持本机服务开启后重试：${(error as Error).message}`); }
  const archive: BackupArchive = { format: 'paperlens-backup', version: 1, createdAt: new Date().toISOString(), papers, local: safeSettings(), jobs };
  const raw = new Blob([JSON.stringify(archive)], { type: 'application/json' });
  if (raw.size > MAX_ARCHIVE_BYTES) throw new Error('文献库备份超过 1 GB，当前版本暂不支持此大小。');
  const compressed = typeof CompressionStream !== 'undefined';
  const blob = compressed ? new Blob([Uint8Array.from(await limitedBytes(raw.stream().pipeThrough(new CompressionStream('gzip')))).buffer], { type: 'application/gzip' }) : raw;
  return { blob, fileName: `PaperRead-${new Date().toISOString().slice(0, 10)}.paperlens${compressed ? '.gz' : '.json'}`, paperCount: papers.length };
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function assertJobs(value: unknown): void {
  if (!object(value) || value.format !== 'paperlens-jobs' || value.version !== 1 || typeof value.exportedAt !== 'number' || !Array.isArray(value.records) || value.records.some(record => !object(record) || !object(record.job) || typeof record.job.id !== 'string' || !object(record.input) || !Array.isArray(record.checkpoints))) throw new Error('备份中的后台任务档案格式错误。');
}
function assertAnalysis(value: unknown): void {
  if (!object(value) || typeof value.title !== 'string' || typeof value.overview !== 'string' || !Array.isArray(value.sections) || !Array.isArray(value.limitations) || value.limitations.some(item => typeof item !== 'string')) throw new Error('备份中的解析正文格式错误。');
  const sectionIds = new Set<string>();
  for (const section of value.sections) {
    if (!object(section) || ['id', 'title', 'shortTitle', 'summary', 'proves', 'markdown'].some(key => typeof section[key] !== 'string') || !Number.isInteger(section.page) || !Array.isArray(section.figures) || sectionIds.has(section.id as string)) throw new Error('备份中的解析章节格式错误。');
    sectionIds.add(section.id as string);
    for (const figure of section.figures) {
      if (!object(figure) || ['id', 'title', 'caption'].some(key => typeof figure[key] !== 'string') || !Number.isInteger(figure.page) || !Array.isArray(figure.panels)) throw new Error('备份中的图片说明格式错误。');
      for (const panel of figure.panels) if (!object(panel) || ['label', 'type', 'xAxis', 'yAxis', 'explanation', 'evidence'].some(key => typeof panel[key] !== 'string')) throw new Error('备份中的子图解析格式错误。');
    }
  }
  if (value.evidenceTable !== undefined && (!Array.isArray(value.evidenceTable) || value.evidenceTable.some(row => !object(row) || ['id', 'label', 'value'].some(key => typeof row[key] !== 'string')))) throw new Error('备份中的专用证据表格式错误。');
  if (value.logic !== undefined && (!object(value.logic) || !Array.isArray(value.logic.nodes) || !Array.isArray(value.logic.edges) || value.logic.nodes.some(node => !object(node) || ['id', 'title', 'sectionId'].some(key => typeof node[key] !== 'string')) || value.logic.edges.some(edge => !object(edge) || ['id', 'from', 'to'].some(key => typeof edge[key] !== 'string')))) throw new Error('备份中的研究逻辑图格式错误。');
}
function assertPaper(paper: unknown): asserts paper is Paper {
  if (!object(paper) || typeof paper.id !== 'string' || !paper.id || paper.id.length > 200 || typeof paper.title !== 'string' || typeof paper.fileName !== 'string' || typeof paper.folderId !== 'string' || typeof paper.notes !== 'string' || typeof paper.starred !== 'boolean' || typeof paper.addedAt !== 'number' || !Number.isFinite(paper.addedAt) || !Number.isInteger(paper.pageCount) || (paper.pageCount as number) < 1 || (paper.pageCount as number) > 10000 || !Array.isArray(paper.pages) || paper.pages.some(page => typeof page !== 'string') || !Array.isArray(paper.outline) || paper.outline.some(item => !object(item) || typeof item.title !== 'string' || !Number.isInteger(item.page)) || !CATEGORIES.includes(paper.category as string)) throw new Error('备份中的文献资料格式不完整，未写入任何内容。');
  for(const key of ['folderIds','relatedPaperIds','mergedPaperIds'])if(paper[key]!==undefined&&(!Array.isArray(paper[key])||(paper[key] as unknown[]).some(x=>typeof x!=='string')))throw new Error('备份中的文献分组格式错误。');
  if(paper.mergedInto!==undefined&&typeof paper.mergedInto!=='string')throw new Error('备份中的合并标识格式错误。');
  if (paper.analysis !== undefined) assertAnalysis(paper.analysis);
  if(paper.authorProfile!==undefined&&(!object(paper.authorProfile)||['paperTitle','name','firstInstitution','country','direction','status'].some(k=>typeof (paper.authorProfile as Record<string,unknown>)[k]!=='string')||!Number.isFinite(paper.authorProfile.checkedAt)||!Array.isArray(paper.authorProfile.honors)||paper.authorProfile.honors.some(x=>typeof x!=='string')||!Array.isArray(paper.authorProfile.sources)||paper.authorProfile.sources.some(x=>!object(x)||typeof x.title!=='string'||typeof x.url!=='string'||!x.url.startsWith('https://'))))throw new Error('备份中的作者资料格式错误。');
  if(paper.integrity!==undefined&&(!object(paper.integrity)||!Number.isFinite(paper.integrity.checkedAt)||typeof paper.integrity.identifier!=='string'||!['notice','no-notice','unavailable'].includes(paper.integrity.status as string)||!Array.isArray(paper.integrity.notices)||paper.integrity.notices.some(n=>!object(n)||['type','title','url','source'].some(k=>typeof n[k]!=='string')||!(n.url as string).startsWith('https://'))))throw new Error('备份中的撤稿记录格式错误。');
  if(paper.titleTranslation!==undefined&&(!object(paper.titleTranslation)||typeof paper.titleTranslation.original!=='string'||typeof paper.titleTranslation.text!=='string'||!['codex','deepseek'].includes(paper.titleTranslation.provider as string)||!Number.isFinite(paper.titleTranslation.createdAt)))throw new Error('备份中的标题翻译格式错误。');
  for(const key of ['citationCount','citationUpdatedAt'])if(paper[key]!==undefined&&(!Number.isSafeInteger(paper[key])||(paper[key] as number)<0))throw new Error('备份中的引用数据格式错误。');
  if (paper.issns !== undefined && (!Array.isArray(paper.issns) || paper.issns.some(x=>typeof x!=='string'||!/^\d{4}-\d{3}[\dX]$/i.test(x)))) throw new Error('备份中的 ISSN 格式错误。');
  if (paper.tags !== undefined && (!Array.isArray(paper.tags) || paper.tags.some(tag => typeof tag !== 'string'))) throw new Error('备份中的标签格式错误。');
  if (paper.readingStatus !== undefined && !['unread', 'reading', 'done'].includes(paper.readingStatus as string)) throw new Error('备份中的阅读状态格式错误。');
  for (const key of ['doi', 'pmid', 'authors', 'journal', 'year', 'fileHash', 'officialUrl']) if (paper[key] !== undefined && typeof paper[key] !== 'string') throw new Error('备份中的文献资料格式错误。');
  if(paper.supplements!==undefined){if(!Array.isArray(paper.supplements)||paper.supplements.some(s=>!object(s)||['id','title','fileName'].some(k=>typeof s[k]!=='string')||!Number.isInteger(s.pageCount)||(s.pageCount as number)<1||!Array.isArray(s.pages)||s.pages.some(x=>typeof x!=='string'))||new Set(paper.supplements.map(s=>(s as Record<string,unknown>).id)).size!==paper.supplements.length)throw new Error('补充材料资料格式错误。');}
  if(paper.supplementLinks!==undefined&&(!Array.isArray(paper.supplementLinks)||paper.supplementLinks.some(s=>!object(s)||['id','reference','documentId'].some(k=>typeof s[k]!=='string')||!Number.isInteger(s.page)||(s.page as number)<1||!['main',...((paper.supplements||[]) as {id:string}[]).map(x=>x.id)].includes(s.documentId as string))))throw new Error('补充材料图页关联格式错误。');
  if (paper.revisions !== undefined) {
    if (!Array.isArray(paper.revisions)) throw new Error('备份中的修订记录格式错误。');
    for (const revision of paper.revisions) { if (!object(revision) || typeof revision.id !== 'string' || typeof revision.label !== 'string' || typeof revision.createdAt !== 'number') throw new Error('备份中的修订记录格式错误。'); assertAnalysis(revision.analysis); }
  }
}
export async function inspectBackup(file: File | Blob): Promise<BackupArchive> {
  if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new Error('请选择有效备份文件（最大 1 GB）。');
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let bytes: Uint8Array;
  try { bytes = await limitedBytes(header[0] === 0x1f && header[1] === 0x8b ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream()); }
  catch (error) { throw new Error((error as Error).message.includes('1 GB') ? (error as Error).message : '备份压缩文件无法读取，可能已损坏。'); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('不是有效的 PaperRead 备份文件。'); }
  return validateArchive(value);
}
function validateArchive(value: unknown): BackupArchive {
  if (!object(value) || value.format !== 'paperlens-backup' || value.version !== 1) throw new Error('备份版本不受支持，请使用 PaperRead 导出的备份。');
  if (!Array.isArray(value.papers) || value.papers.length > 10000 || !object(value.local) || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw new Error('备份清单格式错误。');
  if (value.jobs !== undefined) assertJobs(value.jobs);
  const ids = new Set<string>();
  for (const entry of value.papers) {
    if (!object(entry)) throw new Error('文献记录格式错误。'); assertPaper(entry.paper);
    if (ids.has(entry.paper.id)) throw new Error('备份中存在重复的文献编号。'); ids.add(entry.paper.id);
    const attachments=entry.supplements;if(attachments!==undefined&&(!Array.isArray(attachments)||attachments.some(s=>!object(s)||typeof s.id!=='string'||typeof s.pdf!=='string'||!s.pdf.startsWith('JVBERi0')||typeof s.pdfSha256!=='string'||!/^[a-f0-9]{64}$/.test(s.pdfSha256))||new Set(attachments.map(s=>(s as Record<string,unknown>).id)).size!==attachments.length))throw new Error('补充 PDF 备份格式错误。');
    if(!entry.paper.pdfRemoved&&(entry.paper.supplements||[]).some(s=>!(attachments as {id:string}[]|undefined)?.some(x=>x.id===s.id))||(attachments as {id:string}[]|undefined)?.some(x=>!(entry.paper as Paper).supplements?.some(s=>s.id===x.id)))throw new Error('补充材料清单与 PDF 不一致。');
    if (entry.pdf !== null && typeof entry.pdf !== 'string') throw new Error('备份中 PDF 数据格式错误。');
    if (typeof entry.pdf === 'string' && !entry.pdf.startsWith('JVBERi0')) throw new Error('备份中的 PDF 文件头无效。');
    if (entry.pdfSha256 !== undefined && (typeof entry.pdfSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.pdfSha256))) throw new Error('PDF 完整性校验格式错误。');
  }
  const local: Record<string, string> = Object.create(null);
  for (const [key, raw] of Object.entries(value.local)) {
    if (!safeLocalKey(key)) continue;
    if (typeof raw !== 'string') throw new Error('备份中的偏好设置格式错误。');
    const cleaned = sanitizedPreference(key,raw); if (cleaned === null) throw new Error('备份中的偏好设置无法读取。'); local[key] = cleaned;
  }
  // Imported running tasks cannot reconnect to a different computer's service.
  // Keep their summary/checkpoint but surface them as paused for an explicit retry.
  if (local['pl-jobs']) {
    const jobs = JSON.parse(local['pl-jobs']);
    if (Array.isArray(jobs)) local['pl-jobs'] = JSON.stringify(jobs.map(job => object(job) && ['running', 'queued'].includes(job.status as string) ? { ...job, status: 'paused', message: '从备份恢复，请重新加入解析队列' } : job));
  }
  return { format: 'paperlens-backup', version: 1, createdAt: value.createdAt, papers: cleanValue(value.papers) as BackupArchive['papers'], local, ...(value.jobs ? { jobs: cleanValue(value.jobs) as BackupArchive['jobs'] } : {}) };
}
export async function previewBackup(archive: BackupArchive): Promise<BackupPreview> {
  const existing = new Set((await listPapers(true)).map(p => p.id));
  return { paperCount: archive.papers.length, pdfCount: archive.papers.reduce((n,p)=>n+(p.pdf!==null?1:0)+(p.supplements?.length||0),0), annotationCount: Object.keys(archive.local).filter(k => k.startsWith('paperlens-pdf-')&&k!=='paperlens-pdf-mode').length, chatCount: Object.keys(archive.local).filter(k => k.startsWith('pl-chat-')).length, conflictCount: archive.papers.filter(p => existing.has(p.paper.id)).length, missingPdfCount: archive.papers.filter(p => p.pdf === null && !p.paper.demo).length, byteCount: archive.papers.reduce((n, p) => n + ((p.pdf?.length || 0)+(p.supplements||[]).reduce((n,s)=>n+s.pdf.length,0)) * 0.75, 0), createdAt: archive.createdAt, jobCount: archive.jobs?.records.length || 0 };
}
function mergeSecrets(current: unknown, incoming: unknown): unknown {
  if (!object(current) || !object(incoming)) return incoming;
  const result: Record<string, unknown> = { ...incoming };
  for (const [key, value] of Object.entries(current)) {
    if (forbiddenKey.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key)) result[key] = value;
    else if (object(value) && !['__proto__', 'prototype', 'constructor'].includes(key)) {
      const restored = mergeSecrets(value, object(result[key]) ? result[key] : {}) as Record<string, unknown>;
      if (Object.keys(restored).length) result[key] = restored;
    }
  }
  return result;
}
function mergeFolders(current: string | null, incoming: string, replace: boolean): string {
  const incomingFolders = JSON.parse(incoming), currentFolders = current ? JSON.parse(current) : [];
  if (!Array.isArray(incomingFolders) || !Array.isArray(currentFolders) || incomingFolders.some(f => !object(f) || typeof f.id !== 'string' || typeof f.name !== 'string')) throw new Error('备份的文献分区格式错误。');
  const merged = new Map<string, Folder>();
  for (const folder of replace ? [...currentFolders, ...incomingFolders] : [...incomingFolders, ...currentFolders]) merged.set(folder.id, folder);
  return JSON.stringify([...merged.values()]);
}
export async function restoreBackup(input: BackupArchive, options: { conflicts: 'skip' | 'replace' } = { conflicts: 'skip' }): Promise<RestoreResult> {
  const archive = validateArchive(input), existing = await getAllRecords(), ids = new Set(existing.map(p => p.id));
  const selected = archive.papers.filter(entry => options.conflicts === 'replace' || !ids.has(entry.paper.id));
  const records: PaperRecord[] = [];
  // Validate every PDF before the first write, including records skipped by policy.
  for (const entry of archive.papers) {
    const bytes = entry.pdf === null ? undefined : fromBase64(entry.pdf);
    if (bytes && entry.pdfSha256 && await sha256(bytes) !== entry.pdfSha256) throw new Error(`「${entry.paper.title}」的 PDF 校验失败，未恢复任何内容。`);
    const supplementPdfs:Record<string,Uint8Array>={};for(const s of entry.supplements||[]){const bytes=fromBase64(s.pdf);if(await sha256(bytes)!==s.pdfSha256)throw new Error('补充材料 PDF 校验失败，未恢复任何内容。');supplementPdfs[s.id]=bytes;}
    if (selected.includes(entry)) records.push({ ...entry.paper, supplementPdfs, ...(bytes ? { pdf: bytes } : {}) });
  }
  const before = new Map<string, string | null>(), changes = new Map<string, string>();
  const selectedIds = new Set(records.map(p => p.id)), skippedIds = new Set(archive.papers.filter(p => !selectedIds.has(p.paper.id)).map(p => p.paper.id));
  for (const [key, raw] of Object.entries(archive.local)) {
    if(key==='pl-auto-backup-status')continue;
    const current = localStorage.getItem(key);
    if ([...skippedIds].some(id => key === `pl-chat-${id}` || key.endsWith(`-${id}`))) continue;
    if (key === 'pl-folders') { changes.set(key, mergeFolders(current, raw, options.conflicts === 'replace')); continue; }
    if (options.conflicts === 'skip' && current !== null) continue;
    changes.set(key,['paperlens-pdf-mode','paperlens-highlight-color'].includes(key)?raw:current ? JSON.stringify(mergeSecrets(JSON.parse(current), JSON.parse(raw))) : raw);
  }
  const database = await db();
  try {
    for (const [key, value] of changes) { before.set(key, localStorage.getItem(key)); localStorage.setItem(key, value); }
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('papers', 'readwrite'), store = tx.objectStore('papers');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('文献写入被中止'));
      try { for (const record of records) store.put(record); } catch (error) { tx.abort(); reject(error); }
    });
  } catch (error) {
    try {
      // Release all newly written preference values before rebuilding the old set, including when storage is full.
      for (const key of before.keys()) localStorage.removeItem(key);
      for (const [key, value] of before) if (value !== null) localStorage.setItem(key, value);
    } catch { throw new Error(`文献写入未完成，原有 PDF 与解析仍保留；部分阅读设置回滚失败，请使用恢复前备份恢复设置。原因：${(error as Error).message || '本机存储空间不足'}`); }
    throw new Error(`恢复未完成，原有文献和设置已保留：${(error as Error).message || '本机存储空间不足'}`);
  }
  const result: RestoreResult = { restored: records.length, skipped: archive.papers.length - records.length, replaced: records.filter(p => ids.has(p.id)).length };
  if (archive.jobs?.records.length) {
    try {
      const response = await fetch('/api/jobs/restore', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archive: archive.jobs, conflicts: options.conflicts }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `服务返回 ${response.status}`);
      result.jobs = data;
    } catch (error) { result.warnings = [`文献、PDF 和阅读设置已恢复；后台任务检查点恢复失败：${(error as Error).message}。请保留此备份，服务恢复后重新导入并选择“保留本机记录”。`]; }
  }
  return result;
}
export function downloadBackup(blob: Blob, fileName: string) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }

/** All records are read and changed in one transaction; payloads and annotations stay untouched. */
export async function organizeLibrary(operation:{kind:'merge';primary:string;ids:string[]}|{kind:'split';id:string}|{kind:'related';id:string;ids:string[]}|{kind:'trash';ids:string[];removePdf:boolean}|{kind:'remove-folder';folderId:string}){
 const database=await db();return new Promise<void>((resolve,reject)=>{const tx=database.transaction('papers','readwrite'),store=tx.objectStore('papers'),r=store.getAll();let failure:unknown;
 r.onsuccess=()=>{try{const all=r.result as PaperRecord[],byId=new Map(all.map(p=>[p.id,p]));
  if(operation.kind==='merge'){
   const primary=byId.get(operation.primary),sources=operation.ids.filter(id=>id!==operation.primary).map(id=>byId.get(id));if(!primary||primary.deletedAt||primary.mergedInto||sources.length<1||sources.some(p=>!p||p.deletedAt||p.mergedInto||p.mergedPaperIds?.length))throw Error('这些记录暂时无法合并，请刷新后重试');
   const values=sources as PaperRecord[];const {paperFolders,withFolders}=organizationHelpers;
   const normalize=(doi:string|undefined)=>(doi||'').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//,'').replace(/^doi:\s*/,'');
   const connected=new Set([primary.id]);let changed=true;while(changed){changed=false;for(const p of values)if(!connected.has(p.id)&&[primary,...values].some(q=>connected.has(q.id)&&(p.fileHash&&p.fileHash===q.fileHash||normalize(p.doi)&&normalize(p.doi)===normalize(q.doi)))){connected.add(p.id);changed=true;}}
   if(values.some(p=>!connected.has(p.id)))throw Error('只允许合并 DOI 或 PDF 指纹相同的文献');
   const updated={...primary,...withFolders([primary,...values].flatMap(paperFolders)),tags:[...new Set([primary,...values].flatMap(p=>p.tags||[]))],mergedPaperIds:[...new Set([...(primary.mergedPaperIds||[]),...values.map(p=>p.id)])]};
   for(const field of ['authors','journal','year','doi','pmid','officialUrl'] as const)if(!updated[field])updated[field]=values.find(p=>p[field])?.[field];
   store.put(updated);for(const source of values)store.put({...source,mergedInto:primary.id});
  }else if(operation.kind==='split'){const p=byId.get(operation.id);if(!p)throw Error('文献已移除');store.put({...p,mergedPaperIds:[]});for(const id of p.mergedPaperIds||[]){const source=byId.get(id);if(source?.mergedInto===p.id){delete source.mergedInto;store.put(source);}}}
  else if(operation.kind==='related'){const p=byId.get(operation.id);if(!p||p.deletedAt)throw Error('文献已移除');const ids=[...new Set(operation.ids.filter(id=>id!==p.id&&byId.has(id)&&!byId.get(id)!.deletedAt&&!byId.get(id)!.mergedInto))];store.put({...p,relatedPaperIds:ids});for(const other of all.filter(q=>q.id!==p.id)){const previous=other.relatedPaperIds||[],next=ids.includes(other.id)?[...new Set([...previous,p.id])]:previous.filter(id=>id!==p.id);if(JSON.stringify(previous)!==JSON.stringify(next))store.put({...other,relatedPaperIds:next});}}
  else if(operation.kind==='remove-folder'){for(const p of all)if(organizationHelpers.paperFolders(p).includes(operation.folderId))store.put({...p,...organizationHelpers.withFolders(organizationHelpers.paperFolders(p).filter(id=>id!==operation.folderId))});}
  else{const ids=new Set(operation.ids);for(const p of all)if(ids.has(p.id)||p.mergedInto&&ids.has(p.mergedInto)){const updated={...p,deletedAt:Date.now(),...(operation.removePdf?{pdf:undefined,supplementPdfs:undefined,pdfRemoved:true}:{} )};store.put(updated);}}
 }catch(e){failure=e;tx.abort();}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||Error('文献整理未完成'));});
}
