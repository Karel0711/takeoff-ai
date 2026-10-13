import type { Pt } from '../model';
import type { Segment } from './vectors';

export interface SymbolMatch {
  /** Centre of the matched symbol, in sheet points. */
  at: Pt;
  /** Quarter turns from the sample (0–3). */
  turn: number;
  /** Share of the sample's lines found at this place (0–1). */
  score: number;
}

type Line = { x1: number; y1: number; x2: number; y2: number; width: number };

const len = (s: Line) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Turns a point by quarter turns about the origin (sheet y points down). */
const rot = (x: number, y: number, turn: number): [number, number] =>
  turn === 0 ? [x, y] : turn === 1 ? [-y, x] : turn === 2 ? [-x, -y] : [y, -x];

/** Segments bucketed by midpoint for quick lookups around a point. */
class Index {
  private cells = new Map<string, Line[]>();
  constructor(
    lines: Line[],
    private size: number,
  ) {
    for (const s of lines) {
      const k = this.key((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      const list = this.cells.get(k);
      if (list) list.push(s);
      else this.cells.set(k, [s]);
    }
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  near(x: number, y: number): Line[] {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    const out: Line[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(this.cells.get(`${cx + i},${cy + j}`) ?? []));
    return out;
  }
}

/** Whether a sheet line has the same ends as a (moved, turned) sample line. */
const same = (s: Line, ax: number, ay: number, bx: number, by: number, width: number, tol: number) =>
  Math.abs(s.width - width) <= 0.02 + width * 0.05 &&
  ((Math.hypot(s.x1 - ax, s.y1 - ay) <= tol && Math.hypot(s.x2 - bx, s.y2 - by) <= tol) ||
    (Math.hypot(s.x1 - bx, s.y1 - by) <= tol && Math.hypot(s.x2 - ax, s.y2 - ay) <= tol));

/**
 * Finds every copy of the symbol drawn inside `box` (x0, y0, x1, y1): the same lines,
 * in the same pens, at the same size, moved and turned by quarter turns. CAD blocks
 * repeat exactly, so a copy must have nearly all of the sample's lines.
 */
export function findSymbols(segs: Segment[], box: [number, number, number, number], minScore = 0.85): SymbolMatch[] {
  const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const inBox = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // Lines too short to tell apart (dots, chord pieces under a point) are left out.
  const lines: Line[] = segs.filter((s) => len(s) >= 0.4);
  const sample = lines.filter((s) => inBox(s.x1, s.y1) && inBox(s.x2, s.y2));
  if (sample.length < 2) return [];
  const rel = sample.map((s) => ({ x1: s.x1 - cx, y1: s.y1 - cy, x2: s.x2 - cx, y2: s.y2 - cy, width: s.width }));
  const span = Math.max(x1 - x0, y1 - y0);
  const tol = Math.max(0.35, span * 0.01);
  const index = new Index(lines, Math.max(4, span / 2));

  // Anchor: the sample line whose length and pen are rarest on the sheet.
  const count = (a: Line) => lines.filter((s) => Math.abs(s.width - a.width) <= 0.02 + a.width * 0.05 && Math.abs(len(s) - len(a)) <= tol).length;
  const longest = [...rel].sort((a, b) => len(b) - len(a)).slice(0, 6);
  const anchor = longest.reduce((a, b) => (count(b) < count(a) ? b : a));
  const aLen = len(anchor);
  const candidates = lines.filter((s) => Math.abs(s.width - anchor.width) <= 0.02 + anchor.width * 0.05 && Math.abs(len(s) - aLen) <= tol);

  const found: SymbolMatch[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const turned = rel.map((s) => {
      const [ax, ay] = rot(s.x1, s.y1, turn);
      const [bx, by] = rot(s.x2, s.y2, turn);
      return { ax, ay, bx, by, width: s.width };
    });
    const [pax, pay] = rot(anchor.x1, anchor.y1, turn);
    const [pbx, pby] = rot(anchor.x2, anchor.y2, turn);
    for (const c of candidates) {
      // The candidate's ends match the anchor's either way round: two possible places.
      for (const [ox, oy] of [
        [c.x1 - pax, c.y1 - pay],
        [c.x1 - pbx, c.y1 - pby],
      ]) {
        if (!same(c, pax + ox, pay + oy, pbx + ox, pby + oy, anchor.width, tol)) continue;
        if (found.some((f) => Math.hypot(f.at[0] - ox, f.at[1] - oy) < span / 2)) continue;
        let hits = 0;
        for (let i = 0; i < turned.length; i++) {
          const t = turned[i];
          const ax = t.ax + ox;
          const ay = t.ay + oy;
          const bx = t.bx + ox;
          const by = t.by + oy;
          if (index.near((ax + bx) / 2, (ay + by) / 2).some((s) => same(s, ax, ay, bx, by, t.width, tol))) hits++;
          // Stop early once a match is out of reach.
          if (hits + (turned.length - i - 1) < minScore * turned.length) break;
        }
        const score = hits / turned.length;
        if (score >= minScore) found.push({ at: [ox, oy], turn, score });
      }
    }
    // A symmetric symbol matches itself again turned: those places are already found.
  }
  return found;
}
