import { describe, expect, it } from 'vitest';
import { ceilingTypeFor, findCeilingTags, hatchFamilies, readCeilingDefs, readCeilingSheet } from '../src/fill/ceilings';
import { findGridHatch } from '../src/fill/hatchRegions';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

let sub = 1;
const line = (x1: number, y1: number, x2: number, y2: number, width: number): Segment => ({ x1, y1, x2, y2, width, filled: false, sub: sub++ });
const rect = (x0: number, y0: number, x1: number, y1: number, width: number): Segment[] => {
  const s = sub++;
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0, width, filled: false, sub: s },
    { x1: x1, y1: y0, x2: x1, y2: y1, width, filled: false, sub: s },
    { x1: x1, y1: y1, x2: x0, y2: y1, width, filled: false, sub: s },
    { x1: x0, y1: y1, x2: x0, y2: y0, width, filled: false, sub: s },
  ];
};
/** A type tag's diamond, 20 across, round (x, y). */
const diamond = (x: number, y: number): Segment[] => {
  const s = sub++;
  const p = [
    [x, y - 10],
    [x + 10, y],
    [x, y + 10],
    [x - 10, y],
  ];
  return p.map(([ax, ay], i) => ({ x1: ax, y1: ay, x2: p[(i + 1) % 4][0], y2: p[(i + 1) % 4][1], width: 0.4, filled: false, sub: s }));
};
const text = (str: string, cx: number, cy: number, w = str.length * 4, h = 5): PageText => ({ str, cx, cy, w, h });
/** A ceiling grid over a box, `c` apart, in a thin pen. */
const grid = (x0: number, y0: number, x1: number, y1: number, c: number): Segment[] => {
  const out: Segment[] = [];
  for (let x = x0 + c; x < x1 - 0.01; x += c) out.push(line(x, y0, x, y1, 0.25));
  for (let y = y0 + c; y < y1 - 0.01; y += c) out.push(line(x0, y, x1, y, 0.25));
  return out;
};
/** Stipple: dots every `c`. */
const stipple = (x0: number, y0: number, x1: number, y1: number, c: number): Segment[] => {
  const out: Segment[] = [];
  for (let x = x0 + c / 2; x < x1; x += c) for (let y = y0 + c / 2; y < y1; y += c) out.push(line(x, y, x + 0.3, y, 0.1));
  return out;
};

describe('ceiling types table', () => {
  const rules = [70, 130, 190, 250, 310].map((y) => line(600, y, 880, y, 0.4));
  const texts = [
    text('Ceiling Types:', 650, 55),
    text('#', 620, 63),
    text('c1', 620, 100, 8),
    text('New Suspended Lay-in-Panel (LAP) Ceilings:', 790, 80, 170),
    text('- 2x4 lay-in panels on exposed grid', 780, 90, 150),
    text('cx3', 620, 160, 12),
    text('Existing Gypsum Board on Existing Structure (Fire', 795, 140, 190),
    text('Rated Assembly):', 733, 148, 66),
    text('New paint finishes.', 738, 156, 76),
    text('c2', 620, 220, 8),
    text('Reserved', 717, 200, 34),
    text('c4', 620, 280, 8),
    text('New Suspended Lay-in-Panel (LAP) Ceilings:', 790, 260, 170),
  ];

  it('reads each code’s description from its row', () => {
    const { defs, box } = readCeilingDefs(texts, rules);
    expect(defs.map((d) => [d.code, d.description])).toEqual([
      ['c1', 'New Suspended Lay-in-Panel (LAP) Ceilings'],
      ['cx3', 'Existing Gypsum Board on Existing Structure (Fire Rated Assembly)'],
      ['c2', 'Reserved'],
      ['c4', 'New Suspended Lay-in-Panel (LAP) Ceilings'],
    ]);
    expect(box![0]).toBeLessThan(620);
  });

  it('is not fooled by tags that happen to line up on a plan', () => {
    // Three tags one above the other in a corridor, with room names and notes beside them.
    const plan = [text('c1', 100, 100, 8), text('Office', 140, 100), text('cx3', 100, 300, 12), text('1.0 hour f.r.r.', 160, 300, 50), text('c4', 100, 500, 8), text('Store', 150, 520)];
    expect(readCeilingDefs(plan).defs).toEqual([]);
  });
});

describe('ceiling type tags', () => {
  it('finds a code in a small closed symbol, with its height and "above"', () => {
    const segs = [...diamond(100, 100), ...diamond(200, 100)];
    const texts = [text('c1', 100, 100, 8), text(`8'-6"`, 122, 92, 16), text('cx8', 200, 100, 12), text('above', 222, 92, 20)];
    const tags = findCeilingTags(texts, segs);
    expect(tags.map((t) => [t.code, t.height, t.above ?? false])).toEqual([
      ['c1', `8'-6"`, false],
      ['cx8', undefined, true],
    ]);
  });

  it('leaves out codes of other kinds, bare ceiling-looking text and room numbers under their names', () => {
    const segs = [...diamond(100, 100), ...rect(185, 93, 215, 107, 0.4), ...rect(285, 93, 315, 107, 0.4)];
    const texts = [
      text('px7', 100, 100, 12), // a partition tag
      text('C3', 200, 100, 8), // a room number under its name
      text('MALE WASHROOM', 200, 88, 50),
      text('C1', 400, 100, 8), // a column line, no symbol
      text('ACT-1', 300, 100, 20), // a ceiling tag in a box
    ];
    expect(findCeilingTags(texts, segs).map((t) => t.code)).toEqual(['ACT-1']);
  });
});

describe('hatch lines', () => {
  it('takes a grid’s lines and keeps the outline round it and a wall’s two faces', () => {
    const outline = rect(0, 0, 200, 100, 0.25);
    const g = grid(0, 0, 200, 100, 20);
    const wall = [line(0, 150, 200, 150, 0.25), line(0, 156, 200, 156, 0.25)];
    const { lines, spacing } = hatchFamilies([...outline, ...g, ...wall], 9, 66);
    expect(g.every((s) => lines.has(s))).toBe(true);
    expect(outline.some((s) => lines.has(s))).toBe(false);
    expect(wall.some((s) => lines.has(s))).toBe(false);
    expect(spacing.get('S0.25 line90')).toBeCloseTo(20, 0);
  });
});

describe('ceilings by type on a reflected ceiling plan', () => {
  // Three rooms in a row inside double walls: A gridded and tagged c1 (8'-6"), B stippled and
  // tagged cx3 with a dimension line across it, C gridded with no tag. A types table beside.
  const walls = [
    ...rect(50, 50, 550, 350, 0.7),
    ...rect(56, 56, 544, 344, 0.7),
    line(250, 56, 250, 344, 0.7),
    line(256, 56, 256, 344, 0.7),
    line(400, 56, 400, 344, 0.7),
    line(406, 56, 406, 344, 0.7),
  ];
  const segs = [
    ...walls,
    ...grid(56, 56, 250, 344, 20),
    ...stipple(256, 56, 400, 344, 6),
    line(256, 250, 400, 250, 0.2),
    ...grid(406, 56, 544, 344, 20),
    ...diamond(150, 200),
    ...diamond(320, 120),
    ...[70, 130, 190].map((y) => line(600, y, 880, y, 0.4)),
  ];
  const texts = [
    text('c1', 150, 200, 8),
    text(`8'-6"`, 172, 192, 16),
    text('cx3', 320, 120, 12),
    text('Ceiling Types:', 650, 55),
    text('c1', 620, 85, 8),
    text('New Suspended Lay-in-Panel (LAP) Ceilings:', 790, 80, 170),
    text('cx3', 620, 115, 12),
    text('Existing Gypsum Board on Existing Structure:', 790, 110, 170),
    text('c2', 620, 160, 8),
    text('New Gypsum Board on Existing Structure:', 780, 150, 150),
  ];
  const sheet = { width: 900, height: 420, metersPerPoint: 0.03 };
  const read = readCeilingSheet(segs, texts, sheet);
  const of = (code: string | null) => read.areas.filter((a) => a.code === code);

  it('gives each room the type tagged in it, with the height', () => {
    expect(read.tagged).toBe(true);
    const a = of('c1');
    expect(a).toHaveLength(1);
    expect(a[0].source).toBe('tag');
    expect(a[0].height).toBe(`8'-6"`);
    expect(a[0].area / (194 * 288)).toBeGreaterThan(0.97);
    expect(a[0].area / (194 * 288)).toBeLessThan(1.03);
  });

  it('carries a tag across a dimension line to the rest of its room', () => {
    const b = of('cx3');
    expect(b).toHaveLength(1);
    expect(b[0].area / (144 * 288)).toBeGreaterThan(0.97);
    expect(b[0].area / (144 * 288)).toBeLessThan(1.03);
  });

  it('types an untagged gridded room by what is drawn in it', () => {
    const c = of(null);
    expect(c).toHaveLength(1);
    expect(c[0].source).toBe('fallback');
    expect(c[0].kind).toBe('grid');
    expect(c[0].area / (138 * 288)).toBeGreaterThan(0.97);
    expect(c[0].area / (138 * 288)).toBeLessThan(1.03);
  });

  it('names the types from the table', () => {
    const names = read.areas.map((a) => ceilingTypeFor(a, read, 'new', false).name).sort();
    expect(names).toEqual(['Ceiling – ACT, acoustic tile in a lay-in grid (untagged)', 'c1 – New Suspended Lay-in-Panel (LAP) Ceilings', 'cx3 – Existing Gypsum Board on Existing Structure']);
    const c1 = ceilingTypeFor(of('c1')[0], read, 'new', false);
    expect(c1.items.map((i) => i.name)).toContain('Tiles 2×4 + 5%');
    const cx3 = ceilingTypeFor(of('cx3')[0], read, 'demo', false);
    expect(cx3.name).toBe('cx3 – Existing Gypsum Board on Existing Structure – demolish');
    expect(cx3.division).toBe('02 Existing Conditions');
  });

  it('reads a plan with no type tags, no legend and only a grid drawn as before: the areas its grid covers', () => {
    const plain = segs.filter((s) => s.width !== 0.4 && s.width !== 0.1);
    const r = readCeilingSheet(plain, [], sheet);
    expect(r.tagged).toBe(false);
    expect(r.areas.length).toBe(findGridHatch(plain, 0.03)?.regions.length ?? 0);
    const t = ceilingTypeFor(r.areas[0] ?? { points: [], holes: [], area: 0, code: null, source: 'fallback', kind: 'grid' }, r, 'reinstate', true);
    expect(t.name).toBe('Ceiling – remove & reinstate existing tiles');
  });
});
