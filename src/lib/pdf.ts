import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { CropRegion } from '../types';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { batchDocumentPageImages, imageDataUrlBytes, inspectDocumentVisualPages, PDF_SINGLE_IMAGE_MAX_BYTES, throwIfPdfAborted } from './pdfVisualInspection';
import type { PdfImageBatch, PdfImageBatchOptions, PdfProgress, PdfVisualPage } from './pdfVisualInspection';

export type { PdfImageBatch, PdfImageBatchOptions, PdfVisualPage } from './pdfVisualInspection';

GlobalWorkerOptions.workerSrc = workerUrl;

export function pdfErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/password/i.test(message)) return '这份 PDF 设有密码。请先在「预览」中解锁，并导出不带密码的副本后再导入。';
  if (/invalid pdf|invalidpdf|formaterror/i.test(message)) return '无法读取这份 PDF，它可能已经损坏。请尝试从原始来源重新下载。';
  return `PDF 读取失败：${message}`;
}

export function openPdf(data: Uint8Array) {
  // PDF.js transfers its input buffer to the worker; retain the original for export.
  return getDocument({
    data: data.slice(),
    useSystemFonts: true,
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  });
}

/** Render without relying on the paper currently open in the reader. */
export async function renderPdfPage(data: Uint8Array, number: number, maxWidth = 1500): Promise<string> {
  const task = openPdf(data);
  try { return await renderDocumentPage(await task.promise, number, maxWidth); }
  finally { await task.destroy().catch(() => undefined); }
}

/** Inspect every page, including scans with an OCR text layer and vector-only figures. */
export async function inspectPdfVisualPages(data: Uint8Array, onProgress?: PdfProgress): Promise<PdfVisualPage[]> {
  const task = openPdf(data);
  try { return await inspectDocumentVisualPages(await task.promise, onProgress); }
  finally { await task.destroy().catch(() => undefined); }
}

/** Hold only one small batch of rendered pages; one PDF worker serves the full run. */
export async function* renderPdfImageBatches(data: Uint8Array, pageNumbers: number[], options: PdfImageBatchOptions = {}): AsyncGenerator<PdfImageBatch> {
  throwIfPdfAborted(options.signal);
  const task = openPdf(data);
  const cancel = () => { void task.destroy().catch(() => undefined); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const doc = await task.promise;
    yield* batchDocumentPageImages(doc, pageNumbers, renderBatchPage, options);
  } catch (error) {
    throwIfPdfAborted(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    await task.destroy().catch(() => undefined);
  }
}

async function renderBatchPage(doc: PDFDocumentProxy, number: number, options: PdfImageBatchOptions): Promise<string> {
  throwIfPdfAborted(options.signal);
  const page = await doc.getPage(number);
  const maxWidth = options.maxWidth ?? 2000;
  const quality = options.quality ?? 0.94;
  if (!Number.isFinite(maxWidth) || maxWidth < 320 || maxWidth > 3200 || !Number.isFinite(quality) || quality < 0.5 || quality > 1) {
    page.cleanup();
    throw new Error('PDF 图片渲染尺寸或清晰度无效');
  }
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(maxWidth / base.width, 3200 / base.height) });
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) { canvas.width = 0; canvas.height = 0; page.cleanup(); throw new Error('无法创建页面绘图画布'); }
  const render = page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' });
  const cancel = () => render.cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    throwIfPdfAborted(options.signal);
    await render.promise;
    throwIfPdfAborted(options.signal);
    // No cropping or page omission is used to fit transport limits. Keep the
    // pixel dimensions and lower JPEG compression only when actually required.
    const byteLimit = Math.min(PDF_SINGLE_IMAGE_MAX_BYTES, options.maxBytes ?? PDF_SINGLE_IMAGE_MAX_BYTES);
    let result = canvas.toDataURL('image/jpeg', quality);
    for (const fallbackQuality of [0.88, 0.82, 0.75, 0.68]) {
      if (imageDataUrlBytes(result) <= byteLimit) break;
      if (fallbackQuality < quality) result = canvas.toDataURL('image/jpeg', fallbackQuality);
    }
    return result;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    canvas.width = 0; canvas.height = 0;
    page.cleanup();
  }
}

export async function renderDocumentPage(doc: PDFDocumentProxy, number: number, maxWidth = 1500, region?: CropRegion): Promise<string> {
  const page = await doc.getPage(Math.min(doc.numPages, Math.max(1, Math.round(number))));
  const base = page.getViewport({ scale: 1 });
  const area = region || { x: 0, y: 0, width: 1, height: 1 };
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.x < 0 || area.y < 0 || area.width <= 0 || area.height <= 0 || area.x + area.width > 1.0001 || area.y + area.height > 1.0001) throw new Error('请选择有效的图像范围。');
  // Crop in PDF coordinates and render directly into the small canvas. This keeps
  // tiny labels legible without allocating a giant full-page bitmap first.
  const scale = Math.min(region ? 6 : 2, maxWidth / (base.width * area.width), 2400 / (base.height * area.height));
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width * area.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height * area.height));
  try {
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform: [1, 0, 0, 1, -viewport.width * area.x, -viewport.height * area.y] }).promise;
    return canvas.toDataURL('image/jpeg', 0.94);
  } finally { canvas.width = 0; canvas.height = 0; }
}

async function resolveDestination(doc: PDFDocumentProxy, destination: unknown): Promise<number | null> {
  try {
    const resolved = typeof destination === 'string' ? await doc.getDestination(destination) : destination;
    if (!Array.isArray(resolved) || !resolved.length) return null;
    const first = resolved[0];
    const index = typeof first === 'number' ? first : await doc.getPageIndex(first);
    return index >= 0 && index < doc.numPages ? index + 1 : null;
  } catch { return null; }
}

export async function extractPdf(data: Uint8Array): Promise<{
  pages: string[]; outline: { title: string; page: number }[]; pageCount: number; title: string;
}> {
  const task = openPdf(data);
  let document: PDFDocumentProxy | undefined;
  try {
    document = await task.promise;
    const pages: string[] = [];
    const headingCandidates: { title: string; page: number }[] = [];
    // Preserve explicit page boundaries so every generated claim can cite its source.
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let lastY: number | undefined;
      const parts: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > Math.max(item.height * 0.4, 3) && !parts.at(-1)?.endsWith('\n')) parts.push('\n');
        parts.push(item.str, item.hasEOL ? '\n' : ' ');
        lastY = y;
      }
      const text = parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      pages.push(text);
      for (const line of text.split('\n')) {
        const heading = line.trim().replace(/\s+/g, ' ');
        if (heading.length < 3 || heading.length > 105) continue;
        if (/^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|background|results(?: and discussion)?|discussion|conclusions?|materials and methods|methods|experimental (?:section|procedures)|study design|statistical analysis|references|acknowledg(?:e)?ments|摘要|引言|背景|结果|讨论|结论|材料与方法|方法|参考文献)(?:\s*[:：.]?\s*)$/i.test(heading)) {
          if (!headingCandidates.some(item => item.title.toLowerCase() === heading.toLowerCase())) headingCandidates.push({ title: heading, page: number });
        }
      }
    }
    const outline: { title: string; page: number }[] = [];
    const rawOutline = await document.getOutline().catch(() => null);
    type OutlineItem = { title: string; dest: unknown; items: OutlineItem[] };
    const visit = async (items: OutlineItem[]) => {
      for (const item of items) {
        const page = await resolveDestination(document!, item.dest);
        if (page !== null && item.title.trim()) outline.push({ title: item.title.trim(), page });
        if (item.items?.length) await visit(item.items);
      }
    };
    if (rawOutline) await visit(rawOutline);
    let title = '';
    try {
      const metadata = await document.getMetadata();
      const candidate = (metadata.info as { Title?: string }).Title?.trim();
      if (candidate && !/^(?:untitled|microsoft word|document|unknown)/i.test(candidate)) title = candidate;
    } catch { /* Metadata is optional; readable page text remains usable. */ }
    return { pages, outline: outline.length ? outline : headingCandidates, pageCount: document.numPages, title };
  } catch (error) {
    throw new Error(pdfErrorMessage(error));
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
