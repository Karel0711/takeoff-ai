import type { WallModel } from '../fill/roomFill';
import type { PenStats } from '../fill/walls';
import type { Segment } from '../fill/vectors';
import type { TagText } from './tags';
import { wallTakeoff, type WallTakeoffOptions, type WallTakeoffResult } from './wallTakeoff';

/** Tags that found no wall (a single light line a leader lands on counts: a wall shown above, curtain wall). */
export const missedTags = (r: WallTakeoffResult) => r.unmatched.length;

/**
 * Pens to try as walls drawn lighter: wall-shaped fills, and stroked pens lighter than the
 * walls taken that draw a fair share of their lines in wall-like pairs (looser than the sheet's
 * own pick: the tags vouch for them), the most paired first.
 */
export function candidates(stats: PenStats[], chosen: string[]): string[] {
  const most = Math.max(0, ...stats.map((s) => s.paired));
  const lightest = Math.min(...chosen.map(Number).filter((n) => !Number.isNaN(n)));
  return stats
    .filter((s) => !chosen.includes(s.key) && s.length > 0 && s.paired >= most * 0.05 && s.paired / s.length >= 0.25)
    .filter((s) => s.key === 'fill' || (Number(s.key) > 0 && Number(s.key) < lightest))
    .sort((a, b) => b.paired - a.paired)
    .slice(0, 4)
    .map((s) => s.key);
}

/**
 * Wall takeoff with the sheet's wall pens, and with lighter pens that also draw in wall-like
 * pairs where the wall tags say so. Cut walls are drawn heaviest, but an office may draw its
 * new partitions much lighter than the existing walls (or than the few heavy lines of an
 * enlarged plan): a tag points at a wall, so when the sheet's tags land on no wall of the
 * pens taken and a lighter paired pen catches them, that pen draws walls too.
 */
export function wallTakeoffByTags(
  model: WallModel,
  segments: Segment[],
  texts: TagText[],
  metersPerPoint: number,
  options: WallTakeoffOptions,
  rebuild: (pens: string[]) => WallModel,
): WallTakeoffResult {
  const run = (m: WallModel) => wallTakeoff([...m.lines, ...(m.symbols ?? [])], segments, texts, metersPerPoint, { ...options, doors: m.openings });
  let best = run(model);
  if (!model.pens.length) return best;
  let pens = model.pens;
  for (let round = 0; round < 2; round++) {
    const missed = missedTags(best);
    // Most of the sheet's tags found their walls: the pens are right, and the few left over
    // point at something else (a wall shown above, curtain wall, a mislabelled leader).
    if (missed < Math.max(2, 0.4 * best.tags.length)) break;
    const tried: { r: WallTakeoffResult; pens: string[]; missed: number; lines: number }[] = [];
    for (const pen of candidates(model.stats, pens)) {
      const r = run(rebuild([...pens, pen]));
      const m = missedTags(r);
      tried.push({ r, pens: [...pens, pen], missed: m, lines: model.stats.find((s) => s.key === pen)?.segments ?? 0 });
    }
    // Of the pens that catch about as many tags, the one drawing least else (a pen that draws
    // the walls' faces, not the one that also draws the tag boxes, casework and lettering).
    const least = Math.min(...tried.map((t) => t.missed));
    const close = tried.filter((t) => t.missed <= least + Math.max(1, 0.1 * best.tags.length)).sort((a, b) => a.lines - b.lines);
    const pick = close[0];
    // Only a pen that catches a good share of the tags left over: one or two tags landing on
    // a lighter line by chance (a door frame, a counter) are no reason.
    if (!pick || missed - pick.missed < Math.max(2, 0.3 * missed)) break;
    best = pick.r;
    pens = pick.pens;
  }
  return best;
}
