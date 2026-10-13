import type { Pt } from '../model';
import type { TypedRun } from './wallTakeoff';

export interface TypeLines {
  code: string;
  /** Polylines along the wall centreline, in sheet points. */
  lines: Pt[][];
  /** Pieces whose type came from a tag pointing at them, and pieces it was carried to. */
  tagged: number;
  carried: number;
  /** Pieces drawn in light lines (shown above or below the cut, curtain walls). */
  light: number;
}

const key = (p: Pt) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

/**
 * Groups typed wall pieces by type and chains pieces that meet end to end into
 * polylines, so a wall that runs on round a corner becomes one measurement.
 * Chains break where three or more pieces of the type meet.
 */
export function runsToLines(runs: TypedRun[]): TypeLines[] {
  const codes = [...new Set(runs.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return codes.map((code) => {
    const mine = runs.filter((r) => r.tags.includes(code));
    const at = new Map<string, number[]>();
    mine.forEach((r, i) => {
      for (const p of [r.a, r.b]) {
        const k = key(p);
        at.set(k, [...(at.get(k) ?? []), i]);
      }
    });
    const used = new Set<number>();
    const lines: Pt[][] = [];
    const walk = (start: number, from: Pt) => {
      const line: Pt[] = [from];
      let i = start;
      let p = from;
      for (;;) {
        used.add(i);
        const r = mine[i];
        const next = key(r.a) === key(p) ? r.b : r.a;
        line.push(next);
        const others = (at.get(key(next)) ?? []).filter((j) => j !== i);
        if (others.length !== 1 || used.has(others[0])) break;
        i = others[0];
        p = next;
      }
      lines.push(line);
    };
    // Start from the ends of open chains and from junctions, then whatever is left (closed loops).
    mine.forEach((r, i) => {
      if (used.has(i)) return;
      for (const p of [r.a, r.b]) {
        if ((at.get(key(p)) ?? []).length !== 2 && !used.has(i)) walk(i, p);
      }
    });
    mine.forEach((r, i) => {
      if (!used.has(i)) walk(i, r.a);
    });
    return {
      code,
      lines: lines.map(dropStraightJoins),
      tagged: mine.filter((r) => r.how === 'tag').length,
      carried: mine.filter((r) => r.how === 'carried').length,
      light: mine.filter((r) => r.light).length,
    };
  });
}

/** Removes points where a polyline carries straight on (pieces split at a junction of another type). */
function dropStraightJoins(line: Pt[]): Pt[] {
  return line.filter((p, i) => {
    if (i === 0 || i === line.length - 1) return true;
    const a = line[i - 1];
    const b = line[i + 1];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
    return Math.abs(cross) > 1e-3 * Math.hypot(b[0] - a[0], b[1] - a[1]) ** 2;
  });
}
