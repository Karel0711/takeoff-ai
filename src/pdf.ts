// The legacy build polyfills recent JS features (Math.sumPrecise, Map.getOrInsertComputed) that current browsers lack.
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { inspectRuns, type SheetInfo, type TextRun } from './sheetInfo';

GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** Opens a PDF. pdf.js takes ownership of the bytes it is given, so it gets a copy. */
export function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
}

export async function inspectPage(page: PDFPageProxy): Promise<SheetInfo & { width: number; height: number }> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [, , c, d, e, f] = item.transform as number[];
    const [x, y] = viewport.convertToViewportPoint(e, f);
    runs.push({ str: item.str, x, y, size: Math.hypot(c, d) });
  }
  return { width: viewport.width, height: viewport.height, ...inspectRuns(runs, viewport.width, viewport.height) };
}
