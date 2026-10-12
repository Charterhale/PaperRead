import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

export async function makeVisualPagesFixture() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const bitmap = createCanvas(120, 80), context = bitmap.getContext('2d');
  context.fillStyle = '#f7f8fc'; context.fillRect(0, 0, 120, 80);
  context.fillStyle = '#6950aa'; context.fillRect(10, 25, 25, 40);
  context.fillStyle = '#309ab0'; context.fillRect(45, 10, 25, 55);
  context.fillStyle = '#222'; context.font = '12px sans-serif'; context.fillText('Figure A', 10, 17);
  const image = await pdf.embedPng(bitmap.toBuffer('image/png'));
  const expected = [];
  for (let number = 1; number <= 36; number += 1) {
    const page = pdf.addPage([400, 540]);
    if ([1, 18, 36].includes(number)) {
      page.drawText('As shown in Figure 2, the results support further study.', { x: 20, y: 500, size: 10, font });
      page.drawText('This is ordinary prose referring to Fig. 3 and Figure 4.', { x: 20, y: 480, size: 10, font });
      expected.push({ page: number, kind: 'text' });
    } else if (number % 4 === 0) {
      page.drawImage(image, { x: 0, y: 0, width: 400, height: 540 });
      expected.push({ page: number, kind: 'scan' });
    } else if (number % 4 === 1) {
      page.drawImage(image, { x: 0, y: 0, width: 400, height: 540 });
      page.drawText('OCR text layer retains selectable words on a scanned page.', { x: 20, y: 500, size: 10, font, opacity: 0 });
      page.drawText('The presence of many words must never remove the page image.', { x: 20, y: 480, size: 10, font, opacity: 0 });
      expected.push({ page: number, kind: 'scan' });
    } else if (number % 4 === 2) {
      page.drawText('A small figure appears on this otherwise ordinary text page.', { x: 20, y: 500, size: 10, font });
      page.drawImage(image, { x: 50, y: 350, width: 30, height: 20 });
      expected.push({ page: number, kind: 'raster' });
    } else {
      page.drawText('Chart data are drawn with PDF vector graphics and no caption.', { x: 20, y: 500, size: 10, font });
      page.drawLine({ start: { x: 50, y: 100 }, end: { x: 50, y: 350 }, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x: 50, y: 100 }, end: { x: 350, y: 100 }, color: rgb(0, 0, 0) });
      page.drawRectangle({ x: 80, y: 100, width: 50, height: 120, color: rgb(.4, .3, .8) });
      page.drawRectangle({ x: 160, y: 100, width: 50, height: 200, color: rgb(.1, .6, .7) });
      expected.push({ page: number, kind: 'vector' });
    }
  }
  return { bytes: await pdf.save(), expected };
}
