import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildWallModel } from '../src/fill/roomFill';
import { fillRooms, findDoorTags, findRoomLabels } from '../src/fill/rooms';
import { extractSegments } from '../src/fill/vectors';
import { ringArea } from '../src/geometry';
import type { Sheet } from '../src/model';
import { pageTexts } from '../src/pageText';
import { inspectPage, type PDFPageProxy } from '../src/pdf';
import { samplePlanPdf } from '../src/samplePlan';
import { checkScale } from '../src/scaleCheck';
import { parseScale } from '../src/units';
import { sheetWallTakeoff } from '../src/walls/sheetWallTakeoff';
import { lengthsByType } from '../src/walls/wallTakeoff';

// src/pdf.ts points pdf.js at the bundled worker URL, which only the app serves.
GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;

// The sample plan doubles as an end-to-end check of the readers on a known drawing.
describe('sample plan', () => {
  it('reads as a 1:100 sheet with five rooms, five doors and two wall types', async () => {
    const doc = await getDocument({ data: await samplePlanPdf() }).promise;
    const page = (await doc.getPage(1)) as unknown as PDFPageProxy;
    const info = await inspectPage(page);
    expect(info.name).toBe('A1.01');
    expect(info.scaleHints).toEqual(['1:100']);
    const mpp = parseScale('1:100')!;

    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);
    const scale = checkScale(texts, segs, 'metric')!;
    expect(scale.label).toBe('1:100');
    expect(scale.agree).toBeGreaterThanOrEqual(5);

    const rooms = fillRooms(buildWallModel(segs, mpp), findRoomLabels(texts, segs), vp.width, vp.height);
    const areas = Object.fromEntries(rooms.map((r) => [r.labels[0].number, +(ringArea(r.points ?? []) * mpp * mpp).toFixed(1)]));
    expect(areas).toEqual({ '101': 62.9, '102': 30.7, '103': 30.7, '104': 30.7, '105': 30.7 });

    expect(findDoorTags(texts, segs).map((d) => d.number).sort()).toEqual(['101', '102', '103', '104', '105']);

    const sheet = { id: 's', docId: 'd', page: 1, name: 'A1.01', width: vp.width, height: vp.height, metersPerPoint: mpp, scaleLabel: '1:100', scaleSource: 'preset', scaleHints: [] } as Sheet;
    const walls = lengthsByType((await sheetWallTakeoff(page, sheet, 3, true)).runs, mpp);
    expect(Math.round(walls.get('EW1')!.length)).toBe(58);
    expect(Math.round(walls.get('W1')!.length)).toBe(34);
  }, 60000);

  it('reads the imperial version at 1/8" = 1\'-0" from its feet-and-inch dimensions', async () => {
    const doc = await getDocument({ data: await samplePlanPdf('imperial') }).promise;
    const page = (await doc.getPage(1)) as unknown as PDFPageProxy;
    const info = await inspectPage(page);
    expect(info.scaleHints).toEqual(['1/8" = 1\'-0"']);
    const mpp = parseScale(info.scaleHints[0])!;
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);
    const scale = checkScale(texts, segs, 'imperial')!;
    expect(scale.label).toBe('1/8" = 1\'-0"');
    expect(scale.agree).toBeGreaterThanOrEqual(5);
    // Read with a metric project too: the dimensions decide, not the project's units.
    expect(checkScale(texts, segs, 'metric')!.label).toBe('1/8" = 1\'-0"');

    const sf = (pts: number) => +((pts * mpp * mpp) / 0.09290304).toFixed(1);
    const rooms = fillRooms(buildWallModel(segs, mpp), findRoomLabels(texts, segs), vp.width, vp.height);
    const areas = Object.fromEntries(rooms.map((r) => [r.labels[0].number, sf(ringArea(r.points ?? []))]));
    expect(areas).toEqual({ '101': 698.8, '102': 341.6, '103': 341.6, '104': 341.6, '105': 341.6 });

    const sheet = { id: 's', docId: 'd', page: 1, name: 'A1.01', width: vp.width, height: vp.height, metersPerPoint: mpp, scaleLabel: info.scaleHints[0], scaleSource: 'preset', scaleHints: [] } as Sheet;
    const walls = lengthsByType((await sheetWallTakeoff(page, sheet, 3, true)).runs, mpp);
    expect(walls.get('EW1')!.length / 0.3048).toBeCloseTo(193.3, 0);
    expect(walls.get('W1')!.length / 0.3048).toBeCloseTo(113.3, 0);
  }, 60000);
});
