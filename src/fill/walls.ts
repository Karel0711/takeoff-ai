import type { Segment } from './vectors';

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Line weights rounded to 0.01 pt; architects draw walls with one or two pens. */
export const widthKey = (s: Segment) => (s.filled ? 'fill' : s.width.toFixed(2));

export interface PenStats {
  key: string;
  segments: number;
  length: number;
  /** Length of this pen's lines that run parallel to another of its lines a wall-thickness away. */
  paired: number;
}

/** Spatial hash of segment midpoints, for neighbour queries. */
class Grid {
  private cells = new Map<string, Segment[]>();
  constructor(
    segs: Segment[],
    private size: number,
  ) {
    for (const s of segs) {
      const k = this.key((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      const list = this.cells.get(k);
      if (list) list.push(s);
      else this.cells.set(k, [s]);
    }
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  near(x: number, y: number, radius: number): Segment[] {
    const out: Segment[] = [];
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) out.push(...(this.cells.get(`${i},${j}`) ?? []));
    return out;
  }
}

/** How much of a lies alongside b: overlap of their projections on a's direction. */
function overlap(a: Segment, b: Segment, ux: number, uy: number): number {
  const p = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const a1 = 0;
  const a2 = len(a);
  const [b1, b2] = [p(b.x1, b.y1), p(b.x2, b.y2)].sort((m, n) => m - n);
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * Scores each pen by how much of its linework comes in parallel pairs a wall
 * thickness apart. Wall-type tag diamonds also have parallel sides, so a pair
 * only counts where the shared run is at least twice the gap (walls are long
 * and thin; tags are about as long as they are wide).
 */
export function penStats(segs: Segment[], minGap: number, maxGap: number): PenStats[] {
  const byPen = new Map<string, Segment[]>();
  for (const s of segs) {
    // Filled shapes count together as one "pen": walls drawn as solid poché with no outline.
    if (len(s) < 1) continue;
    const k = widthKey(s);
    const list = byPen.get(k);
    if (list) list.push(s);
    else byPen.set(k, [s]);
  }
  const out: PenStats[] = [];
  for (const [key, list] of byPen) {
    const length = list.reduce((n, s) => n + len(s), 0);
    if (list.length < 20 || list.length > 50000) {
      out.push({ key, segments: list.length, length, paired: 0 });
      continue;
    }
    const grid = new Grid(list, Math.max(16, maxGap * 2));
    let paired = 0;
    for (const a of list) {
      const L = len(a);
      if (L < 2 * minGap) continue;
      const ux = (a.x2 - a.x1) / L;
      const uy = (a.y2 - a.y1) / L;
      let best = 0;
      for (const b of grid.near((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, L / 2 + maxGap)) {
        if (b === a) continue;
        const Lb = len(b);
        const vx = (b.x2 - b.x1) / Lb;
        const vy = (b.y2 - b.y1) / Lb;
        if (Math.abs(ux * vy - uy * vx) > 0.035) continue;
        const d = Math.abs((b.x1 - a.x1) * -uy + (b.y1 - a.y1) * ux);
        if (d < minGap || d > maxGap) continue;
        const ov = overlap(a, b, ux, uy);
        if (ov >= 2 * d) best = Math.max(best, ov);
      }
      paired += best;
    }
    out.push({ key, segments: list.length, length, paired });
  }
  return out.sort((a, b) => b.paired - a.paired);
}

/**
 * The pens that draw walls. Hatching and furniture also come in parallel lines, so
 * pairing alone is not enough; by drafting convention cut walls get the heaviest pen.
 * Among pens with plenty of paired linework, take the heaviest, plus any pen at least
 * as heavy that pairs as well (some offices draw exterior walls heavier still).
 */
export function detectWallPens(stats: PenStats[]): string[] {
  const stroked = detectStrokedPens(stats);
  if (stroked.length) return stroked;
  // No outlined walls: walls drawn as solid fills only (poché), when the fills pair like walls.
  const fill = stats.find((s) => s.key === 'fill');
  return fill && fill.paired > 0 && fill.paired / fill.length >= 0.4 ? ['fill'] : [];
}

function detectStrokedPens(stats: PenStats[]): string[] {
  const most = Math.max(0, ...stats.filter((s) => s.key !== 'fill').map((s) => s.paired));
  if (most === 0) return [];
  // Wall pens draw mostly in parallel pairs. A sheet border or title block in the same pen
  // can pull its share down, so a looser share is accepted when no pen passes.
  for (const share of [0.5, 0.4]) {
    const candidates = stats.filter((s) => s.key !== 'fill' && s.paired >= most * 0.1 && s.paired / s.length >= share);
    if (!candidates.length) continue;
    const heaviest = candidates.reduce((a, b) => (Number(b.key) > Number(a.key) ? b : a));
    // Exterior walls are often drawn heavier than partitions: both count.
    return candidates.filter((s) => Number(s.key) >= Number(heaviest.key) * 0.55).map((s) => s.key);
  }
  return [];
}

/** Window openings: longer gaps are closed when other linework (glazing, frames) runs along them. */
export interface GlazingRule {
  lines: Segment[];
  maxGap: number;
  /** How far from the wall line glazing may sit (about a wall thickness). */
  band: number;
}

/**
 * Closes openings in walls (doors, windows) by joining wall lines that continue
 * on the same line across a gap no wider than `maxGap`. Joining the room-side
 * face lines puts the closure exactly on the inside face of the wall.
 */
export function bridgeGaps(walls: Segment[], maxGap: number, glazing?: GlazingRule): Segment[] {
  const lines = walls.filter((s) => len(s) >= 0.5);
  const reach = glazing ? Math.max(maxGap, glazing.maxGap) : maxGap;
  const grid = new Grid(lines, Math.max(16, reach));
  const other = glazing ? new Grid(glazing.lines, 32) : null;
  /** Share of the gap a→b covered by other linework running along it (window glazing, frames). */
  const glazed = (ax: number, ay: number, bx: number, by: number): number => {
    if (!other || !glazing) return 0;
    const L = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    const spans: [number, number][] = [];
    for (const s of other.near((ax + bx) / 2, (ay + by) / 2, L / 2 + glazing.band + 32)) {
      const Ls = len(s);
      if (Ls < 0.5) continue;
      if (Math.abs(ux * (s.y2 - s.y1) - uy * (s.x2 - s.x1)) / Ls > 0.035) continue;
      if (Math.abs((s.x1 - ax) * -uy + (s.y1 - ay) * ux) > glazing.band) continue;
      const t1 = (s.x1 - ax) * ux + (s.y1 - ay) * uy;
      const t2 = (s.x2 - ax) * ux + (s.y2 - ay) * uy;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(L, Math.max(t1, t2));
      if (hi > lo) spans.push([lo, hi]);
    }
    spans.sort((m, n) => m[0] - n[0]);
    let covered = 0;
    let end = 0;
    for (const [lo, hi] of spans) {
      if (hi <= end) continue;
      covered += hi - Math.max(lo, end);
      end = hi;
    }
    return covered / L;
  };
  const bridges: Segment[] = [];
  const seen = new Set<string>();
  for (const a of lines) {
    const La = len(a);
    const ux = (a.x2 - a.x1) / La;
    const uy = (a.y2 - a.y1) / La;
    for (const [ex, ey] of [
      [a.x1, a.y1],
      [a.x2, a.y2],
    ] as const) {
      // Nearest collinear segment beyond this end, on the far side of a gap. A line
      // that carries on from this end (CAD often splits walls into pieces) is no gap.
      let best: { x: number; y: number; d: number } | null = null;
      let continues = false;
      for (const b of grid.near(ex, ey, reach + 32)) {
        if (b === a) continue;
        const Lb = len(b);
        const vx = (b.x2 - b.x1) / Lb;
        const vy = (b.y2 - b.y1) / Lb;
        if (Math.abs(ux * vy - uy * vx) > 0.0175) continue; // 1°
        const off = Math.abs((b.x1 - a.x1) * -uy + (b.y1 - a.y1) * ux);
        if (off > 0.3) continue;
        // Must lie beyond this end along the line, not overlapping a.
        const t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
        const t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
        const atStart = ex === a.x1 && ey === a.y1;
        const near = atStart ? Math.max(t1, t2) : Math.min(t1, t2) - La;
        const gap = atStart ? -near : near;
        if (gap <= 0.2) {
          const lo = Math.min(t1, t2);
          const hi = Math.max(t1, t2);
          if (atStart ? lo < 0 : hi > La) {
            continues = true;
            break;
          }
          continue;
        }
        if (gap > reach) continue;
        if (best && gap >= best.d) continue;
        const t = atStart ? Math.max(t1, t2) : Math.min(t1, t2);
        const bx = a.x1 + ux * t;
        const by = a.y1 + uy * t;
        // Doors: any gap up to maxGap. Windows: longer gaps with glazing drawn along the wall.
        if (gap > maxGap && glazed(ex, ey, bx, by) < 0.7) continue;
        best = { x: bx, y: by, d: gap };
      }
      if (best && !continues) {
        const key = [ex, ey, best.x, best.y].map((v) => v.toFixed(2)).sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          bridges.push({ x1: ex, y1: ey, x2: best.x, y2: best.y, width: 0, filled: false });
        }
      }
    }
  }
  return bridges;
}
