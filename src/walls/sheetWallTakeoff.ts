import type { Sheet } from '../model';
import type { PDFDocumentProxy, PDFPageProxy } from '../pdf';
import { segmentsOf, wallModelFor } from '../fill/sheetWalls';
import { pageTexts, type PageText } from '../pageText';
import { WALL_TAG, type TagText } from './tags';
import { CODE, classifyCode, emptySetTypes, listedCodes, mergeSetTypes, readTagLegend, readTypeSheet, type SetTypes } from './setTypes';
import { wallTakeoff, type WallTakeoffResult } from './wallTakeoff';

/**
 * Wall type tags on the page, with each text's centre and size in sheet points. What
 * counts as a wall tag comes from context: the project's wall types, the set's assembly
 * types sheet and symbol legends (`set`), this sheet's own legend, and otherwise the
 * usual wall prefixes. Other codes count only when their leader lands on a wall.
 */
export async function wallTagTexts(page: PDFPageProxy, known: readonly string[] = [], set?: SetTypes): Promise<TagText[]> {
  const vp = page.getViewport({ scale: 1 });
  return tagTextsFrom(await pageTexts(page), known, set, [vp.width, vp.height]);
}

export function tagTextsFrom(texts: PageText[], known: readonly string[] = [], set?: SetTypes, size?: [number, number]): TagText[] {
  // This sheet's own legend adds to the set's; the codes listed in its schedules are no tags.
  const context = mergeSetTypes([set ?? emptySetTypes(), readTagLegend(texts)]);
  const listed = size ? listedCodes(texts, size[0], size[1]) : new Map();
  const out: TagText[] = [];
  for (const t of texts) {
    if (!CODE.test(t.str) || listed.has(t)) continue;
    const c = classifyCode(t.str, context, known, (code) => WALL_TAG.test(code));
    if (!c) continue;
    // W-1 and W1 are the same type.
    const code = t.str.replace('-', '');
    out.push({ code, cx: t.cx, cy: t.cy, w: t.w, h: t.h, ...(c.wall ? (c.confirmed ? { confirmed: true } : {}) : { generic: true }) });
  }
  return out;
}

const setCache = new WeakMap<object, Promise<SetTypes>>();

/**
 * What the drawing set says its type codes are (assembly types sheets and symbol
 * legends), read once per drawing file from every sheet's text.
 */
export function setTypesOf(doc: PDFDocumentProxy): Promise<SetTypes> {
  let p = setCache.get(doc);
  if (!p) {
    p = (async () => {
      const parts: Partial<SetTypes>[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const texts = await pageTexts(page);
        const vp = page.getViewport({ scale: 1 });
        const sheet = readTypeSheet(texts, vp.width, vp.height);
        if (sheet) parts.push(sheet);
        parts.push(readTagLegend(texts));
      }
      return mergeSetTypes(parts);
    })();
    p.catch(() => setCache.delete(doc));
    setCache.set(doc, p);
  }
  return p;
}

export interface KnownWalls {
  /** Codes of the project's wall types (empty when it has none yet: tags are then read by their prefixes). */
  codes: string[];
  /** Those of them that are exterior walls. */
  exterior: string[];
  /** What the drawing set's own type sheets and legends say (see `setTypesOf`). */
  set?: SetTypes;
}

/** Runs the wall takeoff on a sheet with a known scale. */
export async function sheetWallTakeoff(
  page: PDFPageProxy,
  sheet: Sheet,
  maxOpening: number,
  throughDoors: boolean,
  stopAtDoors: string[] = [],
  known: KnownWalls = { codes: [], exterior: [] },
): Promise<WallTakeoffResult> {
  if (!sheet.metersPerPoint) throw new Error('Set the sheet scale first.');
  const [model, segments, texts] = await Promise.all([wallModelFor(page, sheet, maxOpening), segmentsOf(page), wallTagTexts(page, known.codes, known.set)]);
  // The wall takeoff reads tags and leaders itself: it takes the wall pens' symbols as drawn.
  return wallTakeoff([...model.lines, ...(model.symbols ?? [])], segments, texts, sheet.metersPerPoint, {
    doors: model.openings,
    throughDoors,
    stopAtDoors,
    exterior: known.exterior,
    kinds: known.set?.kinds,
  });
}
