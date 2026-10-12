import { ApiError, normalizeAnalysis, normalizeEvidenceTable, requiredString } from './validation.mjs';
import { prepareAnalysis } from './service.mjs';
import { buildCoverage, planAnalysisBatches } from './batches.mjs';

export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const STATUSES = new Set(['preparing', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);
const malformed = () => new ApiError(400, 'INVALID_JOB_ARCHIVE', '后台任务备份结构不完整或包含无效内容，未导入任何任务。');
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validTime = value => Number.isSafeInteger(value) && value >= 0;

// Rebuild every level from known fields. Unknown properties (including apiKey,
// headers, authorization and prototype-shaped objects) cannot enter the archive.
function cleanAnalysis(raw, input, chunk, planId) {
  const batchCount = chunk ? 1 : planAnalysisBatches(input).batches.length;
  if (!isObject(raw) || !Array.isArray(raw.sections) || !raw.sections.length || raw.sections.length > (chunk ? 60 : Math.max(1_200, batchCount * 60))) throw malformed();
  const pageCount = input.pages.length;
  const validPage = value => Number.isInteger(value) && value >= 1 && value <= pageCount && (!chunk || chunk.pages.includes(value));
  const ids = new Set();
  for (const section of raw.sections) {
    if (!isObject(section) || !validPage(section.page) || !REFERENCE_ID.test(section.id) || ids.has(section.id) || !Array.isArray(section.figures)) throw malformed();
    ids.add(section.id);
    for (const figure of section.figures) {
      if (!isObject(figure) || !validPage(figure.page) || !REFERENCE_ID.test(figure.id) || ids.has(figure.id)) throw malformed();
      ids.add(figure.id);
    }
  }
  const sections = [];
  let result;
  for (let offset = 0; offset < raw.sections.length; offset += 60) {
    const batch = raw.sections.slice(offset, offset + 60);
    const normalized = normalizeAnalysis({ ...raw, sections: batch, evidenceTable: [], limitations: [] }, pageCount, input.category);
    result ||= normalized;
    for (let index = 0; index < normalized.sections.length; index += 1) {
      normalized.sections[index].id = batch[index].id;
      normalized.sections[index].figures.forEach((figure, figureIndex) => { figure.id = batch[index].figures[figureIndex].id; });
      sections.push(normalized.sections[index]);
    }
  }
  const rows = raw.evidenceTable ?? [];
  if (!Array.isArray(rows) || rows.length > (chunk ? 120 : Math.max(2_400, batchCount * 120))) throw malformed();
  const evidenceTable = [];
  for (let offset = 0; offset < rows.length; offset += 120) {
    evidenceTable.push(...normalizeEvidenceTable(rows.slice(offset, offset + 120), pageCount).map(row => ({ ...row, id: `evidence-${evidenceTable.length + Number(row.id.split('-').at(-1))}` })));
  }
  const limitations = raw.limitations ?? [];
  // Besides 100 model notes, normalizing and localizing can each add one
  // page-location notice per section and figure (60 sections × 80 figures).
  const maxBatchNotices = 100 + 2 * 60 * (1 + 80);
  if (!Array.isArray(limitations) || limitations.length > (chunk ? maxBatchNotices : Math.max(2_000, batchCount * maxBatchNotices + 102))) throw malformed();
  let checkpoint;
  if (chunk && input.pipelineVersion === 2) {
    if (!isObject(raw._batch) || raw._batch.pipelineVersion !== 2 || raw._batch.planId !== planId || raw._batch.batchId !== chunk.id) throw malformed();
    checkpoint = { pipelineVersion: 2, planId, batchId: chunk.id };
  }
  return { ...result, sections, evidenceTable, limitations: limitations.map(value => requiredString(value, '任务备注', 6_000)),
    ...(checkpoint ? { _batch: checkpoint } : {}),
    ...(!chunk && input.pipelineVersion === 2 ? { coverage: buildCoverage(input, planAnalysisBatches(input)) } : {}),
  };
}

export function cleanJobRecord(raw, { restoring = false } = {}) {
  try {
    if (!isObject(raw) || !isObject(raw.job) || !isObject(raw.input)) throw malformed();
    const original = raw.job;
    if (typeof original.id !== 'string' || !JOB_ID.test(original.id) || !STATUSES.has(original.status) || !validTime(original.createdAt) || !validTime(original.updatedAt) || typeof original.progress !== 'number' || !Number.isFinite(original.progress) || original.progress < 0 || original.progress > 100) throw malformed();
    const paperId = requiredString(original.paperId, '文献标识', 200);
    const title = requiredString(original.title, '任务标题', 2_000);
    const message = requiredString(original.message, '任务状态', 2_000);
    if (typeof raw.input.title !== 'string' || typeof raw.input.category !== 'string' || typeof raw.input.model !== 'string' || !Array.isArray(raw.input.images)) throw malformed();
    const allowIncomplete = ['preparing', 'paused', 'cancelled', 'failed'].includes(original.status);
    const { input, chunks, planId } = prepareAnalysis({ ...raw.input, pipelineVersion: raw.input.pipelineVersion ?? 1, apiKey: 'archive-validation-only' }, '', { stage: allowIncomplete });
    const expectedPages = input.expectedVisualPages || [];
    const receivedPages = input.images.map(image => image.page).sort((a, b) => a - b);
    const incomplete = expectedPages.some(page => !receivedPages.includes(page));
    if (incomplete && raw.checkpoints?.length) throw malformed();
    if (!Array.isArray(raw.checkpoints) || raw.checkpoints.length > chunks.length) throw malformed();
    const checkpoints = raw.checkpoints.map((part, index) => cleanAnalysis(part, input, chunks[index], planId));
    const completed = original.status === 'completed';
    if (completed && (!isObject(original.result) || checkpoints.length)) throw malformed();
    const result = completed ? cleanAnalysis(original.result, input) : undefined;
    const status = restoring && !completed ? 'paused' : original.status;
    const job = {
      id: original.id, paperId, title, status,
      progress: completed ? 100 : restoring ? Math.min(99, Math.floor(checkpoints.length / Math.max(1, chunks.length + (chunks.length > 1 ? 1 : 0)) * 100)) : original.progress,
      message: restoring && !completed ? incomplete ? '从备份恢复，等待补齐页面图片' : '从备份恢复，等待继续解析' : message,
      createdAt: original.createdAt, updatedAt: restoring ? Date.now() : original.updatedAt,
      ...(result ? { result } : {}),
      ...(!restoring && typeof original.error === 'string' ? { error: requiredString(original.error, '任务错误说明', 6_000) } : {}),
    };
    return { job, input, checkpoints };
  } catch { throw malformed(); }
}

export function validateJobArchive(value) {
  if (!isObject(value) || value.format !== 'paperlens-jobs' || value.version !== 1 || !validTime(value.exportedAt) || !Array.isArray(value.records) || value.records.length > 200) throw malformed();
  const records = value.records.map(record => cleanJobRecord(record, { restoring: true }));
  if (new Set(records.map(record => record.job.id)).size !== records.length) throw malformed();
  return records;
}
