import { describe, expect, it } from 'vitest';
import { findGridHatch } from '../src/fill/hatchRegions';
import type { Segment } from '../src/fill/vectors';

let sub = 1;
const line = (x1: number, y1: number, x2: number, y2: number, width: number): Segment => ({ x1, y1, x2, y2, width, filled: false, sub: sub++ });
/** A ceiling grid over a box, cell `c` apart, in a thin pen. */
const grid = (x0: number, y0: number, x1: number, y1: number, c: number): Segment[] => {
  const out: Segment[] = [];
  for (let x = x0; x <= x1 + 0.01; x += c) out.push(line(x, y0, x, y1, 0.24));
  for (let y = y0; y <= y1 + 0.01; y += c) out.push(line(x0, y, x1, y, 0.24));
  return out;
};

describe('ceiling areas from the grid drawn', () => {
  // A corridor 100 x 400 hatched in two pieces either side of a doorway (a 4-point gap), walls in a
  // heavy pen either side, and a frame round empty paper in the hatch's pen.
  const segs: Segment[] = [
    ...grid(100, 100, 300, 200, 6.8),
    ...grid(304, 100, 500, 200, 6.8),
    line(100, 98, 500, 98, 0.84),
    line(100, 202, 500, 202, 0.84),
    line(100, 92, 500, 92, 0.84),
    line(100, 208, 500, 208, 0.84),
    line(600, 600, 1200, 600, 0.24),
    line(1200, 600, 1200, 1000, 0.24),
    line(1200, 1000, 600, 1000, 0.24),
    line(600, 1000, 600, 600, 0.24),
  ];

  it('finds the grid and the area it covers, joined across the doorway', () => {
    const g = findGridHatch(segs, null)!;
    expect(g.keys).toEqual(['S0.24 line0', 'S0.24 line90']);
    expect(g.cell).toBeCloseTo(6.8, 0);
    expect(g.regions).toHaveLength(1);
    // 400 x 100, give or take the outline's pixels.
    expect(g.regions[0].area / 40000).toBeGreaterThan(0.95);
    expect(g.regions[0].area / 40000).toBeLessThan(1.06);
  });

  it('finds nothing on a plan with no grid', () => {
    expect(findGridHatch(segs.slice(-8), null)).toBeNull();
  });
});
