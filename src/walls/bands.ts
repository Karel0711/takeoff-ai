import type { Pt } from '../model';
import type { Segment } from '../fill/vectors';

/** A straight wall: its centreline (sheet points) and thickness between its faces. */
export interface WallRun {
  a: Pt;
  b: Pt;
  thickness: number;
}

/** Segments indexed by every grid cell their bounding box covers, for short-range queries. */
export class SegmentIndex {
  private cells = new Map<string, number[]>();
  constructor(
    readonly segs: Segment[],
    private size = 16,
  ) {
    segs.forEach((s, i) => {
      const [cx0, cy0] = this.cell(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2));
      const [cx1, cy1] = this.cell(Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
      for (let x = cx0; x <= cx1; x++) {
        for (let y = cy0; y <= cy1; y++) {
          const k = `${x},${y}`;
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
      }
    });
  }
  private cell(x: number, y: number) {
    return [Math.floor(x / this.size), Math.floor(y / this.size)];
  }
  /** Indexes of segments that may pass within the box. */
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const [cx0, cy0] = this.cell(Math.min(x0, x1), Math.min(y0, y1));
    const [cx1, cy1] = this.cell(Math.max(x0, x1), Math.max(y0, y1));
    // Each once, in the order first met (a stamp per query rather than a Set: this runs per wall line).
    const seen = (this.seen ??= new Uint32Array(this.segs.length));
    const stamp = ++this.queries;
    const out: number[] = [];
    for (let x = cx0; x <= cx1; x++)
      for (let y = cy0; y <= cy1; y++)
        for (const i of this.cells.get(`${x},${y}`) ?? [])
          if (seen[i] !== stamp) {
            seen[i] = stamp;
            out.push(i);
          }
    return out;
  }
  private queries = 0;
  private seen: Uint32Array | null = null;
}

interface Piece {
  /** Unit direction, normalised so pieces of one wall agree. */
  ux: number;
  uy: number;
  /** Signed distance of the centreline from the origin, along the normal (-uy, ux). */
  offset: number;
  t0: number;
  t1: number;
  thickness: number;
}

/**
 * Finds walls as bands between pairs of parallel wall lines a wall-thickness apart.
 * Every wall line is sampled; from each sample a ray goes out to either side and
 * stops at the first line it meets. Where that is a parallel line between `tmin`
 * and `tmax` away, the two lines are the faces of a wall. Lines across door
 * openings (bridges) carry walls through doors.
 */
export function findWallRuns(lines: Segment[], tmin: number, tmax: number, step = 1.5): WallRun[] {
  const segs = lines.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 0.5);
  const index = new SegmentIndex(segs);
  const pieces: Piece[] = [];
  // A ray's hit may lie up to 1% of a line's length past its end: the lines, so lengthened, by the
  // cells they cover (for looking round a ray), and the cells the lines themselves cover (16 pt,
  // as `index`), which say whether and where a line comes in `index.query`'s answer.
  const ext = segs.map((s) => {
    const k = 0.0101;
    const [dx, dy] = [(s.x2 - s.x1) * k, (s.y2 - s.y1) * k];
    return { ...s, x1: s.x1 - dx, y1: s.y1 - dy, x2: s.x2 + dx, y2: s.y2 + dy };
  });
  const around = new SegmentIndex(ext, 16);
  const cellOf = (v: number) => Math.floor(v / 16);
  const rx0 = Int32Array.from(segs, (s) => cellOf(Math.min(s.x1, s.x2)));
  const ry0 = Int32Array.from(segs, (s) => cellOf(Math.min(s.y1, s.y2)));
  const rx1 = Int32Array.from(segs, (s) => cellOf(Math.max(s.x1, s.x2)));
  const ry1 = Int32Array.from(segs, (s) => cellOf(Math.max(s.y1, s.y2)));

  segs.forEach((a, ai) => {
    const La = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    const ux = (a.x2 - a.x1) / La;
    const uy = (a.y2 - a.y1) / La;
    const n = Math.max(1, Math.round(La / step));
    const box = [Math.min(a.x1, a.x2) - tmax - 1, Math.min(a.y1, a.y2) - tmax - 1, Math.max(a.x1, a.x2) + tmax + 1, Math.max(a.y1, a.y2) + tmax + 1];
    const [ax0, ay0, ax1, ay1] = box.map(cellOf);
    // A short line: every line near it, as `index.query` lists them. A long one (on a busy sheet
    // thousands of lines are near it): per ray, the lines round the ray's first tmax that that
    // list has, in its order (by the first of its cells they cover, then as drawn).
    const few = (ax1 - ax0 + 1) * (ay1 - ay0 + 1) <= 12;
    const near = few ? index.query(box[0], box[1], box[2], box[3]) : [];
    const inNear = (b: number) => rx1[b] >= ax0 && rx0[b] <= ax1 && ry1[b] >= ay0 && ry0[b] <= ay1;
    const firstX = (b: number) => Math.max(rx0[b], ax0);
    const firstY = (b: number) => Math.max(ry0[b], ay0);
    for (const side of [1, -1]) {
      const nx = -uy * side;
      const ny = ux * side;
      // Hit per sample: [line index, distance] or null.
      const hits: ([number, number] | null)[] = [];
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) * La) / n;
        const px = a.x1 + ux * t;
        const py = a.y1 + uy * t;
        let best = Infinity;
        let bestIdx = -1;
        // Only a hit up to tmax away counts (a nearer one past it leaves the sample without a face):
        // the lines of `near` round the ray's first tmax, in `near`'s order (the first of equal hits wins).
        const [ex, ey] = [px + nx * tmax, py + ny * tmax];
        const along = few ? near : around.query(Math.min(px, ex) - 1, Math.min(py, ey) - 1, Math.max(px, ex) + 1, Math.max(py, ey) + 1);
        // Of equal hits, the one `near` lists first (`along` is not in its order when looked up round the ray).
        const before = (p: number, q: number) => firstX(p) - firstX(q) || firstY(p) - firstY(q) || p - q;
        for (const bi of along) {
          if (bi === ai || (!few && !inNear(bi))) continue;
          const b = segs[bi];
          const wx = b.x2 - b.x1;
          const wy = b.y2 - b.y1;
          const den = nx * wy - ny * wx;
          if (Math.abs(den) < 1e-9) continue; // runs along the ray
          const qx = b.x1 - px;
          const qy = b.y1 - py;
          const x = (qx * wy - qy * wx) / den;
          const s = (qx * ny - qy * nx) / den;
          if (x <= 0.2 || x > best || s < -0.01 || s > 1.01) continue;
          if (x === best && (few || before(bi, bestIdx) > 0)) continue;
          best = x;
          bestIdx = bi;
        }
        if (bestIdx < 0 || best < tmin || best > tmax) {
          hits.push(null);
          continue;
        }
        const b = segs[bestIdx];
        const Lb = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
        const parallel = Math.abs(ux * (b.y2 - b.y1) - uy * (b.x2 - b.x1)) / Lb < 0.035;
        hits.push(parallel ? [bestIdx, best] : null);
      }
      // Runs of consecutive samples against the same opposite face.
      for (let i = 0; i < n; ) {
        const h = hits[i];
        if (!h) {
          i++;
          continue;
        }
        let j = i;
        let sum = 0;
        while (j < n && hits[j] && hits[j]![0] === h[0] && Math.abs(hits[j]![1] - h[1]) < 0.3) sum += hits[j++]![1];
        const d = sum / (j - i);
        const b = segs[h[0]];
        const pb1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
        const pb2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
        const lo = Math.max(0, Math.min(pb1, pb2), i === 0 ? 0 : ((i + 0.5) * La) / n - La / n / 2);
        const hi = Math.min(La, Math.max(pb1, pb2), j === n ? La : ((j - 0.5) * La) / n + La / n / 2);
        if (hi - lo > 0.3) pieces.push(piece(a.x1 + nx * (d / 2), a.y1 + ny * (d / 2), ux, uy, lo, hi, d));
        i = j;
      }
    }
  });
  return mergePieces(pieces);
}

/** A piece of centreline from p + u·t0 to p + u·t1, normalised to a canonical direction. */
function piece(px: number, py: number, ux: number, uy: number, t0: number, t1: number, thickness: number): Piece {
  // Canonical direction: pointing right, or down when vertical.
  if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
    [t0, t1] = [-t1, -t0];
  }
  const along = px * ux + py * uy;
  return { ux, uy, offset: -uy * px + ux * py, t0: along + t0, t1: along + t1, thickness };
}

/** Joins the pieces found from both faces (and from split lines) into whole runs. */
function mergePieces(pieces: Piece[]): WallRun[] {
  const groups: Piece[][] = [];
  const sorted = [...pieces].sort((p, q) => p.offset - q.offset);
  for (const p of sorted) {
    const g = groups.find((g) => {
      const q = g[0];
      return Math.abs(p.ux * q.uy - p.uy * q.ux) < 0.0175 && Math.abs(p.offset - q.offset) < Math.min(1, 0.15 * q.thickness) && Math.abs(p.thickness - q.thickness) < 0.8;
    });
    if (g) g.push(p);
    else groups.push([p]);
  }
  const runs: WallRun[] = [];
  for (const g of groups) {
    const { ux, uy } = g[0];
    const offset = g.reduce((n, p) => n + p.offset, 0) / g.length;
    const thickness = g.reduce((n, p) => n + p.thickness, 0) / g.length;
    const spans = g.map((p) => [p.t0, p.t1]).sort((m, n) => m[0] - n[0]);
    let [s0, s1] = spans[0];
    const flush = () => {
      if (s1 - s0 < 1) return;
      runs.push({ a: [ux * s0 - uy * offset, uy * s0 + ux * offset], b: [ux * s1 - uy * offset, uy * s1 + ux * offset], thickness });
    };
    // Short breaks (a column, a pilaster, the end of a crossing wall interrupting a
    // face) are still the same wall.
    const join = Math.max(2, 2.5 * thickness);
    for (const [t0, t1] of spans.slice(1)) {
      if (t0 <= s1 + join) s1 = Math.max(s1, t1);
      else {
        flush();
        [s0, s1] = [t0, t1];
      }
    }
    flush();
  }
  return runs;
}
