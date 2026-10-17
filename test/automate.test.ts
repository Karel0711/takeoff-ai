import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { automateCeilings } from '../src/automate/ceilings';
import { doorTakeoff, findDoorTagsIn } from '../src/automate/doors';
import { applyFinishes, finishRooms, readFinishes } from '../src/automate/finishes';
import { automateRooms } from '../src/automate/rooms';
import type { SetAccess } from '../src/automate/set';
import { sheetsOf } from '../src/automate/sheets';
import { automateSprinklers } from '../src/automate/sprinklers';
import { defaultSymbolChoices, symbolTakeoff, symbolTallies } from '../src/automate/symbols';
import { automateWalls } from '../src/automate/walls';
import { segmentsOf } from '../src/fill/sheetWalls';
import { newProject, type Project, type Sheet } from '../src/model';
import { pageTexts } from '../src/pageText';
import type { PDFDocumentProxy } from '../src/pdf';
import { typeTotals } from '../src/quantities';
import { samplePlanPdf } from '../src/samplePlan';

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;

const accessTo = (pdf: PDFDocumentProxy, extra: Partial<SetAccess> = {}): SetAccess => ({
  page: (s) => pdf.getPage(s.page),
  texts: async (s) => pageTexts(await pdf.getPage(s.page)),
  segments: async (s) => segmentsOf(await pdf.getPage(s.page)),
  ...extra,
});

const total = (p: Project, name: RegExp) => typeTotals(p).find((t) => name.test(t.type.name))?.primary ?? 0;

// Every Automate item run headless on the sample plan, as the benchmark runs them: the same
// numbers the app shows for it.
describe('automations on the sample plan', () => {
  it('make the sheets and take off walls, rooms, doors, finishes and symbols', async () => {
    const pdf = (await getDocument({ data: await samplePlanPdf() }).promise) as unknown as PDFDocumentProxy;
    const { sheets, noText } = await sheetsOf(pdf, 'doc', 'metric');
    expect(noText).toBe(0);
    expect(sheets.map((s) => s.name)).toEqual(['A1.01', 'A2.01', 'A1.02']);
    expect(sheets.every((s) => s.scaleLabel === '1:100')).toBe(true);
    let p: Project = { ...newProject('metric'), docs: [{ id: 'doc', name: 'sample.pdf' }], sheets };
    const plan = sheets[0];
    const access = accessTo(pdf);

    const walls = await automateWalls(p, await pdf.getPage(1), pdf, plan, 3);
    p = walls.apply!(p);
    expect(total(p, /^EW1$/)).toBeCloseTo(58, 0);
    expect(total(p, /^W1$/)).toBeCloseTo(34, 0);

    const rooms = await automateRooms(p, await pdf.getPage(1), plan, 3);
    expect(rooms.message).toBe('5 of 5 rooms filled');
    p = rooms.apply!(p);
    expect(total(p, /^Rooms$/)).toBeCloseTo(186, 0);

    const doors = doorTakeoff(p, await findDoorTagsIn(p, access, plan, true), plan, true);
    expect(doors.message).toBe('Counted 5 Doors on 1 sheet');
    p = doors.apply!(p);

    const read = await readFinishes(p, finishRooms(p), access, p.types);
    expect(read.from).toBe('schedule');
    expect(read.picks.size).toBe(5);
    p = applyFinishes(read)(p);
    expect(total(p, /^POR-1 – Floor finish$/)).toBeCloseTo(62.9, 1);

    const { tallies } = await symbolTallies(p, access);
    const symbols = symbolTakeoff(p, defaultSymbolChoices(tallies));
    expect(symbols.message).toBe('Counted 22 symbols as 1 type');
    p = symbols.apply!(p);

    expect((await automateSprinklers(p, access, null)).message).toBe('No sprinkler plans found.');
    expect((await automateCeilings(p, access, null)).apply).toBeUndefined();
  }, 30000);

  it('report a failing sheet and go on when asked, else stop', async () => {
    const pdf = (await getDocument({ data: await samplePlanPdf() }).promise) as unknown as PDFDocumentProxy;
    const { sheets } = await sheetsOf(pdf, 'doc', 'metric');
    const rcp = (n: number): Sheet => ({ ...sheets[1], id: `r${n}`, title: 'Reflected ceiling plan' });
    const p: Project = { ...newProject('metric'), sheets: [rcp(1), rcp(2)] };
    const failing = { segments: async () => Promise.reject(new Error('bad page')) };
    const failed: string[] = [];
    const r = await automateCeilings(p, accessTo(pdf, { ...failing, sheetError: (s) => failed.push(s.id) }), null);
    expect(failed).toEqual(['r1', 'r2']);
    expect(r.message).toBe('No ceilings found on the ceiling plans.');
    await expect(automateCeilings(p, accessTo(pdf, failing), null)).rejects.toThrow('bad page');
  });
});
