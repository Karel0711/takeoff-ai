import type { Measurement, Pt } from './model';

/** A box dragged on the sheet: where the drag started (x0, y0) and ended (x1, y1). */
export type DragBox = [number, number, number, number];

/**
 * Dragged right to left, a box also takes what it touches (AutoCAD's crossing
 * selection); left to right, only what lies wholly inside it.
 */
export const isCrossing = ([x0, , x1]: DragBox) => x1 < x0;

/** The takeoffs a dragged box picks, in the order given. `isArea` tells closed outlines from lines. */
export function boxSelect(measurements: Measurement[], box: DragBox, isArea: (m: Measurement) => boolean): string[] {
  const [ax, ay, bx, by] = box;
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  const inside = ([x, y]: Pt) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const crossing = isCrossing(box);
  return measurements
    .filter((m) => {
      const pts = m.points;
      if (!pts.length) return false;
      if (!crossing) return pts.every(inside);
      if (pts.some(inside)) return true;
      // An outline or line that passes through the box without a point in it.
      const closed = isArea(m) && pts.length >= 3;
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
        if (segmentHitsBox(pts[i], pts[(i + 1) % pts.length], x0, y0, x1, y1)) return true;
      }
      // A box drawn wholly inside an area still touches that area.
      return closed && pointInRing([x0, y0], pts) && !m.holes.some((h) => pointInRing([x0, y0], h));
    })
    .map((m) => m.id);
}

/** Whether segment a–b meets the box (Liang–Barsky clipping). */
function segmentHitsBox([ax, ay]: Pt, [bx, by]: Pt, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

function pointInRing([x, y]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
