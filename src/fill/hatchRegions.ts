import type { Pt } from '../model';
import { pointInRing } from './similar';
import { marksOf } from './marks';
import { simplify, traceBoundary } from './raster';
import { detectWallPens, penStats } from './walls';
import type { Segment } from './vectors';
import { maxOf, minOf } from '../arrays';

export interface HatchRegion {
  points: Pt[];
  /** In square points. */
  area: number;
}

/**
 * Every area on the sheet covered by the same hatch as the sample: a ceiling grid, a tile
 * pattern. The hatch's lines are joined across the gaps a doorway or a wall end leaves in
 * them (up to about a hatch cell), so a corridor hatched in pieces comes back as one area,
 * outlined where its hatching stops.
 */
export function hatchRegions(segs: Segment[], sample: Pt[], options: { res?: number; minCells?: number } = {}): HatchRegion[] {
  const marks = marksOf(segs).filter((m) => m.line && !m.glyph);
  const inside = marks.filter((m) => pointInRing([m.cx, m.cy], sample));
  // The hatch: the line families with several lines in the sample.
  const counts = new Map<string, number>();
  for (const m of inside) counts.set(m.key, (counts.get(m.key) ?? 0) + 1);
  const keys = new Set([...counts].filter(([, n]) => n >= 3).map(([k]) => k));
  if (!keys.size) return [];

  // The hatch cell: the widest gap between neighbouring parallel lines in the sample.
  let cell = 0;
  for (const key of keys) {
    const fam = inside.filter((m) => m.key === key);
    const [x1, y1, x2, y2] = fam[0].line!;
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / L;
    const ny = (x2 - x1) / L;
    const offs = [...new Set(fam.map((m) => Math.round((m.cx * nx + m.cy * ny) * 4) / 4))].sort((a, b) => a - b);
    const gaps = offs.slice(1).map((o, i) => o - offs[i]).filter((g) => g > 0.3);
    if (gaps.length) cell = Math.max(cell, gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]);
  }
  if (!cell) return [];

  return hatchRegionsOf(segs, [...keys], cell, options);
}

/** The areas covered by hatch lines of `keys` spaced about `cell` apart, joined across gaps up to a cell. */
export function hatchRegionsOf(segs: Segment[], keys: string[], cell: number, options: { res?: number; minCells?: number } = {}): HatchRegion[] {
  const wanted = new Set(keys);
  const lines = marksOf(segs).filter((m) => m.line && !m.glyph && wanted.has(m.key));
  if (!lines.length) return [];
  // Raster over the hatch's extent.
  const res = options.res ?? Math.min(1, 6 / cell);
  const pad = cell * 2;
  const xs = lines.flatMap((m) => [m.line![0], m.line![2]]);
  const ys = lines.flatMap((m) => [m.line![1], m.line![3]]);
  const x0 = minOf(xs) - pad;
  const y0 = minOf(ys) - pad;
  const w = Math.ceil((maxOf(xs) + pad - x0) * res);
  const h = Math.ceil((maxOf(ys) + pad - y0) * res);
  const mask = new Uint8Array(w * h);
  for (const m of lines) {
    const [ax, ay, bx, by] = m.line!.map((v, i) => (v - (i % 2 ? y0 : x0)) * res);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(ax + ((bx - ax) * i) / steps);
      const py = Math.round(ay + ((by - ay) * i) / steps);
      if (px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = 1;
    }
  }
  // Closing with a square a cell and a bit across: the hatch's cells fill, and gaps up to
  // that size close; the outline comes back to where the hatch stops.
  const r = Math.max(1, Math.ceil(cell * 0.6 * res));
  const shut = erode(dilate(mask, w, h, r), w, h, r);
  // Then opening, smaller: a lone line in the hatch's pen (a leader, a centreline) is no area.
  const ro = Math.max(1, Math.ceil(cell * 0.3 * res));
  const closed = dilate(erode(shut, w, h, ro), w, h, ro);

  // Each joined area.
  const seen = new Uint8Array(w * h);
  const out: HatchRegion[] = [];
  const minPixels = (options.minCells ?? 4) * cell * cell * res * res;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!closed[start] || seen[start]) continue;
    const region = new Uint8Array(w * h);
    let top = 0;
    let n = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      region[i] = 1;
      n++;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of neighbours) {
        if (j < 0 || j >= w * h || seen[j] || !closed[j]) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    if (n < minPixels) continue;
    // Hatched throughout: a grid draws about two cells' length of line per cell, a frame
    // round empty paper far less.
    let hatch = 0;
    for (const m of lines) {
      const px = Math.floor((m.cx - x0) * res);
      const py = Math.floor((m.cy - y0) * res);
      if (px >= 0 && py >= 0 && px < w && py < h && region[py * w + px]) hatch += m.length;
    }
    if (hatch < (n / (res * res) / cell) * 0.3) continue;
    const ring = simplify(traceBoundary(region, w, h), 1).map(([x, y]) => [x0 + x / res, y0 + y / res] as Pt);
    if (ring.length >= 3) out.push({ points: ring, area: n / (res * res) });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** Square max filter of radius r, row then column. */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return pass(pass(src, w, h, r, true, true), w, h, r, false, true);
}

/** Square min filter of radius r, row then column. */
function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return pass(pass(src, w, h, r, true, false), w, h, r, false, false);
}

/** One direction of a box filter: max (dilate) or min (erode) over a window of 2r+1, by running counts. */
function pass(src: Uint8Array, w: number, h: number, r: number, rows: boolean, max: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  const [outer, inner] = rows ? [h, w] : [w, h];
  const at = (o: number, k: number) => (rows ? o * w + k : k * w + o);
  for (let o = 0; o < outer; o++) {
    let count = 0;
    // Pixels outside the window count as unset for max, set for min (so edges do not erode).
    const val = (k: number) => (k < 0 || k >= inner ? (max ? 0 : 1) : src[at(o, k)]);
    for (let k = -r; k <= r; k++) count += val(k);
    for (let k = 0; k < inner; k++) {
      out[at(o, k)] = max ? (count > 0 ? 1 : 0) : count === 2 * r + 1 ? 1 : 0;
      count += val(k + r + 1) - val(k - r);
    }
  }
  return out;
}

/**
 * The ceiling grid drawn on a reflected ceiling plan, found with nothing marked: of the pens
 * that are not walls, the one drawing the most lines both ways at a regular spacing.
 */
export function findGridHatch(
  segs: Segment[],
  metersPerPoint: number | null,
  avoid: [number, number, number, number][] = [],
): { keys: string[]; cell: number; regions: HatchRegion[] } | null {
  const pt = (m: number, fallback: number) => (metersPerPoint ? m / metersPerPoint : fallback);
  const walls = new Set(detectWallPens(penStats(segs, pt(0.06, 1.5), pt(0.7, 20))));
  const outside = (x: number, y: number) => !avoid.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  const marks = marksOf(segs).filter((m) => m.line && !m.glyph && outside(m.cx, m.cy));
  const inside = segs.filter((s) => outside((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2));
  // Wall pens are left out, unless nothing else draws a grid (a sheet of ceiling only).
  return gridOf(marks, inside, walls) ?? (walls.size ? gridOf(marks, inside, new Set()) : null);
}

function gridOf(marks: ReturnType<typeof marksOf>, inside: Segment[], walls: Set<string>): { keys: string[]; cell: number; regions: HatchRegion[] } | null {
  const pens = new Map<string, { h: typeof marks; v: typeof marks }>();
  for (const m of marks) {
    const [pen, shape] = m.key.split(' ');
    if (walls.has(pen.slice(1))) continue;
    if (shape !== 'line0' && shape !== 'line90') continue;
    const e = pens.get(pen) ?? pens.set(pen, { h: [], v: [] }).get(pen)!;
    (shape === 'line0' ? e.h : e.v).push(m);
  }
  // Of the pens drawing a regular grid, the one whose grid covers the most of the sheet.
  let best: { keys: string[]; cell: number; regions: HatchRegion[]; area: number } | null = null;
  for (const [pen, { h, v }] of pens) {
    if (h.length < 20 || v.length < 20) continue;
    const ch = spacing(h, true);
    const cv = spacing(v, false);
    if (!ch || !cv) continue;
    const keys = [`${pen} line0`, `${pen} line90`];
    const cell = Math.max(ch, cv);
    const regions = hatchRegionsOf(inside, keys, cell).filter((r) => r.area >= cell * cell * 12);
    const area = regions.reduce((n, r) => n + r.area, 0);
    if (!best || area > best.area) best = { keys, cell, regions, area };
  }
  return best && best.area > 0 ? { keys: best.keys, cell: best.cell, regions: best.regions } : null;
}

/**
 * The spacing of a family of parallel lines, when regular: the usual gap to the nearest
 * line beside each one that runs alongside it. Null when the gaps are all over the place.
 */
function spacing(lines: ReturnType<typeof marksOf>, horizontal: boolean): number | null {
  const across = (m: (typeof lines)[number]) => (horizontal ? m.cy : m.cx);
  const along = (m: (typeof lines)[number]): [number, number] => {
    const [x1, y1, x2, y2] = m.line!;
    return horizontal ? [Math.min(x1, x2), Math.max(x1, x2)] : [Math.min(y1, y2), Math.max(y1, y2)];
  };
  const sorted = [...lines].sort((a, b) => across(a) - across(b));
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const [a0, a1] = along(sorted[i]);
    for (let j = i + 1; j < sorted.length && j < i + 40; j++) {
      const d = across(sorted[j]) - across(sorted[i]);
      if (d < 0.5) continue;
      const [b0, b1] = along(sorted[j]);
      if (Math.min(a1, b1) - Math.max(a0, b0) > 0) {
        gaps.push(d);
        break;
      }
    }
  }
  if (gaps.length < 12) return null;
  // The commonest gap (within a tenth either way): a grid's lines share one; other lines in
  // the pen (frames, leaders) scatter.
  let best = 0;
  let share = 0;
  for (const g of gaps) {
    const near = gaps.filter((x) => Math.abs(x - g) <= g * 0.1);
    if (near.length > share) {
      share = near.length;
      best = near.reduce((n, x) => n + x, 0) / near.length;
    }
  }
  return share >= Math.max(10, gaps.length * 0.2) ? best : null;
}
