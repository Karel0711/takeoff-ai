import type { Pt } from '../model';
import type { Segment } from '../fill/vectors';
import { findWallRuns, type WallRun } from './bands';
import { resolveTags, type TagText, type WallTag } from './tags';

export interface TypedRun extends WallRun {
  id: number;
  /** Wall types on this wall: at most one per kind (an exterior wall can also carry its furring). */
  tags: string[];
  /** How the types were found: a tag pointing at it, or carried along from a tagged wall it continues. */
  how: 'tag' | 'carried' | null;
}

export interface WallTakeoffResult {
  runs: TypedRun[];
  tags: WallTag[];
  /** Tags that point at no wall found. */
  unmatched: WallTag[];
}

export interface WallTakeoffOptions {
  /** Thinnest and thickest wall, in metres. */
  minThickness?: number;
  maxThickness?: number;
  /**
   * Where a wall that runs into the side of another stops: at the other wall's
   * centreline (`centre`, centreline measuring) or at its face.
   */
  tee?: 'centre' | 'face';
  /**
   * Where a tag's type spreads to untagged walls of the same thickness: nowhere,
   * along its own wall and round corners, or also into walls that run into it.
   */
  carry?: 'none' | 'wall' | 'wall+tees';
}

/** Kinds of wall tag. A wall has at most one of each; a tag's type spreads only within its kind. */
export function tagKind(code: string): string {
  const prefix = code.replace(/\d.*$/, '');
  if (prefix === 'EW') return 'exterior';
  if (prefix === 'FR') return 'furring';
  if (prefix === 'FW') return 'foundation';
  return 'partition';
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const runLength = (r: WallRun) => dist(r.a, r.b);

/**
 * Wall takeoff from vector linework: finds every wall (as a centreline with a
 * thickness), joins walls at corners and tees and splits them there, reads which
 * type each tag points at, and carries each type along the wall it tags (straight
 * on through junctions and round corners) to untagged pieces of the same thickness.
 */
export function wallTakeoff(
  wallLines: Segment[],
  allSegments: Segment[],
  texts: TagText[],
  metersPerPoint: number,
  options: WallTakeoffOptions = {},
): WallTakeoffResult {
  const { minThickness = 0.05, maxThickness = 0.65, tee = 'centre', carry = 'wall+tees' } = options;
  const pt = (m: number) => m / metersPerPoint;
  const found = findWallRuns(wallLines, pt(minThickness), pt(maxThickness)).filter(
    (r) => runLength(r) >= Math.max(pt(0.1), r.thickness * 0.5),
  );
  const runs: WallRun[] = found.map((r) => ({ ...r, a: [...r.a] as Pt, b: [...r.b] as Pt }));

  // Join ends at corners and tees; remember where to split the walls they meet.
  const splits = runs.map(() => [] as Pt[]);
  const corners: { r1: number; end1: 'a' | 'b'; r2: number; at: Pt }[] = [];
  const tees: { r1: number; end1: 'a' | 'b'; r2: number; at: Pt }[] = [];
  const moves: { run: WallRun; end: 'a' | 'b'; to: Pt }[] = [];
  runs.forEach((r, ri) => {
    for (const end of ['a', 'b'] as const) {
      const e = r[end];
      const o = end === 'a' ? r.b : r.a;
      const L = dist(e, o);
      const ux = (e[0] - o[0]) / L;
      const uy = (e[1] - o[1]) / L;
      let best: { x: number; r2: number; at: Pt; corner: boolean } | null = null;
      runs.forEach((r2, r2i) => {
        if (r2i === ri) return;
        const L2 = runLength(r2);
        const vx = (r2.b[0] - r2.a[0]) / L2;
        const vy = (r2.b[1] - r2.a[1]) / L2;
        const den = ux * vy - uy * vx;
        if (Math.abs(den) < 0.34) return; // under ~20°: not a junction
        const qx = r2.a[0] - e[0];
        const qy = r2.a[1] - e[1];
        const x = (qx * vy - qy * vx) / den;
        const s = (qx * uy - qy * ux) / den;
        const slack = r.thickness / 2 + 2;
        if (x < -1 || x > r2.thickness / 2 + 2 || s < -slack || s > L2 + slack) return;
        if (best && Math.abs(x) >= Math.abs(best.x)) return;
        best = { x, r2: r2i, at: [e[0] + ux * x, e[1] + uy * x], corner: s < slack || s > L2 - slack };
      });
      if (!best) continue;
      const b = best as { x: number; r2: number; at: Pt; corner: boolean };
      if (b.corner) {
        corners.push({ r1: ri, end1: end, r2: b.r2, at: b.at });
        moves.push({ run: r, end, to: b.at });
      } else {
        splits[b.r2].push(b.at);
        tees.push({ r1: ri, end1: end, r2: b.r2, at: b.at });
        if (tee === 'centre') moves.push({ run: r, end, to: b.at });
      }
    }
  });
  // Tags are matched against each wall as drawn, before its ends reach into junctions.
  const drawn = runs.map((r) => ({ ...r, a: [...r.a] as Pt, b: [...r.b] as Pt }));
  for (const m of moves) m.run[m.end] = m.to;

  // Walls crossing each other split each other too.
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const p = crossing(runs[i], runs[j]);
      if (p) {
        splits[i].push(p);
        splits[j].push(p);
      }
    }
  }

  // Split into pieces between junctions; pieces of one wall continue into each other.
  const pieces: TypedRun[] = [];
  const pieceRun: number[] = [];
  const firstPiece: number[] = [];
  const lastPiece: number[] = [];
  const links: [number, number][] = [];
  runs.forEach((r, ri) => {
    const L = runLength(r);
    const ux = (r.b[0] - r.a[0]) / L;
    const uy = (r.b[1] - r.a[1]) / L;
    const ts = splits[ri]
      .map((p) => (p[0] - r.a[0]) * ux + (p[1] - r.a[1]) * uy)
      .filter((t) => t > 1 && t < L - 1)
      .sort((m, n) => m - n)
      .filter((t, k, all) => k === 0 || t - all[k - 1] > 1);
    const at = (t: number): Pt => [r.a[0] + ux * t, r.a[1] + uy * t];
    const bounds = [0, ...ts, L];
    firstPiece[ri] = pieces.length;
    for (let k = 0; k < bounds.length - 1; k++) {
      if (k > 0) links.push([pieces.length - 1, pieces.length]);
      pieceRun.push(ri);
      pieces.push({ a: k === 0 ? r.a : at(bounds[k]), b: k === bounds.length - 2 ? r.b : at(bounds[k + 1]), thickness: r.thickness, id: pieces.length, tags: [], how: null });
    }
    lastPiece[ri] = pieces.length - 1;
  });
  const pieceAtEnd = (ri: number, end: 'a' | 'b') => (end === 'a' ? firstPiece[ri] : lastPiece[ri]);
  for (const c of corners) {
    const r2 = runs[c.r2];
    const end2 = dist(r2.a, c.at) <= dist(r2.b, c.at) ? 'a' : 'b';
    links.push([pieceAtEnd(c.r1, c.end1), pieceAtEnd(c.r2, end2)]);
  }
  // A wall running into the side of another: an untagged one is most likely the same type.
  for (const t of carry === 'wall+tees' ? tees : []) {
    const stem = pieceAtEnd(t.r1, t.end1);
    for (let i = firstPiece[t.r2]; i <= lastPiece[t.r2]; i++) {
      if (dist(pieces[i].a, t.at) < 1.5 || dist(pieces[i].b, t.at) < 1.5) links.push([stem, i]);
    }
  }

  // Types from tags: each tag labels the piece of wall it points at.
  const tags = resolveTags(texts, allSegments);
  const unmatched: WallTag[] = [];
  const tagged = pieces.map(() => new Map<string, { code: string; d: number }>());
  for (const tag of tags) {
    // Follow each leader out from the tag; the first point that lands on a wall is
    // what it points at, and the leader that gets there soonest wins. A tag with
    // no leader sits beside its wall.
    let bestRun = -1;
    let bestD = Infinity;
    let bestSteps = Infinity;
    const paths = tag.leader ? tag.paths : [[tag.target]];
    for (const path of paths) {
      for (let k = 0; k < Math.min(path.length, bestSteps); k++) {
        let hit = -1;
        let hitD = Infinity;
        drawn.forEach((r, ri) => {
          const d = distToRun(path[k], r);
          const limit = tag.leader ? r.thickness / 2 + 1.5 : pt(1.0);
          if (d <= limit && d - r.thickness / 2 < hitD) {
            hit = ri;
            hitD = d - r.thickness / 2;
          }
        });
        if (hit < 0) continue;
        if (k < bestSteps || hitD < bestD) {
          bestRun = hit;
          bestD = hitD;
          bestSteps = k;
          tag.target = path[k];
        }
        break;
      }
    }
    // The piece of that wall the tag points at.
    let best: TypedRun | null = null;
    let nearest = Infinity;
    for (let i = 0; i < pieces.length; i++) {
      if (pieceRun[i] !== bestRun) continue;
      const d = distToRun(tag.target, pieces[i]);
      if (d < nearest) {
        nearest = d;
        best = pieces[i];
      }
    }
    if (!best) {
      unmatched.push(tag);
      continue;
    }
    // Two tags of one kind on one piece: the one pointing more squarely at it wins.
    const kind = tagKind(tag.code);
    const prev = tagged[best.id].get(kind);
    if (!prev || bestD < prev.d) tagged[best.id].set(kind, { code: tag.code, d: bestD });
  }

  // Carry each kind along connected pieces of similar thickness; nearest tag wins.
  const adj = pieces.map(() => [] as number[]);
  for (const [i, j] of links) {
    if (Math.abs(pieces[i].thickness - pieces[j].thickness) > 0.6) continue;
    if (carry === 'none') continue;
    adj[i].push(j);
    adj[j].push(i);
  }
  const kinds = new Set(tagged.flatMap((m) => [...m.keys()]));
  const carried = pieces.map(() => new Map<string, string>());
  for (const kind of kinds) {
    const best = pieces.map(() => Infinity);
    const code: (string | null)[] = pieces.map(() => null);
    const queue: number[] = [];
    pieces.forEach((_, i) => {
      const t = tagged[i].get(kind);
      if (t) {
        best[i] = 0;
        code[i] = t.code;
        queue.push(i);
      }
    });
    // Dijkstra on piece centres (small graphs: a linear scan for the minimum is fine).
    const done = new Set<number>();
    while (queue.length) {
      let k = 0;
      for (let q = 1; q < queue.length; q++) if (best[queue[q]] < best[queue[k]]) k = q;
      const i = queue.splice(k, 1)[0];
      if (done.has(i)) continue;
      done.add(i);
      for (const j of adj[i]) {
        const d = best[i] + (runLength(pieces[i]) + runLength(pieces[j])) / 2;
        if (d < best[j]) {
          best[j] = d;
          code[j] = code[i];
          queue.push(j);
        }
      }
    }
    pieces.forEach((_, i) => {
      if (code[i] && !tagged[i].has(kind)) carried[i].set(kind, code[i]!);
    });
  }
  for (const p of pieces) {
    const own = [...tagged[p.id].values()].map((t) => t.code);
    const more = [...carried[p.id].values()];
    p.tags = [...own, ...more];
    p.how = own.length ? 'tag' : more.length ? 'carried' : null;
  }
  return { runs: pieces, tags, unmatched };
}

/** Where two wall centrelines cross, away from both walls' ends. */
function crossing(r: WallRun, q: WallRun): Pt | null {
  const L1 = runLength(r);
  const L2 = runLength(q);
  const ux = (r.b[0] - r.a[0]) / L1;
  const uy = (r.b[1] - r.a[1]) / L1;
  const vx = (q.b[0] - q.a[0]) / L2;
  const vy = (q.b[1] - q.a[1]) / L2;
  const den = ux * vy - uy * vx;
  if (Math.abs(den) < 0.34) return null;
  const qx = q.a[0] - r.a[0];
  const qy = q.a[1] - r.a[1];
  const t = (qx * vy - qy * vx) / den;
  const s = (qx * uy - qy * ux) / den;
  const m1 = q.thickness / 2 + 1;
  const m2 = r.thickness / 2 + 1;
  if (t < m1 || t > L1 - m1 || s < m2 || s > L2 - m2) return null;
  return [r.a[0] + ux * t, r.a[1] + uy * t];
}

function distToRun(p: Pt, r: WallRun): number {
  const wx = r.b[0] - r.a[0];
  const wy = r.b[1] - r.a[1];
  const L2 = wx * wx + wy * wy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - r.a[0]) * wx + (p[1] - r.a[1]) * wy) / L2)) : 0;
  return Math.hypot(p[0] - r.a[0] - wx * t, p[1] - r.a[1] - wy * t);
}

/** Total centreline length per wall type, in metres. */
export function lengthsByType(runs: TypedRun[], metersPerPoint: number): Map<string, { length: number; runs: number }> {
  const out = new Map<string, { length: number; runs: number }>();
  for (const r of runs) {
    const L = runLength(r) * metersPerPoint;
    for (const t of r.tags.length ? r.tags : ['(untagged)']) {
      const e = out.get(t) ?? { length: 0, runs: 0 };
      e.length += L;
      e.runs++;
      out.set(t, e);
    }
  }
  return out;
}
