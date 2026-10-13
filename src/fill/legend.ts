import type { Kind } from '../model';
import type { PageText } from '../pageText';
import { marksOf } from './marks';
import { buildWallModel, type WallModel } from './roomFill';
import { findPatternOn, samplePattern, type SimilarArea } from './similar';
import { matchSymbol, sampleSymbol, type SymbolMatch, type SymbolSample } from './symbols';
import type { Segment } from './vectors';

type Box = [number, number, number, number];

/** One line of a legend: its label and the graphic drawn beside it. */
export interface LegendRow {
  label: string;
  /** The graphic's bounds on the sheet; null when the row has no linework (text only). */
  graphic: Box | null;
  /** What the graphic stands for: a symbol to count, a hatch (area), a line type (length). */
  kind: Kind | null;
  /** For symbols: the sample and its copies on the sheet outside the legend. */
  sample?: SymbolSample;
  found?: SymbolMatch[];
  /** A short tag drawn with the graphic (FH, HP), and where it appears on the sheet outside the legend. */
  tag?: string;
  tagged?: PageText[];
  /** For hatch swatches: the areas on the sheet hatched the same way, outside the legend, named by the room tag in each. */
  areas?: (SimilarArea & { label?: string })[];
}

/**
 * Finds the areas hatched like each swatch (a stipple or a hatch dense enough to sample
 * inside the swatch's frame). Needs the sheet's scale for its walls.
 */
export function findLegendAreas(rows: LegendRow[], segs: Segment[], box: Box, sheetW: number, sheetH: number, metersPerPoint: number): void {
  const [x0, y0, x1, y1] = norm(box);
  let model: WallModel | null = null;
  const marks = marksOf(segs);
  for (const r of rows) {
    if (r.kind !== 'area' || !r.graphic) continue;
    // Inside the frame, clear of its lines.
    const [gx0, gy0, gx1, gy1] = r.graphic;
    const inset = 1.5;
    if (gx1 - gx0 < 4 * inset || gy1 - gy0 < 4 * inset) continue;
    const ring: [number, number][] = [
      [gx0 + inset, gy0 + inset],
      [gx1 - inset, gy0 + inset],
      [gx1 - inset, gy1 - inset],
      [gx0 + inset, gy1 - inset],
    ];
    // A swatch is a deliberate sample of its hatch: a grid at plan scale may show only two
    // lines each way in it.
    const pattern = samplePattern(marks, ring, sheetW * sheetH, { minLines: 2, minWeight: 8 });
    if (!pattern) continue;
    const found = findPatternOn(segs, () => (model ??= buildWallModel(segs, metersPerPoint)), pattern, sheetW, sheetH);
    const centre = (pts: [number, number][]) => [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length];
    r.areas = found.areas.filter((a) => {
      const [cx, cy] = centre(a.points);
      return !(cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1);
    });
  }
}

const norm = (b: Box): Box => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
const upright = (t: PageText) => !t.angle || Math.abs(t.angle) < 0.1;
/** A short tag drawn with a symbol: FH, HP, SD, EX-1. */
const TAG = /^[A-Z][A-Z0-9-]{0,5}$/;

/**
 * Reads a legend boxed on the sheet. Labels are the column of text most rows start at;
 * each label line is a row, and its graphic is the linework left of the labels within
 * the row's band. A wrapped label (a line with no graphic of its own) joins the row above.
 */
export function readLegend(texts: PageText[], segs: Segment[], box: Box): LegendRow[] {
  const rows = legendRows(texts, segs, box);
  for (const r of rows) countRow(r, segs, box);
  return rows;
}

/**
 * The same, yielding between symbols so a big sheet does not freeze the page:
 * each symbol is matched against the whole sheet.
 */
export async function readLegendAsync(texts: PageText[], segs: Segment[], box: Box, onProgress?: (done: number, of: number) => void): Promise<LegendRow[]> {
  const rows = legendRows(texts, segs, box);
  const symbols = rows.filter((r) => r.kind === 'count' && r.graphic);
  for (const [i, r] of symbols.entries()) {
    onProgress?.(i, symbols.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
    countRow(r, segs, box);
  }
  return rows;
}

/** A symbol row's copies on the sheet, outside the legend. */
function countRow(r: LegendRow, segs: Segment[], box: Box) {
  if (r.kind !== 'count' || !r.graphic) return;
  const [x0, y0, x1, y1] = norm(box);
  const pad = 0.5;
  const sample = sampleSymbol(segs, [r.graphic[0] - pad, r.graphic[1] - pad, r.graphic[2] + pad, r.graphic[3] + pad]);
  if (!sample) return;
  r.sample = sample;
  const outside = (f: SymbolMatch) => !(f.at[0] >= x0 && f.at[0] <= x1 && f.at[1] >= y0 && f.at[1] <= y1);
  r.found = matchSymbol(sample, segs).filter(outside);
  if (r.found.length) return;
  // A legend drawn in another lineweight than the plan's blocks: the same lines in any pen.
  const penless = { ...sample, lines: sample.lines.map((l) => ({ ...l, width: 0 })) };
  r.found = matchSymbol(penless, anyPen(segs)).filter(outside);
}

const penlessCache = new WeakMap<Segment[], Segment[]>();
/** The sheet's lines with their pens ignored (each sheet's copy made once). */
function anyPen(segs: Segment[]): Segment[] {
  let out = penlessCache.get(segs);
  if (!out) {
    out = segs.map((x) => ({ ...x, width: 0 }));
    penlessCache.set(segs, out);
  }
  return out;
}

function legendRows(texts: PageText[], segs: Segment[], box: Box): LegendRow[] {
  const [x0, y0, x1, y1] = norm(box);
  const inside = texts.filter((t) => upright(t) && t.cx >= x0 && t.cx <= x1 && t.cy >= y0 && t.cy <= y1 && !/legend/i.test(t.str));
  if (!inside.length) return [];

  // The label column: the left edge most text runs share (within 3 pt). Short tags drawn in
  // or beside the symbols (FH, SD) can line up too, so descriptions decide when there are any.
  const described = inside.filter((t) => !TAG.test(t.str));
  const lefts = (described.length >= 2 ? described : inside).map((t) => t.cx - t.w / 2);
  let labelX = Infinity;
  let best = 0;
  for (const l of lefts) {
    const n = lefts.filter((m) => Math.abs(m - l) <= 3).length;
    if (n > best || (n === best && l < labelX)) {
      best = n;
      labelX = Math.min(...lefts.filter((m) => Math.abs(m - l) <= 3));
    }
  }
  if (best < 2) return [];
  const labels = inside.filter((t) => t.cx - t.w / 2 >= labelX - 2).sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  // Label lines: runs on one baseline join left to right.
  const lines: { cy: number; h: number; parts: PageText[] }[] = [];
  for (const t of labels) {
    const line = lines.find((l) => Math.abs(l.cy - t.cy) < Math.max(l.h, t.h) * 0.6);
    if (line) line.parts.push(t);
    else lines.push({ cy: t.cy, h: t.h, parts: [t] });
  }
  // A line stops at a wide gap: past it is a second legend column, read when boxed on its own.
  for (const l of lines) {
    l.parts.sort((a, b) => a.cx - b.cx);
    const cut = l.parts.findIndex((t, i) => i > 0 && t.cx - t.w / 2 - (l.parts[i - 1].cx + l.parts[i - 1].w / 2) > 3 * l.h);
    if (cut > 0) l.parts = l.parts.slice(0, cut);
  }
  lines.sort((a, b) => a.cy - b.cy);
  // A label wrapped onto a second line sits closer than the legend's rows do.
  const groups: { top: number; bottom: number; h: number; parts: PageText[] }[] = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && l.cy - g.bottom < Math.max(g.h, l.h) * 1.8) {
      g.bottom = l.cy;
      g.parts.push(...l.parts.sort((a, b) => a.cx - b.cx));
    } else groups.push({ top: l.cy, bottom: l.cy, h: l.h, parts: [...l.parts].sort((a, b) => a.cx - b.cx) });
  }

  // Graphic linework: wholly left of the labels and inside the box.
  const gap = 2;
  const art = segs.filter((s) => Math.max(s.x1, s.x2) < labelX - gap && Math.min(s.x1, s.x2) >= x0 && Math.min(s.y1, s.y2) >= y0 && Math.max(s.y1, s.y2) <= y1);

  const tags = inside.filter((t) => t.cx + t.w / 2 < labelX - gap && TAG.test(t.str));
  const outside = (x: number, y: number) => !(x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const rows: LegendRow[] = [];
  groups.forEach((line, i) => {
    // The row's band runs halfway to the rows above and below.
    const top = i === 0 ? y0 : (groups[i - 1].bottom + line.top) / 2;
    const bottom = i === groups.length - 1 ? y1 : (line.bottom + groups[i + 1].top) / 2;
    const mine = art.filter((s) => Math.min(s.y1, s.y2) >= top && Math.max(s.y1, s.y2) <= bottom);
    const label = line.parts
      .map((p) => p.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!mine.length && rows.length && !rows[rows.length - 1].label.endsWith(':')) {
      // A wrapped label line, or a heading, with no graphic of its own: part of the row above.
      const above = rows[rows.length - 1];
      if (line.top - groups[i - 1].bottom < line.h * 2.2) {
        above.label = `${above.label} ${label}`;
        return;
      }
    }
    const graphic: Box | null = mine.length
      ? [Math.min(...mine.map((s) => Math.min(s.x1, s.x2))), Math.min(...mine.map((s) => Math.min(s.y1, s.y2))), Math.max(...mine.map((s) => Math.max(s.x1, s.x2))), Math.max(...mine.map((s) => Math.max(s.y1, s.y2)))]
      : null;
    // A tag belongs to the row's graphic: inside it or just beside it (a heading is neither).
    const near = (t: PageText) =>
      graphic && t.cx >= graphic[0] - 3 * t.h - t.w && t.cx <= graphic[2] + 3 * t.h + t.w && t.cy >= graphic[1] - 2 * t.h && t.cy <= graphic[3] + 2 * t.h;
    const tag = tags.find((t) => t.cy >= top && t.cy <= bottom && near(t))?.str;
    const row: LegendRow = { label, graphic, kind: graphic ? classify(mine, graphic) : null };
    if (tag) {
      row.tag = tag;
      row.tagged = texts.filter((t) => t.str === tag && outside(t.cx, t.cy));
    }
    rows.push(row);
  });

  return rows;
}

/** A swatch (a closed box with a pattern or fill in it) is an area; a long thin graphic a line type; anything else a symbol. */
function classify(segs: Segment[], [gx0, gy0, gx1, gy1]: Box): Kind {
  const w = gx1 - gx0;
  const h = gy1 - gy0;
  const tol = Math.max(0.6, Math.min(w, h) * 0.04);
  const along = (s: Segment, horizontal: boolean, at: number) =>
    horizontal
      ? Math.abs(s.y1 - at) <= tol && Math.abs(s.y2 - at) <= tol && Math.abs(s.x2 - s.x1) >= w * 0.9
      : Math.abs(s.x1 - at) <= tol && Math.abs(s.x2 - at) <= tol && Math.abs(s.y2 - s.y1) >= h * 0.9;
  const framed = segs.some((s) => along(s, true, gy0)) && segs.some((s) => along(s, true, gy1)) && segs.some((s) => along(s, false, gx0)) && segs.some((s) => along(s, false, gx1));
  if (framed && w >= 12 && h >= 6) return 'area';
  if (h <= Math.max(2, w * 0.2) && w >= 20) return 'linear';
  return 'count';
}
