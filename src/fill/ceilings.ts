import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { ringArea } from '../geometry';
import { SegmentIndex } from '../walls/bands';
import { dedupe, symbolLoop } from '../walls/tags';
import { findGridHatch } from './hatchRegions';
import { readLegendRows } from './legend';
import { marksOf, type Mark } from './marks';
import { drawSegments, makeGrid, simplify, traceBoundary } from './raster';
import { snapToLines } from './roomFill';
import { findRoomLabels } from './rooms';
import type { Segment } from './vectors';

/**
 * Ceilings by ceiling type, read off a reflected ceiling plan the way an estimator reads one:
 * each ceiling is the area the walls (or a ceiling change line) enclose, and its type is
 *  (a) the ceiling type tag drawn in it (c1, cx3, ACT-1, GWB-1: a short code, usually in a
 *      small closed symbol, often with the height beside it),
 *  (b) failing a tag, the legend swatch its pattern matches,
 *  (c) failing both, what is drawn in it: a lay-in grid, a stipple (gypsum), or nothing.
 * Types are described from the ceiling types table when the set has one (code, then its
 * description on the same row).
 */

type Box = [number, number, number, number];

/** What is drawn in a ceiling area. */
export type CeilingKind = 'grid' | 'stipple' | 'hatch' | 'plain';

export interface CeilingTag {
  /** As printed (cx3, ACT-1). */
  code: string;
  /** For grouping: lower case, no dash (cx3, act1). */
  key: string;
  /** Centre of the tag. */
  at: Pt;
  /** The symbol round it (or the text's own box when it has none). */
  box: Box;
  /** The ceiling height printed with it, e.g. 8'-6". */
  height?: string;
  /** Tagged "above": a ceiling above the one seen (it does not type the area). */
  above?: boolean;
}

export interface CeilingDef {
  code: string;
  key: string;
  description: string;
  at: Pt;
}

export interface CeilingArea {
  points: Pt[];
  holes: Pt[][];
  /** In square sheet points, holes taken out. */
  area: number;
  /** The ceiling type code, when tagged (or carried from a tagged part of the same ceiling). */
  code: string | null;
  /** The legend row's label, for an area typed by the legend. */
  legend?: string;
  source: 'tag' | 'legend' | 'fallback';
  kind: CeilingKind;
  /** Heights tagged in it. */
  height?: string;
  /** Room numbers and names inside it. */
  room?: string;
}

export interface CeilingSheetRead {
  /** False when the sheet has no ceiling type tags: the areas are then the ceiling grid's (legacy reading). */
  tagged: boolean;
  areas: CeilingArea[];
  tags: CeilingTag[];
  defs: CeilingDef[];
  legend: { label: string; kind: CeilingKind }[];
}

/** A short type code: c1, cx3, ACT-1, GWB2, C-1A. */
const CODE = /^([A-Za-z]{1,4})-?(\d{1,3}[A-Za-z]?)$/;
/** Code prefixes ceiling types go by (an x after them for existing: cx, actx). */
const CEILING_PREFIX = /^(?:c|cl|clg|cg|ceil|act|acp|apc|acl|at|ec|gwb|gb|gyp|lap|sat|sc|t)x?$/i;
const HEIGHT = /^\d{1,2}'\s*-?\s*\d{1,2}(?:\s+\d{1,2}\/\d{1,2})?"?(?:\s*a\.?f\.?f\.?)?$|^\d{4}\s*(?:mm)?(?:\s*a\.?f\.?f\.?)?$/i;
/** A legend row about a ceiling finish (not a diffuser or a light drawn as a box). */
const CEILING_WORDS = /ceiling|\bclg\b|tile|panel|board|gypsum|\bgyp|\bgwb\b|\bact\b|lay-?in|acoustic|plaster|bulkhead|soffit|t-bar|suspended|drywall/i;
const ABOVE = /^(?:above|abv\.?|\(above\))$/i;

export const codeKey = (s: string) => s.replace(/-/g, '').toLowerCase();

/** Text runs drawn twice over (some exports do) count once. */
function uniqueTexts(texts: PageText[]): PageText[] {
  const seen = new Set<string>();
  return texts.filter((t) => {
    const k = `${t.str}|${Math.round(t.cx)}|${Math.round(t.cy)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const upright = (t: PageText) => !t.angle || Math.abs(t.angle) < 0.1;

/**
 * A ceiling types table: a column of type codes, one per row (at least three, lined up one
 * above the other), with each code's description to its right. The description is the
 * nearest column of the row with real text in it (a section drawing's labels are short),
 * its first line or lines up to a colon.
 */
export function readCeilingDefs(input: PageText[], segs: Segment[] = []): { defs: CeilingDef[]; box: Box | null } {
  const texts = uniqueTexts(input).filter(upright);
  const codes = texts.filter((t) => CODE.test(t.str));
  const used = new Set<PageText>();
  const defs: CeilingDef[] = [];
  const boxes: Box[] = [];
  // Candidate code columns, longest first: a table's own column of codes, then (left out once
  // inside a table found) any codes its section drawings carry.
  const columns: PageText[][] = [];
  for (const c of codes) {
    if (used.has(c)) continue;
    const column = codes.filter((o) => Math.abs(o.cx - c.cx) <= 3).sort((a, b) => a.cy - b.cy);
    column.forEach((o) => used.add(o));
    columns.push(column);
  }
  columns.sort((a, b) => b.length - a.length);
  const tables: Box[] = [];
  for (const column of columns) {
    const c = column[0];
    if (column.some((o) => tables.some(([a, b, x, y]) => o.cx >= a && o.cx <= x && o.cy >= b && o.cy <= y))) continue;
    // Rows: far enough apart to be table rows, not a label's lines.
    const rows = column.filter((o, i) => i === 0 || o.cy - column[i - 1].cy > 2 * o.h);
    if (new Set(rows.map((r) => codeKey(r.str))).size < 3) continue;
    // The table's rules across the code column, when drawn, bound the rows.
    const rules = segs
      .filter((sg) => Math.abs(sg.y1 - sg.y2) < 0.3 && Math.min(sg.x1, sg.x2) < c.cx - c.w / 2 - 1 && Math.max(sg.x1, sg.x2) > c.cx + c.w / 2 + 1)
      .map((sg) => sg.y1)
      .sort((a, b) => a - b);
    const found = rows.map((r, i) => {
      const gapUp = i > 0 ? r.cy - rows[i - 1].cy : rows[i + 1].cy - r.cy;
      const gapDown = i < rows.length - 1 ? rows[i + 1].cy - r.cy : gapUp;
      const above = rules.filter((y) => y < r.cy - r.h && y > r.cy - gapUp).pop();
      const below = rules.find((y) => y > r.cy + r.h && y < r.cy + gapDown);
      const top = above ?? r.cy - gapUp / 2;
      const bottom = below ?? r.cy + gapDown / 2;
      const right = texts.filter((t) => t !== r && t.cx - t.w / 2 > r.cx + r.w / 2 + 2 && t.cy >= top && t.cy <= bottom);
      // Columns by left edge, nearest first.
      const cols: PageText[][] = [];
      for (const t of [...right].sort((a, b) => a.cx - a.w / 2 - (b.cx - b.w / 2))) {
        const col = cols.find((k) => Math.abs(k[0].cx - k[0].w / 2 - (t.cx - t.w / 2)) <= 6);
        if (col) col.push(t);
        else cols.push([t]);
      }
      const desc = cols.find((k) => k.reduce((n, t) => n + t.str.length, 0) >= 20)?.sort((a, b) => a.cy - b.cy) ?? null;
      return { r, top, bottom, desc };
    });
    // A table: one row per code, nearly every row described, the descriptions in one column.
    if (new Set(rows.map((r) => codeKey(r.str))).size !== rows.length) continue;
    const described = found.filter((f) => f.desc);
    if (described.length < Math.max(3, rows.length * 0.75)) continue;
    const lefts = described.map((f) => Math.min(...f.desc!.map((t) => t.cx - t.w / 2))).sort((a, b) => a - b);
    const mid = lefts[Math.floor(lefts.length / 2)];
    if (lefts.filter((l) => Math.abs(l - mid) <= 6).length < described.length * 0.75) continue;
    // Ceiling types: headed so, or coded so.
    const first = rows[0];
    const span = rows.length > 1 ? (rows[rows.length - 1].cy - first.cy) / (rows.length - 1) : 50;
    const headed = texts.some((t) => /ceiling.*(type|schedule|assembl|legend)|(type|schedule|assembl|legend).*ceiling|\bclg\b/i.test(t.str) && t.cy < first.cy && t.cy > first.cy - 3 * span && t.cx + t.w / 2 > first.cx - 40 && t.cx - t.w / 2 < mid + 400);
    const prefixed = rows.filter((r) => CEILING_PREFIX.test(CODE.exec(r.str)![1])).length >= rows.length * 0.75;
    if (!headed && !prefixed) continue;
    const before = boxes.length;
    for (const { r, top, bottom, desc: first } of found) {
      // The description column's text (a short one too, "Reserved"), not a column further on.
      const desc = texts
        .filter((t) => t.cy >= top && t.cy <= bottom && Math.abs(t.cx - t.w / 2 - mid) <= 8)
        .sort((a, b) => a.cy - b.cy);
      void first;
      let description = '';
      if (desc.length) {
        const title: string[] = [];
        for (const l of desc) {
          title.push(l.str);
          if (/:\s*$/.test(l.str) || title.length >= 3) break;
        }
        description = /:\s*$/.test(title[title.length - 1]) || title.length < 3 ? title.join(' ') : desc[0].str;
        description = description.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
        const xs = [r.cx - r.w / 2, ...desc.map((l) => l.cx + l.w / 2)];
        boxes.push([Math.min(...xs), top, Math.max(...xs), bottom]);
      } else boxes.push([r.cx - r.w, top, r.cx + r.w, bottom]);
      defs.push({ code: r.str, key: codeKey(r.str), description, at: [r.cx, r.cy] });
    }
    const mine = boxes.slice(before);
    tables.push([Math.min(...mine.map((b) => b[0])), Math.min(...mine.map((b) => b[1])), Math.max(...mine.map((b) => b[2])), Math.max(...mine.map((b) => b[3]))]);
  }
  const box: Box | null = boxes.length
    ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    : null;
  return { defs, box };
}

/** Whether a code belongs to the ceiling types: listed in a ceiling types table, or with a ceiling prefix. */
function isCeilingCode(str: string, defined: Set<string>): boolean {
  const m = CODE.exec(str);
  if (!m) return false;
  return defined.has(codeKey(str)) || CEILING_PREFIX.test(m[1]);
}

/**
 * Ceiling type tags on a plan: a ceiling code in a small closed symbol (any shape), or a code
 * the ceiling types table lists printed bare. A height printed beside a tag (8'-6", 2400) and
 * an "above" beside it go with the nearest tag.
 */
export function findCeilingTags(input: PageText[], segs: Segment[], defs: CeilingDef[] = [], table: Pt[] = defs.map((d) => d.at)): CeilingTag[] {
  const texts = uniqueTexts(input);
  const defined = new Set(defs.map((d) => d.key));
  const lines = segs.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  const tags: CeilingTag[] = [];
  for (const t of texts) {
    if (!isCeilingCode(t.str, defined)) continue;
    // The table's own codes are definitions, not tags.
    if (table.some((d) => Math.hypot(d[0] - t.cx, d[1] - t.cy) < 2)) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const within = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter((s) => within(s.x1, s.y1) && within(s.x2, s.y2));
    let box: Box | null = null;
    for (const pen of new Set(candidates.map((s) => `${s.filled ? 'F' : 'S'}${s.width}`))) {
      const loop = symbolLoop(
        candidates.filter((s) => `${s.filled ? 'F' : 'S'}${s.width}` === pen),
        t.cx,
        t.cy,
      );
      if (loop.length < 3) continue;
      const xs = loop.flatMap((s) => [s.x1, s.x2]);
      const ys = loop.flatMap((s) => [s.y1, s.y2]);
      const b: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      // Just round the code, not a room it happens to sit in.
      if (b[2] - b[0] > Math.max(4 * t.h, 1.8 * t.w + 8) || b[3] - b[1] > Math.max(5 * t.h, 1.8 * t.w + 8)) continue;
      if (!box || (b[2] - b[0]) * (b[3] - b[1]) < (box[2] - box[0]) * (box[3] - box[1])) box = b;
    }
    if (!box && !defined.has(codeKey(t.str))) continue;
    // A room number tagged under its room's name (C3 under MALE WASHROOM) is not a ceiling.
    const named = texts.some(
      (o) =>
        o !== t &&
        /[A-Za-z]{3,}/.test(o.str) &&
        !HEIGHT.test(o.str) &&
        !ABOVE.test(o.str) &&
        !CODE.test(o.str) &&
        /^[A-Za-z][A-Za-z .&/'-]*$/.test(o.str) &&
        o.cy < t.cy &&
        t.cy - o.cy < 3.2 * Math.max(t.h, o.h) &&
        Math.abs(o.cx - t.cx) < Math.max(o.w, t.w) * 0.2,
    );
    if (named && texts.filter((o) => codeKey(o.str) === codeKey(t.str)).length === 1) continue;
    box ??= [t.cx - t.w / 2, t.cy - t.h / 2, t.cx + t.w / 2, t.cy + t.h / 2];
    tags.push({ code: t.str, key: codeKey(t.str), at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], box });
  }
  // Heights and "above" go with the nearest tag (measured to its symbol).
  const gap = (t: CeilingTag, x: number, y: number) => Math.hypot(Math.max(t.box[0] - x, 0, x - t.box[2]), Math.max(t.box[1] - y, 0, y - t.box[3]));
  const near = new Map<CeilingTag, number>();
  for (const a of texts) {
    const height = HEIGHT.test(a.str);
    if (!height && !ABOVE.test(a.str)) continue;
    let best: CeilingTag | null = null;
    let bestD = Infinity;
    for (const t of tags) {
      const size = Math.max(t.box[2] - t.box[0], t.box[3] - t.box[1]);
      // Written after the tag it goes with: measured from its start to a tag before it, or
      // from anywhere on it (and a little further) to one after it.
      const d = t.at[0] < a.cx ? gap(t, a.cx - a.w / 2, a.cy) : Math.min(gap(t, a.cx - a.w / 2, a.cy), gap(t, a.cx + a.w / 2, a.cy), gap(t, a.cx, a.cy)) + size * 0.4;
      if (d <= Math.max(size * 0.9, 6) && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (!best) continue;
    if (!height) best.above = true;
    else if (!best.height || bestD < (near.get(best) ?? Infinity)) {
      best.height = a.str.replace(/\s+/g, ' ');
      near.set(best, bestD);
    }
  }
  return tags;
}

/** A straight line's class: its pen and direction to the nearest 15° (as marks name them). */
const segmentKey = (sg: Segment) => {
  const a = (Math.atan2(sg.y2 - sg.y1, sg.x2 - sg.x1) * 180) / Math.PI;
  return `S${sg.width.toFixed(2)} line${(((Math.round(a / 15) * 15) % 180) + 180) % 180}`;
};

const perpendicularKey = (key: string) => key.replace(/line(\d+)$/, (_, a) => `line${(Number(a) + 90) % 180}`);

/**
 * Hatch lines: lines of one pen and direction lying side by side at a regular spacing, at
 * least three in a row (a wall's two faces are a pair, not a hatch). A ceiling grid is two such
 * families of one pen. Spacings under `minSpacing` (wall thicknesses) are not hatch here, nor
 * over `maxSpacing`.
 */
export function hatchFamilies(segs: Segment[], minSpacing: number, maxSpacing = minSpacing * 8): { lines: Map<Segment, string>; spacing: Map<string, number> } {
  const byKey = new Map<string, Segment[]>();
  for (const sg of segs) {
    if (sg.filled || sg.curve) continue;
    const L = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
    if (L < 2) continue;
    const key = segmentKey(sg);
    const list = byKey.get(key);
    if (list) list.push(sg);
    else byKey.set(key, [sg]);
  }
  const lines = new Map<Segment, string>();
  const spacing = new Map<string, number>();
  for (const [key, fam] of byKey) {
    if (fam.length < 6) continue;
    const angle = (Number(/line(\d+)/.exec(key)![1]) * Math.PI) / 180;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const items = fam
      .map((m) => {
        const t1 = m.x1 * ux + m.y1 * uy;
        const t2 = m.x2 * ux + m.y2 * uy;
        const cx = (m.x1 + m.x2) / 2;
        const cy = (m.y1 + m.y2) / 2;
        return { m, off: cx * -uy + cy * ux, lo: Math.min(t1, t2), hi: Math.max(t1, t2) };
      })
      .sort((a, b) => a.off - b.off);
    // Every pair side by side within the widest spacing.
    const links: [number, number, number][] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        const d = b.off - a.off;
        if (d > maxSpacing) break;
        if (d < minSpacing) continue;
        const ov = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        if (ov > 0.3 * Math.min(a.hi - a.lo, b.hi - b.lo)) links.push([i, j, d]);
      }
    }
    if (links.length < 8) continue;
    // The spacings: the gaps most pairs share, smallest first, leaving out multiples of one
    // taken (lines two apart are side by side too). Rooms gridded 2×4 one way and 4×2 the
    // other give two.
    const gaps = links.map((l) => l[2]).sort((x, y) => x - y);
    const support: [number, number][] = [];
    for (let i = 0, lo = 0, hi = 0; i < gaps.length; i++) {
      while (gaps[lo] < gaps[i] * 0.93) lo++;
      while (hi + 1 < gaps.length && gaps[hi + 1] <= gaps[i] * 1.07) hi++;
      support.push([gaps[i], hi - lo + 1]);
    }
    const top = Math.max(...support.map((x) => x[1]));
    const chosen: number[] = [];
    for (const [g2, c] of [...support].sort((x, y) => y[1] - x[1])) {
      if (chosen.length >= 3 || c < Math.max(4, top * 0.35)) break;
      if (chosen.some((g3) => Math.abs(g2 / g3 - Math.round(g2 / g3)) * g3 <= g3 * 0.1 || Math.abs(g3 / g2 - Math.round(g3 / g2)) * g2 <= g2 * 0.1)) continue;
      chosen.push(g2);
    }
    if (!chosen.length) continue;
    // Lines linked at a spacing taken (or a multiple of it, across a light), in runs of three or more.
    const parent = items.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const [i, j, d] of links) if (chosen.some((g2) => Math.abs(d - g2) <= g2 * 0.08)) parent[find(i)] = find(j);
    const size = new Map<number, number>();
    items.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
    const inRun = (i: number) => (size.get(find(i)) ?? 0) >= 3;
    const across = byKey.get(perpendicularKey(key));
    let keep: (i: number) => boolean;
    if (across && across.length >= 4) {
      // A grid: its lines are crossed by (or meet) the lines across it on both sides. An
      // outline round the grid, or a wall, is met from one side only.
      const index = new SegmentIndex(across, 32);
      keep = (i) => {
        if (!inRun(i)) return false;
        const { m, lo, hi } = items[i];
        const nx = -uy;
        const ny = ux;
        let a = false;
        let b = false;
        for (const k of index.query(Math.min(m.x1, m.x2) - 1, Math.min(m.y1, m.y2) - 1, Math.max(m.x1, m.x2) + 1, Math.max(m.y1, m.y2) + 1)) {
          const q = across[k];
          const d1 = (q.x1 - m.x1) * nx + (q.y1 - m.y1) * ny;
          const d2 = (q.x2 - m.x1) * nx + (q.y2 - m.y1) * ny;
          if (Math.min(d1, d2) > 0.6 || Math.max(d1, d2) < -0.6) continue;
          const t = ((q.x1 + q.x2) / 2) * ux + ((q.y1 + q.y2) / 2) * uy;
          if (t < lo - 0.6 || t > hi + 0.6) continue;
          if (Math.max(d1, d2) > 0.6) a = true;
          if (Math.min(d1, d2) < -0.6) b = true;
          if (a && b) return true;
        }
        return false;
      };
    } else {
      // A hatch one way: a pen that draws mostly hatch (a pen of walls or outlines, a few of
      // them happening to lie evenly spaced, keeps them).
      const len = (i: number) => items[i].hi - items[i].lo;
      let total = 0;
      let chained = 0;
      items.forEach((_, i) => {
        total += len(i);
        if (inRun(i)) chained += len(i);
      });
      if (chained < total * 0.5) continue;
      keep = inRun;
    }
    let n = 0;
    items.forEach((it, i) => {
      if (keep(i)) {
        lines.set(it.m, key);
        n++;
      }
    });
    const best = Math.min(...chosen);
    if (n) spacing.set(key, best);
  }
  return { lines, spacing };
}

interface Faces {
  w: number;
  h: number;
  res: number;
  label: Int32Array;
  count: number;
  pixels: Int32Array;
  edge: Uint8Array;
  /** Half the widest width across each face, in pixels. */
  inner: Float32Array;
  bbox: Int32Array;
}

/** Every space the barrier lines enclose, labelled (4-connected), with its size and how wide it gets. */
function facesOf(barrier: Uint8Array, w: number, h: number, res: number): Faces {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let count = 0;
  const pixels: number[] = [];
  const edge: number[] = [];
  const bbox: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (barrier[i] || label[i] >= 0) continue;
    let top = 0;
    stack[top++] = i;
    label[i] = count;
    let n = 0;
    let e = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (top) {
      const j = stack[--top];
      n++;
      const x = j % w;
      const y = (j - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) e = 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !barrier[j - 1] && label[j - 1] < 0) (label[j - 1] = count), (stack[top++] = j - 1);
      if (x < w - 1 && !barrier[j + 1] && label[j + 1] < 0) (label[j + 1] = count), (stack[top++] = j + 1);
      if (y > 0 && !barrier[j - w] && label[j - w] < 0) (label[j - w] = count), (stack[top++] = j - w);
      if (y < h - 1 && !barrier[j + w] && label[j + w] < 0) (label[j + w] = count), (stack[top++] = j + w);
    }
    pixels.push(n);
    edge.push(e);
    bbox.push(x0, y0, x1, y1);
    count++;
  }
  // Chamfer (3-4) distance to the nearest barrier pixel.
  const dist = new Float32Array(w * h);
  const BIG = 1e9;
  for (let i = 0; i < dist.length; i++) dist[i] = barrier[i] ? 0 : BIG;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        d = Math.min(d, dist[i - w] + 3);
        if (x > 0) d = Math.min(d, dist[i - w - 1] + 4);
        if (x < w - 1) d = Math.min(d, dist[i - w + 1] + 4);
      }
      dist[i] = d;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < h - 1) {
        d = Math.min(d, dist[i + w] + 3);
        if (x < w - 1) d = Math.min(d, dist[i + w + 1] + 4);
        if (x > 0) d = Math.min(d, dist[i + w - 1] + 4);
      }
      dist[i] = d;
    }
  const inner = new Float32Array(count);
  for (let i = 0; i < label.length; i++) {
    const id = label[i];
    if (id >= 0 && dist[i] < BIG && dist[i] / 3 > inner[id]) inner[id] = dist[i] / 3;
  }
  return { w, h, res, label, count, pixels: Int32Array.from(pixels), edge: Uint8Array.from(edge), inner, bbox: Int32Array.from(bbox) };
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

/** A legend's frame: the space round the word "legend" (a boxed legend), when it is a box and not the sheet. */
function legendBoxes(texts: PageText[], faces: Faces, sheetArea: number): Box[] {
  const out: Box[] = [];
  for (const t of texts) {
    if (!/\blegend\b/i.test(t.str) || t.str.length > 40) continue;
    const id = faceNear(faces, t.cx, t.cy);
    if (id < 0 || faces.edge[id] || faces.pixels[id] / faces.res ** 2 > sheetArea * 0.15) continue;
    const r = faces.res;
    const b: Box = [faces.bbox[4 * id] / r, faces.bbox[4 * id + 1] / r, (faces.bbox[4 * id + 2] + 1) / r, (faces.bbox[4 * id + 3] + 1) / r];
    if (!out.some((o) => o[0] === b[0] && o[1] === b[1])) out.push(b);
  }
  return out;
}

/** The face under a sheet point, or the nearest one within a couple of pixels. */
function faceNear(f: Faces, x: number, y: number): number {
  const px = Math.floor(x * f.res);
  const py = Math.floor(y * f.res);
  for (let r = 0; r <= 3; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= f.w || qy >= f.h) continue;
        const id = f.label[qy * f.w + qx];
        if (id >= 0) return id;
      }
  return -1;
}

export interface ReadCeilingOptions {
  /** Ceiling types described elsewhere in the set (another RCP, an assembly sheet). */
  defs?: CeilingDef[];
  /** Areas to leave out: the title block. */
  avoid?: Box[];
}

/**
 * Reads one reflected ceiling plan: its ceiling areas, each with a type. A sheet without
 * ceiling type tags comes back untagged, with the areas its ceiling grid covers.
 */
export function readCeilingSheet(
  segs: Segment[],
  rawTexts: PageText[],
  sheet: { width: number; height: number; metersPerPoint: number | null },
  options: ReadCeilingOptions = {},
): CeilingSheetRead {
  const texts = uniqueTexts(rawTexts);
  const own = readCeilingDefs(texts, segs);
  const defs = mergeDefs([...(options.defs ?? []), ...own.defs]);
  const avoid: Box[] = [...(options.avoid ?? []), ...(own.box ? [own.box] : [])];
  const inBox = (x: number, y: number, boxes: Box[]) => boxes.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  let tags = findCeilingTags(texts, segs, defs, own.defs.map((d) => d.at)).filter((t) => !inBox(t.at[0], t.at[1], avoid));
  const mpp = sheet.metersPerPoint;
  const pt = (m: number, fallback: number) => (mpp ? m / mpp : fallback);

  if (!tags.length) {
    const grid = findGridHatch(segs, mpp, options.avoid ?? []);
    return {
      tagged: false,
      tags: [],
      defs,
      legend: [],
      areas: (grid?.regions ?? []).map((r) => ({ points: r.points, holes: [], area: r.area, code: null, source: 'fallback', kind: 'grid' })),
    };
  }

  // The barrier: every line but hatching, stipple and lettering.
  const marks = marksOf(segs);
  const skip = new Set<number>();
  const dotCount = new Map<string, number>();
  for (const m of marks) {
    if (m.sub === undefined) continue;
    if (m.glyph || m.size < 1.2) skip.add(m.sub);
    if (m.size < 1.2) dotCount.set(m.key, (dotCount.get(m.key) ?? 0) + 1);
  }
  const drawn = segs.filter((s) => s.sub === undefined || !skip.has(s.sub));
  const hatch = hatchFamilies(drawn, pt(0.28, 7), pt(2, 56));
  const barrierLines = drawn.filter((s) => !hatch.lines.has(s));
  const W = sheet.width;
  const H = sheet.height;
  const res = Math.min(2, Math.sqrt(9e6 / (W * H)));
  const g = makeGrid(0, 0, W, H, res);
  drawSegments(g, barrierLines);
  const faces = facesOf(g.data, g.w, g.h, res);
  const sheetArea = W * H;
  const legendFrames = legendBoxes(texts, faces, sheetArea);
  const skipBoxes = [...avoid, ...legendFrames];
  tags = tags.filter((t) => !inBox(t.at[0], t.at[1], legendFrames));

  // What is drawn in each face: hatch line length per family, stipple dots.
  const n = faces.count;
  const faceAt = (x: number, y: number) => {
    const px = Math.floor(x * res);
    const py = Math.floor(y * res);
    return px >= 0 && py >= 0 && px < g.w && py < g.h ? faces.label[py * g.w + px] : -1;
  };
  const hatchCover = new Map<string, Float64Array>();
  for (const [m, key] of hatch.lines) {
    const sp = hatch.spacing.get(key);
    if (!sp) continue;
    let arr = hatchCover.get(key);
    if (!arr) hatchCover.set(key, (arr = new Float64Array(n)));
    const [ax, ay, bx, by] = [m.x1, m.y1, m.x2, m.y2];
    const L = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(L / Math.max(1, sp / 2)));
    for (let i = 0; i < steps; i++) {
      const id = faceAt(ax + ((bx - ax) * (i + 0.5)) / steps, ay + ((by - ay) * (i + 0.5)) / steps);
      if (id >= 0) arr[id] += (L / steps) * sp;
    }
  }
  const stippleKeys = new Set([...dotCount].filter(([, c]) => c >= 100).map(([k]) => k));
  const dots = new Float64Array(n);
  const dotKeysIn = new Map<number, Set<string>>();
  for (const m of marks) {
    if (m.size >= 1.2 || !stippleKeys.has(m.key)) continue;
    const id = faceAt(m.cx, m.cy);
    if (id < 0) continue;
    dots[id]++;
    (dotKeysIn.get(id) ?? dotKeysIn.set(id, new Set()).get(id)!).add(m.key);
  }
  const areaPt = (id: number) => faces.pixels[id] / res ** 2;
  const kindOf = (id: number): { kind: CeilingKind; keys: string[] } => {
    const A = areaPt(id);
    const cover = [...hatchCover].map(([k, arr]) => [k, arr[id] / A] as const).filter(([, c]) => c >= 0.25);
    const dirs = new Set(cover.map(([k]) => k));
    const total = cover.reduce((s, [, c]) => s + c, 0);
    if (dirs.size >= 2 && total >= 0.6) return { kind: 'grid', keys: [...dirs] };
    if (dots[id] >= 12 && dots[id] / A >= 0.006) return { kind: 'stipple', keys: [...(dotKeysIn.get(id) ?? [])] };
    if (total >= 0.5) return { kind: 'hatch', keys: [...dirs] };
    return { kind: 'plain', keys: [] };
  };
  const kinds = Array.from({ length: n }, (_, id) => kindOf(id));

  // Faces that can be ceilings: closed, not the sheet round the plan, wider than a wall's cavity.
  const minWidth = pt(0.4, 10) * res;
  const cx = (id: number) => (faces.bbox[4 * id] + faces.bbox[4 * id + 2] + 1) / 2 / res;
  const cy = (id: number) => (faces.bbox[4 * id + 1] + faces.bbox[4 * id + 3] + 1) / 2 / res;
  const usable = (id: number) => !faces.edge[id] && faces.inner[id] * 2 >= minWidth && areaPt(id) < sheetArea * 0.2 && !inBox(cx(id), cy(id), skipBoxes);

  // Each tag types the face it sits in: the face most of the points just round its symbol fall in.
  const tagsIn = new Map<number, CeilingTag[]>();
  for (const t of tags) {
    if (t.above) continue;
    const pad = 2.5;
    const [x0, y0, x1, y1] = [t.box[0] - pad, t.box[1] - pad, t.box[2] + pad, t.box[3] + pad];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const probes: Pt[] = [
      [x0, y0], [mx, y0], [x1, y0], [x1, my], [x1, y1], [mx, y1], [x0, y1], [x0, my],
      [mx, y0 - pad], [mx, y1 + pad], [x0 - pad, my], [x1 + pad, my],
    ];
    const votes = new Map<number, number>();
    for (const [px, py] of probes) {
      const id = faceAt(px, py);
      if (id >= 0 && usable(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    let best = -1;
    for (const [id, v] of votes) if (best < 0 || v > votes.get(best)! || (v === votes.get(best)! && faces.pixels[id] > faces.pixels[best])) best = id;
    if (best < 0) continue;
    (tagsIn.get(best) ?? tagsIn.set(best, []).get(best)!).push(t);
  }

  // Groups: one per code, then legend rows and fallback kinds. Pixels are assigned to groups.
  const groupKeys: string[] = [];
  const groupIndex = (k: string) => {
    let i = groupKeys.indexOf(k);
    if (i < 0) i = groupKeys.push(k) - 1;
    return i;
  };
  const faceGroup = new Int32Array(n).fill(-1);
  const split = new Map<number, CeilingTag[]>();
  for (const [id, list] of tagsIn) {
    const keys = [...new Set(list.map((t) => t.key))];
    if (keys.length === 1) faceGroup[id] = groupIndex(`code:${keys[0]}`);
    else {
      split.set(id, list);
      // The code most of its tags carry, for neighbours that join it.
      const counts = keys.map((k) => list.filter((t) => t.key === k).length);
      faceGroup[id] = groupIndex(`code:${keys[counts.indexOf(Math.max(...counts))]}`);
      for (const k of keys) groupIndex(`code:${k}`);
    }
  }

  // Untagged faces beside a tagged one across a single line (a dimension, a light's edge, the
  // grid's border) and drawn the same are part of the same ceiling.
  const contact = new Map<number, Map<number, number>>();
  const k = Math.max(3, Math.round(1.5 * res + 1.5));
  const touch = (a: number, b: number) => {
    if (a === b || a < 0 || b < 0) return;
    const m = contact.get(a) ?? contact.set(a, new Map()).get(a)!;
    m.set(b, (m.get(b) ?? 0) + 1);
    const m2 = contact.get(b) ?? contact.set(b, new Map()).get(b)!;
    m2.set(a, (m2.get(a) ?? 0) + 1);
  };
  for (let y = 0; y < g.h; y++) {
    let last = -1;
    let run = 0;
    for (let x = 0; x < g.w; x++) {
      const id = faces.label[y * g.w + x];
      if (id < 0) run++;
      else {
        if (run > 0 && run <= k) touch(last, id);
        last = id;
        run = 0;
      }
    }
  }
  for (let x = 0; x < g.w; x++) {
    let last = -1;
    let run = 0;
    for (let y = 0; y < g.h; y++) {
      const id = faces.label[y * g.w + x];
      if (id < 0) run++;
      else {
        if (run > 0 && run <= k) touch(last, id);
        last = id;
        run = 0;
      }
    }
  }
  const minPiece = pt(0.25, 3) ** 2;
  const gridCode = (key: string): boolean | null => {
    const desc = defs.find((d) => d.key === key)?.description ?? '';
    if (/lay-?in|\blap\b|acoustic|\bact\b|tile|t-bar|suspended|grid/i.test(desc)) return true;
    if (/gypsum|\bgwb\b|wallboard|drywall|plaster|board|concrete|exposed|deck/i.test(desc)) return false;
    let gridFaces = 0;
    let other = 0;
    for (const [id, list] of tagsIn) {
      if (list.some((t) => t.key !== key) || !list.length || list[0].key !== key) continue;
      if (kinds[id].kind === 'grid') gridFaces++;
      else other++;
    }
    return gridFaces + other ? gridFaces > other : null;
  };
  // The code a neighbour passes on: its own, or for a face two codes share, the one drawn
  // like this face (a lay-in code to a gridded piece).
  const passOn = (o: number, id: number): number => {
    const list = split.get(o);
    if (!list) return kinds[o].kind === kinds[id].kind ? faceGroup[o] : -1;
    const grid = kinds[id].kind === 'grid';
    const fit = [...new Set(list.map((t) => t.key))].filter((k) => gridCode(k) === grid);
    return fit.length === 1 ? groupIndex(`code:${fit[0]}`) : -1;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (let id = 0; id < n; id++) {
      if (faceGroup[id] >= 0 || !usable(id) || areaPt(id) < minPiece) continue;
      let best = -1;
      let bestC = 0;
      for (const [o, c] of contact.get(id) ?? []) {
        if (faceGroup[o] < 0) continue;
        const gi = passOn(o, id);
        if (gi >= 0 && c > bestC) {
          best = gi;
          bestC = c;
        }
      }
      // A real shared edge, not a corner: a few pixels' worth.
      if (best >= 0 && bestC >= 4) {
        faceGroup[id] = best;
        changed = true;
      }
    }
  }

  // The legend's swatches, for faces with no tag.
  const legend = legendFrames.flatMap((box) => readLegendRows(texts, segs, box).filter((r) => r.kind === 'area' && r.graphic && CEILING_WORDS.test(r.label)).map((r) => ({ label: r.label, ...swatchKind(marks, segs, r.graphic!) })));
  const labels = findRoomLabels(texts, segs);
  const fallbackMin = pt(Math.sqrt(2.3), 15) ** 2;
  // Lettering in each face: a box of notes or a table cell is mostly text, a room is not.
  const lettering = new Float64Array(n);
  for (const t of texts) {
    const id = faceAt(t.cx, t.cy);
    if (id >= 0) lettering[id] += t.w * t.h;
  }
  for (let id = 0; id < n; id++) {
    if (faceGroup[id] >= 0 || !usable(id) || lettering[id] > areaPt(id) * 0.08) continue;
    const { kind, keys } = kinds[id];
    if (kind !== 'plain') {
      if (areaPt(id) < fallbackMin) continue;
      const same = legend.filter((l) => l.kind === kind);
      const row = same.find((l) => l.keys.some((x) => keys.includes(x))) ?? (same.length === 1 ? same[0] : undefined);
      if (row) faceGroup[id] = groupIndex(`legend:${row.label}`);
      // Lines one way only, with no legend saying what they are, are stairs or notes as often as a ceiling.
      else if (kind !== 'hatch') faceGroup[id] = groupIndex(`kind:${kind}`);
    } else if (areaPt(id) >= minPiece * 16 && labels.some((l) => faceAt(l.at[0], l.at[1]) === id || (l.box && faceAt(l.box[0] - 3, l.at[1]) === id))) {
      faceGroup[id] = groupIndex('kind:plain');
    }
  }

  // Pixels to groups; a face two codes share is split between their tags, nearest first.
  const owner = new Int16Array(g.w * g.h).fill(-1);
  for (let i = 0; i < owner.length; i++) {
    const id = faces.label[i];
    if (id >= 0 && faceGroup[id] >= 0) owner[i] = faceGroup[id];
  }
  // Where a face holds a lay-in code and a board one, the grid drawn decides between them;
  // otherwise (and within each) the nearest tag does.
  let gridMask: Uint8Array | null = null;
  const gridAt = () => {
    if (gridMask) return gridMask;
    const gridKeys = [...hatch.spacing].filter(([k]) => hatch.spacing.has(perpendicularKey(k)));
    const m = makeGrid(0, 0, W, H, res);
    drawSegments(m, [...hatch.lines].filter(([, k]) => gridKeys.some(([gk]) => gk === k)).map(([sg]) => sg));
    const r = Math.max(1, Math.ceil(0.6 * Math.max(0, ...gridKeys.map(([, sp]) => sp)) * res));
    gridMask = box(box(m.data, m.w, m.h, r, true), m.w, m.h, r, false);
    return gridMask;
  };
  for (const [id, list] of split) {
    const [x0, y0, x1, y1] = faces.bbox.subarray(4 * id, 4 * id + 4);
    const kindsOf = new Map(list.map((t) => [t.key, gridCode(t.key)] as const));
    const mixed = [...kindsOf.values()].includes(true) && [...kindsOf.values()].includes(false);
    const mask = mixed ? gridAt() : null;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * g.w + x;
        if (faces.label[i] !== id) continue;
        const px = (x + 0.5) / res;
        const py = (y + 0.5) / res;
        const onGrid = mask ? mask[i] === 1 : null;
        let best: CeilingTag | null = null;
        let bd = Infinity;
        for (const t of list) {
          if (onGrid !== null && kindsOf.get(t.key) !== onGrid) continue;
          const d = (t.at[0] - px) ** 2 + (t.at[1] - py) ** 2;
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (!best)
          for (const t of list) {
            const d = (t.at[0] - px) ** 2 + (t.at[1] - py) ** 2;
            if (d < bd) {
              bd = d;
              best = t;
            }
          }
        owner[i] = groupIndex(`code:${best!.key}`);
      }
  }

  // Each group's pieces, joined across the single lines between them, outlined on the lines.
  const index = new SegmentIndex(barrierLines, 32);
  const areas: CeilingArea[] = [];
  const close = Math.max(1, Math.round(res * 1.2));
  const minArea = pt(0.6, 6) ** 2;
  const spelled = new Map<string, string>();
  for (const t of tags) if (!spelled.has(t.key)) spelled.set(t.key, t.code);
  for (let gi = 0; gi < groupKeys.length; gi++) {
    const gk = groupKeys[gi];
    let bx0 = g.w;
    let by0 = g.h;
    let bx1 = -1;
    let by1 = -1;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== gi) continue;
      const x = i % g.w;
      const y = (i - x) / g.w;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    if (bx1 < 0) continue;
    const m = close + 2;
    const ox = bx0 - m;
    const oy = by0 - m;
    const w = bx1 - bx0 + 1 + 2 * m;
    const h = by1 - by0 + 1 + 2 * m;
    let mask: Uint8Array = new Uint8Array(w * h);
    const other = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx < 0 || sy < 0 || sx >= g.w || sy >= g.h) continue;
        const o = owner[sy * g.w + sx];
        if (o === gi) mask[y * w + x] = 1;
        else if (o >= 0) other[y * w + x] = 1;
      }
    mask = closeMask(mask, w, h, close);
    for (let i = 0; i < mask.length; i++) if (other[i]) mask[i] = 0;
    for (const piece of components(mask, w, h)) {
      // Worked on in the piece's own box, a pixel of margin round it.
      const lx = piece.x0 - 1;
      const ly = piece.y0 - 1;
      const cw = piece.x1 - piece.x0 + 3;
      const chh = piece.y1 - piece.y0 + 3;
      const comp = new Uint8Array(cw * chh);
      const near = new Uint8Array(cw * chh);
      for (const i of piece.pixels) {
        const x = i % w;
        comp[((i - x) / w - ly) * cw + x - lx] = 1;
      }
      for (let y = 0; y < chh; y++)
        for (let x = 0; x < cw; x++) {
          const sx = x + lx;
          const sy = y + ly;
          if (sx >= 0 && sy >= 0 && sx < w && sy < h) near[y * cw + x] = other[sy * w + sx];
        }
      // Holes: filled, unless another ceiling is in them.
      const { filled, holes } = fillHolesKeeping(comp, cw, chh, near);
      const toPts = (ring: [number, number][]) =>
        snapRing(simplify(ring, 1).map(([x, y]) => [(x + lx + ox) / res, (y + ly + oy) / res] as Pt), index, barrierLines, 2.5 / res);
      const outer = toPts(traceBoundary(filled, cw, chh));
      if (outer.length < 3) continue;
      const holeRings = holes.map((hm) => toPts(traceBoundary(hm, cw, chh))).filter((r) => r.length >= 3);
      const area = Math.abs(ringArea(outer)) - holeRings.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
      if (area < minArea) continue;
      const inside = (p: Pt) => pointInRing(p, outer) && !holeRings.some((r) => pointInRing(p, r));
      const mine = tags.filter((t) => inside(t.at) && (gk === `code:${t.key}` || !gk.startsWith('code:')));
      const heights = [...new Set(mine.filter((t) => t.height && !t.above).map((t) => t.height!))];
      const rooms = labels.filter((l) => inside(l.at)).map((l) => (/^[A-Za-z][A-Za-z0-9 .,&/'()-]{0,40}$/.test(l.name) ? `${l.number} ${l.name}` : l.number));
      const code = gk.startsWith('code:') ? spelled.get(gk.slice(5)) ?? gk.slice(5) : null;
      // How it got its type: tagged in this piece, or carried from a tagged neighbour.
      const kindCount = new Map<CeilingKind, number>();
      for (const i of piece.pixels) {
        const x = i % w;
        const id = faces.label[((i - x) / w + oy) * g.w + x + ox];
        if (id >= 0) kindCount.set(kinds[id].kind, (kindCount.get(kinds[id].kind) ?? 0) + 1);
      }
      const kind = [...kindCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'plain';
      areas.push({
        points: outer,
        holes: holeRings,
        area,
        code,
        legend: gk.startsWith('legend:') ? gk.slice(7) : undefined,
        source: gk.startsWith('code:') ? 'tag' : gk.startsWith('legend:') ? 'legend' : 'fallback',
        kind: gk.startsWith('kind:') ? (gk.slice(5) as CeilingKind) : kind,
        height: heights.length ? heights.join(', ') : undefined,
        room: rooms.length ? rooms.join(', ') : undefined,
      });
    }
  }
  return { tagged: true, areas, tags, defs, legend: legend.map((l) => ({ label: l.label, kind: l.kind })) };
}

/** Definitions from several tables, first description of each code kept. */
export function mergeDefs(defs: CeilingDef[]): CeilingDef[] {
  const out = new Map<string, CeilingDef>();
  for (const d of defs) {
    const had = out.get(d.key);
    if (!had || (!had.description && d.description)) out.set(d.key, d);
  }
  return [...out.values()];
}

/** What a legend swatch shows: its hatch lines, its stipple, or nothing. */
function swatchKind(marks: Mark[], segs: Segment[], [x0, y0, x1, y1]: Box): { kind: CeilingKind; keys: string[] } {
  const inset = 1.2;
  const within = (x: number, y: number) => x > x0 + inset && x < x1 - inset && y > y0 + inset && y < y1 - inset;
  const dots = marks.filter((m) => m.size < 1.2 && within(m.cx, m.cy));
  if (dots.length >= 3) return { kind: 'stipple', keys: [...new Set(dots.map((m) => m.key))] };
  const lines = segs.filter((sg) => !sg.filled && !sg.curve && Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1) > 2 && within((sg.x1 + sg.x2) / 2, (sg.y1 + sg.y2) / 2));
  const keys = [...new Set(lines.map(segmentKey))];
  const dirs = new Set(keys.map((k) => k.split(' ')[1]));
  if (dirs.size >= 2) return { kind: 'grid', keys };
  if (lines.length >= 2) return { kind: 'hatch', keys };
  return { kind: 'plain', keys: [] };
}

/** Closing (dilate then erode) with a square of radius r. */
function closeMask(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return box(box(src, w, h, r, true), w, h, r, false);
}

function box(src: Uint8Array, w: number, h: number, r: number, max: boolean): Uint8Array {
  const pass = (a: Uint8Array, rows: boolean) => {
    const out = new Uint8Array(w * h);
    const [outer, inner] = rows ? [h, w] : [w, h];
    const at = (o: number, k: number) => (rows ? o * w + k : k * w + o);
    for (let o = 0; o < outer; o++) {
      let count = 0;
      const val = (k: number) => (k < 0 || k >= inner ? (max ? 0 : 1) : a[at(o, k)]);
      for (let k = -r; k <= r; k++) count += val(k);
      for (let k = 0; k < inner; k++) {
        out[at(o, k)] = max ? (count > 0 ? 1 : 0) : count === 2 * r + 1 ? 1 : 0;
        count += val(k + r + 1) - val(k - r);
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** The 4-connected pieces of a mask: their pixels and boxes. */
function components(mask: Uint8Array, w: number, h: number): { pixels: number[]; x0: number; y0: number; x1: number; y1: number }[] {
  const seen = new Uint8Array(w * h);
  const out: { pixels: number[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const pixels: number[] = [];
    let [x0, y0, x1, y1] = [w, h, 0, 0];
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    while (top) {
      const i = stack[--top];
      pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= mask.length || seen[j] || !mask[j]) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    out.push({ pixels, x0, y0, x1, y1 });
  }
  return out;
}

/** Fills a piece's holes (lights, tags, columns) except those another ceiling lies in, which stay holes. */
function fillHolesKeeping(comp: Uint8Array, w: number, h: number, other: Uint8Array): { filled: Uint8Array; holes: Uint8Array[] } {
  const filled = Uint8Array.from(comp);
  const holes: Uint8Array[] = [];
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!comp[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] || outside[s] || seen[s]) continue;
    const hole = new Uint8Array(w * h);
    const list = [s];
    seen[s] = 1;
    let others = 0;
    let n = 0;
    while (list.length) {
      const i = list.pop()!;
      hole[i] = 1;
      n++;
      if (other[i]) others++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= comp.length || seen[j] || comp[j] || outside[j]) continue;
        seen[j] = 1;
        list.push(j);
      }
    }
    if (others > n * 0.3) holes.push(hole);
    else for (let i = 0; i < hole.length; i++) if (hole[i]) filled[i] = 1;
  }
  return { filled, holes };
}

/** Snaps an outline's edges onto the drawn lines near it. */
function snapRing(ring: Pt[], index: SegmentIndex, lines: Segment[], tol: number): Pt[] {
  if (ring.length < 3) return ring;
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const near = index.query(Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3).map((i) => lines[i]);
  const snapped = snapToLines(ring, near, tol);
  // A snap that wrecked the outline (a corner pulled far off) is not used.
  const a0 = Math.abs(ringArea(ring));
  const a1 = Math.abs(ringArea(snapped));
  return snapped.length >= 3 && Math.abs(a1 - a0) <= a0 * 0.08 + 4 ? snapped : ring;
}

/** What a ceiling plan shows: new work, ceilings to demolish, or existing ceilings to take down and put back. */
export type CeilingPlanKind = 'new' | 'demo' | 'reinstate';

/** From the sheet's title: a demolition plan, an existing plan (no new ceiling shown), or any other. */
export const ceilingPlanKind = (title: string): CeilingPlanKind => (/DEMO|REMOVAL/i.test(title) ? 'demo' : /EXISTING/i.test(title) ? 'reinstate' : 'new');

export interface CeilingTypeSpec {
  name: string;
  division: string;
  package: string;
  items: { name: string; unit: string; formula: string }[];
  /** The ceiling types table's description, for a coded type. */
  description?: string;
}

/**
 * The takeoff type an area goes under: one per ceiling type code (named by the code and its
 * description), per legend row, or per kind drawn when neither says. A sheet with no tags keeps
 * the grid reading's three types (new T-bar, demolish, remove & reinstate).
 */
export function ceilingTypeFor(a: CeilingArea, read: { tagged: boolean; defs: CeilingDef[] }, plan: CeilingPlanKind, metric: boolean): CeilingTypeSpec {
  const area = metric ? 'm²' : 'SF';
  const len = metric ? 'm' : 'ft';
  const tile = metric ? 0.72 : 8;
  const tbar = [
    { name: 'Ceiling area', unit: area, formula: 'A' },
    { name: metric ? 'Tiles 600×1200 + 5%' : 'Tiles 2×4 + 5%', unit: 'ea', formula: `ceil(A / ${tile} * 1.05)` },
    { name: metric ? 'Main tees @ 1200, 3.66 m long' : "Main tees @ 4', 12' long", unit: 'ea', formula: metric ? 'ceil(A / 1.2 / 3.66)' : 'ceil(A / 4 / 12)' },
    { name: metric ? '1200 cross tees @ 600' : "4' cross tees @ 2'", unit: 'ea', formula: `ceil(A / ${tile})` },
    { name: 'Wall angle', unit: len, formula: 'P' },
    { name: metric ? 'Hanger wires @ 1200×1200' : "Hanger wires @ 4'×4'", unit: 'ea', formula: metric ? 'ceil(A / 1.44)' : 'ceil(A / 16)' },
  ];
  const finishes = { division: '09 Finishes', package: 'Drywall & ceilings' };
  if (!read.tagged) {
    if (plan === 'demo') return { name: 'Ceiling – demolish existing', division: '02 Existing Conditions', package: 'Demolition & abatement', items: [{ name: 'Existing ceiling to demolish', unit: area, formula: 'A' }] };
    if (plan === 'reinstate') return { name: 'Ceiling – remove & reinstate existing tiles', ...finishes, items: [{ name: 'Existing ceiling to remove and reinstate', unit: area, formula: 'A' }] };
    return { name: metric ? 'Ceiling – new suspended T-bar, 600×1200' : 'Ceiling – new suspended T-bar, 2×4', ...finishes, items: tbar };
  }
  const description = a.code ? read.defs.find((d) => d.key === codeKey(a.code!))?.description || undefined : undefined;
  const KIND: Record<CeilingKind, string> = { grid: 'lay-in grid', stipple: 'gypsum board', hatch: 'hatched', plain: 'open / none shown' };
  const base = a.code ? `${a.code} – ${description ?? 'ceiling'}` : a.legend ? `Ceiling – ${a.legend}` : `Ceiling – ${KIND[a.kind]} (untagged)`;
  if (plan === 'demo') return { name: `${base} – demolish`, division: '02 Existing Conditions', package: 'Demolition & abatement', items: [{ name: 'Existing ceiling to demolish', unit: area, formula: 'A' }], description };
  if (plan === 'reinstate') return { name: `${base} – remove & reinstate`, ...finishes, items: [{ name: 'Existing ceiling to remove and reinstate', unit: area, formula: 'A' }], description };
  const words = `${description ?? ''} ${a.legend ?? ''}`;
  const existing = /^\s*existing|to remain/i.test(words);
  const layIn = /lay-?in|\blap\b|acoustic|\bact\b|t-bar|suspended/i.test(words) || (!words.trim() && a.kind === 'grid');
  const items = !existing && layIn ? tbar : [{ name: 'Ceiling area', unit: area, formula: 'A' }, { name: 'Perimeter', unit: len, formula: 'P' }];
  return { name: base, ...finishes, items, description };
}

/** A name for one ceiling area: the room(s) it covers and its height. */
export const ceilingLabel = (a: CeilingArea): string | undefined => [a.room, a.height && `h ${a.height}`].filter(Boolean).join(' · ') || undefined;
