import { describe, expect, it } from 'vitest';
import { backgroundInk, ceilingSwatches, explodedDashes, findCeilingTags, readCeilingDefs, readCeilingNotes, readCeilingSheet, splitAtNarrows } from '../src/fill/ceilings';
import { marksOf } from '../src/fill/marks';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';
import { classifySheet, hasCeilingPlan } from '../src/sheetKind';

let sub = 1;
const line = (x1: number, y1: number, x2: number, y2: number, width: number, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width, filled: false, sub: sub++, ...extra });
const rect = (x0: number, y0: number, x1: number, y1: number, width: number): Segment[] => {
  const s = sub++;
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0, width, filled: false, sub: s },
    { x1: x1, y1: y0, x2: x1, y2: y1, width, filled: false, sub: s },
    { x1: x1, y1: y1, x2: x0, y2: y1, width, filled: false, sub: s },
    { x1: x0, y1: y1, x2: x0, y2: y0, width, filled: false, sub: s },
  ];
};
const circle = (x: number, y: number, r: number): Segment[] => {
  const s = sub++;
  const n = 12;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    const b = ((i + 1) / n) * 2 * Math.PI;
    return { x1: x + r * Math.cos(a), y1: y + r * Math.sin(a), x2: x + r * Math.cos(b), y2: y + r * Math.sin(b), width: 0.3, filled: false, sub: s };
  });
};
const text = (str: string, cx: number, cy: number, w = str.length * 4, h = 5): PageText => ({ str, cx, cy, w, h });
const grid = (x0: number, y0: number, x1: number, y1: number, c: number, width = 0.25): Segment[] => {
  const out: Segment[] = [];
  for (let x = x0 + c; x < x1 - 0.01; x += c) out.push(line(x, y0, x, y1, width));
  for (let y = y0 + c; y < y1 - 0.01; y += c) out.push(line(x0, y, x1, y, width));
  return out;
};
const stipple = (x0: number, y0: number, x1: number, y1: number, c: number): Segment[] => {
  const out: Segment[] = [];
  for (let x = x0 + c / 2; x < x1; x += c) for (let y = y0 + c / 2; y < y1; y += c) out.push(line(x, y, x + 0.3, y, 0.1));
  return out;
};
/** Double walls round a box. */
const walls = (x0: number, y0: number, x1: number, y1: number) => [...rect(x0, y0, x1, y1, 0.7), ...rect(x0 + 6, y0 + 6, x1 - 6, y1 - 6, 0.7)];

describe('ceiling tags as sets print them', () => {
  it('takes a code printed under a ceiling height, with or without brackets or a symbol', () => {
    const texts = [text('2,667', 100, 100, 20), text('(CA1)', 100, 112, 22), text('2,600', 300, 100, 20), text('(CA2)', 300, 112, 22), text('B12', 500, 100, 12)];
    const tags = findCeilingTags(texts, []);
    expect(tags.map((t) => [t.code, t.height])).toEqual([
      ['CA1', '2,667'],
      ['CA2', '2,600'],
    ]);
  });

  it('takes an existing code written C-X1 and a box a little wider than the code', () => {
    const segs = [...rect(88, 94, 112, 106, 0.3)];
    const tags = findCeilingTags([text('C-X1', 100, 100, 14)], segs);
    expect(tags.map((t) => t.code)).toEqual(['C-X1']);
  });

  it('reads material abbreviations as codes where a ceiling legend lists them, with a height', () => {
    const table = [text('REFLECTED CEILING PLAN LEGEND:', 640, 40, 120), text('EXP', 600, 60, 12), text('EXPOSED STRUCTURE', 660, 60, 70), text('EXT', 600, 75, 12), text('EXISTING CEILING', 660, 75, 64), text('GYP', 600, 90, 12), text('GYPSUM BOARD CEILING', 670, 90, 80), text('MS', 600, 105, 8), text('METAL SOFFIT', 650, 105, 48)];
    const { defs } = readCeilingDefs(table);
    expect(defs.map((d) => [d.code, d.description])).toEqual([
      ['EXP', 'EXPOSED STRUCTURE'],
      ['EXT', 'EXISTING CEILING'],
      ['GYP', 'GYPSUM BOARD CEILING'],
      ['MS', 'METAL SOFFIT'],
    ]);
    const plan = [text('2438', 100, 100, 16), text('GYP', 100, 110, 12), text('GYP', 300, 300, 12)];
    expect(findCeilingTags([...table, ...plan], [], defs).map((t) => [t.code, t.at.map(Math.round)])).toEqual([['GYP', [100, 110]]]);
  });
});

describe('ceiling keynotes', () => {
  const notes = [
    text('REFLECTED CEILING PLAN NOTES', 760, 380, 120),
    text('1', 700, 400, 4),
    text("INSTALL NEW 4'x 2' T-BAR ACOUSTIC TILE CEILING", 800, 400, 180),
    text('2', 700, 415, 4),
    text('INSTALL NEW GYPSUM BOARD CEILING TO HEIGHT SHOWN ON R.C.P.', 820, 415, 220),
    text('3', 700, 430, 4),
    text('REFER TO MECHANICAL DRAWINGS FOR GRILLES', 800, 430, 180),
  ];
  it('reads the notes about ceilings, and their numbers in keynote symbols on the plan', () => {
    const read = readCeilingNotes(notes);
    expect(read.defs.map((d) => [d.code, d.description])).toEqual([
      ['1', "INSTALL NEW 4'x 2' T-BAR ACOUSTIC TILE CEILING"],
      ['2', 'INSTALL NEW GYPSUM BOARD CEILING'],
    ]);
    // A keynote "2" in a small circle on the plan; a grid bubble "1" in big lettering is not one.
    const plan = [text('2', 100, 100, 4), text('1', 300, 40, 8, 10), text('3', 200, 200, 4)];
    const segs = [...circle(100, 100, 5), ...circle(300, 40, 12), ...circle(200, 200, 5)];
    const tags = findCeilingTags([...notes, ...plan], segs, read.defs, read.defs.map((d) => d.at), read);
    expect(tags.map((t) => t.code)).toEqual(['2']);
  });
});

describe('what bounds a ceiling', () => {
  it('leaves out white masks, light grey fine linework and dashed lines', () => {
    expect(backgroundInk(line(0, 0, 10, 0, 0.24, { color: '#a9a9a9' }))).toBe(true);
    expect(backgroundInk(line(0, 0, 10, 0, 0.24, { color: '#7f7f7f' }))).toBe(false);
    expect(backgroundInk(line(0, 0, 10, 0, 2, { color: '#aaaaaa' }))).toBe(false);
    expect(backgroundInk({ ...line(0, 0, 10, 0, 0, { color: '#ffffff' }), filled: true })).toBe(true);
    expect(backgroundInk({ ...line(0, 0, 10, 0, 0, { color: '#c0c0c0' }), filled: true })).toBe(false);
    const dashes = Array.from({ length: 6 }, (_, i) => line(i * 6, 50, i * 6 + 3, 50, 0.5));
    const grid4 = Array.from({ length: 6 }, (_, i) => line(i * 17, 80, i * 17 + 17, 80, 0.5));
    const found = explodedDashes([...dashes, ...grid4]);
    expect(dashes.every((d) => found.has(d))).toBe(true);
    expect(grid4.some((d) => found.has(d))).toBe(false);
  });

  it('splits an open space at its narrows between two codes', () => {
    // A 60×40 hall with a 10×30 alcove open to it through a 6 px neck.
    const w = 80;
    const h = 50;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y < 45; y++) for (let x = 5; x < 65; x++) mask[y * w + x] = 1;
    for (let y = 10; y < 40; y++) for (let x = 65; x < 75; x++) mask[y * w + x] = 1;
    for (let y = 10; y < 40; y++) mask[y * w + 65] = y >= 22 && y < 28 ? 1 : 0;
    const out = splitAtNarrows(mask, w, h, [{ key: 'c1', x: 30, y: 25 }, { key: 'c3', x: 70, y: 15 }], 4)!;
    expect(out[25 * w + 70]).toBe('c3');
    expect(out[35 * w + 70]).toBe('c3');
    expect(out[25 * w + 60]).toBe('c1');
  });
});

describe('a ceiling legend that is not framed', () => {
  const legend = [
    text('CEILING LEGEND', 520, 400, 60),
    text('SAT1', 520, 420, 16),
    text('609x1219', 528, 428, 32),
    text('GYP', 520, 450, 12),
    text('GYPSUM BOARD', 536, 458, 48),
    text('RECESSED LIGHT FIXTURE', 560, 480, 90),
  ];
  const swatches = [...grid(470, 414, 505, 434, 6), ...stipple(470, 444, 505, 464, 2.2), ...rect(480, 474, 500, 486, 0.3)];
  it('reads each ceiling finish beside its swatch, and the code it starts with', () => {
    const got = ceilingSwatches(legend, swatches, marksOf(swatches), 1000, 1000);
    expect(got.map((s) => [s.code ?? null, s.kind])).toEqual([
      ['SAT1', 'grid'],
      [null, 'stipple'],
    ]);
  });

  it('types an RCP with no type tags by the legend: grid rooms SAT1, the stippled room gypsum', () => {
    const segs = [...walls(50, 50, 250, 250), ...grid(56, 56, 244, 244, 20), ...walls(256, 50, 400, 250), ...stipple(262, 56, 394, 244, 4), ...swatches];
    const read = readCeilingSheet(segs, legend, { width: 1000, height: 1000, metersPerPoint: null });
    const by = new Map<string, number>();
    for (const a of read.areas) by.set(a.code ?? a.legend ?? a.kind, (by.get(a.code ?? a.legend ?? a.kind) ?? 0) + a.area);
    expect([...by.keys()].sort()).toEqual(['GYP GYPSUM BOARD', 'SAT1']);
    expect(by.get('SAT1')!).toBeGreaterThan(180 * 180);
    expect(by.get('GYP GYPSUM BOARD')!).toBeGreaterThan(120 * 180);
  });
});

describe('ceiling plans in the set', () => {
  it('reads ceilings off an existing / demolition floor plan drawn with its RCP', () => {
    const s = { name: 'A302', title: 'LEVEL 1 - EXISTING AND DEMO - FLOOR PLAN & RCP' };
    expect(classifySheet(s).kind).toBe('other');
    expect(hasCeilingPlan(s)).toBe(true);
  });
});
