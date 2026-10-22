import type { Pt } from '../model';
import type { Segment } from './vectors';

/**
 * Shaded (greyed-out) parts of a plan: on renovation sets the areas outside the work are drawn
 * under a grey tone, with the rooms in the work painted white over it. Which ink is on top at a
 * point is the last filled shape drawn there (shapes are numbered in drawing order).
 */
interface Shape {
  sub: number;
  grey: boolean;
  box: [number, number, number, number];
  segs: Segment[];
}

const isGrey = (c: string | undefined) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c ?? '');
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 12 && r >= 150 && r <= 235;
};

/** The filled shapes of a sheet that can shade a room: big enough to be more than a wall's poche or a tag's mask. */
export function fillShapes(segs: Segment[]): Shape[] {
  const bySub = new Map<number, Segment[]>();
  for (const s of segs) if (s.filled && s.sub !== undefined) (bySub.get(s.sub) ?? bySub.set(s.sub, []).get(s.sub)!).push(s);
  const out: Shape[] = [];
  for (const [sub, list] of bySub) {
    const xs = list.flatMap((s) => [s.x1, s.x2]);
    const ys = list.flatMap((s) => [s.y1, s.y2]);
    const box: Shape['box'] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // A wall's poche is long and thin: count only shapes at least a small room across.
    if (box[2] - box[0] < 20 || box[3] - box[1] < 20) continue;
    out.push({ sub, grey: isGrey(list[0].color), box, segs: list });
  }
  return out.sort((a, b) => a.sub - b.sub);
}

const inside = (s: Shape, x: number, y: number) => {
  if (x < s.box[0] || x > s.box[2] || y < s.box[1] || y > s.box[3]) return false;
  let odd = false;
  for (const g of s.segs) if (g.y1 > y !== g.y2 > y && x < g.x1 + ((y - g.y1) * (g.x2 - g.x1)) / (g.y2 - g.y1)) odd = !odd;
  return odd;
};

const inRing = (ring: Pt[], x: number, y: number) => {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) odd = !odd;
  }
  return odd;
};

/** How much of a room outline lies under the grey tone (0–1), from points spread over it. */
export function shadedShare(ring: Pt[], shapes: Shape[]): number {
  if (!shapes.some((s) => s.grey) || ring.length < 3) return 0;
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const step = Math.max((x1 - x0) / 14, (y1 - y0) / 14, 0.5);
  let n = 0;
  let grey = 0;
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!inRing(ring, x, y)) continue;
      n++;
      let top: Shape | undefined;
      for (const s of shapes) if (inside(s, x, y)) top = s;
      if (top?.grey) grey++;
    }
  return n ? grey / n : 0;
}

/**
 * The sheet drawn small, to read what tone each point is painted (a grey tone is often a shape
 * clipped to the areas outside the work, which the linework alone does not show). Null when the
 * page can't be drawn here.
 */
export async function toneMap(page: { getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> } }, scale = 0.5): Promise<((x: number, y: number) => 'grey' | 'white' | 'ink') | null> {
  try {
    const vp = page.getViewport({ scale });
    const w = Math.ceil(vp.width);
    const h = Math.ceil(vp.height);
    let canvas: { getContext(t: '2d'): unknown; width: number; height: number };
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      canvas = c;
    } else {
      const mod = (await import(/* @vite-ignore */ '@napi-rs/canvas' as string)) as { createCanvas(w: number, h: number): typeof canvas };
      canvas = mod.createCanvas(w, h);
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const data = ctx.getImageData(0, 0, w, h).data;
    return (x, y) => {
      const px = Math.min(w - 1, Math.max(0, Math.round(x * scale)));
      const py = Math.min(h - 1, Math.max(0, Math.round(y * scale)));
      const i = (py * w + px) * 4;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 240 && g > 240 && b > 240) return 'white';
      if (Math.max(r, g, b) - Math.min(r, g, b) < 14 && r >= 150 && r <= 235) return 'grey';
      return 'ink';
    };
  } catch {
    return null;
  }
}

/** How much of a room outline is painted the grey tone (0–1), ink left out. */
export function toneShare(ring: Pt[], tone: (x: number, y: number) => 'grey' | 'white' | 'ink'): number {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const step = Math.max((x1 - x0) / 20, (y1 - y0) / 20, 1);
  let grey = 0;
  let white = 0;
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!inRing(ring, x, y)) continue;
      const t = tone(x, y);
      if (t === 'grey') grey++;
      else if (t === 'white') white++;
    }
  return grey + white ? grey / (grey + white) : 0;
}
