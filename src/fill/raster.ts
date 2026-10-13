import type { Pt } from '../model';
import type { Segment } from './vectors';

/** A pixel grid over a window of the sheet: `res` pixels per point, origin at (x0, y0). */
export interface Grid {
  w: number;
  h: number;
  x0: number;
  y0: number;
  res: number;
  data: Uint8Array;
}

export function makeGrid(x0: number, y0: number, wPt: number, hPt: number, res: number): Grid {
  const w = Math.max(1, Math.ceil(wPt * res));
  const h = Math.max(1, Math.ceil(hPt * res));
  return { w, h, x0, y0, res, data: new Uint8Array(w * h) };
}

/** Marks the pixels a segment covers. Lines are kept thin (about 1.5 px) so the fill reaches the line itself. */
export function drawSegments(g: Grid, segs: Segment[]) {
  const r = 0.75;
  for (const s of segs) {
    const ax = (s.x1 - g.x0) * g.res;
    const ay = (s.y1 - g.y0) * g.res;
    const bx = (s.x2 - g.x0) * g.res;
    const by = (s.y2 - g.y0) * g.res;
    if (Math.max(ax, bx) < -2 || Math.min(ax, bx) > g.w + 2 || Math.max(ay, by) < -2 || Math.min(ay, by) > g.h + 2) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let i = 0; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
        if (py < 0 || py >= g.h) continue;
        for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
          if (px < 0 || px >= g.w) continue;
          if ((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2 <= (r + 0.5) ** 2) g.data[py * g.w + px] = 1;
        }
      }
    }
  }
}

export interface FillResult {
  /** 1 where the region is. */
  region: Uint8Array;
  pixels: number;
  /** The region reached the edge of the window, so the room may be larger (or open). */
  touchesEdge: boolean;
}

/** 4-connected flood fill over unmarked pixels, from (sx, sy). */
export function floodFill(g: Grid, sx: number, sy: number): FillResult {
  const region = new Uint8Array(g.w * g.h);
  if (sx < 0 || sy < 0 || sx >= g.w || sy >= g.h || g.data[sy * g.w + sx]) return { region, pixels: 0, touchesEdge: false };
  const stack = new Int32Array(g.w * g.h);
  let top = 0;
  stack[top++] = sy * g.w + sx;
  region[sy * g.w + sx] = 1;
  let pixels = 0;
  let touchesEdge = false;
  while (top) {
    const i = stack[--top];
    pixels++;
    const x = i % g.w;
    const y = (i - x) / g.w;
    if (x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1) touchesEdge = true;
    const n = [x > 0 ? i - 1 : -1, x < g.w - 1 ? i + 1 : -1, y > 0 ? i - g.w : -1, y < g.h - 1 ? i + g.w : -1];
    for (const j of n) {
      if (j >= 0 && !region[j] && !g.data[j]) {
        region[j] = 1;
        stack[top++] = j;
      }
    }
  }
  return { region, pixels, touchesEdge };
}

/** Fills holes in a region (columns, closed shapes inside a room) so only its outer boundary counts. */
export function fillHoles(region: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!region[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/**
 * Traces the outer boundary of a region along pixel edges, keeping the region
 * on the right, and returns the corner points where the direction changes
 * (pixel-corner coordinates).
 */
export function traceBoundary(region: Uint8Array, w: number, h: number): [number, number][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && region[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < region.length; i++) {
    if (region[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const sx = start % w;
  const sy = (start - sx) / w;
  // Directions: 0 right, 1 down, 2 left, 3 up (y grows downwards).
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  // Pixels ahead-left and ahead-right of a corner for each direction.
  const aheadLeft = (x: number, y: number, d: number): [number, number] =>
    [
      [x, y - 1],
      [x, y],
      [x - 1, y],
      [x - 1, y - 1],
    ][d] as [number, number];
  const aheadRight = (x: number, y: number, d: number): [number, number] =>
    [
      [x, y],
      [x - 1, y],
      [x - 1, y - 1],
      [x, y - 1],
    ][d] as [number, number];

  const pts: [number, number][] = [];
  let x = sx;
  let y = sy;
  let d = 0;
  const limit = 4 * (w + 1) * (h + 1);
  for (let step = 0; step < limit; step++) {
    let nd: number;
    if (inside(...aheadLeft(x, y, d))) nd = (d + 3) % 4;
    else if (inside(...aheadRight(x, y, d))) nd = d;
    else nd = (d + 1) % 4;
    if (step > 0 && x === sx && y === sy && nd === 0) break;
    if (nd !== d || step === 0) pts.push([x, y]);
    d = nd;
    x += dx[d];
    y += dy[d];
  }
  return pts;
}

/** Douglas–Peucker simplification of a closed polygon. */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 4) return pts;
  // Split the ring at its two farthest-apart points and simplify each half.
  let far = 0;
  let bestD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > bestD) {
      bestD = d;
      far = i;
    }
  }
  const dp = (p: [number, number][]): [number, number][] => {
    if (p.length < 3) return p;
    const [a, b] = [p[0], p[p.length - 1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let idx = 0;
    let maxD = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const dist = Math.abs((b[0] - a[0]) * (a[1] - p[i][1]) - (a[0] - p[i][0]) * (b[1] - a[1])) / L;
      if (dist > maxD) {
        maxD = dist;
        idx = i;
      }
    }
    if (maxD <= tol) return [a, b];
    return [...dp(p.slice(0, idx + 1)).slice(0, -1), ...dp(p.slice(idx))];
  };
  const first = dp(pts.slice(0, far + 1));
  const second = dp([...pts.slice(far), pts[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Pixel-corner coordinates back to sheet points. */
export const toSheet = (g: Grid, pts: [number, number][]): Pt[] => pts.map(([x, y]) => [g.x0 + x / g.res, g.y0 + y / g.res]);
