import type { PDFPageProxy } from './pdf';

/** A run of text on the sheet: its centre and size in sheet points. */
export interface PageText {
  str: string;
  cx: number;
  cy: number;
  /** Width along the baseline and the height of its capitals. */
  w: number;
  h: number;
}

/** Every text run on the page, trimmed, positioned by its centre. */
export async function pageTexts(page: PDFPageProxy): Promise<PageText[]> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: PageText[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = item.str.trim();
    if (!str) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const n = Math.hypot(a, b) || 1;
    const size = Math.hypot(c, d) || 1;
    // Centre: half the width along the baseline, a third of the size up.
    const [cx, cy] = vp.convertToViewportPoint(e + (a / n) * (item.width / 2) + (c / size) * size * 0.35, f + (b / n) * (item.width / 2) + (d / size) * size * 0.35);
    out.push({ str, cx, cy, w: item.width, h: size * 0.7 });
  }
  return out;
}
