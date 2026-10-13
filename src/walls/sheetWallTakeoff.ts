import type { Sheet } from '../model';
import type { PDFPageProxy } from '../pdf';
import { segmentsOf, wallModelFor } from '../fill/sheetWalls';
import { WALL_TAG, type TagText } from './tags';
import { wallTakeoff, type WallTakeoffResult } from './wallTakeoff';

/** Wall type tags on the page, with each text's centre and size in sheet points. */
export async function wallTagTexts(page: PDFPageProxy): Promise<TagText[]> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: TagText[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const code = item.str.trim();
    if (!WALL_TAG.test(code)) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const n = Math.hypot(a, b) || 1;
    const size = Math.hypot(c, d);
    // Centre of the text: half its width along the baseline, a third of its size up.
    const [cx, cy] = vp.convertToViewportPoint(e + (a / n) * (item.width / 2) + (c / (size || 1)) * size * 0.35, f + (b / n) * (item.width / 2) + (d / (size || 1)) * size * 0.35);
    out.push({ code, cx, cy, w: item.width, h: size * 0.7 });
  }
  return out;
}

/** Runs the wall takeoff on a sheet with a known scale. */
export async function sheetWallTakeoff(page: PDFPageProxy, sheet: Sheet, maxOpening: number): Promise<WallTakeoffResult> {
  if (!sheet.metersPerPoint) throw new Error('Set the sheet scale first.');
  const [model, segments, texts] = await Promise.all([wallModelFor(page, sheet, maxOpening), segmentsOf(page), wallTagTexts(page)]);
  return wallTakeoff(model.lines, segments, texts, sheet.metersPerPoint);
}
