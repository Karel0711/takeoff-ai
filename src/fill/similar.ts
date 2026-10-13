import type { Pt } from '../model';
import { ringArea } from '../geometry';
import { marksOf, type Mark } from './marks';
import { fillRoom, type WallModel } from './roomFill';
import { drawSegments, makeGrid, simplify, traceBoundary, type Grid } from './raster';
import type { Segment } from './vectors';

export interface SimilarArea {
  points: Pt[];
  /** In square points. */
  area: number;
  /** 'room' when the hatch fills its room (outline on the walls), 'hatch' when it covers part of one. */
  how: 'room' | 'hatch';
}

export interface SimilarResult {
  /** The hatch the sample was matched by, e.g. "S0.54 dot"; null when the sample has none. */
  pattern: string | null;
  areas: SimilarArea[];
}

export function pointInRing([x, y]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How much a mark counts toward a pattern's density: one per dot or shape, one per 10 points of line. */
const markWeight = (m: Mark) => (m.line ? m.length / 10 : 1);

export interface Pattern {
  /** Mark classes of the hatch, e.g. ["S0.54 dot"] or a grid's ["S0.30 line0", "S0.30 line90"]. */
  keys: string[];
  /** Grid cell, in points: about two pattern spacings, so a patch of hatch reads as solid. */
  cell: number;
  /** Pattern weight per square point in the sample (dots count one, lines one per 10 points). */
  density: number;
}

/**
 * The hatch that marks the sample area: the kind of mark (dot, hatch line at an angle,
 * small shape, by pen) that is many times denser inside it than across the sheet.
 * Lines count by length, so long hatch and grid lines weigh as much as dots.
 */
export function samplePattern(marks: Mark[], sample: Pt[], sheetArea: number): Pattern | null {
  const area = Math.abs(ringArea(sample));
  if (area <= 0) return null;
  const xs = sample.map((p) => p[0]);
  const ys = sample.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Weight: one per dot or shape, one per 10 points of line.
  const weight = markWeight;
  const all = new Map<string, number>();
  const inside = new Map<string, { w: number; n: number; length: number }>();
  for (const m of marks) {
    if (m.glyph) continue;
    all.set(m.key, (all.get(m.key) ?? 0) + weight(m));
    if (m.cx < x0 || m.cx > x1 || m.cy < y0 || m.cy > y1 || !pointInRing([m.cx, m.cy], sample)) continue;
    const e = inside.get(m.key) ?? { w: 0, n: 0, length: 0 };
    e.w += weight(m);
    e.n++;
    e.length += m.length;
    inside.set(m.key, e);
  }
  const lift = (key: string) => inside.get(key)!.w / area / (all.get(key)! / sheetArea);
  let best: string | null = null;
  let score = 0;
  for (const [key, e] of inside) {
    if (e.n < (key.includes(' line') ? 4 : 12) || e.w < 12) continue;
    const l = lift(key);
    if (l < 6) continue;
    if (e.w * Math.log(l) > score) {
      score = e.w * Math.log(l);
      best = key;
    }
  }
  if (!best) return null;
  const keys = [best];
  const pen = best.split(' ')[0];
  const angle = /line(\d+)/.exec(best)?.[1];
  if (angle !== undefined) {
    // A grid: the same pen's lines across the first set.
    const across = `${pen} line${(Number(angle) + 90) % 180}`;
    if (inside.has(across) && inside.get(across)!.n >= 3 && lift(across) >= 4) keys.push(across);
  }
  const spacing = best.includes(' line')
    ? area / Math.max(1, keys.reduce((n, k) => n + inside.get(k)!.length, 0))
    : Math.sqrt(area / inside.get(best)!.n);
  // Grids take the wider spacing, so every cell meets a line.
  const cell = Math.min(40, Math.max(2, (keys.length > 1 ? 3 : 2) * spacing));
  const density = keys.reduce((n, k) => n + inside.get(k)!.w, 0) / area;
  return { keys, cell, density };
}

/**
 * Finds every area on the sheet hatched like the sample. Every room the walls close
 * is checked once: a room the sample's pattern covers, at about the sample's density,
 * is taken to its walls; a room it covers only in part (a bulkhead, a band) gives the
 * hatched part's outline.
 */
export function findSimilar(segs: Segment[], model: WallModel, sample: Pt[], sheetW: number, sheetH: number): SimilarResult {
  const marks = marksOf(segs);
  const pattern = samplePattern(marks, sample, sheetW * sheetH);
  if (!pattern) return { pattern: null, areas: [] };
  const { keys, cell, density } = pattern;
  const lines = keys.some((k) => k.includes(' line'));

  // The pattern on a coarse grid.
  const cw = Math.ceil(sheetW / cell);
  const ch = Math.ceil(sheetH / cell);
  const on = new Uint8Array(cw * ch);
  const hit = (x: number, y: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    if (gx >= 0 && gy >= 0 && gx < cw && gy < ch) on[gy * cw + gx] = 1;
  };
  const used = marks.filter((m) => keys.includes(m.key));
  for (const m of used) {
    if (!m.line) {
      hit(m.cx, m.cy);
      continue;
    }
    const [ax, ay, bx, by] = m.line;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)));
    for (let i = 0; i <= steps; i++) hit(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps);
  }

  // Every space the walls enclose, labelled on one sheet-wide raster.
  const res = Math.min(1, Math.sqrt(12e6 / (sheetW * sheetH)));
  const g = makeGrid(0, 0, sheetW, sheetH, res);
  drawSegments(g, model.lines);
  const { label, count } = labelSpaces(g);
  const pixels = new Float64Array(count);
  const covered = new Float64Array(count);
  const edge = new Uint8Array(count);
  const seed: Pt[] = new Array(count);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const id = label[y * g.w + x];
      if (id < 0) continue;
      pixels[id]++;
      if (x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1) edge[id] = 1;
      seed[id] ??= [(x + 0.5) / res, (y + 0.5) / res];
      if (on[Math.floor((y + 0.5) / res / cell) * cw + Math.floor((x + 0.5) / res / cell)]) covered[id]++;
    }
  }
  const weight = new Float64Array(count);
  for (const m of used) {
    const id = label[Math.floor(m.cy * res) * g.w + Math.floor(m.cx * res)];
    if (id >= 0) weight[id] += markWeight(m);
  }
  const sx = sample.reduce((n, p) => n + p[0], 0) / sample.length;
  const sy = sample.reduce((n, p) => n + p[1], 0) / sample.length;
  const sampleId = label[Math.floor(sy * res) * g.w + Math.floor(sx * res)];

  const areas: SimilarArea[] = [];
  const minArea = (cell * cell * 4) * res * res;
  for (let id = 0; id < count; id++) {
    // Spaces with only a few of the pattern's marks (a wall cavity beside a hatched room) are skipped.
    if (edge[id] || id === sampleId || covered[id] < minArea || weight[id] < 6) continue;
    const share = covered[id] / pixels[id];
    const ptArea = pixels[id] / (res * res);
    const dens = weight[id] / ptArea;
    if (share >= 0.5 && dens >= 0.35 * density) {
      const room = fillRoom(model, [seed[id]], sheetW, sheetH, 2);
      if (room.ok && !pointInRing([sx, sy], room.points)) areas.push({ points: room.points, area: Math.abs(ringArea(room.points)), how: 'room' });
    } else if (!lines && share >= 0.08) {
      // Part of the room: the hatched cells inside it.
      const cells: number[] = [];
      for (let j = 0; j < on.length; j++) {
        if (!on[j]) continue;
        const px = Math.floor(((j % cw) + 0.5) * cell * res);
        const py = Math.floor((Math.floor(j / cw) + 0.5) * cell * res);
        if (px < g.w && py < g.h && label[py * g.w + px] === id) cells.push(j);
      }
      pushOutline(areas, cells, cw, ch, cell);
    }
  }
  return { pattern: keys.join(' + '), areas };
}

/** Labels each 4-connected free region of the raster; walls get -1. */
function labelSpaces(g: Grid): { label: Int32Array; count: number } {
  const label = new Int32Array(g.w * g.h).fill(-1);
  const stack = new Int32Array(g.w * g.h);
  let count = 0;
  for (let i = 0; i < label.length; i++) {
    if (g.data[i] || label[i] >= 0) continue;
    let top = 0;
    stack[top++] = i;
    label[i] = count;
    while (top) {
      const j = stack[--top];
      const x = j % g.w;
      if (x > 0 && !g.data[j - 1] && label[j - 1] < 0) (label[j - 1] = count), (stack[top++] = j - 1);
      if (x < g.w - 1 && !g.data[j + 1] && label[j + 1] < 0) (label[j + 1] = count), (stack[top++] = j + 1);
      if (j >= g.w && !g.data[j - g.w] && label[j - g.w] < 0) (label[j - g.w] = count), (stack[top++] = j - g.w);
      if (j < label.length - g.w && !g.data[j + g.w] && label[j + g.w] < 0) (label[j + g.w] = count), (stack[top++] = j + g.w);
    }
    count++;
  }
  return { label, count };
}

/** Adds the outline of each patch of cells (closed over one-cell gaps) as an area. */
function pushOutline(areas: SimilarArea[], cells: number[], w: number, h: number, cell: number) {
  let region: Uint8Array = new Uint8Array(w * h);
  for (const j of cells) region[j] = 1;
  region = closeGrid(region, w, h);
  const seen = new Uint8Array(w * h);
  for (const start of cells) {
    if (seen[start] || !region[start]) continue;
    // One 4-connected piece of the closed region.
    const piece = new Uint8Array(w * h);
    const stack = [start];
    seen[start] = 1;
    let n = 0;
    while (stack.length) {
      const j = stack.pop()!;
      piece[j] = 1;
      n++;
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k >= 0 && k < region.length && region[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (n < 4) continue;
    const ring = simplify(traceBoundary(piece, w, h), 0.5).map(([x, y]) => [x * cell, y * cell] as Pt);
    if (ring.length >= 3) areas.push({ points: ring, area: Math.abs(ringArea(ring)), how: 'hatch' });
  }
}

/** Closing by one cell: fills single-cell gaps in a patch, without growing it. */
function closeGrid(src: Uint8Array, w: number, h: number): Uint8Array {
  const pass = (a: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(a.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const inside = nx >= 0 && ny >= 0 && nx < w && ny < h ? a[ny * w + nx] : 0;
            if (grow && inside) v = 1;
            if (!grow && !inside) v = 0;
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}
