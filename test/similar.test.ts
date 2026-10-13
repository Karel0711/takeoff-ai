import { describe, expect, it } from 'vitest';
import { buildWallModel, fillRoom } from '../src/fill/roomFill';
import { findSimilar } from '../src/fill/similar';
import type { Segment } from '../src/fill/vectors';

const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
let sub = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.57): Segment => ({ x1: pt(x1), y1: pt(y1), x2: pt(x2), y2: pt(y2), width, filled: false, sub: ++sub });
const rect = (x1: number, y1: number, x2: number, y2: number) => [seg(x1, y1, x2, y1), seg(x2, y1, x2, y2), seg(x2, y2, x1, y2), seg(x1, y2, x1, y1)];
/** A stipple: dots every 0.25 m in a box. */
function dots(x1: number, y1: number, x2: number, y2: number): Segment[] {
  const out: Segment[] = [];
  for (let x = x1 + 0.1; x < x2; x += 0.25) for (let y = y1 + 0.1; y < y2; y += 0.25) out.push(seg(x, y, x, y, 0.3));
  return out;
}

/** Wall lines drawn in pieces, as CAD exports them (pen detection wants a few dozen). */
const pieces = (s: Segment, n = 4): Segment[] =>
  Array.from({ length: n }, (_, i) => ({
    ...s,
    x1: s.x1 + ((s.x2 - s.x1) * i) / n,
    y1: s.y1 + ((s.y2 - s.y1) * i) / n,
    x2: s.x1 + ((s.x2 - s.x1) * (i + 1)) / n,
    y2: s.y1 + ((s.y2 - s.y1) * (i + 1)) / n,
  }));

// Three rooms in a row, 4 x 4 m each (inside faces), with 0.2 m walls.
const walls = [...rect(0, 0, 12.8, 4.4), ...rect(0.2, 0.2, 12.6, 4.2), ...[4.2, 4.4, 8.4, 8.6].map((x) => seg(x, 0.2, x, 4.2))].flatMap((s) => pieces(s));
const W = pt(30);
const H = pt(10);

describe('find areas hatched like a sample', () => {
  it('takes the other rooms with the same stipple to their walls, and leaves the plain one', () => {
    const segs = [...walls, ...dots(0.2, 0.2, 4.2, 4.2), ...dots(8.6, 0.2, 12.6, 4.2)];
    const model = buildWallModel(segs, MPP);
    const sample = fillRoom(model, [[pt(2), pt(2)]], W, H);
    expect(sample).toMatchObject({ ok: true });
    const found = findSimilar(segs, model, sample.ok ? sample.points : [], W, H);
    expect(found.pattern).toBe('S0.30 dot');
    expect(found.areas.map((a) => [a.how, Math.round(a.area * MPP * MPP)])).toEqual([['room', 16]]);
  });

  it('finds nothing to match in a plain room', () => {
    const model = buildWallModel(walls, MPP);
    const sample = fillRoom(model, [[pt(6), pt(2)]], W, H);
    expect(findSimilar(walls, model, sample.ok ? sample.points : [], W, H).pattern).toBeNull();
  });
});
