import { describe, expect, it } from 'vitest';
import { namesFromList, readDrawingList } from '../src/drawingList';
import type { PageText } from '../src/pageText';

const text = (str: string, cx: number, cy: number, w = str.length * 4, h = 5): PageText => ({ str, cx, cy, w, h });
/** A drawing list column: numbers at x, titles beside them. */
const column = (x: number, rows: [string, string][]) =>
  rows.flatMap(([n, t], i) => [text(n, x + n.length * 2, 100 + i * 10), text(t, x + 30 + t.length * 2, 100 + i * 10)]);

describe('drawing list', () => {
  const texts = [
    text('DRAWING LIST', 100, 80, 60),
    ...column(50, [
      ['A0.1', 'COVER'],
      ['A2.1', 'GROUND FLOOR PLAN'],
      ['A2.2', 'SECOND FLOOR PLAN'],
      ['A5.2', 'STAIR 1 - PLANS'],
    ]),
    ...column(250, [
      ['A6.1', 'REFLECTED CEILING PLAN - GROUND FLOOR'],
      ['A6.2', 'REFLECTED CEILING PLAN - SECOND FLOOR'],
      ['A7.1', 'INTERIOR ELEVATIONS'],
      ['A8.1', 'CURTAIN WALL ELEVATIONS'],
    ]),
    text('A2.1', 600, 400), // a reference on a plan, not a list line
  ];

  it('reads the columns in binding order', () => {
    expect(readDrawingList(texts).map((l) => l.number)).toEqual(['A0.1', 'A2.1', 'A2.2', 'A5.2', 'A6.1', 'A6.2', 'A7.1', 'A8.1']);
    expect(readDrawingList(texts)[4].title).toBe('REFLECTED CEILING PLAN - GROUND FLOOR');
  });

  it('names unnamed pages bound between two listed sheets', () => {
    const list = readDrawingList(texts);
    const names = namesFromList(['A2.2', 'A5.2', null, null, 'A7.1', null], list);
    expect(names.map((n) => n?.number ?? null)).toEqual([null, null, 'A6.1', 'A6.2', null, null]);
    // A count that does not fit the list says nothing.
    expect(namesFromList(['A5.2', null, 'A7.1'], list).every((n) => n === null)).toBe(true);
    // Listed sheets the file lacks, of a series it has (A2.2 here, A2.1 not bound): the pages are the series it has none of.
    expect(namesFromList(['A0.1', 'A2.2', 'A5.2', null, null, 'A7.1'], [...list.slice(0, 4), { number: 'A5.3', title: 'STAIR 2' }, ...list.slice(4)]).map((n) => n?.number ?? null)).toEqual([null, null, null, 'A6.1', 'A6.2', null]);
  });
});
