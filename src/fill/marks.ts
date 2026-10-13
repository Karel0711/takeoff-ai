import type { Segment } from './vectors';

/** One drawn shape (a subpath): a dot, a hatch line, a glyph outline. */
export interface Mark {
  cx: number;
  cy: number;
  /** Longest side of its bounding box, in points. */
  size: number;
  /** Total drawn length. */
  length: number;
  /** Pattern class, e.g. "S0.54 dot" or "S0.30 line90": marks of one hatch share it. */
  key: string;
  /** For a straight line: its ends, so long hatch lines count along their length. */
  line?: [number, number, number, number];
  /** A filled outline the size of lettering: text drawn as shapes, never a hatch. */
  glyph: boolean;
}

/** Groups segments into their shapes, with a class that hatch marks of one kind share. */
export function marksOf(segs: Segment[]): Mark[] {
  const bySub = new Map<number, Segment[]>();
  for (const s of segs) {
    if (s.sub === undefined) continue;
    const list = bySub.get(s.sub);
    if (list) list.push(s);
    else bySub.set(s.sub, [s]);
  }
  const out: Mark[] = [];
  for (const list of bySub.values()) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let length = 0;
    for (const s of list) {
      x0 = Math.min(x0, s.x1, s.x2);
      y0 = Math.min(y0, s.y1, s.y2);
      x1 = Math.max(x1, s.x1, s.x2);
      y1 = Math.max(y1, s.y1, s.y2);
      length += Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    }
    const size = Math.max(x1 - x0, y1 - y0);
    const first = list[0];
    let shape: string;
    let line: Mark['line'];
    if (size < 1.2) shape = 'dot';
    else if (list.length <= 2 && !first.filled) {
      // A straight stroke: its direction, to the nearest 15°.
      const a = (Math.atan2(first.y2 - first.y1, first.x2 - first.x1) * 180) / Math.PI;
      shape = `line${(((Math.round(a / 15) * 15) % 180) + 180) % 180}`;
      const last = list[list.length - 1];
      line = [first.x1, first.y1, last.x2, last.y2];
    } else shape = `shape${Math.round(Math.log2(size))}`;
    out.push({
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      size,
      length,
      key: `${first.filled ? 'F' : 'S'}${first.width.toFixed(2)} ${shape}`,
      line,
      glyph: first.filled && size >= 1.2 && size <= 12,
    });
  }
  return out;
}
