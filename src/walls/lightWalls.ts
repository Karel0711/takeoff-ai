import type { Pt } from '../model';
import type { Segment } from '../fill/vectors';
import { SegmentIndex, type WallRun } from './bands';
import { distToSeg } from './tags';

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/**
 * A wall a tag points at that is not drawn with the wall pen: walls shown above or
 * below the cut ("EW3A BELOW"), curtain walls with mullion ticks, dashed outlines.
 * The wall is the line the leader ends on, followed along its length across small
 * breaks (dashes, ticks), together with the lines drawn alongside it a wall
 * thickness or less away.
 */
export function lightWall(path: Pt[], index: SegmentIndex, tmax: number, walls: WallRun[]): WallRun | null {
  if (path.length < 2) return null;
  const end = path[path.length - 1];
  const prev = path[path.length - 2];
  const dl = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
  const lx = (end[0] - prev[0]) / dl;
  const ly = (end[1] - prev[1]) / dl;
  const segs = index.segs;
  // The line the leader ends on (not a piece of the leader itself); a leader can also
  // stop between a wall's two lines, or run alongside it.
  const onLeader = (x: number, y: number) =>
    path.slice(1).some((p, i) => distToSeg(x, y, { x1: path[i][0], y1: path[i][1], x2: p[0], y2: p[1], width: 0, filled: false }) < 0.3);
  let l0: Segment | null = null;
  // Nearest line crossing the leader's last stretch; a line running alongside it only
  // when none crosses within reach.
  search: for (const reach of [1.5, tmax / 2]) {
    for (const crossingOnly of [true, false]) {
      let best = reach;
      for (const i of index.query(end[0] - reach, end[1] - reach, end[0] + reach, end[1] + reach)) {
        const s = segs[i];
        if (s.filled || len(s) < 3 || (onLeader(s.x1, s.y1) && onLeader(s.x2, s.y2))) continue;
        const crossing = Math.abs((lx * (s.y2 - s.y1) - ly * (s.x2 - s.x1)) / len(s)) >= 0.5;
        if (crossingOnly !== crossing) continue;
        const d = distToSeg(end[0], end[1], s);
        if (d < best) {
          best = d;
          l0 = s;
        }
      }
      if (l0) break search;
    }
  }
  if (!l0) return null;
  const L0 = len(l0);
  const ux = (l0.x2 - l0.x1) / L0;
  const uy = (l0.y2 - l0.y1) / L0;
  const offsetOf = (x: number, y: number) => -uy * x + ux * y;
  const alongOf = (x: number, y: number) => ux * x + uy * y;
  const off0 = offsetOf(l0.x1, l0.y1);
  const parallel = (s: Segment) => len(s) >= 0.5 && Math.abs(ux * (s.y2 - s.y1) - uy * (s.x2 - s.x1)) / len(s) < 0.0175;
  /** Lines that may lie in the band from along-position s0 to s1, up to tmax either side. */
  const near = (s0: number, s1: number) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const t of [s0, s1]) {
      for (const o of [off0 - tmax - 1, off0 + tmax + 1]) {
        xs.push(ux * t - uy * o);
        ys.push(uy * t + ux * o);
      }
    }
    return index.query(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  };

  // Follow the line along its length across breaks up to 6 pt (dashes, mullion ticks).
  let s0 = Math.min(alongOf(l0.x1, l0.y1), alongOf(l0.x2, l0.y2));
  let s1 = Math.max(alongOf(l0.x1, l0.y1), alongOf(l0.x2, l0.y2));
  for (let grew = true, k = 0; grew && k < 200; k++) {
    grew = false;
    for (const i of near(s0 - 8, s1 + 8)) {
      const s = segs[i];
      if (s.filled || !parallel(s) || Math.abs(offsetOf(s.x1, s.y1) - off0) > 0.3) continue;
      const a = Math.min(alongOf(s.x1, s.y1), alongOf(s.x2, s.y2));
      const b = Math.max(alongOf(s.x1, s.y1), alongOf(s.x2, s.y2));
      if (b < s0 - 6 || a > s1 + 6) continue;
      if (a < s0 - 0.01 || b > s1 + 0.01) {
        s0 = Math.min(s0, a);
        s1 = Math.max(s1, b);
        grew = true;
      }
    }
  }
  // A wall that meets the line (a partition running into it, the wall at a corner)
  // ends this one: keep the stretch the tag points at.
  const atTag = alongOf(end[0], end[1]);
  for (const r of walls) {
    const Lr = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    const vx = (r.b[0] - r.a[0]) / Lr;
    const vy = (r.b[1] - r.a[1]) / Lr;
    const den = ux * vy - uy * vx;
    if (Math.abs(den) < 0.34) continue;
    // Point on the line: u·sa + n·off0 = r.a + v·t
    const px = -uy * off0;
    const py = ux * off0;
    const qx = r.a[0] - px;
    const qy = r.a[1] - py;
    const sa = (qx * vy - qy * vx) / den;
    const t = (qx * uy - qy * ux) / den;
    const reach = tmax + r.thickness / 2;
    if (t < -reach || t > Lr + reach) continue;
    if (sa < atTag && sa > s0) s0 = sa;
    if (sa > atTag && sa < s1) s1 = sa;
  }
  const span = s1 - s0;
  if (span < 3) return null;

  // The wall's other face: the lines alongside, each within a short step of the last.
  const offsets = [off0];
  for (const i of near(s0, s1)) {
    const s = segs[i];
    if (s.filled || !parallel(s)) continue;
    const a = Math.min(alongOf(s.x1, s.y1), alongOf(s.x2, s.y2));
    const b = Math.max(alongOf(s.x1, s.y1), alongOf(s.x2, s.y2));
    if (Math.min(b, s1) - Math.max(a, s0) < 0.3 * span) continue;
    const o = offsetOf(s.x1, s.y1);
    if (Math.abs(o - off0) <= tmax) offsets.push(o);
  }
  offsets.sort((m, n) => m - n);
  const at = offsets.indexOf(off0);
  let lo = off0;
  let hi = off0;
  const step = tmax / 2;
  for (let i = at - 1; i >= 0 && lo - offsets[i] <= step && hi - offsets[i] <= tmax; i--) lo = offsets[i];
  for (let i = at + 1; i < offsets.length && offsets[i] - hi <= step && offsets[i] - lo <= tmax; i++) hi = offsets[i];
  const c = (lo + hi) / 2;
  return {
    a: [ux * s0 - uy * c, uy * s0 + ux * c],
    b: [ux * s1 - uy * c, uy * s1 + ux * c],
    thickness: Math.max(hi - lo, 1),
  };
}
