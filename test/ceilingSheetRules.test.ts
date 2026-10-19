import { describe, expect, it } from 'vitest';
import { ceilingSwatches, explodedDashes, findCeilingTags, gridBubbles, hatchFamilies, readCeilingDefs, readCeilingSheet } from '../src/fill/ceilings';
import { findGridHatch } from '../src/fill/hatchRegions';
import { marksOf } from '../src/fill/marks';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';
import { viewTitle } from '../src/sheetScale';

let sub = 1;
const line = (x1: number, y1: number, x2: number, y2: number, width = 0.5, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width, filled: false, sub: sub++, ...extra });
const rect = (x0: number, y0: number, x1: number, y1: number, width = 0.5, extra: Partial<Segment> = {}): Segment[] => {
  const s = sub++;
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0, width, filled: false, sub: s, ...extra },
    { x1: x1, y1: y0, x2: x1, y2: y1, width, filled: false, sub: s, ...extra },
    { x1: x1, y1: y1, x2: x0, y2: y1, width, filled: false, sub: s, ...extra },
    { x1: x0, y1: y1, x2: x0, y2: y0, width, filled: false, sub: s, ...extra },
  ];
};
const text = (str: string, cx: number, cy: number, w = str.length * 4, h = 5): PageText => ({ str, cx, cy, w, h });
const circle = (cx: number, cy: number, r: number): Segment[] => {
  const s = sub++;
  const out: Segment[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const b = ((k + 1) * Math.PI) / 8;
    out.push({ x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), width: 0.3, filled: false, sub: s, curve: true });
  }
  return out;
};

describe('dashed lines in any direction', () => {
  it('takes a slanted line drawn as dashes for one dashed line', () => {
    const dashes: Segment[] = [];
    for (let k = 0; k < 8; k++) dashes.push(line(100 + k * 4, 100 + k * 4, 102 + k * 4, 102 + k * 4));
    const solid = line(0, 0, 50, 80);
    const found = explodedDashes([...dashes, solid]);
    expect(dashes.every((d) => found.has(d))).toBe(true);
    expect(found.has(solid)).toBe(false);
  });
});

describe('column grid bubbles', () => {
  it('finds a grid label in a circle with the grid line running off it', () => {
    const segs = [...circle(100, 50, 8), line(100, 58, 100, 600)];
    const b = gridBubbles([text('A', 100, 50, 4, 6)], segs);
    expect(b).toHaveLength(1);
    expect(Math.round(b[0].at[1])).toBe(50);
  });
  it('ignores a circled number without a long line (a keynote)', () => {
    expect(gridBubbles([text('3', 300, 50, 4, 6)], circle(300, 50, 8))).toEqual([]);
  });
});

describe('existing ceiling tags', () => {
  it('reads EX-ACT and EX. GWB with a ceiling height (written ±) as tags, not EXIT', () => {
    const texts = [text('EX-ACT', 100, 100), text("+/- 9'-4\"", 100, 110), text('EX. GWB', 300, 100), text("8'-6\"", 300, 110), text('EXIT', 500, 100), text("8'-0\"", 500, 110)];
    const tags = findCeilingTags(texts, []);
    expect(tags.map((t) => t.code).sort()).toEqual(['EX-ACT', 'EX-GWB']);
    expect(tags.find((t) => t.code === 'EX-ACT')!.height).toBe("+/- 9'-4\"");
  });
});

describe('ceiling legend', () => {
  it('stops at its frame: tags on the plan beyond it are no legend rows', () => {
    const segs = [
      // The legend's frame and a swatch with a grid in it.
      line(20, 20, 20, 400),
      line(220, 20, 220, 400),
      ...rect(30, 60, 60, 80),
      line(40, 60, 40, 80, 0.3),
      line(50, 60, 50, 80, 0.3),
      line(30, 70, 60, 70, 0.3),
      // A plan tag's surroundings beyond the frame.
      ...rect(250, 100, 290, 130),
      line(255, 100, 255, 130, 0.3),
      line(265, 100, 265, 130, 0.3),
      line(250, 115, 290, 115, 0.3),
    ];
    const texts = [text('RCP LEGEND', 120, 40, 60, 8), text('ACT-1 - T-BAR CEILING', 120, 70, 80), text('ACT-1', 320, 115, 20)];
    const rows = ceilingSwatches(texts, segs, marksOf(segs), 1000, 800);
    expect(rows.map((r) => r.code)).toEqual(['ACT-1']);
    expect(rows[0].box[0]).toBeLessThan(220);
  });

  it('reads a types legend mixing codes and words (EX, C-1, C-2, OPEN) under a ceiling heading', () => {
    const texts = [
      text('CEILING TYPE LEGEND', 160, 40, 80, 8),
      text('EX', 100, 70, 8),
      text('EXISTING CEILING TO REMAIN', 200, 70, 110),
      text('C-1', 100, 110, 12),
      text('1/2" PAINTED GYPSUM BOARD', 200, 110, 110),
      text('C-2', 100, 150, 12),
      text('NEW ACOUSTIC CEILING TILE', 200, 150, 110),
      text('OPEN', 100, 190, 16),
      text('OPEN TO UNDERSIDE OF DECK', 200, 190, 110),
    ];
    expect(readCeilingDefs(texts).defs.map((d) => d.code)).toEqual(['EX', 'C-1', 'C-2', 'OPEN']);
  });
});

describe('ceiling grid against walls', () => {
  it('keeps a wall line along its poché edge out of the hatch, however evenly the walls lie', () => {
    // Walls 12 apart in pairs, every 40, crossed by walls the other way; each wall filled grey.
    const segs: Segment[] = [];
    const faces: Segment[] = [];
    for (let k = 0; k < 8; k++) {
      const x = 100 + k * 40;
      const a = line(x, 100, x, 400, 0.7);
      const b = line(x + 12, 100, x + 12, 400, 0.7);
      faces.push(a, b);
      segs.push(a, b, ...rect(x, 100, x + 12, 400, 0, { color: '#989898' }));
    }
    for (let k = 0; k < 8; k++) segs.push(line(90, 110 + k * 40, 420, 110 + k * 40, 0.7));
    const { lines } = hatchFamilies(segs, 16.5, 120, 26);
    expect(faces.filter((f) => lines.has(f))).toEqual([]);
  });

  it('takes no ceiling grid finer than a ceiling tile', () => {
    // Lines 1 apart both ways (hatching in walls) at 1:50: 18 mm cells.
    const segs: Segment[] = [];
    for (let k = 0; k < 40; k++) segs.push(line(100, 100 + k, 160, 100 + k, 0.36), line(100 + k, 100, 100 + k, 160, 0.36));
    expect(findGridHatch(segs, 0.034)).toBeNull();
  });
});

describe('spaces with no ceiling', () => {
  it('leaves a space marked open to below, with its X, untaken', () => {
    const segs = [...rect(0, 0, 1000, 800, 1), ...rect(100, 100, 500, 500, 1), ...rect(500, 100, 800, 500, 1), line(100, 100, 500, 500, 0.3), line(500, 100, 100, 500, 0.3), ...rect(638, 293, 662, 307, 0.3)];
    const texts = [text('OPEN TO BELOW', 300, 300, 50), text('C1', 650, 300, 8)];
    const r = readCeilingSheet(segs, texts, { width: 1000, height: 800, metersPerPoint: 0.02 });
    expect(r.areas.length).toBe(1);
    expect(r.areas[0].points.every(([x]) => x >= 499)).toBe(true);
  });
});

describe('sheet title', () => {
  it('is the plan’s when a legend beside it is titled as big', () => {
    expect(viewTitle([text('LEGEND - RCP', 100, 900, 80, 17), text('ENLARGED REFLECTED CEILING PLAN - RENOVATION AREAS', 600, 900, 300, 17)])).toBe('ENLARGED REFLECTED CEILING PLAN - RENOVATION AREAS');
  });
});
