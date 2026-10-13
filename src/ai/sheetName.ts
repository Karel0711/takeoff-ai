import { getSample } from '../host';
import type { PDFPageProxy } from '../pdf';
import { askClaudeJson, getApiKey } from './claude';

const PROMPT = `These images are the title block of one sheet of a construction drawing set: the right-hand strip and the bottom strip of the sheet.
Read the sheet number (for example A6.1, S2.0, M-101) as printed in the title block, and the drawing title.
Reply with only one JSON object: {"number": "A6.1", "title": "REFLECTED CEILING PLANS"}. Use null for anything you cannot read clearly.`;

/** Renders part of a page (sheet points) to a PNG, at most `maxPx` on its long side. */
async function renderRegion(page: PDFPageProxy, x0: number, y0: number, w: number, h: number, maxPx: number): Promise<Blob> {
  const scale = maxPx / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  await page.render({ canvas, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale] }).promise;
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the sheet.'))), 'image/png'));
}

export interface SheetName {
  number: string | null;
  title: string | null;
}

/** Whether Claude can be asked from here: the hosted page's account, or an API key. */
export async function canAskClaude(): Promise<boolean> {
  return !!(await getSample()) || !!getApiKey();
}

/**
 * Reads a sheet's number and title from its title block with Claude, for sheets whose
 * text is drawn as outlines (no text layer to read).
 */
export async function readSheetName(page: PDFPageProxy, signal?: AbortSignal): Promise<SheetName> {
  const { width, height } = page.getViewport({ scale: 1 });
  const images = [
    await renderRegion(page, width * 0.78, 0, width * 0.22, height, 1500),
    await renderRegion(page, 0, height * 0.86, width, height * 0.14, 1500),
  ];
  const sample = await getSample();
  const raw = sample ? await sample.json<SheetName>(PROMPT, { signal, images, modelTier: 'default' }) : await askClaudeJson<SheetName>(PROMPT, images, signal);
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { number: clean(raw?.number), title: clean(raw?.title) };
}
