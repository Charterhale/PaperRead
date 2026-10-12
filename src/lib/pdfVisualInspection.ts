import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfVisualPage = {
  page: number;
  kind: 'raster' | 'vector' | 'scan' | 'uncertain' | 'text';
  reasons: string[];
};
export type PdfProgress = (completed: number, total: number) => void;

const imageOperations = new Set<number>([
  OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
  OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
]);
const vectorOperations = new Set<number>([
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
  OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  OPS.shadingFill, OPS.rawFillPath,
]);
type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: number[]): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** Inspect actual PDF drawing operations; a prose reference to a figure is not an image. */
export async function inspectDocumentVisualPages(doc: PDFDocumentProxy, onProgress?: PdfProgress): Promise<PdfVisualPage[]> {
  const pages: PdfVisualPage[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
    try {
      page = await doc.getPage(number);
      const [textResult, operatorResult, annotationResult] = await Promise.allSettled([
        page.getTextContent(), page.getOperatorList(), page.getAnnotations({ intent: 'display' }),
      ]);
      const reasons: string[] = [];
      let kind: PdfVisualPage['kind'] = 'text';
      let textLength = 0;
      if (textResult.status === 'fulfilled') {
        textLength = textResult.value.items.reduce((length, item) => length + ('str' in item ? item.str.replace(/\s/g, '').length : 0), 0);
      } else reasons.push('文字层检测失败，保留整页图片');
      let imageCount = 0, vectorCount = 0, largestImageArea = 0;
      if (operatorResult.status === 'fulfilled') {
        const { fnArray, argsArray } = operatorResult.value;
        let matrix = identity();
        const stack: Matrix[] = [];
        for (let index = 0; index < fnArray.length; index += 1) {
          const operation = fnArray[index], args = argsArray[index] || [];
          if (operation === OPS.save) stack.push([...matrix]);
          else if (operation === OPS.restore) matrix = stack.pop() || identity();
          else if (operation === OPS.transform && args.length >= 6) matrix = multiply(matrix, args);
          else if (operation === OPS.paintFormXObjectBegin) {
            stack.push([...matrix]);
            if (Array.isArray(args[0]) && args[0].length >= 6) matrix = multiply(matrix, args[0]);
          } else if (operation === OPS.paintFormXObjectEnd) matrix = stack.pop() || identity();
          if (imageOperations.has(operation)) {
            imageCount += 1;
            // PDF images occupy the unit square in their current transformation.
            largestImageArea = Math.max(largestImageArea, Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
          }
          // constructPath embeds the painting operation in PDF.js 5.7. Older
          // versions emit the separate stroke/fill operation. Count either form.
          if (vectorOperations.has(operation) || (operation === OPS.constructPath && args[0] !== OPS.endPath)) vectorCount += 1;
        }
      } else reasons.push('图形绘制层检测失败，保留整页图片');
      if (annotationResult.status === 'rejected') reasons.push('页面批注层检测失败，保留整页图片');
      else if (annotationResult.value.some(annotation => ['Stamp', 'Ink', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Line'].includes(annotation.subtype))) {
        reasons.push('页面包含可见图形批注，保留整页图片');
      }
      if (imageCount) {
        const viewport = page.getViewport({ scale: 1 });
        const fraction = largestImageArea / (viewport.width * viewport.height);
        kind = textLength < 40 || fraction >= 0.55 ? 'scan' : 'raster';
        reasons.push(`检测到 ${imageCount} 个实际位图绘制操作`);
        if (kind === 'scan') reasons.push(textLength < 40 ? '文字层较少，按扫描或图像页面处理' : '存在大面积页面图像，保留扫描原图及 OCR 文字层');
      } else if (vectorCount) {
        kind = 'vector';
        reasons.push(`检测到 ${vectorCount} 个矢量图形绘制操作`);
      } else if (textLength < 40) {
        kind = 'uncertain';
        reasons.push('页面文字不足以确认是纯文字页，保守保留整页图片');
      }
      if (reasons.some(reason => /失败|批注/.test(reason))) kind = 'uncertain';
      if (kind === 'text') reasons.push('具有可读取的文字层，未检测到位图、矢量图或图形批注');
      pages.push({ page: number, kind, reasons });
    } catch (error) {
      pages.push({ page: number, kind: 'uncertain', reasons: [`页面检测失败，保留整页图片：${error instanceof Error ? error.message : String(error)}`] });
    } finally {
      page?.cleanup();
    }
    onProgress?.(number, doc.numPages);
  }
  return pages;
}

export type PdfImageBatchOptions = {
  maxImages?: number;
  maxBytes?: number;
  maxWidth?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: PdfProgress;
};
export type PdfImageBatch = { images: { page: number; dataUrl: string }[]; completed: number; total: number };
export const PDF_IMAGE_BATCH_MAX_BYTES = 8 * 1024 * 1024;
export const PDF_SINGLE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export function throwIfPdfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('已取消 PDF 图片处理', 'AbortError');
}
export function imageDataUrlBytes(dataUrl: string): number {
  const start = dataUrl.indexOf(',') + 1;
  if (start < 1 || !/^data:image\/jpeg;base64,/.test(dataUrl)) throw new Error('无法编码 PDF 页面图片');
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.floor((dataUrl.length - start) * 3 / 4) - padding;
}

/** Batching core separated from browser rendering so byte boundaries are testable. */
export async function* batchDocumentPageImages(
  doc: PDFDocumentProxy,
  pageNumbers: number[],
  render: (doc: PDFDocumentProxy, page: number, options: PdfImageBatchOptions) => Promise<string>,
  options: PdfImageBatchOptions = {},
): AsyncGenerator<PdfImageBatch> {
  const maxImages = Math.min(4, options.maxImages ?? 4);
  const maxBytes = Math.min(PDF_IMAGE_BATCH_MAX_BYTES, options.maxBytes ?? PDF_IMAGE_BATCH_MAX_BYTES);
  if (!Number.isInteger(maxImages) || maxImages < 1 || !Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('PDF 图片批次大小无效');
  for (const number of pageNumbers) {
    if (!Number.isInteger(number) || number < 1 || number > doc.numPages) throw new Error(`PDF 第 ${number} 页不存在，无法读取图片`);
  }
  const seen = new Set<number>();
  for (const number of pageNumbers) {
    if (seen.has(number)) throw new Error(`PDF 图片页码重复：第 ${number} 页`);
    seen.add(number);
  }
  let images: PdfImageBatch['images'] = [], byteCount = 0, completed = 0;
  for (const number of pageNumbers) {
    throwIfPdfAborted(options.signal);
    let dataUrl: string;
    try { dataUrl = await render(doc, number, options); }
    catch (error) {
      throwIfPdfAborted(options.signal);
      throw new Error(`PDF 第 ${number} 页图片读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    throwIfPdfAborted(options.signal);
    const bytes = imageDataUrlBytes(dataUrl);
    if (bytes > Math.min(PDF_SINGLE_IMAGE_MAX_BYTES, maxBytes)) throw new Error(`PDF 第 ${number} 页图片超过单页传输限制，请重试较小的渲染尺寸；该页未被跳过`);
    if (images.length && (images.length >= maxImages || byteCount + bytes > maxBytes)) {
      yield { images, completed, total: pageNumbers.length };
      throwIfPdfAborted(options.signal);
      images = []; byteCount = 0;
    }
    images.push({ page: number, dataUrl }); byteCount += bytes; completed += 1;
    options.onProgress?.(completed, pageNumbers.length);
    if (images.length >= maxImages) {
      yield { images, completed, total: pageNumbers.length };
      throwIfPdfAborted(options.signal);
      images = []; byteCount = 0;
    }
  }
  if (images.length) yield { images, completed, total: pageNumbers.length };
}
