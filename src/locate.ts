import type { Pt } from './model';
import type { PageText } from './pageText';
import { detectWallPens, penStats, widthKey } from './fill/walls';
import type { Segment } from './fill/vectors';

/** A room as tagged on the sheet: its number with its name written by it ("112 BEDROOM"). */
export interface RoomTag {
  name: string;
  at: Pt;
}

const NUMBER = /^[A-Z]?\d{2,4}[A-Z]?$/;
const NAME_WORD = /^[A-Z][A-Z.&/'-]*$/;
/** Words that sit above numbers but name no room. */
const NOT_A_ROOM = /^(UP|DN|DWN|EQ|TYP|MIN|MAX|NTS|SIM|EXISTING|NEW|SEE|REFER|NOTE)\.?$/;

/** Room tags: a number with a name on the line just above or below it, centred on it. */
export function roomTags(texts: PageText[]): RoomTag[] {
  const upright = texts.filter((t) => Math.abs(t.angle ?? 0) < 0.1);
  const words = upright.filter((t) => t.str.split(/\s+/).every((w) => NAME_WORD.test(w)) && t.str.length >= 3);
  const out: RoomTag[] = [];
  for (const n of upright) {
    if (!NUMBER.test(n.str)) continue;
    // The name: words on the nearest line above or below, over the number.
    const near = words.filter((w) => Math.abs(n.cy - w.cy) > w.h * 0.5 && Math.abs(n.cy - w.cy) < Math.max(n.h, w.h) * 3.2 && Math.abs(w.cx - n.cx) < Math.max(w.w, n.w) * 0.75 + n.h);
    if (!near.length) continue;
    const closest = near.reduce((a, b) => (Math.abs(b.cy - n.cy) < Math.abs(a.cy - n.cy) ? b : a));
    const line = closest.cy;
    const name = near
      .filter((w) => Math.abs(w.cy - line) < w.h * 0.6)
      .sort((a, b) => a.cx - b.cx)
      .map((w) => w.str)
      .join(' ');
    if (!name || NOT_A_ROOM.test(name)) continue;
    out.push({ name: `${n.str} ${name}`, at: [n.cx, (n.cy + line) / 2] });
  }
  return out;
}

/**
 * Says which room a point is in: the nearest room tag it can see without crossing a wall.
 * With none in sight (a corridor is often untagged), the nearest tag, as "near 104 BEDROOM".
 * Null when no tag is within `reach` points.
 */
export function roomLocator(texts: PageText[], segs: Segment[], metersPerPoint: number | null, reach = 600): (at: Pt) => string | null {
  const tags = roomTags(texts);
  if (!tags.length) return () => null;
  const pt = (m: number, fallback: number) => (metersPerPoint ? m / metersPerPoint : fallback);
  const pens = new Set(detectWallPens(penStats(segs, pt(0.06, 1.5), pt(0.7, 20))));
  const walls = segs.filter((s) => !s.curve && pens.has(widthKey(s)) && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 1);
  const cell = 24;
  const grid = new Map<string, Segment[]>();
  for (const s of walls) {
    const [x0, x1] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
    const [y0, y1] = [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const k = `${gx},${gy}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
      }
  }
  const crosses = (a: Pt, b: Pt) => {
    const seen = new Set<Segment>();
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / steps;
      const y = a[1] + ((b[1] - a[1]) * i) / steps;
      for (const s of grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (intersects(a, b, [s.x1, s.y1], [s.x2, s.y2])) return true;
      }
    }
    return false;
  };
  return (at: Pt) => {
    const near = tags
      .map((t) => ({ t, d: Math.hypot(t.at[0] - at[0], t.at[1] - at[1]) }))
      .filter((x) => x.d <= reach)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    const seen = near.find((x) => !crosses(at, x.t.at));
    return seen ? seen.t.name : near.length ? `near ${near[0].t.name}` : null;
  };
}

/** Whether segments a–b and c–d cross (touching at an end does not count). */
function intersects(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Where a takeoff is: a count's point, the point halfway along a run, an area's middle. */
export function middleOf(points: Pt[], closed = false): Pt {
  if (points.length === 1) return points[0];
  if (!closed) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    let half = lengths.reduce((n, l) => n + l, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (half <= lengths[i] && lengths[i] > 0) {
        const t = half / lengths[i];
        return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
      }
      half -= lengths[i];
    }
    return points[points.length - 1];
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
