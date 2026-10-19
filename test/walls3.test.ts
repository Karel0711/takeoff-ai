import { describe, expect, it } from 'vitest';
import { buildWallModel } from '../src/fill/roomFill';
import type { Segment } from '../src/fill/vectors';
import { bridgeGaps, detectWallPens, penStats } from '../src/fill/walls';
import { findWallRuns } from '../src/walls/bands';
import type { TagText } from '../src/walls/tags';
import { wallTakeoffByTags } from '../src/walls/tagPens';
import { lengthsByType, wallTakeoff } from '../src/walls/wallTakeoff';

/** 1:100 metric: metres per sheet point. */
const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
const T = 0.124;

/** A polyline in metres, each side chopped into 1 m pieces as CAD exports often do. */
function poly(width: number, ...pts: [number, number][]): Segment[] {
  return pts.slice(1).flatMap((p, i) => {
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - x1, p[1] - y1)));
    return Array.from({ length: n }, (_, k) => ({
      x1: pt(x1 + ((p[0] - x1) * k) / n),
      y1: pt(y1 + ((p[1] - y1) * k) / n),
      x2: pt(x1 + ((p[0] - x1) * (k + 1)) / n),
      y2: pt(y1 + ((p[1] - y1) * (k + 1)) / n),
      width,
      filled: false,
    }));
  });
}
const wall = (...pts: [number, number][]) => poly(0.57, ...pts);

/** A diamond tag around (x, y) metres with a leader to (lx, ly). */
function tag(code: string, x: number, y: number, leaderTo?: [number, number], width = 0.51): { text: TagText; segs: Segment[] } {
  const r = 0.45;
  const segs = poly(width, [x, y - r], [x + r, y], [x, y + r], [x - r, y], [x, y - r]);
  if (leaderTo) segs.push(...poly(width, [x, y + r], leaderTo));
  return { text: { code, cx: pt(x), cy: pt(y), w: 10.6, h: 4.9 }, segs };
}

/** A room 6 x 4 m of 0.2 m walls drawn in `width`, its corner at (x, y) metres. */
function room(x: number, y: number, width: number, t = 0.2): Segment[] {
  return [
    ...poly(width, [x, y], [x + 6, y], [x + 6, y + 4], [x, y + 4], [x, y]),
    ...poly(width, [x + t, y + t], [x + 6 - t, y + t], [x + 6 - t, y + 4 - t], [x + t, y + 4 - t], [x + t, y + t]),
  ];
}

describe('hatching is no wall pen', () => {
  it('counts evenly spaced parallel lines (hatching, stair treads) as a ladder, not wall pairs', () => {
    // A roof hatched with lines 0.15 m apart in a heavy pen, and a lighter pen drawing walls.
    const hatch: Segment[] = [];
    for (let i = 0; i < 80; i++) hatch.push(...poly(0.7, [20, i * 0.15], [32, i * 0.15]));
    const walls = [...room(0, 0, 0.35), ...room(0, 6, 0.35)];
    const stats = penStats([...hatch, ...walls], pt(0.06), pt(0.7));
    const h = stats.find((s) => s.key === '0.70')!;
    expect(h.ladder! / h.length).toBeGreaterThan(0.9);
    expect(h.paired / h.length).toBeLessThan(0.1);
    expect(detectWallPens(stats)).toEqual(['0.35']);
  });

  it('keeps a wall drawn with a middle layer (three evenly spaced lines) as wall pairs', () => {
    const walls = [...room(0, 0, 0.35, 0.2), ...room(0, 6, 0.35, 0.2)];
    // The middle layer: a third line halfway between the faces.
    const mid = [...poly(0.35, [0.1, 0.1], [5.9, 0.1], [5.9, 3.9], [0.1, 3.9], [0.1, 0.1]), ...poly(0.35, [0.1, 6.1], [5.9, 6.1], [5.9, 9.9], [0.1, 9.9], [0.1, 6.1])];
    const w = penStats([...walls, ...mid], pt(0.06), pt(0.7)).find((s) => s.key === '0.35')!;
    expect(w.ladder ?? 0).toBe(0);
    expect(w.paired / w.length).toBeGreaterThan(0.5);
  });

  it('gives up on a wall search that would test every line against thousands of others', () => {
    const hatch: Segment[] = [];
    for (let i = 0; i < 400; i++) hatch.push(...poly(0.7, [0, i * 0.1], [40, i * 0.1]), ...poly(0.7, [i * 0.1, 0], [i * 0.1, 40]));
    expect(findWallRuns(hatch, pt(0.05), pt(0.65), 1.5, 1e5)).toEqual([]);
    expect(findWallRuns(room(0, 0, 0.57), pt(0.05), pt(0.65), 1.5, 1e5).length).toBeGreaterThan(0);
  });
});

describe('tag boxes', () => {
  it('does not take the box round a tag, drawn in the wall pen, for a wall', () => {
    // A boxed tag 0.9 x 0.4 m in the wall pen, beside a wall, with a leader onto it.
    const box = poly(0.57, [2, 1], [2.9, 1], [2.9, 1.4], [2, 1.4], [2, 1]);
    const lines = [...wall([0, 0], [5, 0]), ...wall([0, T], [5, T]), ...box, ...wall([2.45, 1], [2.45, T])];
    const text: TagText = { code: 'W1', cx: pt(2.45), cy: pt(1.2), w: pt(0.3), h: pt(0.15) };
    const res = wallTakeoff(lines, lines, [text], MPP);
    expect(res.runs.every((r) => r.a[1] * MPP < 0.5)).toBe(true);
    expect(lengthsByType(res.runs, MPP).get('W1')?.length).toBeCloseTo(5, 1);
  });
});

describe('exterior types', () => {
  it('stay on the exterior wall: a partition of the same thickness running into it is not carried', () => {
    // Exterior wall along the top; a partition of the same thickness runs down from it.
    const s = 2.5 - T / 2;
    const lines = [
      ...wall([0, 0], [5, 0]),
      ...wall([0, T], [s, T]),
      ...wall([s + T, T], [5, T]),
      ...wall([s, T], [s, 3]),
      ...wall([s + T, T], [s + T, 3]),
      ...wall([s, 3], [s + T, 3]),
    ];
    const model = [...lines, ...bridgeGaps(lines, pt(3))];
    const t = tag('EW1', 1, 1, [1, T]);
    const res = wallTakeoff(model, [...lines, ...t.segs], [t.text], MPP);
    const by = lengthsByType(res.runs, MPP);
    expect(by.get('EW1')?.length).toBeCloseTo(5, 1);
  });
});

describe('walls drawn lighter, found by their tags', () => {
  it('takes a lighter paired pen as walls when the tags point at its walls and not the heavy ones', () => {
    // Existing walls in a heavy pen; new partitions in a light pen, too light for the sheet's pick.
    const heavy = room(0, 0, 1.4, 0.3);
    const light = [...wall([10, 0], [16, 0]), ...wall([10, 0.1], [16, 0.1]), ...wall([10, 3], [16, 3]), ...wall([10, 3.1], [16, 3.1])].map((s) => ({ ...s, width: 0.35 }));
    // Tags set beside their walls, with no leader.
    const t1 = tag('W1', 12, 0.65, undefined, 0.18);
    const t2 = tag('W1', 14, 2.45, undefined, 0.18);
    const segs = [...heavy, ...light, ...t1.segs, ...t2.segs];
    const model = buildWallModel(segs, MPP, { maxOpening: 3 });
    expect(model.pens).toEqual(['1.40']);
    const plain = wallTakeoff([...model.lines], segs, [t1.text, t2.text], MPP, { doors: model.openings });
    expect(plain.unmatched).toHaveLength(2);
    const res = wallTakeoffByTags(model, segs, [t1.text, t2.text], MPP, {}, (pens) => buildWallModel(segs, MPP, { pens, maxOpening: 3, stats: model.stats }));
    expect(res.unmatched).toHaveLength(0);
    expect(lengthsByType(res.runs, MPP).get('W1')?.length).toBeCloseTo(12, 0);
  });
});
