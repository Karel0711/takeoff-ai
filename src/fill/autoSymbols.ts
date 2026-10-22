import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { classify, legendRows, type LegendRow } from './legend';
import { look, type LookLine } from './symbolLook';
import { sampleSymbol, type SymbolLine, type SymbolSample } from './symbols';
import type { Segment } from './vectors';
import { findRoot } from '../arrays';

/**
 * Count symbols with nothing boxed: the legends on a sheet are found by their headings
 * ("Legend", "RCP Legend", "Symbols", "Electrical Legend"), every legend line drawn with a
 * symbol becomes a symbol to count, and each is counted wherever it is drawn in the set,
 * leaving out the legends themselves and the title block.
 */

export type Box = [number, number, number, number];

export interface FoundLegend {
  /** The heading as printed. */
  heading: string;
  /** The whole legend, heading included: copies inside it are not counted. */
  box: Box;
  rows: LegendRow[];
  /** For one column of a grid legend: the category it is under ("POWER"). */
  group?: string;
}

/** A legend line drawn with a symbol, ready to count. */
export interface LegendSymbol {
  /** The label, lower-cased and tidied: the same line in another sheet's legend is the same symbol. */
  key: string;
  label: string;
  /** Which legend it was read from. */
  legend: string;
  sample: SymbolSample;
  /** Lettering inside the symbol (EXIT, Fh, S) that each copy must have too: the outline alone is shared by several symbols. */
  text?: string;
  /** Sizes its copies may be drawn at (a legend's: any, in proportion). */
  sizes?: Sizes;
}

const upright = (t: PageText) => !t.angle || Math.abs(t.angle) < 0.1;
const left = (t: PageText) => t.cx - t.w / 2;
const right = (t: PageText) => t.cx + t.w / 2;
const words = (s: string) => s.trim().split(/\s+/).length;

/** A legend's heading: short, naming a legend or symbols ("RCP Legend:", "SYMBOLS", "Electrical Legend", "Legend of Symbols"). */
export function isLegendHeading(str: string): boolean {
  const s = str.trim();
  if (!/\b(legend|symbols?)\b/i.test(s) || words(s) > 6 || s.length > 48) return false;
  // "see legend", "symbol modifiers", "(refer to legend)" are notes, not headings.
  if (/\b(see|refer|per|as)\b/i.test(s) || /modifier/i.test(s)) return false;
  return true;
}

type HLine = { at: number; a: number; b: number };

/** Long axis-aligned lines, collinear pieces joined: horizontal ones by y, vertical by x. */
export function axisLines(segs: Segment[], min: number): { h: HLine[]; v: HLine[] } {
  const join = (raw: HLine[]) => {
    raw.sort((p, q) => p.at - q.at || p.a - q.a);
    const out: HLine[] = [];
    for (const r of raw) {
      let last: HLine | undefined;
      for (let i = out.length - 1; i >= 0 && !last; i--) if (Math.abs(out[i].at - r.at) <= 0.3 && r.a <= out[i].b + 2) last = out[i];
      if (last) last.b = Math.max(last.b, r.b);
      else out.push({ ...r });
    }
    return out.filter((o) => o.b - o.a >= min);
  };
  const h: HLine[] = [];
  const v: HLine[] = [];
  for (const s of segs) {
    if (s.filled && s.width === 0 && s.color === '#ffffff') continue;
    if (Math.abs(s.y1 - s.y2) <= 0.3 && Math.abs(s.x2 - s.x1) >= 2)
      h.push({
        at: (s.y1 + s.y2) / 2,
        a: Math.min(s.x1, s.x2),
        b: Math.max(s.x1, s.x2),
      });
    else if (Math.abs(s.x1 - s.x2) <= 0.3 && Math.abs(s.y2 - s.y1) >= 2)
      v.push({
        at: (s.x1 + s.x2) / 2,
        a: Math.min(s.y1, s.y2),
        b: Math.max(s.y1, s.y2),
      });
  }
  return { h: join(h), v: join(v) };
}

/** The rectangle framing a heading: a line over it, sides running down from that line. */
function frameAround(head: PageText, lines: { h: HLine[]; v: HLine[] }): Box | null {
  const hl = left(head);
  const hr = right(head);
  const tops = lines.h.filter((l) => l.at < head.cy - head.h * 0.5 && l.at >= head.cy - head.h * 8 && l.a <= hl + 1 && l.b >= hr - 1).sort((p, q) => q.at - p.at);
  for (const top of tops) {
    const sides = lines.v.filter((v) => v.a <= top.at + 1.5 && v.a >= top.at - 1.5 && v.b > head.cy + head.h * 2);
    const l = sides.filter((v) => v.at <= hl && v.at >= top.a - 1.5).sort((p, q) => q.at - p.at)[0];
    const r = sides.filter((v) => v.at >= hr && v.at <= top.b + 1.5).sort((p, q) => p.at - q.at)[0];
    if (l && r) return [l.at, top.at, r.at, Math.min(l.b, r.b)];
    // A table drawn as rows closed on one side only: the rule over the heading gives the other.
    if (l || r) return [l ? l.at : top.a, top.at, r ? r.at : top.b, (l ?? r)!.b];
  }
  return null;
}

/**
 * How far down a legend runs, from its labels: the column of text most lines start at, read
 * down while the lines keep coming at about the legend's spacing, up to text that runs across
 * the column (notes) or a gap much wider than the legend's rows.
 */
function labelsEnd(head: PageText, texts: PageText[], x0: number, x1: number, y1: number): number | null {
  const below = texts.filter((t) => upright(t) && t.cx >= x0 && t.cx <= x1 && t.cy > head.cy + head.h * 0.6 && t.cy <= y1).sort((a, b) => a.cy - b.cy);
  // Labels are words; lettering drawn inside symbols is not.
  const wordy = below.filter((t) => /[A-Za-z]{2}/.test(t.str) && t.h < head.h * 1.2);
  const lefts = wordy.slice(0, 40).map(left);
  let labelX = NaN;
  let best = 0;
  for (const l of lefts) {
    const n = lefts.filter((m) => Math.abs(m - l) <= 3).length;
    if (n > best) {
      best = n;
      labelX = Math.min(...lefts.filter((m) => Math.abs(m - l) <= 3));
    }
  }
  if (best < 2) return null;
  const labels = wordy.filter((t) => left(t) >= labelX - 2);
  const h = labels.map((t) => t.h).sort((a, b) => a - b)[Math.floor(labels.length / 2)] ?? head.h;
  let bottom = head.cy + head.h * 0.5;
  const pitches: number[] = [];
  let lastCy = NaN;
  for (const t of below) {
    // Notes running across the label column: past the legend.
    if (left(t) < labelX - 2 * h && right(t) > labelX + 4 * h && /[A-Za-z]{3}/.test(t.str)) {
      if (t.cy - h > bottom) break;
      continue;
    }
    if (left(t) < labelX - 2 || !/[A-Za-z]{2}/.test(t.str)) continue;
    if (t.h > h * 1.6) break;
    const pitch = pitches.length ? pitches.slice().sort((a, b) => a - b)[Math.floor(pitches.length / 2)] : h * 4;
    if (t.cy - t.h - bottom > Math.max(h * 6, pitch * 3)) break;
    if (!Number.isNaN(lastCy) && t.cy - lastCy > t.h * 0.6) pitches.push(t.cy - lastCy);
    lastCy = t.cy;
    bottom = Math.max(bottom, t.cy + t.h * 0.5);
  }
  return bottom;
}

/**
 * A legend drawn as a grid: one table across the sheet, columns in pairs of a narrow symbol
 * column and a description column, each pair under a category heading ("POWER", "FIRE ALARM
 * INITIATING"), rows ruled between. Each pair is read as a legend of its own, row by row: the
 * ink in the symbol cell is the symbol, the words in the description cell its label.
 */
export function gridLegends(head: PageText, frame: Box, texts: PageText[], segs: Segment[], lines: { h: HLine[]; v: HLine[] }): FoundLegend[] {
  const [fx0, fy0, fx1, fy1] = frame;
  const fh = fy1 - fy0;
  // Column rules: vertical lines inside the frame running most of its height.
  const xs: number[] = [];
  for (const v of lines.v) {
    if (v.at < fx0 - 1 || v.at > fx1 + 1 || v.b - v.a < fh * 0.3 || v.b < fy0 || v.a > fy1) continue;
    if (!xs.some((x) => Math.abs(x - v.at) < 2)) xs.push(v.at);
  }
  xs.sort((a, b) => a - b);
  if (xs.length < 4) return [];
  const inside = (t: PageText, x0: number, x1: number) => upright(t) && t.cx > x0 && t.cx < x1 && t.cy > head.cy + head.h && t.cy < fy1;
  const wordsIn = (x0: number, x1: number) => texts.filter((t) => inside(t, x0, x1) && /[A-Za-z]{3}/.test(t.str)).length;
  const out: FoundLegend[] = [];
  for (let i = 0; i + 2 < xs.length; i++) {
    const [a, b, c] = [xs[i], xs[i + 1], xs[i + 2]];
    // A symbol column: narrow beside its description, few words in it.
    if (b - a > (c - b) * 0.6 || b - a < 8) continue;
    const descWords = wordsIn(b, c);
    if (descWords < 3 || wordsIn(a, b) > descWords * 0.3) continue;
    // Row rules across the pair.
    const ys = lines.h
      .filter((h) => h.a <= a + 2 && h.b >= c - 2 && h.at > head.cy && h.at <= fy1 + 1)
      .map((h) => h.at)
      .sort((p, q) => p - q)
      .filter((y, k, arr) => k === 0 || y - arr[k - 1] > 2);
    if (ys.length < 3) continue;
    const rows: LegendRow[] = [];
    let heading = '';
    for (let k = 0; k + 1 < ys.length; k++) {
      const [y0, y1] = [ys[k], ys[k + 1]];
      const label = texts
        .filter((t) => upright(t) && t.cx > b && t.cx < c && t.cy > y0 && t.cy < y1)
        .sort((p, q) => p.cy - q.cy || p.cx - q.cx)
        .map((t) => t.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const art = segs.filter(
        (s) => Math.min(s.x1, s.x2) > a + 1 && Math.max(s.x1, s.x2) < b - 1 && Math.min(s.y1, s.y2) > y0 + 0.5 && Math.max(s.y1, s.y2) < y1 - 0.5,
      );
      // A row whose symbol is lettering alone ("OS" an occupancy sensor, "TR" tamper resistant):
      // counted where the plans write it.
      const lettering = texts.filter((t) => upright(t) && t.cx > a && t.cx < b && t.cy > y0 && t.cy < y1).map((t) => t.str.trim());
      const tag = lettering.length === 1 && /^[A-Z][A-Z0-9/-]{1,5}$/.test(lettering[0]) ? lettering[0] : null;
      if (tag && label && !/^INDICATE[SD]?\b/i.test(label) && !art.some((s) => s.width > 0 && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > (b - a) * 0.4)) {
        rows.push({ label, graphic: null, kind: 'count', tag });
        continue;
      }
      // A row with no symbol drawn: the column's category heading (the first one), or a note.
      if (!art.length) {
        if (!heading && !rows.length) heading = texts.filter((t) => upright(t) && t.cy > y0 && t.cy < y1 && t.cx > a && t.cx < c).map((t) => t.str.trim()).join(' ');
        continue;
      }
      if (!label) continue;
      const graphic: Box = [Math.min(...art.map((s) => Math.min(s.x1, s.x2))), Math.min(...art.map((s) => Math.min(s.y1, s.y2))), Math.max(...art.map((s) => Math.max(s.x1, s.x2))), Math.max(...art.map((s) => Math.max(s.y1, s.y2)))];
      rows.push({ label, graphic, kind: classify(art, graphic) });
    }
    if (rows.length < 2) continue;
    out.push({ heading: head.str.replace(/:\s*$/, '').trim(), box: [a, ys[0], c, ys[ys.length - 1]], rows, ...(heading ? { group: heading } : {}) });
  }
  return out;
}

/**
 * The table a heading tops when no frame closes round it (its sides are the sheet border's): the
 * rule over the heading, down to the last rule under it about as long.
 */
function tableUnder(head: PageText, lines: { h: HLine[]; v: HLine[] }, height: number): Box | null {
  // The table's top rule: over the heading or just under it, much longer than the heading (not its underline).
  const wide = (right(head) - left(head)) * 3;
  const top = lines.h
    .filter((l) => l.at >= head.cy - head.h * 8 && l.at <= head.cy + head.h * 3 && l.a <= left(head) + 1 && l.b >= right(head) - 1 && l.b - l.a >= wide)
    .sort((p, q) => Math.abs(p.at - head.cy) - Math.abs(q.at - head.cy))[0];
  if (!top) return null;
  const long = lines.h.filter((l) => l.at > top.at && l.at < top.at + height * 0.8 && l.b - l.a >= (top.b - top.a) * 0.5 && l.a < top.b && l.b > top.a);
  if (long.length < 3) return null;
  return [top.a, Math.min(top.at, head.cy - head.h), top.b, Math.max(...long.map((l) => l.at))];
}

/** Every legend on a sheet, read into rows (symbols not yet counted), outside `avoid` (the title block). */
export function findLegends(texts: PageText[], segs: Segment[], width: number, height: number, avoid: Box[] = []): FoundLegend[] {
  const heads = texts.filter((t) => upright(t) && isLegendHeading(t.str));
  if (!heads.length) return [];
  const lines = axisLines(segs, 20);
  const out: FoundLegend[] = [];
  for (const head of heads) {
    if (out.some((l) => inBox([head.cx, head.cy], l.box)) || avoid.some((b) => inBox([head.cx, head.cy], b))) continue;
    const frame = frameAround(head, lines);
    let box: Box;
    // A frame round just the legend is the legend; a sheet-high column of notes it shares is trimmed to its labels.
    if (frame && frame[2] - frame[0] <= width * 0.45 && frame[3] - frame[1] <= height * 0.6) box = frame;
    else {
      // A table across the sheet: columns of symbols and descriptions in pairs.
      const grid = gridLegends(head, frame ?? tableUnder(head, lines, height) ?? [0, 0, 0, 0], texts, segs, lines);
      if (grid.length >= 2) {
        out.push(...grid);
        continue;
      }
      const x0 = frame ? frame[0] : left(head) - head.h * 3;
      const x1 = frame ? frame[2] : Math.min(width, left(head) + width * 0.3);
      const end = labelsEnd(head, texts, x0, x1, frame ? frame[3] : height);
      if (end === null) continue;
      box = [x0, head.cy - head.h, x1, end + head.h];
    }
    // Not into the title block beside or below it.
    for (const b of avoid) {
      if (b[0] > head.cx && b[0] < box[2] && b[1] < box[3] && b[3] > box[1]) box[2] = b[0];
      if (b[1] > head.cy && b[1] < box[3] && b[0] < box[2] && b[2] > box[0]) box[3] = b[1];
    }
    // The rows start under the heading. A line of many words is a note, not a legend line; a
    // block that is mostly notes is notes.
    const rows = legendRows(texts, segs, [box[0], head.cy + head.h * 0.6, box[2], box[3]]).filter((r) => words(r.label) <= 12);
    const drawn = rows.filter((r) => r.graphic).length;
    if (drawn < 2 || drawn < rows.length * 0.4) continue;
    out.push({ heading: head.str.replace(/:\s*$/, '').trim(), box, rows });
  }
  return out;
}

/** The label as a key: the same line in another sheet's legend is the same symbol. */
export const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[:.,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A legend line naming a surface or material: its framed graphic is a hatch swatch, measured as an area. */
const SURFACE =
  /\b(ceilings?|floors?|flooring|walls?|wallboard|roof(ing)?|assembl(y|ies)|finish(es)?|carpet|tiles?|paint(ed)?|concrete|asphalt|grass|sod|gravel|insulation|membrane|hatch(ed)?|zones?|areas?|existing|masonry|brick|block|stone|wood|vinyl|terrazzo|epoxy)\b/i;

/** A tag or reference mark (section marks, room and door numbers): its lettering is a placeholder, filled in differently at every copy. */
const PLACEHOLDER = /#|xx|^\d+(\.\d+)?$|^[A-Z]\d{2,4}$/i;

/**
 * Lettering drawn in a symbol: about its middle and small enough to be part of it (not a big
 * glyph laid over it, nor stray characters a scanned-in text layer put at its edge).
 */
function textInside(texts: PageText[], [x0, y0, x1, y1]: Box): PageText[] {
  const small = Math.max(1.5, Math.min(x1 - x0, y1 - y0) * 0.6);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return texts.filter(
    (t) => Math.abs(t.cx - mx) <= (x1 - x0) * 0.3 && Math.abs(t.cy - my) <= (y1 - y0) * 0.3 && t.h <= small && t.w <= x1 - x0 + 1 && /^[A-Za-z0-9#.\-/]+$/.test(t.str),
  );
}

const inBox = ([x, y]: Pt, b: Box) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** The sheet's ink: white fills (the masks drawn behind symbols and lettering) are not seen. */
export function visibleInk(segs: Segment[]): Segment[] {
  let out = visibleCache.get(segs);
  if (!out) {
    out = segs.filter((s) => !(s.filled && /^#f{6}$/i.test(s.color ?? '')));
    visibleCache.set(segs, out);
  }
  return out;
}
const visibleCache = new WeakMap<Segment[], Segment[]>();

/**
 * The legend's lines drawn with a symbol, as samples to count (from the sheet's visible ink).
 * Hatches and line types are left to Read a legend; tags and reference marks (a placeholder
 * such as 1/A301, w#, 07 drawn in them, or "see sheet …") are not things to count. A framed
 * graphic can be a hatch swatch or a symbol drawn as a box (a diffuser, an exit sign): it is
 * taken as a symbol when `hasCopies` says copies of it are drawn on the sheet.
 */
export function legendSymbols(legend: FoundLegend, texts: PageText[], segs: Segment[], hasCopies?: (s: LegendSymbol) => boolean): LegendSymbol[] {
  // The legend's own rules (its frame, the stubs of a table's row dividers) are not part of any symbol.
  const [bx0, , bx1] = legend.box;
  const ink = visibleInk(segs).filter((s) => Math.min(s.x1, s.x2) > bx0 + 1 && Math.max(s.x1, s.x2) < bx1 - 1);
  const out: LegendSymbol[] = [];
  for (const r of legend.rows) {
    if ((r.kind !== 'count' && r.kind !== 'area') || !r.graphic) continue;
    const pad = 0.5;
    const g: Box = [r.graphic[0] - pad, r.graphic[1] - pad, r.graphic[2] + pad, r.graphic[3] + pad];
    const lettering = textInside(texts, g);
    if (lettering.some((t) => PLACEHOLDER.test(t.str))) continue;
    if (/\bsee\b(?!\s+also)/i.test(r.label) && /\b(sheets?|schedules?|series)\b/i.test(r.label)) continue;
    // A line type for walls ("existing wall to remain", "new partition"): measured, not counted.
    if (/^(EXISTING|NEW|PROPOSED|RATED|FIRE)?[\s\w-]{0,20}\b(WALLS?|PARTITIONS?)\b\s*(TO\s+(REMAIN|BE\b)|$|\(|-|,)|\b(WALLS?|PARTITIONS?)\s+TO\s+(REMAIN|BE (DEMOLISHED|REMOVED))/i.test(r.label)) continue;
    const sample = sampleSymbol(ink, g);
    if (!sample) continue;
    const label = r.label.replace(/[:,]\s*$/, '').trim();
    const symbol: LegendSymbol = {
      key: keyOf(label),
      label,
      legend: legend.heading,
      sample,
    };
    if (lettering.length) symbol.text = lettering.map((t) => t.str).join(' ');
    // Only lines, nothing closed (a dashed outline, a corner mark): too plain to tell from the
    // window frames and wall ends it looks like. Read a legend or a click counts those.
    if (!closedShape(sample.lines)) continue;
    // A box with lettering in it (JB, SV, a keypad) is a symbol drawn as a box, not a hatch swatch.
    if (r.kind === 'area' && !lettering.length && (SURFACE.test(label) || !hasCopies?.(symbol))) continue;
    out.push(symbol);
  }
  return out;
}

/** Whether a drawing has a closed shape in it (a circle, a box, a hexagon of loose lines). */
export function closedShape(lines: readonly SymbolLine[]): boolean {
  if (lines.some((l) => l.filled)) return true;
  const xs = lines.flatMap((l) => [l.x1, l.x2]);
  const ys = lines.flatMap((l) => [l.y1, l.y2]);
  const tol = Math.max(0.05, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.02);
  const meets = (a: SymbolLine, b: SymbolLine) =>
    [
      [a.x1, a.y1],
      [a.x2, a.y2],
    ].some(([x, y]) => Math.hypot(x - b.x1, y - b.y1) <= tol || Math.hypot(x - b.x2, y - b.y2) <= tol);
  // Pieces: a shape drawn as one, or loose lines (a shape of one line each) meeting end to end.
  const count = new Map<number | undefined, number>();
  for (const l of lines) count.set(l.group, (count.get(l.group) ?? 0) + 1);
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => findRoot(parent, i);
  const loose = (l: SymbolLine) => l.group === undefined || count.get(l.group) === 1;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if ((!loose(a) && !loose(b) && a.group === b.group) || (loose(a) && loose(b) && meets(a, b))) parent[find(i)] = find(j);
    }
  const pieces = new Map<number, SymbolLine[]>();
  lines.forEach((l, i) => pieces.set(find(i), [...(pieces.get(find(i)) ?? []), l]));
  // Closed: a piece of three lines or more with every end meeting another.
  for (const ls of pieces.values()) {
    if (ls.length < 3) continue;
    const ends = ls.flatMap((l) => [
      [l.x1, l.y1],
      [l.x2, l.y2],
    ]);
    if (ends.every((e, i) => ends.some((f, j) => j !== i && Math.hypot(e[0] - f[0], e[1] - f[1]) <= tol))) return true;
  }
  return false;
}

/** A sheet made ready for counting symbols on: its visible ink, its drawn shapes by kind, a lookup grid. */
export interface SheetInk {
  segs: Segment[];
  texts: PageText[];
  /** Copies inside these (the legends, the title block) are not counted. */
  exclude: Box[];
}

interface ShapeInfo {
  w: number;
  h: number;
  cx: number;
  cy: number;
}
const shapeCache = new WeakMap<Segment[], Map<string, ShapeInfo[]>>();
const segLen = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const shapeKey = (n: number, filled: boolean, dashed = false) => `${n}|${filled ? 1 : 0}|${dashed ? 1 : 0}`;

/** The sheet's drawn shapes (subpaths), by how many lines they have and whether they are filled. */
function sheetShapes(segs: Segment[]): Map<string, ShapeInfo[]> {
  let out = shapeCache.get(segs);
  if (out) return out;
  const subs = new Map<number, Segment[]>();
  for (const s of segs) {
    if (s.sub === undefined || segLen(s) < 0.4) continue;
    const list = subs.get(s.sub);
    if (list) list.push(s);
    else subs.set(s.sub, [s]);
  }
  out = new Map();
  for (const ls of subs.values()) {
    const xs = ls.flatMap((s) => [s.x1, s.x2]);
    const ys = ls.flatMap((s) => [s.y1, s.y2]);
    const k = shapeKey(ls.length, ls[0].filled, !!ls[0].dashed);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const info = {
      w: x1 - x0,
      h: y1 - y0,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
    };
    const list = out.get(k);
    if (list) list.push(info);
    else out.set(k, [info]);
  }
  shapeCache.set(segs, out);
  return out;
}

/** A symbol's shapes, biggest first. */
function sampleShapes(sample: SymbolSample) {
  const groups = new Map<number, SymbolLine[]>();
  for (const l of sample.lines) {
    const k = l.group ?? 0;
    const list = groups.get(k);
    if (list) list.push(l);
    else groups.set(k, [l]);
  }
  return (
    [...groups.values()]
      .map((ls) => {
        const xs = ls.flatMap((l) => [l.x1, l.x2]);
        const ys = ls.flatMap((l) => [l.y1, l.y2]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        return {
          lines: ls,
          w: x1 - x0,
          h: y1 - y0,
          cx: (x0 + x1) / 2,
          cy: (y0 + y1) / 2,
          filled: !!ls[0].filled,
          dashed: !!ls[0].dashed,
        };
      })
      // The body first: a shape of a few lines (a circle, a box) says more than a lone stroke beside it.
      .sort((a, b) => Number(b.lines.length >= 3) - Number(a.lines.length >= 3) || Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.lines.length - a.lines.length)
  );
}

const GRID = 16;
/** A sheet's segments by the grid cell each starts in and each ends in, for footprint lookups. */
interface EndIndex {
  starts: Map<number, number[]>;
  ends: Map<number, number[]>;
  ci: Int32Array;
  cj: Int32Array;
}
const endCache = new WeakMap<Segment[], EndIndex>();
const cellKey = (i: number, j: number) => (i + 65536) * 131072 + (j + 65536);
function endIndex(segs: Segment[]): EndIndex {
  let ix = endCache.get(segs);
  if (ix) return ix;
  ix = { starts: new Map(), ends: new Map(), ci: new Int32Array(segs.length), cj: new Int32Array(segs.length) };
  const add = (m: Map<number, number[]>, k: number, i: number) => {
    const list = m.get(k);
    if (list) list.push(i);
    else m.set(k, [i]);
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    ix.ci[i] = Math.floor(s.x1 / GRID);
    ix.cj[i] = Math.floor(s.y1 / GRID);
    add(ix.starts, cellKey(ix.ci[i], ix.cj[i]), i);
    add(ix.ends, cellKey(Math.floor(s.x2 / GRID), Math.floor(s.y2 / GRID)), i);
  }
  endCache.set(segs, ix);
  return ix;
}

/**
 * The segments drawn wholly inside `box` with an end on `foot` (a box inside it), by the grid cell
 * they start in (column by column), then as drawn: only the cells under the footprint are looked in.
 */
function footSegs(segs: Segment[], box: Box, foot: Box): Segment[] {
  const ix = endIndex(segs);
  const onFoot = (x: number, y: number) => x >= foot[0] && x <= foot[2] && y >= foot[1] && y <= foot[3];
  const within = (s: Segment) => s.x1 >= box[0] && s.x1 <= box[2] && s.y1 >= box[1] && s.y1 <= box[3] && s.x2 >= box[0] && s.x2 <= box[2] && s.y2 >= box[1] && s.y2 <= box[3];
  const got: number[] = [];
  const [i0, i1, j0, j1] = [Math.floor(foot[0] / GRID), Math.floor(foot[2] / GRID), Math.floor(foot[1] / GRID), Math.floor(foot[3] / GRID)];
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      for (const n of ix.starts.get(cellKey(i, j)) ?? []) if (onFoot(segs[n].x1, segs[n].y1) && within(segs[n])) got.push(n);
      // Ending on the footprint, started off it (those started on it are in already).
      for (const n of ix.ends.get(cellKey(i, j)) ?? []) if (!onFoot(segs[n].x1, segs[n].y1) && onFoot(segs[n].x2, segs[n].y2) && within(segs[n])) got.push(n);
    }
  got.sort((m, n) => ix.ci[m] - ix.ci[n] || ix.cj[m] - ix.cj[n] || m - n);
  return got.map((n) => segs[n]);
}

/** Turns a point the matcher's way: quarter turns 0–3, 4–7 mirrored first. */
const turnPt = (x: number, y: number, turn: number): [number, number] => {
  const mx = turn >= 4 ? -x : x;
  const q = turn % 4;
  return q === 0 ? [mx, y] : q === 1 ? [-y, mx] : q === 2 ? [-mx, -y] : [y, -mx];
};
/** Undoes `turnPt`. */
const unturn = (x: number, y: number, turn: number): [number, number] => {
  const q = turn % 4;
  const [u, v] = q === 0 ? [x, y] : q === 1 ? [y, -x] : q === 2 ? [-x, -y] : [-y, x];
  return turn >= 4 ? [-u, v] : [u, v];
};

/** The stretch (0–1 along it) of a line inside a box, or null. */
function clipT(ax: number, ay: number, bx: number, by: number, [x0, y0, x1, y1]: Box): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** A sample's extent and finest stroke, worked out once per sample. */
const boundsCache = new WeakMap<readonly SymbolLine[], { x0: number; x1: number; y0: number; y1: number; fine: number }>();
function sampleBounds(sample: readonly SymbolLine[]) {
  const xs = sample.flatMap((l) => [l.x1, l.x2]);
  const ys = sample.flatMap((l) => [l.y1, l.y2]);
  // Hatching behind it (stipple, a fine-pen pattern) is not part of it.
  const strokes = sample.filter((l) => !l.filled && l.width > 0).map((l) => l.width);
  const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), fine: strokes.length ? Math.min(...strokes) / 2 : 0 };
  boundsCache.set(sample, b);
  return b;
}

/** Grid cells across a symbol when comparing drawings: fine enough to tell ◐ from ◒, coarse enough that a legend drawn a little differently from the plan's blocks still matches. */
const LOOK_CELLS = 14;
/** A copy must look this much like the sample (each drawing's ink found in the other). */
export const LOOK = 0.8;

/**
 * How alike the drawing at `at` (turned `turn`, drawn `size` times the sample's size) looks to
 * the sample (0–1). Only linework wholly inside the symbol's footprint counts: a grid line or
 * wall running through is not part of it.
 */
export function copyLooks(segs: Segment[], sample: readonly SymbolLine[], at: Pt, turn: number, size = 1, min = 0): { score: number; matched: number } {
  const { x0, x1, y0, y1, fine } = boundsCache.get(sample) ?? sampleBounds(sample);
  const pad = Math.max(x1 - x0, y1 - y0) / LOOK_CELLS + 0.3;
  const r = (Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)) + pad) * size;
  const copy: LookLine[] = [];
  const box: Box = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  const inside = (x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  // Linework wholly inside the footprint, and the part inside of lines that start or end on it
  // (the stem of a sconce round a pot light's place): a line passing right through, or hatching
  // that only runs into the footprint, is not part of it.
  const reachOut = r + Math.max(x1 - x0, y1 - y0) * size;
  const attached: number[][] = [];
  // The footprint on the sheet (quarter turns keep it square to the sheet), a hair bigger: a line
  // with neither end on it is neither part of the copy nor attached to it.
  const [c0x, c0y] = turnPt(box[0] * size, box[1] * size, turn);
  const [c1x, c1y] = turnPt(box[2] * size, box[3] * size, turn);
  const e = 1e-6 * (1 + reachOut);
  const [fx0, fx1] = [at[0] + Math.min(c0x, c1x) - e, at[0] + Math.max(c0x, c1x) + e];
  const [fy0, fy1] = [at[1] + Math.min(c0y, c1y) - e, at[1] + Math.max(c0y, c1y) + e];
  for (const s of footSegs(segs, [at[0] - reachOut, at[1] - reachOut, at[0] + reachOut, at[1] + reachOut], [fx0, fy0, fx1, fy1])) {
    if (!s.filled && s.width < fine) continue;
    if (segLen(s) < 0.4 * size) continue;
    const [ax, ay] = unturn((s.x1 - at[0]) / size, (s.y1 - at[1]) / size, turn);
    const [bx, by] = unturn((s.x2 - at[0]) / size, (s.y2 - at[1]) / size, turn);
    const ina = inside(ax, ay);
    const inb = inside(bx, by);
    if (ina && inb)
      copy.push({
        x1: ax,
        y1: ay,
        x2: bx,
        y2: by,
        filled: s.filled,
        group: s.sub,
        width: s.width / size,
      });
    else if ((ina || inb) && !s.filled) {
      const t = clipT(ax, ay, bx, by, box);
      if (t) attached.push([ax + (bx - ax) * t[0], ay + (by - ay) * t[0], ax + (bx - ax) * t[1], ay + (by - ay) * t[1], ina ? ax : bx, ina ? ay : by, s.width, ax, ay, bx, by]);
    }
  }
  const touch = pad;
  const near = (l: LookLine, x: number, y: number) => {
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    const t = Math.max(0, Math.min(1, ((x - l.x1) * dx + (y - l.y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (l.x1 + t * dx), y - (l.y1 + t * dy)) <= touch;
  };
  /**
   * The copy's line an end touches, if any: the first in the copy's order, as a scan would find it,
   * looked up by grid cell (a busy spot has thousands of lines and as many ends to try).
   */
  const G = 16;
  const gx = (box[2] - box[0]) / G || 1;
  const gy = (box[3] - box[1]) / G || 1;
  const cellOf = (v: number, o: number, g: number) => Math.max(0, Math.min(G - 1, Math.floor((v - o) / g)));
  let grid: number[][] = [];
  let indexed = 0;
  const index = () => {
    for (; indexed < copy.length; indexed++) {
      const l = copy[indexed];
      const i0 = cellOf(Math.min(l.x1, l.x2) - touch, box[0], gx);
      const i1 = cellOf(Math.max(l.x1, l.x2) + touch, box[0], gx);
      const j0 = cellOf(Math.min(l.y1, l.y2) - touch, box[1], gy);
      const j1 = cellOf(Math.max(l.y1, l.y2) + touch, box[1], gy);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) grid[j * G + i].push(indexed);
    }
  };
  const onCopy = (x: number, y: number): LookLine | undefined => {
    // A few lines: a plain scan is quicker than building the grid.
    if (!grid.length && copy.length * attached.length < 4096) return copy.find((l) => near(l, x, y));
    if (!grid.length) grid = Array.from({ length: G * G }, () => []);
    index();
    let best = -1;
    for (const k of grid[cellOf(y, box[1], gy) * G + cellOf(x, box[0], gx)]) if ((best < 0 || k < best) && near(copy[k], x, y)) best = k;
    return best < 0 ? undefined : copy[best];
  };
  const span0 = Math.max(x1 - x0, y1 - y0);
  // A shape lying wholly in the margin round the footprint is the neighbour's (the wall's
  // insulation a camera sits against), not part of the symbol.
  const eps = 1e-6 + span0 * 1e-6;
  const strict = (x: number, y: number) => x >= x0 - eps && x <= x1 + eps && y >= y0 - eps && y <= y1 + eps;
  const touching = new Set<number>();
  for (const l of copy) if (l.group !== undefined && (strict(l.x1, l.y1) || strict(l.x2, l.y2) || strict((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2))) touching.add(l.group);
  for (let i = copy.length - 1; i >= 0; i--) if (copy[i].group !== undefined && !touching.has(copy[i].group!)) copy.splice(i, 1);
  const span = Math.max(x1 - x0, y1 - y0);
  const beyond: LookLine[] = [];
  for (const [cx1, cy1, cx2, cy2, ex, ey, w, fx1, fy1, fx2, fy2] of attached) {
    const on = onCopy(ex, ey);
    if (!on) continue;
    copy.push({ x1: cx1, y1: cy1, x2: cx2, y2: cy2, width: w / size });
    // A short line running on out of it in its own pen is part of a bigger symbol here (a sconce's
    // stem); a long one is a leader or a wall, one in another pen the wall's hatching it sits on.
    if (Math.hypot(fx2 - fx1, fy2 - fy1) <= span && on.width !== undefined && Math.abs(on.width - w / size) <= 0.05 + on.width * 0.1)
      beyond.push({ x1: fx1, y1: fy1, x2: fx2, y2: fy2 });
  }
  const r2 = look(sample as readonly LookLine[] as LookLine[], copy, LOOK_CELLS, beyond, min);
  return { score: r2.score, matched: r2.matched * size * size };
}

/** A copy of a symbol on a sheet. */
export interface Copy {
  at: Pt;
  /** Its size over the sample's (1: the same). */
  size: number;
  /** How alike it looks (0–1). */
  score: number;
  /** How it is turned from the sample (quarter turns 0–3, 4–7 mirrored). */
  turn: number;
  /** How much of the drawing there the symbol accounts for, in square points. */
  matched: number;
}

/** Sizes a copy may be drawn at, over the sample's. */
export interface Sizes {
  min: number;
  max: number;
}
/**
 * A legend is seldom drawn to the plan's size (its surface light twice the plan's, a sconce
 * outside drawn half as big again as one inside): a legend symbol is itself at any size, in proportion.
 */
export const LEGEND_SIZES: Sizes = { min: 0.4, max: 2.5 };
/** A symbol picked on the plan is a block: its copies are drawn the same size (a 2x2 light is not a 1x1). */
export const BLOCK_SIZES: Sizes = { min: 0.92, max: 1.08 };

/**
 * Every place a symbol is drawn on a sheet, judged by eye rather than line by line: a legend is
 * often drawn apart from the blocks on the plan (a pot light's ticks a little shorter, a heavier
 * pen), so a copy is any drawing that looks the same and has the same parts. Candidates are the
 * sheet's shapes drawn like the symbol's body (as many lines, filled or not, in proportion); at
 * each, the drawing round it is compared with the symbol at all eight turns.
 */
export function findLookalikes(sample: SymbolSample, segs: Segment[], minLook = LOOK, sizes: Sizes = LEGEND_SIZES): Copy[] {
  const ink = visibleInk(segs);
  const shapes = sampleShapes(sample);
  const main = shapes[0];
  if (!main) return [];
  const [lo, hi] = [sizes.min, sizes.max];
  const out: Copy[] = [];
  for (const c of sheetShapes(ink).get(shapeKey(main.lines.length, main.filled, main.dashed)) ?? []) {
    let best: Copy | null = null;
    for (let turn = 0; turn < 8; turn++) {
      const [mw, mh] = turn % 2 ? [main.h, main.w] : [main.w, main.h];
      // About in proportion: each side scaled alike, give or take a quarter (or a point on a thin side).
      const fit = (c.w + c.h) / (mw + mh);
      if (Math.abs(c.w - mw * fit) > Math.max(1, mw * fit * 0.25) || Math.abs(c.h - mh * fit) > Math.max(1, mh * fit * 0.25)) continue;
      // Sized by the shape; or, when the shape is drawn a little smaller or bigger in the legend
      // than on the plan (the heads of an emergency light), the legend's own size.
      for (const size of Math.abs(fit - 1) > 0.05 && fit > 0.7 && fit < 1.4 ? [fit, 1] : [fit]) {
        if (!(size >= lo && size <= hi)) continue;
        const [ox, oy] = turnPt(main.cx * size, main.cy * size, turn);
        const at: Pt = [c.cx - ox, c.cy - oy];
        // Below the likeness wanted (or the best this shape already has) is no use: let it go early.
        const { score, matched } = copyLooks(ink, sample.lines, at, turn, size, best ? Math.max(minLook, best.score) : minLook);
        if (score >= minLook && (!best || score > best.score)) best = { at, size, score, turn, matched };
      }
    }
    if (!best) continue;
    const b = best;
    const twin = out.findIndex((o) => Math.hypot(o.at[0] - b.at[0], o.at[1] - b.at[1]) < (sample.span * Math.min(o.size, b.size)) / 3);
    if (twin < 0) out.push(b);
    else if (b.score > out[twin].score) out[twin] = b;
  }
  return out;
}

/**
 * Every copy of a symbol on a sheet outside the boxes given (legends, title block), with the
 * lettering drawn in the sample (EXIT, Fh) in the copy too.
 */
export function findCopies(symbol: LegendSymbol, sheet: SheetInk): Copy[] {
  const found = findLookalikes(symbol.sample, sheet.segs, LOOK, symbol.sizes ?? LEGEND_SIZES).filter((f) => !sheet.exclude.some((b) => inBox(f.at, b)));
  if (!symbol.text) return found;
  const want = symbol.text.toLowerCase().replace(/\s+/g, '');
  const xs = symbol.sample.lines.flatMap((l) => [l.x1, l.x2]);
  const ys = symbol.sample.lines.flatMap((l) => [l.y1, l.y2]);
  const r = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)) + 1;
  return found.filter((f) => {
    const reach = r * f.size;
    const near = sheet.texts.filter((t) => Math.abs(t.cx - f.at[0]) <= reach && Math.abs(t.cy - f.at[1]) <= reach);
    return (
      near.some((t) => t.str.toLowerCase().replace(/\s+/g, '') === want) ||
      near
        .map((t) => t.str)
        .join('')
        .toLowerCase()
        .replace(/\s+/g, '') === want
    );
  });
}

/**
 * Copies of several symbols on one sheet: where two land on one place (both look like the
 * drawing there), the one with more to it wins (a sconce, not the pot light inside it) unless
 * the other looks clearly more like it; of two about as big, the better likeness.
 */
export function settleOverlaps(found: { symbol: LegendSymbol; copies: Copy[] }[]): { symbol: LegendSymbol; copies: Copy[] }[] {
  const drawn = (symbol: LegendSymbol) => symbol.sample.lines.reduce((n, l) => n + segLen(l), 0);
  const all = found.flatMap((f, i) => f.copies.map((c) => ({ i, c, w: drawn(f.symbol) * c.size, r: (f.symbol.sample.span * c.size) / 2 })));
  const lost = new Set<Copy>();
  for (const a of all)
    for (const b of all) {
      if (a.i === b.i || lost.has(a.c) || lost.has(b.c)) continue;
      if (Math.hypot(a.c.at[0] - b.c.at[0], a.c.at[1] - b.c.at[1]) > Math.min(a.r, b.r)) continue;
      if (a.w > b.w * 1.05 && a.c.score >= b.c.score - 0.1) lost.add(b.c);
      else if (b.w > a.w * 1.05 && b.c.score >= a.c.score - 0.1) lost.add(a.c);
      else if (a.c.score >= b.c.score) lost.add(b.c);
      else lost.add(a.c);
    }
  return found.map((f) => ({ symbol: f.symbol, copies: f.copies.filter((c) => !lost.has(c)) }));
}

/**
 * The symbol under a click, with no box dragged: the drawn shape at the point (the smallest
 * one round it, else the nearest line) and the small shapes joined to it or drawn inside it,
 * up to `maxSpan` across. Lines longer than that (walls, grid) are never part of it.
 */
export function symbolBoxAt(segs: Segment[], [px, py]: Pt, maxSpan: number, reach = 3): Box | null {
  const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const near = segs.filter(
    (s) => Math.min(s.x1, s.x2) <= px + maxSpan && Math.max(s.x1, s.x2) >= px - maxSpan && Math.min(s.y1, s.y2) <= py + maxSpan && Math.max(s.y1, s.y2) >= py - maxSpan,
  );
  // Shapes: the PDF's subpaths, lines that are not too long to be part of a symbol.
  const shapes = new Map<number, Segment[]>();
  let loose = -1;
  for (const s of near) {
    if (len(s) > maxSpan) continue;
    const k = s.sub ?? loose--;
    const list = shapes.get(k);
    if (list) list.push(s);
    else shapes.set(k, [s]);
  }
  type Shape = { segs: Segment[]; box: Box };
  const all: Shape[] = [...shapes.values()].map((ss) => ({
    segs: ss,
    box: [
      Math.min(...ss.map((s) => Math.min(s.x1, s.x2))),
      Math.min(...ss.map((s) => Math.min(s.y1, s.y2))),
      Math.max(...ss.map((s) => Math.max(s.x1, s.x2))),
      Math.max(...ss.map((s) => Math.max(s.y1, s.y2))),
    ],
  }));
  const span = (b: Box) => Math.max(b[2] - b[0], b[3] - b[1]);
  const area = (b: Box) => Math.max(0.01, (b[2] - b[0]) * (b[3] - b[1]));
  const usable = all.filter((s) => span(s.box) <= maxSpan);
  const distTo = (s: Segment) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
  };
  // The smallest shape round the point (of some size: not a dot or a fill sliver), else the nearest line.
  const around = usable
    .filter((s) => inBox([px, py], [s.box[0] - 0.5, s.box[1] - 0.5, s.box[2] + 0.5, s.box[3] + 0.5]) && span(s.box) >= 1.5)
    .sort((a, b) => area(a.box) - area(b.box));
  let seed = around[0];
  if (!seed) {
    const byDist = usable
      .map((s) => ({ s, d: Math.min(...s.segs.map(distTo)) }))
      .filter((x) => x.d <= reach)
      .sort((a, b) => a.d - b.d);
    seed = byDist[0]?.s;
  }
  if (!seed) return null;
  // A shape round the seed not much bigger (the ring of ⊙ round its dot) is the symbol's outline.
  for (const s of around) if (s !== seed && area(s.box) <= area(seed.box) * 6 && span(s.box) <= maxSpan) seed = s;

  const grow = (start: Shape, joinTouching: boolean): Box | null => {
    let box: Box = [...start.box];
    const members = new Set<Shape>([start]);
    const ends = (s: Segment): Pt[] => [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ];
    const touches = (a: Shape, b: Shape) => {
      const tol = 0.6;
      for (const s of a.segs)
        for (const p of ends(s))
          for (const t of b.segs) {
            const dx = t.x2 - t.x1;
            const dy = t.y2 - t.y1;
            const u = Math.max(0, Math.min(1, ((p[0] - t.x1) * dx + (p[1] - t.y1) * dy) / (dx * dx + dy * dy || 1)));
            if (Math.hypot(p[0] - (t.x1 + u * dx), p[1] - (t.y1 + u * dy)) <= tol) return true;
          }
      return false;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of usable) {
        if (members.has(s)) continue;
        const inside = s.box[0] >= box[0] - 0.3 && s.box[1] >= box[1] - 0.3 && s.box[2] <= box[2] + 0.3 && s.box[3] <= box[3] + 0.3;
        // Parts hung on the body (a stem, a lamp head) are smaller than it; a shape as big (the next ceiling tile) is not part of it.
        const joined = joinTouching && !inside && span(s.box) < span(start.box) * 0.9 && [...members].some((m) => touches(s, m) || touches(m, s));
        if (!inside && !joined) continue;
        const next: Box = [Math.min(box[0], s.box[0]), Math.min(box[1], s.box[1]), Math.max(box[2], s.box[2]), Math.max(box[3], s.box[3])];
        if (span(next) > maxSpan) return null;
        members.add(s);
        box = next;
        changed = true;
      }
    }
    return box;
  };
  // Joined to more than a symbol's worth of linework (a light in a ceiling grid): the shape and what is drawn inside it.
  return grow(seed, true) ?? grow(seed, false) ?? seed.box;
}

/** The symbol clicked on a sheet, ready to count like a legend's (named by the legend line it matches, if any). */
export function pickSymbol(segs: Segment[], texts: PageText[], at: Pt, legends: LegendSymbol[] = [], maxSpan = 60): LegendSymbol | null {
  const ink = visibleInk(segs);
  const box = symbolBoxAt(ink, at, maxSpan);
  if (!box) return null;
  const pad = 0.5;
  const g: Box = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
  const sample = sampleSymbol(ink, g);
  if (!sample) return null;
  const lettering = textInside(texts, g);
  const text = lettering.length ? lettering.map((t) => t.str).join(' ') : undefined;
  // Named after the legend line drawn like it: copies of that line's symbol land on it.
  const span = Math.max(box[2] - box[0], box[3] - box[1]);
  const local = ink.filter((s) => Math.abs(s.x1 - at[0]) <= span * 4 && Math.abs(s.y1 - at[1]) <= span * 4);
  const origin = sample.origin ?? at;
  const named = legends
    .map((l) => ({ l, hit: findLookalikes(l.sample, local, LOOK, l.sizes ?? LEGEND_SIZES).filter((c) => Math.hypot(c.at[0] - origin[0], c.at[1] - origin[1]) <= span / 2) }))
    .filter((x) => x.hit.length && (!x.l.text || x.l.text === text))
    .sort((a, b) => b.hit[0].score - a.hit[0].score)[0]?.l;
  const label = named?.label ?? (text ? `Symbol ${text}` : 'Symbol');
  return {
    key: named?.key ?? `picked:${Math.round(origin[0])},${Math.round(origin[1])}`,
    label,
    legend: named?.legend ?? '',
    sample,
    ...(text ? { text } : {}),
    sizes: BLOCK_SIZES,
  };
}

/** A sheet of the set, as the counter sees it. */
export interface SetSheet {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** How the counter reads the set (the app reads pages through pdf.js; tests hand them in). */
export interface SetReader {
  texts(s: SetSheet): Promise<PageText[]>;
  segments(s: SetSheet): Promise<Segment[] | null>;
  /** Where nothing is counted besides the legends: the title block. */
  exclude(s: SetSheet, texts: PageText[]): Box[];
  /** Whether `s` is drawn at the scale of `home`, the sheet a symbol was read from: a symbol is only itself at its own scale. */
  sameScale(s: SetSheet, home: SetSheet, segs: Segment[], texts: PageText[]): boolean | Promise<boolean>;
  progress?(text: string): void;
}

/** One symbol counted across the set. */
export interface SymbolTally {
  symbol: LegendSymbol;
  /** The sheet it was read from (its legend, or where it was picked). */
  home: string;
  /** Copies on each sheet, in sheet points. */
  places: { sheetId: string; at: Pt[] }[];
  total: number;
}

const pause = () => new Promise((r) => setTimeout(r, 0));

/** A sheet number's discipline: its letters (E, M, FP, A), or for a bare number its series (8 of 812). */
export function discipline(name: string): string | null {
  const n = name.trim().toUpperCase();
  const letters = /^([A-Z]{1,3})[-.\s]?\d/.exec(n);
  if (letters) return letters[1];
  const series = /^(\d)\d{2}\b/.exec(n);
  return series ? series[1] : null;
}

/**
 * Counts every legend symbol of the set, as one count per legend line (a line repeated in each
 * sheet's legend is one symbol), on the sheets the legend is for: those carrying a legend of
 * that name (each reprint of the RCP legend is on an RCP), and sheets of the same discipline with
 * no legend of their own drawn at the legend's scale (an electrical plan whose legend is on a
 * legend sheet). A
 * floor plan with its own, different legend is not an RCP: its circles are not light fixtures.
 * Given a picked symbol, that symbol alone, on its sheet and every sheet at its scale. On a sheet
 * with its own legend, its own legend's drawing of a symbol is used; where symbols land on one
 * place, the one with more to it wins.
 */
export async function countSymbolsInSet(sheets: SetSheet[], reader: SetReader, picked?: { symbol: LegendSymbol; home: SetSheet }): Promise<SymbolTally[]> {
  const order: string[] = [];
  const canonical = new Map<string, { symbol: LegendSymbol; home: SetSheet }>();
  const own = new Map<string, Map<string, LegendSymbol>>();
  const legendsOn = new Map<string, { boxes: Box[]; names: Set<string> }>();
  const legendKey = (heading: string) => keyOf(heading);
  for (const [i, s] of sheets.entries()) {
    reader.progress?.(`Finding legends… ${i + 1} of ${sheets.length}`);
    const texts = await reader.texts(s);
    if (!texts.some((t) => upright(t) && isLegendHeading(t.str))) continue;
    const segs = await reader.segments(s);
    if (!segs) continue;
    await pause();
    const legends = findLegends(texts, segs, s.width, s.height, reader.exclude(s, texts));
    if (!legends.length) continue;
    legendsOn.set(s.id, { boxes: legends.map((l) => l.box), names: new Set(legends.map((l) => legendKey(l.heading))) });
    if (picked) continue;
    const sheet: SheetInk = { segs, texts, exclude: [...legends.map((l) => l.box), ...reader.exclude(s, texts)] };
    const mine = new Map<string, LegendSymbol>();
    for (const l of legends)
      for (const sym of legendSymbols(l, texts, segs, (x) => findCopies(x, sheet).length > 0)) {
        if (mine.has(sym.key)) continue;
        mine.set(sym.key, sym);
        if (!canonical.has(sym.key)) {
          canonical.set(sym.key, { symbol: sym, home: s });
          order.push(sym.key);
        }
      }
    own.set(s.id, mine);
  }
  if (picked) {
    order.push(picked.symbol.key);
    canonical.set(picked.symbol.key, picked);
  }
  if (!order.length) return [];

  const tallies = new Map<string, SymbolTally>(order.map((k) => [k, { symbol: canonical.get(k)!.symbol, home: canonical.get(k)!.home.id, places: [], total: 0 }]));
  const scaleOk = new Map<string, boolean>();
  for (const [i, s] of sheets.entries()) {
    const legends = legendsOn.get(s.id);
    const mine = own.get(s.id);
    // Which symbols this sheet is for, before reading its linework.
    const wanted = order.filter((k) => {
      if (mine?.has(k)) return true;
      const { symbol, home } = canonical.get(k)!;
      if (home.id === s.id) return true;
      if (picked) return true;
      // Legends of its own discipline only (E101 an E001 legend sheet's, not the fire alarm
      // legend on an 8xx sheet, whatever both legends are headed).
      const a = discipline(s.name);
      const b = discipline(home.name);
      if (a && b && a !== b) return false;
      return legends ? legends.names.has(legendKey(symbol.legend)) : true;
    });
    if (!wanted.length) continue;
    reader.progress?.(`Counting symbols… ${s.name} (${i + 1} of ${sheets.length})`);
    await pause();
    const texts = await reader.texts(s);
    const segs = await reader.segments(s);
    if (!segs) continue;
    const todo: LegendSymbol[] = [];
    for (const k of wanted) {
      const here = mine?.get(k);
      if (here) {
        todo.push(here);
        continue;
      }
      const { symbol, home } = canonical.get(k)!;
      const pair = `${s.id}|${home.id}`;
      if (!scaleOk.has(pair)) scaleOk.set(pair, home.id === s.id || (await reader.sameScale(s, home, segs, texts)));
      if (scaleOk.get(pair)) todo.push(symbol);
    }
    if (!todo.length) continue;
    const sheet: SheetInk = { segs, texts, exclude: [...(legends?.boxes ?? []), ...reader.exclude(s, texts)] };
    const found: { symbol: LegendSymbol; copies: Copy[] }[] = [];
    for (const symbol of todo) {
      found.push({ symbol, copies: findCopies(symbol, sheet) });
      await pause();
    }
    for (const { symbol, copies } of settleOverlaps(found)) {
      if (!copies.length) continue;
      const t = tallies.get(symbol.key)!;
      t.places.push({ sheetId: s.id, at: copies.map((c) => c.at) });
      t.total += copies.length;
    }
  }
  return order.map((k) => tallies.get(k)!);
}
