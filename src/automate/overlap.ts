import type { Measurement, Pt, Sheet } from '../model';

/**
 * Two plans of the same floor drawn over each other (enlarged plans whose areas overlap, A1.3 and
 * A1.5 both showing the corridor and kitchen): where one sits on the other, from the room tags
 * both carry. Same scale only. Returns the shift that takes a point on `from` to `to`, or null
 * when they share fewer than two rooms or the rooms disagree.
 */
export function planShift(from: { number: string; at: Pt }[], to: { number: string; at: Pt }[], tolerance = 6): Pt | null {
  const there = new Map<string, Pt[]>();
  for (const l of to) there.set(l.number, [...(there.get(l.number) ?? []), l.at]);
  const shifts: Pt[] = [];
  for (const l of from) {
    const at = there.get(l.number);
    // A number written once on each: a tag repeated on a sheet says nothing about where.
    if (at?.length !== 1 || from.filter((o) => o.number === l.number).length !== 1) continue;
    shifts.push([at[0][0] - l.at[0], at[0][1] - l.at[1]]);
  }
  if (shifts.length < 2) return null;
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const d: Pt = [med(shifts.map((s) => s[0])), med(shifts.map((s) => s[1]))];
  // Most tags must agree (a tag placed differently on the enlarged plan is allowed).
  const agree = shifts.filter((s) => Math.hypot(s[0] - d[0], s[1] - d[1]) <= tolerance * 3).length;
  return agree >= 2 && agree >= shifts.length * 0.6 ? d : null;
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** How much of a run (0–1) lies along any of `others` once shifted by `d`, within `tolerance` sheet points. */
export function coveredShare(run: Pt[], others: Pt[][], d: Pt, tolerance: number): number {
  let total = 0;
  let near = 0;
  for (let i = 1; i < run.length; i++) {
    const [a, b] = [run[i - 1], run[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) {
      const p: Pt = [a[0] + ((b[0] - a[0]) * (k + 0.5)) / n + d[0], a[1] + ((b[1] - a[1]) * (k + 0.5)) / n + d[1]];
      total += len / n;
      if (others.some((o) => o.some((q, j) => j > 0 && segDist(p, o[j - 1], q) <= tolerance))) near += len / n;
    }
  }
  return total ? near / total : 0;
}

/**
 * The wall runs on `sheet` already taken off on another plan of the same floor (same type, drawn
 * at the same place): the ids to leave out so the shared area counts once.
 */
export function repeatedRuns(
  sheet: Sheet,
  runs: Measurement[],
  sheetLabels: { number: string; at: Pt }[],
  earlier: { sheet: Sheet; labels: { number: string; at: Pt }[]; runs: Measurement[] }[],
  typeCode: (typeId: string) => string,
): Set<string> {
  const out = new Set<string>();
  for (const e of earlier) {
    if (!sheet.metersPerPoint || !e.sheet.metersPerPoint || Math.abs(sheet.metersPerPoint / e.sheet.metersPerPoint - 1) > 0.02) continue;
    const d = planShift(sheetLabels, e.labels);
    if (!d) continue;
    // About a wall's thickness at the plan's scale (8 in), at least 4 points.
    const tol = Math.max(4, 0.2 / sheet.metersPerPoint);
    for (const r of runs) {
      if (out.has(r.id)) continue;
      const same = e.runs.filter((o) => typeCode(o.typeId) === typeCode(r.typeId)).map((o) => o.points);
      if (same.length && coveredShare(r.points, same, d, tol) >= 0.6) out.add(r.id);
    }
  }
  return out;
}
