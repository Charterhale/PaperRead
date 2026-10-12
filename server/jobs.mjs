import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, credentials, requiredString } from './validation.mjs';
import { prepareAnalysis } from './service.mjs';
import { cleanJobRecord, validateJobArchive } from './job-archive.mjs';

const ACTIVE = new Set(['preparing', 'queued', 'running']);
const EXECUTING = new Set(['queued', 'running']);
const STATUSES = new Set(['preparing', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);
const ID = /^[0-9a-f-]{36}$/;

// The persisted record contains only an allowlisted paper input, completed
// chunks, and a public status. Keys and abort controllers live in RAM only.
export function createJobManager({ directory, services, environmentKey = '', concurrency = 1 }) {
  const records = new Map();
  const secrets = new Map();
  const workers = new Map();
  const writes = new Map();
  const mutations = new Map();
  const restoringIds = new Set();
  let restoreWork = null;
  let closed = false;
  let initialError;
  const maxWorkers = Number.isInteger(concurrency) ? Math.max(1, Math.min(3, concurrency)) : 1;

  function preparation(record) {
    if (record.input.pipelineVersion !== 2) return undefined;
    return {
      expectedPages: [...(record.input.expectedVisualPages || [])],
      receivedPages: record.input.images.map(image => image.page).sort((a, b) => a - b),
    };
  }

  function missingImages(record) {
    const received = new Set(record.input.images.map(image => image.page));
    return (record.input.expectedVisualPages || []).filter(page => !received.has(page));
  }

  function publicJob(record) {
    return structuredClone({ ...record.job, provider: record.input.provider || 'deepseek', model: record.input.model, reasoningEffort: record.input.reasoningEffort||'medium', pipelineVersion: record.input.pipelineVersion,
      ...(preparation(record) ? { preparation: preparation(record) } : {}),
      ...(record.input.visualPlan ? { visualPlan: record.input.visualPlan } : {}),
    });
  }

  // Serialize preparation mutations so a second upload cannot replace pages
  // accepted by the first, and start/cancel cannot race an in-flight save.
  function mutate(id, operation) {
    const previous = mutations.get(id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => { await checkReady(); return operation(getRecord(id)); });
    mutations.set(id, pending);
    void pending.finally(() => { if (mutations.get(id) === pending) mutations.delete(id); }).catch(() => {});
    return pending;
  }

  function persist(record) {
    const id = record.job.id;
    const snapshot = JSON.stringify({ version: 1, job: record.job, input: record.input, checkpoints: record.checkpoints });
    const previous = writes.get(id) || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(directory, `${id}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, path.join(directory, `${id}.json`));
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
    });
    writes.set(id, write);
    return write;
  }

  const recoveryWrites = [];
  if (existsSync(directory)) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5)))) {
      try {
        const record = JSON.parse(readFileSync(path.join(directory, filename), 'utf8'));
        if (record.version !== 1 || record.job?.id !== filename.slice(0, -5) || !STATUSES.has(record.job.status) || !record.input || !Array.isArray(record.checkpoints)) continue;
        // Rebuild the input from its allowlist even when loading old records.
        const { input } = prepareAnalysis({ ...record.input, pipelineVersion: record.input.pipelineVersion ?? 1, apiKey: 'local-recovery-validation-only' }, '', { stage: true });
        record.input = input;
        records.set(record.job.id, record);
        if (EXECUTING.has(record.job.status)) {
          record.job.status = 'paused';
          record.job.message = '上次解析已暂停，使用已保存的片段继续';
          record.job.updatedAt = Date.now();
          recoveryWrites.push(persist(record));
        }
      } catch {
        // A damaged record does not prevent the rest of the library opening.
        // Leave that file intact for recovery rather than overwriting it.
      }
    }
  }
  const ready = Promise.all(recoveryWrites).catch(() => { initialError = new ApiError(500, 'JOB_STORAGE_ERROR', '无法保存解析任务，请检查本地磁盘空间和文件权限。'); });

  async function checkReady() {
    await ready;
    if (initialError) throw initialError;
    if (closed) throw new ApiError(503, 'JOBS_CLOSED', '后台解析服务正在关闭。');
  }

  function getRecord(id) {
    if (restoringIds.has(id)) throw new ApiError(409, 'JOB_RESTORING', '这条任务正在从备份恢复，请稍后再操作。');
    const record = records.get(id);
    if (!record) throw new ApiError(404, 'JOB_NOT_FOUND', '找不到这条解析任务。');
    return record;
  }

  function touch(record, changes) {
    Object.assign(record.job, changes, { updatedAt: Date.now() });
  }

  function schedule() {
    if (closed) return;
    for (const record of records.values()) {
      if (workers.size >= maxWorkers) break;
      if (record.job.status !== 'queued' || workers.has(record.job.id)) continue;
      const controller = new AbortController();
      const task = { controller, promise: null };
      workers.set(record.job.id, task);
      task.promise = run(record, controller).finally(() => {
        workers.delete(record.job.id);
        secrets.delete(record.job.id);
        schedule();
      });
    }
  }

  async function run(record, controller) {
    try {
      if (closed || record.job.status !== 'queued') return;
      touch(record, { status: 'running', message: record.checkpoints.length ? '正在从已保存的片段继续' : '正在开始解析' });
      await persist(record);
      const result = await services.analyze({ ...record.input, apiKey: secrets.get(record.job.id) }, controller.signal, {
        checkpoints: record.checkpoints,
        onCheckpoint: async checkpoints => {
          if (!records.has(record.job.id)) return;
          record.checkpoints = structuredClone(checkpoints);
          await persist(record);
        },
        onProgress: async (progress, message) => {
          if (record.job.status !== 'running') return;
          // 100 is reserved for a fully persisted, usable result.
          touch(record, { progress: Math.min(progress, 99), message });
          await persist(record);
        },
      });
      if (controller.signal.aborted || record.job.status !== 'running') return;
      const completed = { ...record, checkpoints: [], job: { ...record.job, status: 'completed', progress: 100, message: '解析完成', result, updatedAt: Date.now() } };
      // Publish completion only after the final document is durable. If a
      // cancellation arrives during the write, its later write wins and the
      // cancelled job is never changed back to completed in memory.
      await persist(completed);
      if (controller.signal.aborted || record.job.status !== 'running') return;
      record.job = completed.job;
      record.checkpoints = [];
    } catch (error) {
      secrets.delete(record.job.id);
      if (record.job.status !== 'running') return;
      const message = error instanceof ApiError ? error.message : '本地任务未能完成；已保存的片段会在重试时继续使用。';
      touch(record, { status: 'failed', message: '解析未完成，可从已保存的片段重试', error: message });
      await persist(record).catch(() => {});
    }
  }

  return {
    async create(body, { stage = false } = {}) {
      await checkReady();
      if (restoreWork) throw new ApiError(409, 'JOB_RESTORE_BUSY', '正在恢复任务备份，请稍后再创建解析任务。');
      const paperId = requiredString(body.paperId, '文献标识', 200);
      if (stage && body.pipelineVersion !== 2) throw new ApiError(400, 'INVALID_PIPELINE', '分批准备任务需要新版解析流程。');
      if (stage && (!body.visualPlan || !Array.isArray(body.expectedVisualPages))) throw new ApiError(400, 'VISUAL_PLAN_REQUIRED', '分批解析前需要先完成全文页面识别。');
      const { input, auth } = prepareAnalysis(body, environmentKey, { stage });
      const existing = [...records.values()].find(record => record.job.paperId === paperId && ACTIVE.has(record.job.status));
      if (existing) throw new ApiError(409, 'JOB_ALREADY_ACTIVE', '这篇文献已有待处理任务，请先完成或取消。');
      if (records.size >= 200) throw new ApiError(409, 'JOB_LIMIT', '任务记录已达 200 条，请清理已完成任务后继续。');
      const now = Date.now();
      const job = { id: randomUUID(), paperId, title: input.title || '未命名文献', status: stage ? 'preparing' : 'queued', progress: 0, message: stage ? `正在准备页面图片（${input.images.length}/${input.expectedVisualPages.length}）` : '等待后台解析', createdAt: now, updatedAt: now };
      const record = { job, input, checkpoints: [] };
      records.set(job.id, record);
      secrets.set(job.id, auth.apiKey);
      try { await persist(record); }
      catch { records.delete(job.id); secrets.delete(job.id); throw new ApiError(500, 'JOB_STORAGE_ERROR', '无法保存解析任务，请检查本地磁盘空间。'); }
      const response = publicJob(record);
      schedule();
      return response;
    },
    async upload(id, body) {
      return mutate(id, async record => {
        if (record.job.status !== 'preparing' || record.input.pipelineVersion !== 2) throw new ApiError(409, 'JOB_NOT_PREPARING', '此任务当前不能接收图片，请先恢复图片准备。');
        if (!Array.isArray(body.images) || !body.images.length || body.images.length > 4) throw new ApiError(400, 'INVALID_UPLOAD_BATCH', '每批请上传 1 至 4 张页面图片。');
        let bytes = 0;
        const received = new Map(record.input.images.map(image => [image.page, image]));
        const expected = new Set(record.input.expectedVisualPages);
        for (const image of body.images) {
          if (!image || !Number.isInteger(image.page) || !expected.has(image.page)) throw new ApiError(400, 'UNEXPECTED_IMAGE_PAGE', '上传图片页码不在本任务的读图计划内。');
          if (typeof image.dataUrl !== 'string') throw new ApiError(400, 'INVALID_IMAGE', '页面图片格式无效。');
          bytes += Buffer.byteLength(image.dataUrl.split(',')[1] || '', 'base64');
          if (bytes > 8 * 1024 * 1024) throw new ApiError(413, 'UPLOAD_BATCH_TOO_LARGE', '本批图片超过 8 MiB，请分成更小批次继续上传。已保存的页面不受影响。');
          const previous = received.get(image.page);
          if (previous && previous.dataUrl !== image.dataUrl) throw new ApiError(409, 'IMAGE_PAGE_CONFLICT', `第 ${image.page} 页已有不同图片，请保留原任务或重新创建解析任务。`);
          received.set(image.page, { page: image.page, dataUrl: image.dataUrl });
        }
        const { input } = prepareAnalysis({ ...record.input, images: [...received.values()].sort((a, b) => a.page - b.page), apiKey: 'local-upload-validation-only' }, '', { stage: true });
        const changed = { ...record, input, job: { ...record.job, message: `正在准备页面图片（${input.images.length}/${input.expectedVisualPages.length}）`, updatedAt: Date.now() } };
        await persist(changed);
        record.input = changed.input;
        record.job = changed.job;
        return publicJob(record);
      });
    },
    async start(id, body = {}) {
      return mutate(id, async record => {
        if (record.job.status !== 'preparing') throw new ApiError(409, 'JOB_NOT_PREPARING', '此任务未处于图片准备阶段。');
        const missing = missingImages(record);
        if (missing.length) throw new ApiError(409, 'VISUAL_PAGES_MISSING', `尚有 ${missing.length} 页图片未上传（第 ${missing.join('、')} 页），已保存当前进度，补齐后才能开始解析。`);
        const { input, auth } = prepareAnalysis({ ...record.input, apiKey: body.apiKey || secrets.get(id) }, environmentKey);
        const changed = { ...record, input, job: { ...record.job, status: 'queued', message: '页面图片已齐备，等待后台解析', updatedAt: Date.now() } };
        delete changed.job.error;
        await persist(changed);
        record.input = changed.input;
        record.job = changed.job;
        secrets.set(id, auth.apiKey);
        const response = publicJob(record);
        schedule();
        return response;
      });
    },
    async list() {
      await checkReady();
      return [...records.values()].sort((a, b) => b.job.createdAt - a.job.createdAt).map(publicJob);
    },
    async archive() {
      await checkReady();
      return { format: 'paperlens-jobs', version: 1, exportedAt: Date.now(), records: [...records.values()].map(record => cleanJobRecord(record)) };
    },
    async restore(body) {
      await checkReady();
      if (!['skip', 'replace'].includes(body.conflicts)) throw new ApiError(400, 'INVALID_CONFLICT_POLICY', '请选择跳过或覆盖重复任务。');
      // Fully validate first: a malformed later record cannot leave the first
      // few records silently imported.
      const imported = validateJobArchive(body.archive);
      if (restoreWork) throw new ApiError(409, 'JOB_RESTORE_BUSY', '正在恢复另一份任务备份，请稍后再试。');
      const planned = [];
      const counts = { restored: 0, skipped: 0, replaced: 0 };
      for (const record of imported) {
        const previous = records.get(record.job.id);
        if (previous && (body.conflicts === 'skip' || ACTIVE.has(previous.job.status) || workers.has(record.job.id))) { counts.skipped += 1; continue; }
        planned.push({ record, previous });
        counts[previous ? 'replaced' : 'restored'] += 1;
      }
      if (records.size + counts.restored > 200) throw new ApiError(409, 'JOB_LIMIT', '恢复后任务记录将超过 200 条，请先清理已完成任务。');
      for (const { record } of planned) restoringIds.add(record.job.id);
      restoreWork = (async () => {
        const written = [];
        try {
          for (const item of planned) {
            await persist(item.record);
            written.push(item);
          }
          for (const { record } of planned) {
            secrets.delete(record.job.id);
            records.set(record.job.id, record);
          }
          return counts;
        } catch {
          let rollbackFailed = false;
          for (const { record, previous } of written.reverse()) {
            try {
              if (previous) await persist(previous);
              else await rm(path.join(directory, `${record.job.id}.json`), { force: true });
            } catch { rollbackFailed = true; }
          }
          throw new ApiError(500, 'JOB_RESTORE_FAILED', rollbackFailed ? '磁盘写入失败，部分任务文件无法回滚。请保留备份并检查本地磁盘。' : '无法写入任务备份，已回滚本次恢复。请检查本地磁盘空间。');
        }
      })();
      try { return await restoreWork; }
      finally { for (const { record } of planned) restoringIds.delete(record.job.id); restoreWork = null; }
    },
    async get(id) { await checkReady(); return publicJob(getRecord(id)); },
    async cancel(id) {
      return mutate(id, async record => {
        if (record.job.status === 'completed' || record.job.status === 'cancelled') return publicJob(record);
        touch(record, { status: 'cancelled', message: '已取消；已保存的页面图片和片段可在重试时恢复' });
        workers.get(id)?.controller.abort();
        secrets.delete(id);
        await persist(record);
        return publicJob(record);
      });
    },
    async retry(id, body = {}) {
      return mutate(id, async record => {
        if (EXECUTING.has(record.job.status) || record.job.status === 'completed') throw new ApiError(409, 'JOB_NOT_RETRYABLE', '这条任务正在处理或已经完成。');
        if ([...records.values()].some(other => other !== record && other.job.paperId === record.job.paperId && ACTIVE.has(other.job.status))) throw new ApiError(409, 'JOB_ALREADY_ACTIVE', '这篇文献已有待处理任务，请先完成或取消。');
        const auth = credentials({ apiKey: body.apiKey || secrets.get(id), model: record.input.model, provider: record.input.provider, reasoningEffort: record.input.reasoningEffort }, environmentKey);
        const previous = workers.get(id)?.promise;
        if (previous) await previous;
        const preparing = record.job.status === 'preparing' || missingImages(record).length > 0;
        touch(record, { status: preparing ? 'preparing' : 'queued', message: preparing ? `继续准备页面图片（${record.input.images.length}/${record.input.expectedVisualPages.length}）` : record.checkpoints.length ? '等待继续已保存的片段' : '等待重新解析' });
        delete record.job.error;
        secrets.set(id, auth.apiKey);
        await persist(record);
        const response = publicJob(record);
        schedule();
        return response;
      });
    },
    async remove(id) {
      return mutate(id, async record => {
        touch(record, { status: 'cancelled', message: '已删除' });
        workers.get(id)?.controller.abort();
        secrets.delete(id);
        const running = workers.get(id)?.promise;
        if (running) await running;
        await writes.get(id)?.catch(() => {});
        await rm(path.join(directory, `${id}.json`), { force: true });
        records.delete(id);
        writes.delete(id);
        return { ok: true };
      });
    },
    async close() {
      closed = true;
      await ready;
      if (restoreWork) await restoreWork.catch(() => {});
      await Promise.allSettled([...mutations.values()]);
      const paused = [];
      for (const record of records.values()) {
        if (!EXECUTING.has(record.job.status)) continue;
        touch(record, { status: 'paused', message: '已暂停，重新打开软件后可继续解析' });
        workers.get(record.job.id)?.controller.abort();
        paused.push(persist(record));
      }
      secrets.clear();
      await Promise.allSettled([...paused, ...[...workers.values()].map(worker => worker.promise)]);
      // A just-created preparing job has no worker to await. Finish its first
      // durable save as well before Electron is allowed to quit.
      await Promise.allSettled([...writes.values()]);
    },
  };
}
