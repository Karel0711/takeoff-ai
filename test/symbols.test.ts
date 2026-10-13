import { describe, expect, it } from 'vitest';
import { findSymbols } from '../src/fill/symbols';
import type { Segment } from '../src/fill/vectors';

const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.3): Segment => ({ x1, y1, x2, y2, width, filled: false });

/** A light fixture: a 6 x 3 rectangle with a cross, placed at (x, y), turned a quarter turn when `turned`. */
function fixture(x: number, y: number, turned = false): Segment[] {
  const pts: [number, number, number, number][] = [
    [-3, -1.5, 3, -1.5],
    [3, -1.5, 3, 1.5],
    [3, 1.5, -3, 1.5],
    [-3, 1.5, -3, -1.5],
    [-3, -1.5, 3, 1.5],
    [-3, 1.5, 3, -1.5],
    [0, -1.5, 0, -2.5],
  ];
  return pts.map(([a, b, c, d]) => (turned ? seg(x - b, y + a, x - d, y + c) : seg(x + a, y + b, x + c, y + d)));
}
/** Same outline, no cross: a different symbol. */
const plain = (x: number, y: number) => fixture(x, y).slice(0, 4);

describe('count by symbol', () => {
  const segs = [
    ...fixture(100, 100),
    ...fixture(200, 100),
    ...fixture(300, 250, true),
    ...plain(400, 100),
    // A wall line running past one fixture does not stop it matching.
    seg(150, 104, 260, 104, 0.6),
    // Its mirror image (the tail on the other side, flipped top to bottom) still counts.
    ...fixture(600, 100).map((x) => ({ ...x, y1: 200 - x.y1, y2: 200 - x.y2 })),
    // The same fixture drawn in a heavier pen is a different symbol.
    ...fixture(500, 100).map((s) => ({ ...s, width: 0.6 })),
  ];

  it('finds every copy of the sample, turned, mirrored or not, and nothing else', () => {
    const found = findSymbols(segs, [95, 95, 105, 105]);
    const at = found.map((f) => [Math.round(f.at[0]), Math.round(f.at[1])]).sort((a, b) => a[0] - b[0]);
    expect(at).toEqual([
      [100, 100],
      [200, 100],
      [300, 250],
      [600, 100],
    ]);
    expect(found.find((f) => Math.round(f.at[0]) === 300)?.turn).toBe(1);
  });

  it('needs a few lines to go on', () => {
    expect(findSymbols(segs, [0, 0, 10, 10])).toEqual([]);
  });
});
