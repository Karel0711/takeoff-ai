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
});
