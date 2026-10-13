import { describe, expect, it } from 'vitest';
import { readLegend } from '../src/fill/legend';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.5): Segment => ({ x1, y1, x2, y2, width, filled: false });
const text = (str: string, left: number, cy: number): PageText => ({ str, cx: left + str.length * 2.5, cy, w: str.length * 5, h: 5, angle: 0 });
/** A small valve-like symbol: a box with a cross, centred at (x, y). */
const symbol = (x: number, y: number): Segment[] => [
  seg(x - 4, y - 4, x + 4, y - 4),
  seg(x + 4, y - 4, x + 4, y + 4),
  seg(x + 4, y + 4, x - 4, y + 4),
  seg(x - 4, y + 4, x - 4, y - 4),
  seg(x - 4, y - 4, x + 4, y + 4),
  seg(x - 3, y + 4, x + 4, y - 3),
];

describe('legend reading', () => {
  it('reads each line, tells symbols, line types and hatches apart, and counts symbols', () => {
    const segs: Segment[] = [
      // Frame and heading rule, which belong to no row.
      seg(90, 70, 400, 70),
      seg(90, 70, 90, 260),
      seg(90, 86, 400, 86),
      // Fence: a long thin line.
      seg(110, 100, 170, 100),
      // Valve symbol.
      ...symbol(140, 130),
      // Asphalt: a framed swatch with a hatch.
      seg(115, 152, 165, 152),
      seg(165, 152, 165, 168),
      seg(165, 168, 115, 168),
      seg(115, 168, 115, 152),
      seg(120, 168, 136, 152),
      seg(135, 168, 151, 152),
      // Hydrant: a dot with its tag beside it.
      seg(138, 190, 142, 190),
      // The plan: three valves (one turned) and two hydrant tags.
      ...symbol(800, 500),
      ...symbol(900, 650),
      ...symbol(1200, 300).map((s) => ({ ...s, x1: 2400 - s.x1, x2: 2400 - s.x2 })),
    ];
    const texts: PageText[] = [
      text('SYMBOLS LEGEND:', 100, 78),
      text('CHAIN LINK FENCE', 200, 100),
      text('GATE VALVE', 200, 130),
      text('NEW ASPHALT AREA', 200, 160),
      text('WITH 50MM TOPCOAT', 200, 168),
      text('FH', 150, 190),
      text('FIRE HYDRANT', 200, 190),
      text('FH', 700, 400),
      text('FH', 1500, 900),
    ];
    const rows = readLegend(texts, segs, [90, 70, 400, 260]);
    expect(rows.map((r) => [r.label, r.kind])).toEqual([
      ['CHAIN LINK FENCE', 'linear'],
      ['GATE VALVE', 'count'],
      ['NEW ASPHALT AREA WITH 50MM TOPCOAT', 'area'],
      ['FIRE HYDRANT', 'count'],
    ]);
    expect(rows[1].found?.length).toBe(3);
    expect(rows[3].tag).toBe('FH');
    expect(rows[3].tagged?.length).toBe(2);
  });
});

describe('legend reading, awkward layouts', () => {
  it('skips table headings, keeps tags inside symbols out of the label column, and stops at a second column', () => {
    const circle = (x: number, y: number): Segment[] =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const b = ((i + 1) / 12) * Math.PI * 2;
        return seg(x + 6 * Math.cos(a), y + 6 * Math.sin(a), x + 6 * Math.cos(b), y + 6 * Math.sin(b));
      });
    const segs: Segment[] = [...circle(120, 120), ...circle(120, 150), ...circle(600, 400), ...circle(700, 420)];
    const texts: PageText[] = [
      text('SYMBOL', 105, 95),
      text('DESCRIPTION', 200, 95),
      // Tags drawn inside the circles, lined up like a column.
      text('FH', 115, 120),
      text('SD', 115, 150),
      text('FIRE HOSE CABINET', 200, 120),
      text('SMOKE DETECTOR', 200, 150),
      // A second legend column far to the right on the same lines.
      text('DUPLEX RECEPTACLE', 330, 120),
      text('FH', 640, 380),
    ];
    const rows = readLegend(texts, segs, [90, 85, 420, 165]);
    expect(rows.map((r) => [r.label, r.kind, r.tag ?? null])).toEqual([
      ['DESCRIPTION', null, null],
      ['FIRE HOSE CABINET', 'count', 'FH'],
      ['SMOKE DETECTOR', 'count', 'SD'],
    ]);
    expect(rows[1].found?.length).toBe(2);
    expect(rows[1].tagged?.length).toBe(1);
  });
});
