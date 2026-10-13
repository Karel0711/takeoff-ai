import type { Sheet } from '../model';
import type { PDFPageProxy } from '../pdf';
import { segmentsOf, wallModelFor } from '../fill/sheetWalls';
import { pageTexts } from '../pageText';
import { WALL_TAG, type TagText } from './tags';
import { wallTakeoff, type WallTakeoffResult } from './wallTakeoff';

/** Wall type tags on the page, with each text's centre and size in sheet points. */
export async function wallTagTexts(page: PDFPageProxy): Promise<TagText[]> {
  return (await pageTexts(page)).filter((t) => WALL_TAG.test(t.str)).map((t) => ({ code: t.str, cx: t.cx, cy: t.cy, w: t.w, h: t.h }));
}

/** Runs the wall takeoff on a sheet with a known scale. */
export async function sheetWallTakeoff(page: PDFPageProxy, sheet: Sheet, maxOpening: number, throughDoors: boolean): Promise<WallTakeoffResult> {
  if (!sheet.metersPerPoint) throw new Error('Set the sheet scale first.');
  const [model, segments, texts] = await Promise.all([wallModelFor(page, sheet, maxOpening), segmentsOf(page), wallTagTexts(page)]);
  return wallTakeoff(model.lines, segments, texts, sheet.metersPerPoint, { doors: model.openings, throughDoors });
}
