/**
 * Whether two drawings of a symbol look the same: both are drawn into a small grid (lines as
 * strokes, filled shapes filled in) and compared cell by cell, a cell of slack either way. Lines
 * matched end to end can miss that a half-filled circle is not a quartered one, or that a fill
 * was cut into other pieces; the picture does not.
 */
import { findRoot } from '../arrays';

export interface LookLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Part of a filled shape: the shape's inside is ink too. */
  filled?: boolean;
  /** Which shape the line is part of (fills are filled shape by shape). */
  group?: number;
  /** Pen width: a small ring in a pen nearly as heavy as it is wide reads as a dot. */
  width?: number;
}

export type Box = [number, number, number, number];

/** The cells of `box` (a grid `cell` wide) the lines ink. */
export function inkCells(lines: LookLine[], box: Box, cell: number): { cells: Uint8Array; fill: Uint8Array; nx: number; ny: number } {
  const nx = Math.max(1, Math.ceil((box[2] - box[0]) / cell) + 1);
  const ny = Math.max(1, Math.ceil((box[3] - box[1]) / cell) + 1);
  const cells = new Uint8Array(nx * ny);
  /** The insides of filled shapes alone. */
  const fill = new Uint8Array(nx * ny);
  const fills = new Map<number, LookLine[]>();
  const groups = new Map<number, LookLine[]>();
  const [bx, by] = [box[0], box[1]];
  for (const l of lines) {
    const n = Math.max(1, Math.ceil(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / (cell / 3)));
    const [dx, dy] = [l.x2 - l.x1, l.y2 - l.y1];
    // Points along the line, each inking its cell (as `mark`, written out: this runs for every line of every copy looked at).
    for (let k = 0; k <= n; k++) {
      const i = Math.floor((l.x1 + (dx * k) / n - bx) / cell);
      const j = Math.floor((l.y1 + (dy * k) / n - by) / cell);
      if (i >= 0 && j >= 0 && i < nx && j < ny) cells[j * nx + i] = 1;
    }
    if (l.group !== undefined && !l.filled) {
      const list = groups.get(l.group);
      if (list) list.push(l);
      else groups.set(l.group, [l]);
    }
    if (l.filled) {
      const k = l.group ?? -1;
      const list = fills.get(k);
      if (list) list.push(l);
      else fills.set(k, [l]);
    }
  }
  // A small ring drawn in a pen nearly as heavy as it is wide reads as a solid dot.
  for (const [k, shape] of groups) {
    const w = Math.max(...shape.map((l) => l.width ?? 0));
    const xs = shape.flatMap((l) => [l.x1, l.x2]);
    const ys = shape.flatMap((l) => [l.y1, l.y2]);
    const closed = Math.hypot(shape[0].x1 - shape[shape.length - 1].x2, shape[0].y1 - shape[shape.length - 1].y2) <= w;
    if (shape.length >= 3 && closed && w > 0 && Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) <= w * 2.5) fills.set(-1000 - k, shape);
  }
  for (const shape of fills.values()) {
    if (shape.length < 3) continue;
    const x0 = Math.min(...shape.map((l) => Math.min(l.x1, l.x2)));
    const x1 = Math.max(...shape.map((l) => Math.max(l.x1, l.x2)));
    const y0 = Math.min(...shape.map((l) => Math.min(l.y1, l.y2)));
    const y1 = Math.max(...shape.map((l) => Math.max(l.y1, l.y2)));
    for (let j = Math.max(0, Math.floor((y0 - box[1]) / cell)); j <= Math.min(ny - 1, Math.floor((y1 - box[1]) / cell)); j++) {
      const py = box[1] + (j + 0.5) * cell;
      // Even-odd: a point is inside when a ray from it crosses the outline an odd number of times.
      // Where the outline crosses this row, once per row; then along it, the crossings still ahead.
      const xs: number[] = [];
      for (const l of shape) if (l.y1 > py !== l.y2 > py) xs.push(l.x1 + ((py - l.y1) * (l.x2 - l.x1)) / (l.y2 - l.y1));
      if (!xs.length) continue;
      xs.sort((a, b) => a - b);
      let passed = 0;
      for (let i = Math.max(0, Math.floor((x0 - box[0]) / cell)); i <= Math.min(nx - 1, Math.floor((x1 - box[0]) / cell)); i++) {
        const px = box[0] + (i + 0.5) * cell;
        while (passed < xs.length && xs[passed] <= px) passed++;
        if ((xs.length - passed) % 2 === 1) cells[j * nx + i] = fill[j * nx + i] = 1;
      }
    }
  }
  return { cells, fill, nx, ny };
}

/** Share of `a`'s inked cells with ink in `b` at most one cell away. */
function covered(a: Uint8Array, b: Uint8Array, nx: number, ny: number): number {
  return coveredCount(a, b, nx, ny).share;
}

function coveredCount(a: Uint8Array, b: Uint8Array, nx: number, ny: number): { share: number; hit: number } {
  let n = 0;
  let hit = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!a[j * nx + i]) continue;
      n++;
      let found = false;
      for (let dj = -1; dj <= 1 && !found; dj++)
        for (let di = -1; di <= 1 && !found; di++) {
          const x = i + di;
          const y = j + dj;
          if (x >= 0 && y >= 0 && x < nx && y < ny && b[y * nx + x]) found = true;
        }
      if (found) hit++;
    }
  return { share: n ? hit / n : 1, hit };
}

/**
 * How alike two drawings are (0–1), both in the same frame: the lesser of how much of the
 * sample's ink the copy has and how much of the copy's ink the sample has.
 */
export function lookScore(sample: LookLine[], copy: LookLine[], cells = 20): number {
  return look(sample, copy, cells).score;
}

/** What `look` needs of a sample, worked out once per sample (it is compared at thousands of places). */
interface SampleFrame {
  span: number;
  box: Box;
  cell: number;
  ink: ReturnType<typeof inkCells>;
  solid: number;
  parts: Part[];
}
const frames = new WeakMap<readonly LookLine[], Map<number, SampleFrame>>();
function frameOf(sample: LookLine[], cells: number): SampleFrame {
  let byCells = frames.get(sample);
  if (!byCells) frames.set(sample, (byCells = new Map()));
  let f = byCells.get(cells);
  if (f) return f;
  const xs = sample.flatMap((l) => [l.x1, l.x2]);
  const ys = sample.flatMap((l) => [l.y1, l.y2]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.5);
  const pad = span * 0.1 + 0.3;
  const box: Box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  // Fine enough across a long thin symbol's short side too: a slash across a 1x4 box is not its outline.
  const short = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const cell = Math.max(0.12, span / (cells * 3), Math.min(span / cells, short / 12));
  const ink = inkCells(sample, box, cell);
  f = { span, box, cell, ink, solid: ink.fill.reduce((n, v) => n + v, 0), parts: partsOf(sample) };
  byCells.set(cells, f);
  return f;
}

/**
 * The same, with how much of the copy's drawing the sample accounts for (in the sample's units
 * squared). `beyond` are short lines running on from the copy out of its footprint (a sconce's
 * stem round a pot light's place): parts the sample would need to have. Given `min`, a copy is
 * let go as soon as it is sure to score under it (its score then is only known to be under
 * `min`, and `matched` is not worked out).
 */
export function look(sample: LookLine[], copy: LookLine[], cells = 20, beyond: LookLine[] = [], min = 0): { score: number; matched: number } {
  if (!sample.length || !copy.length) return { score: 0, matched: 0 };
  const { span, box, cell, ink: a, solid: solidA, parts } = frameOf(sample, cells);
  const b = inkCells(copy, box, cell);
  const back = coveredCount(b.cells, a.cells, a.nx, a.ny);
  if (back.share < min) return { score: back.share, matched: 0 };
  let score = Math.min(covered(a.cells, b.cells, a.nx, a.ny), back.share);
  if (score < min) return { score, matched: 0 };
  const matched = back.hit * cell * cell;
  // Solid parts compared on their own: outlines alike, a half-filled circle is still not a quartered one.
  const solid = (f: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < f.length; i++) n += f[i];
    return n;
  };
  if (solidA >= 3 || solid(b.fill) >= 3) score = Math.min(score, covered(a.fill, b.fill, a.nx, a.ny), covered(b.fill, a.fill, a.nx, a.ny));
  if (score < min) return { score, matched };
  // Every part drawn, both ways: a small part (a sconce's stem, the slash of a night light) is
  // little of the ink but all of the difference.
  if (!alikeParts(parts, partsOf([...copy, ...beyond]), span)) score = Math.min(score, 0.5);
  return { score, matched };
}

interface Part {
  n: number;
  length: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** For a single line: its direction, 0–π. */
  angle?: number;
}

/**
 * The separate parts of a drawing: its shapes, with loose lines meeting end to end joined into
 * one (a hexagon drawn as six loose lines, or an edge drawn in pieces, is one part).
 */
function partsOf(lines: LookLine[]): Part[] {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => findRoot(parent, i);
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const xs0 = lines.flatMap((l) => [l.x1, l.x2]);
  const ys0 = lines.flatMap((l) => [l.y1, l.y2]);
  const tol = Math.max(0.05, Math.max(Math.max(...xs0) - Math.min(...xs0), Math.max(...ys0) - Math.min(...ys0)) * 0.01);
  const byGroup = new Map<number, number>();
  // Line ends on a grid, to find ends that meet.
  const ends = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (l.group !== undefined) {
      const g = byGroup.get(l.group);
      if (g === undefined) byGroup.set(l.group, i);
      else join(i, g);
    }
    for (const [x, y] of [
      [l.x1, l.y1],
      [l.x2, l.y2],
    ]) {
      const k = `${Math.round(x / tol)},${Math.round(y / tol)}`;
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });
  // Only loose lines (a shape of one line) join up end to end; a shape drawn as one stays itself.
  const size = new Map<number, number>();
  for (const l of lines) if (l.group !== undefined) size.set(l.group, (size.get(l.group) ?? 0) + 1);
  const loose = (i: number) => lines[i].group === undefined || size.get(lines[i].group!) === 1;
  // Every loose line ending in a cell joins every loose line ending in it or a cell beside it: all
  // of those are one part, so each joins the first of the cell's (pair by pair would be the same
  // parts, at the square of the work on a busy drawing).
  for (const [k, list] of ends) {
    const first = list.find(loose);
    if (first === undefined) continue;
    const [gx, gy] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) for (const j of ends.get(`${gx + dx},${gy + dy}`) ?? []) if (j !== first && loose(j)) join(j, first);
  }
  const groups = new Map<number, LookLine[]>();
  lines.forEach((l, i) => {
    const k = find(i);
    const list = groups.get(k);
    if (list) list.push(l);
    else groups.set(k, [l]);
  });
  return [...groups.values()].map((ls) => {
    const xs = ls.flatMap((l) => [l.x1, l.x2]);
    const ys = ls.flatMap((l) => [l.y1, l.y2]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const part: Part = { n: ls.length, length: ls.reduce((n, l) => n + Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    // A straight run, however many pieces it is drawn in, is a line with a direction.
    const dir = (l: LookLine) => (Math.atan2(l.y2 - l.y1, l.x2 - l.x1) + Math.PI) % Math.PI;
    const d0 = dir(ls[0]);
    const straight = ls.every((l) => {
      const d = Math.abs(dir(l) - d0);
      return Math.min(d, Math.PI - d) <= 0.05;
    });
    if (straight && Math.abs(part.length - Math.hypot(part.w, part.h)) <= tol * 4) part.angle = d0;
    return part;
  });
}

/**
 * Whether two drawings have the same parts: each shape of one (a circle, a stem, a slash) has a
 * shape in the other about where it is, about as big, and a single line turned the same way. A
 * legend is often drawn a little differently from the plan's blocks (a longer stem, shorter
 * ticks), so sizes and places are loose; a part missing or extra is not.
 */
export function partsAlike(a: LookLine[], b: LookLine[], span: number): boolean {
  return alikeParts(partsOf(a), partsOf(b), span);
}

function alikeParts(pa: Part[], pb: Part[], span: number): boolean {
  const total = pa.reduce((n, p) => n + p.length, 0);
  // Specks (a dot of hatching, a sliver) are too little to go on.
  const counts = (p: Part) => p.length >= total * 0.04 && Math.max(p.w, p.h) >= span * 0.1;
  const near = (p: Part, q: Part) => {
    if (Math.hypot(p.cx - q.cx, p.cy - q.cy) > span * 0.2) return false;
    if (p.angle !== undefined || q.angle !== undefined) {
      if (p.angle === undefined || q.angle === undefined) return false;
      const d = Math.abs(p.angle - q.angle);
      return Math.min(d, Math.PI - d) <= 0.35 && q.length >= p.length * 0.4 && q.length <= p.length * 2.5;
    }
    const size = (u: number, v: number) => Math.abs(u - v) <= Math.max(span * 0.15, Math.max(u, v) * 0.45);
    return size(p.w, q.w) && size(p.h, q.h);
  };
  return pa.filter(counts).every((p) => pb.some((q) => near(p, q))) && pb.filter(counts).every((q) => pa.some((p) => near(q, p)));
}
