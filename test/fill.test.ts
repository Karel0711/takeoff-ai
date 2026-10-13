import { describe, expect, it } from 'vitest';
import { ringArea } from '../src/geometry';
import type { Pt } from '../src/model';
import { fillHoles, floodFill, makeGrid, drawSegments, simplify, traceBoundary } from '../src/fill/raster';
import { buildWallModel, fillRoom, snapToLines } from '../src/fill/roomFill';
import type { Segment } from '../src/fill/vectors';
import { bridgeGaps, detectWallPens, penStats } from '../src/fill/walls';

/** 1:100 metric: metres per sheet point. */
const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
const WALL = 0.57;
const FURNITURE = 0.28;

/** A line in metres, chopped into pieces of at most 1 m as CAD exports often do. */
function line(x1: number, y1: number, x2: number, y2: number, width = WALL): Segment[] {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const b = (i + 1) / n;
    out.push({
      x1: pt(x1 + (x2 - x1) * a),
      y1: pt(y1 + (y2 - y1) * a),
      x2: pt(x1 + (x2 - x1) * b),
      y2: pt(y1 + (y2 - y1) * b),
      width,
      filled: false,
    });
  }
  return out;
}

/** A vertical wall from y1 to y2 at x, `t` thick, with openings [from, to] along it. */
function vWall(x: number, y1: number, y2: number, t: number, openings: [number, number][] = []): Segment[] {
  const spans: [number, number][] = [];
  let y = y1;
  for (const [a, b] of openings) {
    spans.push([y, a]);
    y = b;
  }
  spans.push([y, y2]);
  return spans.flatMap(([a, b]) => [...line(x, a, x, b), ...line(x + t, a, x + t, b)]);
}

function rect(x1: number, y1: number, x2: number, y2: number, width: number): Segment[] {
  return [...line(x1, y1, x2, y1, width), ...line(x2, y1, x2, y2, width), ...line(x2, y2, x1, y2, width), ...line(x1, y2, x1, y1, width)];
}

/**
 * A 20 x 10 m building, 0.2 m walls, split by an interior wall at x = 10 with a
 * 0.9 m door. Room A inside: 9.8 x 9.6 m; room B: 9.6 x 9.6 m.
 */
function building(door: [number, number] = [4, 4.9]): Segment[] {
  return [
    ...rect(0, 0, 20, 10, WALL),
    ...rect(0.2, 0.2, 19.8, 9.8, WALL),
    ...vWall(10, 0.2, 9.8, 0.2, [door]),
    // Furniture: a table and a bed in room A, drawn with a light pen.
    ...rect(2, 2, 4, 3, FURNITURE),
    ...rect(5, 6, 7, 8.5, FURNITURE),
    ...line(2, 2, 4, 3, FURNITURE),
  ];
}

const W = pt(20) + 50;
const H = pt(10) + 50;
const sqm = (points: Pt[]) => ringArea(points) * MPP * MPP;

describe('flood fill', () => {
  it('finds the wall pen, not the furniture pen', () => {
    const segs = building();
    const pens = detectWallPens(penStats(segs, pt(0.06), pt(0.7)));
    expect(pens).toEqual([WALL.toFixed(2)]);
  });

  it('bridges a door gap on both wall faces', () => {
    const walls = vWall(10, 0.2, 9.8, 0.2, [[4, 4.9]]);
    const bridges = bridgeGaps(walls, pt(3));
    expect(bridges).toHaveLength(2);
    for (const b of bridges) expect(Math.abs(b.y2 - b.y1) * MPP).toBeCloseTo(0.9, 3);
  });

  it('leaves a gap wider than the opening limit open unless glazing runs along it', () => {
    const walls = vWall(10, 0.2, 9.8, 0.2, [[2, 7]]);
    expect(bridgeGaps(walls, pt(3))).toHaveLength(0);
    const glass = line(10.1, 2, 10.1, 7, 0.4);
    expect(bridgeGaps(walls, pt(3), { lines: glass, maxGap: pt(10), band: pt(0.7) })).toHaveLength(2);
  });

  it('fills a room to the inside face of the walls, ignoring furniture and the door', () => {
    const model = buildWallModel(building(), MPP);
    const a = fillRoom(model, [[pt(3), pt(5)]], W, H);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(sqm(a.points)).toBeCloseTo(9.8 * 9.6, 2);
    expect(a.points).toHaveLength(4);
    const b = fillRoom(model, [[pt(15), pt(5)]], W, H);
    expect(b.ok && sqm(b.points)).toBeCloseTo(9.6 * 9.6, 2);
  });

  it('a click inside furniture still fills the whole room', () => {
    const model = buildWallModel(building(), MPP);
    const r = fillRoom(model, [[pt(6), pt(7)]], W, H);
    expect(r.ok && sqm(r.points)).toBeCloseTo(9.8 * 9.6, 2);
  });

  it('an opening wider than the limit joins the rooms', () => {
    const segs = building([2, 7]);
    const open = fillRoom(buildWallModel(segs, MPP, { maxOpening: 3 }), [[pt(3), pt(5)]], W, H);
    expect(open.ok && sqm(open.points)).toBeGreaterThan(180);
    const closed = fillRoom(buildWallModel(segs, MPP, { maxOpening: 6 }), [[pt(3), pt(5)]], W, H);
    expect(closed.ok && sqm(closed.points)).toBeCloseTo(9.8 * 9.6, 2);
  });

  it('reports open spaces, clicks on walls, sheets without walls and joins across walls', () => {
    const model = buildWallModel(building(), MPP);
    expect(fillRoom(model, [[pt(25), pt(5)]], pt(30), H)).toEqual({ ok: false, reason: 'not-closed' });
    expect(fillRoom(buildWallModel([], MPP), [[10, 10]], W, H)).toEqual({ ok: false, reason: 'no-walls' });
    const solid = buildWallModel([...rect(0, 0, 20, 10, WALL), ...rect(0.2, 0.2, 19.8, 9.8, WALL), ...vWall(10, 0.2, 9.8, 0.2)], MPP);
    expect(fillRoom(solid, [[pt(3), pt(5)], [pt(15), pt(5)]], W, H)).toEqual({ ok: false, reason: 'not-connected' });
  });

  it('Shift-join merges the spaces either side of a closed opening, with the opening', () => {
    const model = buildWallModel(building(), MPP);
    expect(model.openings).toHaveLength(1);
    const both = fillRoom(model, [[pt(3), pt(5)], [pt(15), pt(5)]], W, H);
    expect(both.ok).toBe(true);
    if (both.ok) expect(sqm(both.points)).toBeCloseTo(9.8 * 9.6 + 9.6 * 9.6 + 0.2 * 0.9, 1);
    // Both clicks in one room is just that room.
    const same = fillRoom(model, [[pt(3), pt(5)], [pt(6), pt(2)]], W, H);
    expect(same.ok && sqm(same.points)).toBeCloseTo(9.8 * 9.6, 2);
  });
});

describe('raster helpers', () => {
  it('traces a filled square back to its four corners', () => {
    const g = makeGrid(0, 0, 20, 20, 1);
    drawSegments(g, [
      { x1: 2, y1: 2, x2: 17, y2: 2, width: 1, filled: false },
      { x1: 17, y1: 2, x2: 17, y2: 17, width: 1, filled: false },
      { x1: 17, y1: 17, x2: 2, y2: 17, width: 1, filled: false },
      { x1: 2, y1: 17, x2: 2, y2: 2, width: 1, filled: false },
      // An island inside, which fillHoles absorbs.
      { x1: 8, y1: 8, x2: 11, y2: 11, width: 1, filled: false },
    ]);
    const f = floodFill(g, 9, 5);
    expect(f.touchesEdge).toBe(false);
    const region = fillHoles(f.region, g.w, g.h);
    const corners = simplify(traceBoundary(region, g.w, g.h), 0.5);
    expect(corners).toHaveLength(4);
    expect(Math.abs(ringArea(corners))).toBe(f.pixels + (region.reduce((n, v) => n + v, 0) - f.pixels));
  });

  it('snaps a slightly-off outline onto the drawn lines', () => {
    const lines: Segment[] = [
      { x1: 0, y1: 0, x2: 100, y2: 0, width: 0.5, filled: false },
      { x1: 100, y1: 0, x2: 100, y2: 50, width: 0.5, filled: false },
      { x1: 100, y1: 50, x2: 0, y2: 50, width: 0.5, filled: false },
      { x1: 0, y1: 50, x2: 0, y2: 0, width: 0.5, filled: false },
    ];
    const rough: Pt[] = [
      [0.3, 0.4],
      [99.6, 0.3],
      [99.7, 49.6],
      [0.4, 49.7],
    ];
    const snapped = snapToLines(rough, lines, 1);
    expect(Math.abs(ringArea(snapped))).toBeCloseTo(5000, 6);
  });
});
