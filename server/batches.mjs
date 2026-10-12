import { createHash } from 'node:crypto';
import { ApiError, LIMITS, chunkPages } from './validation.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const imageBytes = image => Buffer.byteLength(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64');

export function validateVisualPlan(value, pageCount) {
  if (value === undefined) return undefined;
  if (!value || value.version !== 1 || !Array.isArray(value.pages) || value.pages.length !== pageCount) throw new ApiError(400, 'INVALID_VISUAL_PLAN', '页面识别记录需覆盖本文每一页。');
  const seen = new Set();
  const pages = value.pages.map(item => {
    if (!item || !Number.isInteger(item.page) || item.page < 1 || item.page > pageCount || seen.has(item.page) || !['raster', 'vector', 'scan', 'uncertain', 'text'].includes(item.kind) || !Array.isArray(item.reasons) || item.reasons.length > 20 || !item.reasons.every(reason => typeof reason === 'string' && reason.length <= 1_000)) throw new ApiError(400, 'INVALID_VISUAL_PLAN', '页面识别记录不完整或格式不正确。');
    seen.add(item.page);
    return { page: item.page, kind: item.kind, reasons: item.reasons };
  });
  return { version: 1, pages: pages.sort((a, b) => a.page - b.page) };
}

export function validateExpectedVisualPages(value, pages, images, visualPlan) {
  const fallback = visualPlan ? visualPlan.pages.filter(page => page.kind !== 'text').map(page => page.page) : images.map(image => image.page);
  const expected = value ?? fallback;
  if (!Array.isArray(expected) || expected.length > pages.length || expected.some(page => !Number.isInteger(page) || page < 1 || page > pages.length) || new Set(expected).size !== expected.length) throw new ApiError(400, 'INVALID_VISUAL_PAGES', '待解析图像页码列表格式不正确。');
  const planned = new Set(expected);
  if (visualPlan && (fallback.some(page => !planned.has(page)) || expected.some(page => !fallback.includes(page)))) throw new ApiError(400, 'VISUAL_PLAN_MISMATCH', '待上传图片页码与页面识别结果不一致，请重新检查页面。');
  if (images.some(image => !planned.has(image.page))) throw new ApiError(400, 'UNEXPECTED_VISUAL_PAGE', '收到不在页面识别计划内的图片。');
  return [...planned].sort((a, b) => a - b);
}

// A visual page is assigned exactly once, to its first text part, including
// pages whose text layer is empty. Plan identity binds durable checkpoints to
// the exact source content and the model, not merely the number of batches.
export function planAnalysisBatches(input) {
  const { pages, images = [] } = input;
  const pipelineVersion = input.pipelineVersion ?? 2;
  const planId = digest(JSON.stringify({ pipelineVersion, pages, model: input.model, ...(input.reasoningEffort ? {reasoningEffort:input.reasoningEffort}:{}), category: input.category, images: images.map(image => ({ page: image.page, hash: digest(image.dataUrl) })).sort((a, b) => a.page - b.page) }));
  if (pipelineVersion === 1) return { planId, batches: chunkPages(pages).map((chunk, index) => ({ ...chunk, id: `batch-${index + 1}`, imagePages: images.filter(image => chunk.pages.includes(image.page)).map(image => image.page) })) };
  const imagesByPage = new Map(images.map(image => [image.page, image]));
  const batches = [];
  let parts = [], visual = [], characters = 0, bytes = 0;
  const flush = () => {
    if (!parts.length) return;
    batches.push({ id: `batch-${batches.length + 1}`, parts, pages: [...new Set(parts.map(part => part.page))], imagePages: visual, imageBytes: bytes });
    parts = []; visual = []; characters = 0; bytes = 0;
  };
  pages.forEach((text, index) => {
    const totalParts = Math.max(1, Math.ceil(text.length / LIMITS.chunkCharacters));
    for (let part = 0; part < totalParts; part += 1) {
      const value = text.slice(part * LIMITS.chunkCharacters, (part + 1) * LIMITS.chunkCharacters);
      const image = part === 0 ? imagesByPage.get(index + 1) : undefined;
      const addition = image ? imageBytes(image) : 0;
      if (characters + value.length > LIMITS.chunkCharacters || visual.length + Number(Boolean(image)) > LIMITS.batchImages || bytes + addition > LIMITS.batchImageBytes) flush();
      parts.push({ page: index + 1, part: part + 1, totalParts, text: value });
      characters += value.length;
      if (image) { visual.push(index + 1); bytes += addition; }
    }
  });
  flush();
  return { planId, batches };
}

export function buildCoverage(input, plan) {
  const visualPages = input.images.map(image => image.page).sort((a, b) => a - b);
  const visual = new Set(visualPages);
  return {
    pipelineVersion: input.pipelineVersion, planId: plan.planId, totalPages: input.pages.length,
    expectedVisualPages: input.expectedVisualPages, visualPages,
    textOnlyPages: input.pages.map((_, index) => index + 1).filter(page => !visual.has(page)),
    pages: input.pages.map((_, index) => ({ page: index + 1, mode: visual.has(index + 1) ? 'visual' : 'text-only', batchIds: plan.batches.filter(batch => batch.pages.includes(index + 1)).map(batch => batch.id) })),
    batches: plan.batches.map(({ id, pages, imagePages }) => ({ id, pages, imagePages, status: 'completed' })),
  };
}
