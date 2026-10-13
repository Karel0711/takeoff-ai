import { describe, expect, it } from 'vitest';
import { polylineLength } from '../src/geometry';
import { traceLine } from '../src/fill/trace';
import type { Segment } from '../src/fill/vectors';

const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.5): Segment => ({ x1, y1, x2, y2, width, filled: false });

describe('trace a line', () => {
  it('follows a dashed polyline in one pen round its corners, from a click anywhere on it', () => {
    // An L of dashes: 0→100 along y=0 (dash 8, gap 2), then down to y=50.
    const dashes: Segment[] = [];
    for (let x = 0; x < 100; x += 10) dashes.push(seg(x, 0, x + 8, 0));
    dashes.push(seg(98, 0, 100, 0));
    for (let y = 0; y < 50; y += 10) dashes.push(seg(100, y + 2, 100, y + 10));
    const other = [seg(0, 20, 100, 20, 0.25), seg(50, -30, 50, 30, 0.25)];
    const line = traceLine([...dashes, ...other], [55, 1], 5)!;
    expect(line[0]).toEqual([0, 0]);
    expect(line[line.length - 1]).toEqual([100, 50]);
    expect(polylineLength(line)).toBeCloseTo(150, 0);
  });

  it('finds nothing far from any line', () => {
    expect(traceLine([seg(0, 0, 10, 0)], [5, 50], 5)).toBeNull();
  });
});
