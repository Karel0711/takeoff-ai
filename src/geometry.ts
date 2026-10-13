import type { Pt } from './model';

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/** Perimeter of a closed ring. */
export function ringLength(ring: Pt[]): number {
  if (ring.length < 2) return 0;
  return polylineLength(ring) + dist(ring[ring.length - 1], ring[0]);
}

/** Unsigned area of a simple polygon (shoelace formula). */
export function ringArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function centroid(ring: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return ring.length ? [x / ring.length, y / ring.length] : [0, 0];
}

/** Constrains `p` to the horizontal or vertical line through `from`, whichever is closer. */
export function orthoSnap(from: Pt, p: Pt): Pt {
  return Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]];
}

export const ringToPath = (ring: Pt[]): string =>
  ring.length ? `M${ring.map((p) => `${p[0]},${p[1]}`).join('L')}Z` : '';
