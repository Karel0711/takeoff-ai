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

/** The page's text runs, positioned in sheet space (PDF points from the top-left corner). */
export async function pageTextRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [, , c, d, e, f] = item.transform as number[];
    const [x, y] = viewport.convertToViewportPoint(e, f);
    runs.push({ str: item.str, x, y, size: Math.hypot(c, d) });
  }
  return runs;
}

export async function inspectPage(page: PDFPageProxy): Promise<SheetInfo & { width: number; height: number }> {
  const viewport = page.getViewport({ scale: 1 });
  const runs = await pageTextRuns(page);
  return { width: viewport.width, height: viewport.height, ...inspectRuns(runs, viewport.width, viewport.height) };
}

/**
 * Renders the page as a grid of overlapping tiles, each at most `maxPx` on its
 * long edge, so small print stays legible to a vision model. Returns base64 PNGs.
 */
export async function renderTiles(page: PDFPageProxy, cols: number, rows: number, maxPx: number): Promise<string[]> {
  const { width, height } = page.getViewport({ scale: 1 });
  const overlap = 0.04;
  const tileW = width / cols + width * overlap;
  const tileH = height / rows + height * overlap;
  const scale = maxPx / Math.max(tileW, tileH);
  const tiles: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, Math.min(width - tileW, (c * width) / cols - (width * overlap) / 2));
      const y0 = Math.max(0, Math.min(height - tileH, (r * height) / rows - (height * overlap) / 2));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(tileW * scale);
      canvas.height = Math.floor(tileH * scale);
      await page.render({ canvas, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale] })
        .promise;
      tiles.push(canvas.toDataURL('image/png').split(',')[1]);
    }
  }
  return tiles;
}
