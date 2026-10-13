import type { Sheet } from '../model';
import type { PDFPageProxy } from '../pdf';
import { buildWallModel, type WallModel } from './roomFill';
import { extractSegments, type Segment } from './vectors';

/**
 * Wall models per sheet. Reading a sheet's linework takes a few seconds on a dense
 * plan, so segments are kept per page and the model is rebuilt only when the scale
 * or the opening size changes.
 */
const segmentCache = new WeakMap<PDFPageProxy, Promise<Segment[]>>();
const modelCache = new WeakMap<PDFPageProxy, Map<string, WallModel>>();

export function segmentsOf(page: PDFPageProxy): Promise<Segment[]> {
  let p = segmentCache.get(page);
  if (!p) {
    p = page.getOperatorList().then((ops) => {
      const vp = page.getViewport({ scale: 1 });
      return extractSegments(ops.fnArray, ops.argsArray, vp.transform as [number, number, number, number, number, number]);
    });
    segmentCache.set(page, p);
  }
  return p;
}

export async function wallModelFor(page: PDFPageProxy, sheet: Sheet, maxOpening: number): Promise<WallModel> {
  const key = `${sheet.metersPerPoint ?? 'none'}|${maxOpening}`;
  let byKey = modelCache.get(page);
  if (!byKey) modelCache.set(page, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const model = buildWallModel(await segmentsOf(page), sheet.metersPerPoint, { maxOpening });
  byKey.set(key, model);
  return model;
}
