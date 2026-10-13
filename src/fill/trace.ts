import type { Pt } from '../model';
import type { Segment } from './vectors';

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

function distToSeg([px, py]: Pt, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/**
 * Follows the drawn line under a click: from the nearest stroke, along strokes of the
 * same pen joined end to end (gaps up to `gap` points, as dashed lines have), as long
 * as the way on is clear: at a fork it carries on only straight ahead, and it stops
 * where the line turns back on itself. Returns the polyline, or null when nothing is
 * near the click.
 */
export function traceLine(segs: Segment[], at: Pt, reach: number, gap = 4): Pt[] | null {
  const strokes = segs.filter((s) => !s.filled && len(s) > 0.2);
  let start: Segment | null = null;
  let best = reach;
  for (const s of strokes) {
    const d = distToSeg(at, s);
    if (d < best) {
      best = d;
      start = s;
    }
  }
  if (!start) return null;
  const pen = start.width;
  const same = strokes.filter((s) => Math.abs(s.width - pen) <= 0.01 + pen * 0.03);
  // Ends indexed on a grid for quick lookups.
  const cell = Math.max(4, gap * 2);
  const grid = new Map<string, { s: Segment; end: 0 | 1 }[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const s of same) {
    for (const end of [0, 1] as const) {
      const [x, y] = end ? [s.x2, s.y2] : [s.x1, s.y1];
      const k = key(x, y);
      const list = grid.get(k);
      if (list) list.push({ s, end });
      else grid.set(k, [{ s, end }]);
    }
  }
  const near = (x: number, y: number) => {
    const out: { s: Segment; end: 0 | 1; d: number }[] = [];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const e of grid.get(`${cx + i},${cy + j}`) ?? []) {
          const [ex, ey] = e.end ? [e.s.x2, e.s.y2] : [e.s.x1, e.s.y1];
          const d = Math.hypot(ex - x, ey - y);
          if (d <= gap) out.push({ ...e, d });
        }
      }
    }
    return out;
  };

  const used = new Set<Segment>([start]);
  /** Walks on from (x, y), arriving in direction (ux, uy); returns the points passed. */
  const walk = (x: number, y: number, ux: number, uy: number): Pt[] => {
    const pts: Pt[] = [];
    for (let guard = 0; guard < 20000; guard++) {
      let pick: { s: Segment; end: 0 | 1; turn: number } | null = null;
      let ways = 0;
      for (const c of near(x, y)) {
        if (used.has(c.s)) continue;
        const [fx, fy, tx, ty] = c.end ? [c.s.x2, c.s.y2, c.s.x1, c.s.y1] : [c.s.x1, c.s.y1, c.s.x2, c.s.y2];
        const L = Math.hypot(tx - fx, ty - fy);
        const turn = ((tx - fx) * ux + (ty - fy) * uy) / L;
        // Never turn back sharply onto the way we came.
        if (turn < -0.2) continue;
        ways++;
        if (!pick || turn > pick.turn) pick = { s: c.s, end: c.end, turn };
      }
      // At a fork, only straight on is clear; a turn there could be any of the lines.
      if (!pick || (ways > 1 && pick.turn < 0.995)) break;
      used.add(pick.s);
      const [fx, fy, tx, ty] = pick.end ? [pick.s.x2, pick.s.y2, pick.s.x1, pick.s.y1] : [pick.s.x1, pick.s.y1, pick.s.x2, pick.s.y2];
      const L = Math.hypot(tx - fx, ty - fy);
      pts.push([fx, fy], [tx, ty]);
      [x, y, ux, uy] = [tx, ty, (tx - fx) / L, (ty - fy) / L];
    }
    return pts;
  };
  const L = len(start);
  const ux = (start.x2 - start.x1) / L;
  const uy = (start.y2 - start.y1) / L;
  const forward = walk(start.x2, start.y2, ux, uy);
  const backward = walk(start.x1, start.y1, -ux, -uy);
  const raw: Pt[] = [...backward.reverse(), [start.x1, start.y1], [start.x2, start.y2], ...forward];
  // Drop repeated points where strokes join, and points along straight stretches.
  const out: Pt[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last[0] - a[0]) * (p[1] - a[1]) - (last[1] - a[1]) * (p[0] - a[0]);
      const span = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const along = (last[0] - a[0]) * (p[0] - a[0]) + (last[1] - a[1]) * (p[1] - a[1]);
      if (span > 0 && Math.abs(cross) / span < 0.05 && along > 0) out[out.length - 1] = p;
      else out.push(p);
    } else out.push(p);
  }
  return out.length >= 2 ? out : null;
}
