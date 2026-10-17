import { describe, expect, it } from 'vitest';
import {
  closedShape,
  discipline,
  countSymbolsInSet,
  findLegends,
  findLookalikes,
  isLegendHeading,
  legendSymbols,
  pickSymbol,
  settleOverlaps,
  symbolBoxAt,
  findCopies,
  type SetSheet,
} from '../src/fill/autoSymbols';
import { lookScore, type LookLine } from '../src/fill/symbolLook';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

let sub = 1;
const W = 0.72;
const seg = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Segment> = {}): Segment => ({
  x1,
  y1,
  x2,
  y2,
  width: W,
  filled: false,
  color: '#000000',
  sub: sub++,
  ...extra,
});
/** A circle as a PDF draws one: 16 chords in one shape. */
const circle = (x: number, y: number, r: number, extra: Partial<Segment> = {}): Segment[] => {
  const s = sub++;
  return Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const b = ((i + 1) / 16) * Math.PI * 2;
    return { x1: x + r * Math.cos(a), y1: y + r * Math.sin(a), x2: x + r * Math.cos(b), y2: y + r * Math.sin(b), width: W, filled: false, color: '#000000', sub: s, ...extra };
  });
};
const box = (x0: number, y0: number, x1: number, y1: number): Segment[] => {
  const s = sub++;
  return [seg(x0, y0, x1, y0, { sub: s }), seg(x1, y0, x1, y1, { sub: s }), seg(x1, y1, x0, y1, { sub: s }), seg(x0, y1, x0, y0, { sub: s })];
};
/** ¤ a pot light: a circle with a cross through it, `k` times the legend's size, turned a quarter when `turned`. */
const potLight = (x: number, y: number, k = 1): Segment[] => [
  ...circle(x, y, 2.8 * k),
  seg(x - 4 * k, y - 4 * k, x + 4 * k, y + 4 * k),
  seg(x - 4 * k, y + 4 * k, x + 4 * k, y - 4 * k),
];
/** A wall sconce: a pot light on a stem with a foot. */
const sconce = (x: number, y: number, k = 1, down = true): Segment[] => {
  const d = down ? 1 : -1;
  return [...potLight(x, y, k), seg(x, y + 2.8 * k * d, x, y + 5.5 * k * d), seg(x - 2 * k, y + 5.5 * k * d, x + 2 * k, y + 5.5 * k * d)];
};
/** A filled half (or quarter) of a circle, as a filled shape. */
const wedge = (x: number, y: number, r: number, a0: number, a1: number): Segment[] => {
  const s = sub++;
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i <= 4; i++) pts.push([x + r * Math.cos(a0 + ((a1 - a0) * i) / 4), y + r * Math.sin(a0 + ((a1 - a0) * i) / 4)]);
  pts.push([x, y]);
  return pts.slice(1).map((p, i) => ({ x1: pts[i][0], y1: pts[i][1], x2: p[0], y2: p[1], width: 0, filled: true, color: '#000000', sub: s }));
};
const heat = (x: number, y: number) => [...circle(x, y, 3), ...wedge(x, y, 3, 0, Math.PI)];
const occupancy = (x: number, y: number) => [...circle(x, y, 3), ...wedge(x, y, 3, 0, Math.PI / 2), ...wedge(x, y, 3, Math.PI, Math.PI * 1.5)];
const text = (str: string, left: number, cy: number, h = 5): PageText => ({ str, cx: left + str.length * h * 0.3, cy, w: str.length * h * 0.6, h, angle: 0 });

describe('legend headings', () => {
  it('takes short headings naming a legend or symbols, not notes pointing at one', () => {
    for (const h of ['RCP Legend:', 'LEGEND', 'Symbols', 'SYMBOL LEGEND', 'Electrical Legend', 'Legend of Symbols']) expect(isLegendHeading(h)).toBe(true);
    for (const h of ['See legend on A001', 'Symbol Modifiers:', 'refer to legend for fixture types and mounting heights shown']) expect(isLegendHeading(h)).toBe(false);
  });
});

/** A framed RCP legend at (1000, 100) and a plan: legend symbols drawn bigger than the plan's blocks. */
function rcpSheet() {
  const segs: Segment[] = [
    ...box(990, 90, 1200, 260),
    ...potLight(1015, 125, 1.4),
    ...sconce(1015, 150, 1.4),
    ...heat(1015, 185),
    ...occupancy(1015, 210),
    ...box(1009, 232, 1021, 238),
    // The plan.
    ...potLight(100, 100),
    ...potLight(160, 100),
    ...potLight(220, 140),
    ...sconce(100, 300),
    ...sconce(300, 300, 1.5, false),
    ...heat(400, 100),
    ...heat(450, 100),
    ...occupancy(400, 200),
    // An exit sign and a plain box of the same size: only the one lettered EXIT is a sign.
    ...box(500, 100, 512, 106),
    ...box(500, 200, 512, 206),
  ];
  const texts: PageText[] = [
    text('RCP Legend:', 1000, 105, 7),
    text('Pot light fixture', 1040, 125),
    text('Wall sconce light fixture', 1040, 152),
    text('Heat detector', 1040, 185),
    text('Occupancy sensor', 1040, 210),
    text('Exit sign', 1040, 235),
    { str: 'EXIT', cx: 1015, cy: 235, w: 8, h: 2.5, angle: 0 },
    { str: 'EXIT', cx: 506, cy: 103, w: 8, h: 2.5, angle: 0 },
  ];
  return { segs, texts };
}

describe('count symbols from the legends, nothing boxed', () => {
  it('finds a framed legend by its heading and reads its lines', () => {
    const { segs, texts } = rcpSheet();
    const legends = findLegends(texts, segs, 1300, 900);
    expect(legends).toHaveLength(1);
    expect(legends[0].heading).toBe('RCP Legend');
    expect(legends[0].rows.map((r) => r.label)).toEqual(['Pot light fixture', 'Wall sconce light fixture', 'Heat detector', 'Occupancy sensor', 'Exit sign']);
  });

  it('counts each symbol at the size and turn the plan draws it, telling look-alikes apart', () => {
    const { segs, texts } = rcpSheet();
    const [legend] = findLegends(texts, segs, 1300, 900);
    const symbols = legendSymbols(legend, texts, segs, () => true);
    const sheet = { segs, texts, exclude: [legend.box] };
    const settled = settleOverlaps(symbols.map((symbol) => ({ symbol, copies: findCopies(symbol, sheet) })));
    const count = Object.fromEntries(settled.map((s) => [s.symbol.label, s.copies.length]));
    // The sconce drawn half as big again and upside down is a sconce, not a pot light inside one.
    expect(count).toEqual({ 'Pot light fixture': 3, 'Wall sconce light fixture': 2, 'Heat detector': 2, 'Occupancy sensor': 1, 'Exit sign': 1 });
  });

  it('tells a half-filled circle from a quartered one by its solid parts', () => {
    const asLines = (s: Segment[]): LookLine[] => s.map((x) => ({ ...x, group: x.sub }));
    expect(lookScore(asLines(heat(0, 0)), asLines(heat(0, 0)), 14)).toBe(1);
    expect(lookScore(asLines(heat(0, 0)), asLines(occupancy(0, 0)), 14)).toBeLessThan(0.8);
  });

  it('does not take the legend itself, and only counts sheets the legend is for', async () => {
    const rcp = rcpSheet();
    // A second RCP with its own copy of the legend, a floor plan with a different legend, and a
    // sheet with no legend at another scale: only the RCPs are counted.
    const rcp2 = { segs: [...rcp.segs.filter((s) => s.x1 > 900), ...potLight(600, 600)], texts: rcp.texts.filter((t) => t.cx > 900) };
    const plan = {
      segs: [...box(990, 90, 1200, 200), ...circle(1015, 125, 3), ...box(1009, 150, 1021, 156), ...potLight(100, 100)],
      texts: [text('Legend:', 1000, 105, 7), text('Room number', 1040, 125), { str: '07', cx: 1015, cy: 125, w: 4, h: 2.5, angle: 0 }, text('Door tag', 1040, 153)],
    };
    const detail = { segs: potLight(100, 100), texts: [] as PageText[] };
    const data: Record<string, { segs: Segment[]; texts: PageText[] }> = { a: rcp, b: rcp2, c: plan, d: detail };
    const sheets: SetSheet[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), width: 1300, height: 900 }));
    const tallies = await countSymbolsInSet(sheets, {
      texts: async (s) => data[s.id].texts,
      segments: async (s) => data[s.id].segs,
      exclude: () => [],
      sameScale: (s) => s.id !== 'd',
    });
    const pot = tallies.find((t) => t.symbol.label === 'Pot light fixture')!;
    expect(pot.places).toEqual([
      { sheetId: 'a', at: expect.any(Array) },
      { sheetId: 'b', at: expect.any(Array) },
    ]);
    expect(pot.total).toBe(4);
    expect(tallies.some((t) => /room number/i.test(t.symbol.label))).toBe(false);
  });
});

describe('sheet disciplines', () => {
  it('reads the discipline from a sheet number', () => {
    expect([discipline('E101'), discipline('E-001'), discipline('FP2.1'), discipline('812'), discipline('Page 4')]).toEqual(['E', 'E', 'FP', '8', null]);
  });
});

describe('which legend graphics are symbols to count', () => {
  const L = (x1: number, y1: number, x2: number, y2: number, group: number) => ({ x1, y1, x2, y2, width: 0.5, group });
  it('takes a closed shape, even drawn as loose lines, but not a dashed outline or a corner mark', () => {
    const hexagon = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      const b = ((i + 1) / 6) * Math.PI * 2;
      return L(5 * Math.cos(a), 5 * Math.sin(a), 5 * Math.cos(b), 5 * Math.sin(b), 100 + i);
    });
    expect(closedShape(hexagon)).toBe(true);
    const dashed = [L(0, 0, 0, 8, 1), L(0, 0, 4, 0, 1), L(0, 8, 4, 8, 1), L(10, 0, 25, 0, 2), L(10, 8, 25, 8, 3), L(31, 0, 35, 0, 4), L(35, 0, 35, 8, 4), L(35, 8, 31, 8, 4)];
    expect(closedShape(dashed)).toBe(false);
    expect(closedShape([L(0, 0, 10, 0, 1), L(10, 0, 10, 10, 1)])).toBe(false);
  });
});

describe('count a symbol with one click', () => {
  it('takes the symbol under the click, not the ceiling grid it sits in', () => {
    // A 2x4 fixture (a box with a box inside) in a ceiling grid: tiles drawn as boxes touching it.
    const fixture = (x: number, y: number) => [...box(x, y, x + 18, y + 36), ...box(x + 2, y + 2, x + 16, y + 34)];
    const segs: Segment[] = [...box(80, 100, 98, 136), ...box(116, 100, 134, 136), ...fixture(98, 100), ...seg2grid()];
    const b = symbolBoxAt(segs, [107, 118], 60);
    expect(b?.map(Math.round)).toEqual([98, 100, 116, 136]);
  });

  it('counts a clicked symbol on every sheet at its scale, named by the legend line it matches', async () => {
    const rcp = rcpSheet();
    const [legend] = findLegends(rcp.texts, rcp.segs, 1300, 900);
    const symbols = legendSymbols(legend, rcp.texts, rcp.segs, () => true);
    const picked = pickSymbol(rcp.segs, rcp.texts, [100, 100], symbols);
    expect(picked?.label).toBe('Pot light fixture');
    const other = { segs: [...potLight(50, 50), ...potLight(80, 50), ...sconce(200, 200)], texts: [] as PageText[] };
    const sheets: SetSheet[] = [
      { id: 'a', name: 'A', width: 1300, height: 900 },
      { id: 'b', name: 'B', width: 1300, height: 900 },
    ];
    const data: Record<string, { segs: Segment[]; texts: PageText[] }> = { a: rcp, b: other };
    const [tally] = await countSymbolsInSet(
      sheets,
      { texts: async (s) => data[s.id].texts, segments: async (s) => data[s.id].segs, exclude: () => [], sameScale: () => true },
      { symbol: picked!, home: sheets[0] },
    );
    // Picked from the plan, a block: the bigger sconce and the legend's own drawing are not copies.
    expect(tally.places.map((p) => [p.sheetId, p.at.length])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('finds a turned copy', () => {
    const sample = potLight(0, 0);
    const segs = [...sample, ...potLight(50, 0).map((s) => ({ ...s, x1: 50 - (s.y1 - 0), y1: s.x1 - 50, x2: 50 - (s.y2 - 0), y2: s.x2 - 50 }))];
    const legend = pickSymbol(segs, [], [0, 0]);
    expect(findLookalikes(legend!.sample, segs)).toHaveLength(2);
  });
});

/** Grid lines running across the ceiling. */
function seg2grid(): Segment[] {
  return [seg(40, 100, 200, 100), seg(40, 136, 200, 136)];
}
