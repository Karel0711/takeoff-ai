import { describe, expect, it } from 'vitest';
import { countListedItems, countWindowTags, setLists, type TagSheet } from '../src/automate/tagCounts';
import { findDoorTags } from '../src/fill/rooms';
import { codeLists, codesIn, findEnclosedTags, isLegendSample } from '../src/fill/typeTags';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

// Sheet points throughout.
const seg = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width: 0.24, filled: false, ...extra });
const text = (str: string, cx: number, cy: number, h = 5): PageText => ({ str, cx, cy, w: str.length * 0.6 * h, h });

/** A closed polygon of `n` sides round (x, y). */
function polygon(x: number, y: number, n: number, r = 10, extra: Partial<Segment> = {}): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const b = ((i + 1) / n) * 2 * Math.PI;
    out.push(seg(x + r * Math.cos(a), y + r * Math.sin(a), x + r * Math.cos(b), y + r * Math.sin(b), extra));
  }
  return out;
}
const box = (x: number, y: number, w = 12, h = 6, extra: Partial<Segment> = {}) => [
  seg(x - w, y - h, x + w, y - h, extra),
  seg(x + w, y - h, x + w, y + h, extra),
  seg(x + w, y + h, x - w, y + h, extra),
  seg(x - w, y + h, x - w, y - h, extra),
];

describe('tags in symbols', () => {
  it('finds a code in a hexagon and names its shape, looking past a white mask behind the lettering', () => {
    const segs = [...polygon(100, 100, 6), ...box(100, 100, 7, 3.5, { filled: true, width: 0, color: '#ffffff' })];
    const [tag] = findEnclosedTags([text('W1A', 100, 100)], segs);
    expect(tag).toMatchObject({ code: 'W1A', sides: 6, shape: 'polygon', others: [] });
  });

  it('notes a callout bubble holding a second number', () => {
    const tags = findEnclosedTags([text('A601', 200, 104), text('1', 200, 95)], polygon(200, 100, 24, 12));
    expect(tags.find((t) => t.code === 'A601')?.others).toEqual(['1']);
  });

  it('splits codes run together into one text', () => {
    expect(codesIn(text('EQ-9EQ-7', 50, 50)).map((c) => c.code)).toEqual(['EQ-9', 'EQ-7']);
    expect(codesIn(text('TA-3 TA-8', 50, 50)).map((c) => c.code)).toEqual(['TA-3', 'TA-8']);
    expect(codesIn(text('SEE TA-3', 50, 50))).toEqual([]);
  });

  it('reads a legend line as a sample, not a tag', () => {
    expect(isLegendSample([100, 100], 5, [text('WINDOW TYPE', 140, 100)])).toBe(true);
    expect(isLegendSample([100, 100], 5, [text('OFFICE', 140, 100)])).toBe(false);
  });

  it('does not take a detail callout (1 over A601) for a door tag', () => {
    const texts = [text('A601', 300, 104), text('1', 300, 95), text('125', 400, 100)];
    const segs = [...polygon(300, 100, 24, 12), ...polygon(400, 100, 24, 12)];
    expect(findDoorTags(texts, segs).map((d) => d.number)).toEqual(['125']);
  });
});

describe('lists of codes', () => {
  const legend = (codes: string[], names: string[], x = 50, y0 = 600) => codes.flatMap((c, i) => [text(c, x, y0 + i * 20), text(names[i], x + 80, y0 + i * 20)]);

  it('reads a schedule column with each row\'s description', () => {
    const rows = codeLists(legend(['TA-1', 'TA-2', 'TA-3'], ['WASTE RECEPTACLE', 'GRAB BARS', 'FLAT FRAMED MIRROR']));
    expect(rows.map((r) => [r.code, r.description])).toEqual([
      ['TA-1', 'WASTE RECEPTACLE'],
      ['TA-2', 'GRAB BARS'],
      ['TA-3', 'FLAT FRAMED MIRROR'],
    ]);
  });

  it('does not take tags that happen to line up on a plan for a list', () => {
    // Repeated and out of order: a plan's own tags.
    expect(codeLists([text('px7', 50, 100), text('px3', 50, 160), text('px7', 50, 300)])).toEqual([]);
  });
});

describe('counting by type tag', () => {
  const sheet = (id: string, name: string, title: string, texts: PageText[], tags?: ReturnType<typeof findEnclosedTags>): TagSheet => ({
    sheet: { id, name, title, width: 2592, height: 1728 },
    texts,
    ...(tags ? { tags } : {}),
  });
  const row = (code: string, name: string, y: number, x = 2000) => [text(code, x, y), text(name, x + 90, y)];

  it('counts listed items where the plans write their code, not in the list itself, and leaves finish lists alone', () => {
    const legendSheet = sheet('a1', 'A1.0', 'LEGEND AND NOTES', [
      ...row('TA-1', 'WASTE RECEPTACLE', 100),
      ...row('TA-2', 'GRAB BARS', 120),
      ...row('TA-3', 'MIRROR', 140),
      ...row('PT-1', 'PAINT', 300),
      ...row('PT-2', 'PAINT', 320),
      ...row('PT-3', 'PAINT', 340),
    ]);
    const plan = sheet('a2', 'A2.1', 'GROUND FLOOR PLAN', [text('TA-1', 300, 300), text('TA-1', 500, 300), text('TA-2', 400, 400), text('TA-3 TA-1', 600, 300), text('PT-1', 700, 700)]);
    const counts = countListedItems([legendSheet, plan]);
    expect(counts.map((c) => [c.code, c.total, c.description])).toEqual([
      ['TA-1', 3, 'WASTE RECEPTACLE'],
      ['TA-2', 1, 'GRAB BARS'],
      ['TA-3', 1, 'MIRROR'],
    ]);
  });

  it('leaves out codes a door schedule lists', () => {
    const doors = sheet('a9', 'A9.0', 'DOOR SCHEDULE', [...row('x101', 'EXISTING HOLLOW', 100), ...row('x102', 'EXISTING HOLLOW', 120), ...row('x103', 'EXISTING HOLLOW', 140)]);
    const plan = sheet('a2', 'A2.1', 'GROUND FLOOR PLAN', [text('x101', 300, 300)]);
    expect(countListedItems([doors, plan])).toEqual([]);
    expect(setLists([doors]).map((l) => l.kind)).toEqual(['schedule']);
  });

  it('counts window tags on the floor plans, not wall tags of the same letter drawn as the wall types', () => {
    const texts = [text('W1a', 300, 300), text('W1a', 500, 300), text('W2', 700, 300), text('W-1', 300, 500), text('W-1', 500, 500), text('W-2', 700, 500)];
    const segs = [...polygon(300, 300, 6), ...polygon(500, 300, 6), ...polygon(700, 300, 6), ...box(300, 500), ...box(500, 500), ...box(700, 500)];
    const plan = sheet('a2', 'A2.1', 'GROUND FLOOR PLAN', texts, findEnclosedTags(texts, segs));
    const walls = sheet('a0', 'A0.1', 'WALL TYPES', [...row('W-1', 'GYPSUM BOARD ON STEEL STUDS', 100), ...row('W-2', 'GYPSUM BOARD ON STEEL STUDS', 120), ...row('W-3', 'CONCRETE BLOCK', 140)]);
    const counts = countWindowTags([walls, plan]);
    expect(counts.map((c) => [c.code, c.total])).toEqual([
      ['W1a', 2],
      ['W2', 1],
    ]);
  });

  it('counts a window type no plan tags on the building elevations', () => {
    const planTexts = [text('W1', 300, 300)];
    const plan = sheet('a2', 'A2.1', 'GROUND FLOOR PLAN', planTexts, findEnclosedTags(planTexts, polygon(300, 300, 6)));
    const elevTexts = [text('W1', 300, 300), text('W5', 500, 300), text('W5', 700, 300)];
    const elev = sheet('a3', 'A3.1', 'BUILDING ELEVATIONS', elevTexts, findEnclosedTags(elevTexts, [...polygon(300, 300, 6), ...polygon(500, 300, 6), ...polygon(700, 300, 6)]));
    expect(countWindowTags([plan, elev]).map((c) => [c.code, c.total, c.places.length])).toEqual([
      ['W1', 1, 1],
      ['W5', 2, 1],
    ]);
  });
});
