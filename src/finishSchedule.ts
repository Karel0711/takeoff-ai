import type { FinishRole } from './model';
import type { PageText } from './pageText';
import type { Segment } from './fill/vectors';

/** One room's line of a room finish schedule: the finish code in each column. */
export interface ScheduleRow {
  number: string;
  name: string;
  finishes: Partial<Record<FinishRole, string>>;
  /**
   * Every wall finish the room's line lists (a schedule with a column per wall, N/E/S/W),
   * most used first, when it lists more than one. `finishes.walls` is the first.
   */
  wallFinishes?: string[];
  /** With a column per wall, the share of the room's walls each wall finish is listed on (CT on two of four: 0.5). */
  wallShares?: Record<string, number>;
  /** The ceiling height as printed in the schedule (8'-6", 2700). */
  ceilingHeight?: string;
}

export interface FinishSchedule {
  rows: ScheduleRow[];
  /** The columns found, for showing what was read. */
  columns: FinishRole[];
}

/** What a column holds: a finish, or the room's number, name or ceiling height, or something else. */
type Role = FinishRole | 'room' | 'name' | 'height' | 'other';
/** A heading word that means "the finish" only under a group heading: FINISH, MATERIAL, TYPE. */
type Heading = Role | 'generic';

/** The words after a finish heading that still mean that finish (FLOOR FINISH, WALL MAT'L). */
const OF = String.raw`(\s+(FINISH(ES)?|MATERIALS?|MAT'?L\.?|FIN\.?|TYPE))?`;

/** Heading words, most specific first (FLOOR REMARKS is a remark, not the floor). */
const HEADINGS: [Heading, RegExp][] = [
  ['other', /REMARK|NOTE|COMMENT|BULKHEAD|SUBSTRATE|^SUB\.?$|^SUBS$/i],
  ['height', /HEIGHT|^(CLG\.?\s*)?HT\.?$|A\.?F\.?F/i],
  ['room', /^(ROOM|RM\.?)\s*(NO\.?|#|NUMBER)$|^(NO\.?|NUMBER|#)$/i],
  ['name', /NAME|^DESCRIPTION$|^ROOM$|^SPACE$/i],
  ['floor', new RegExp(`^(FLOORS?|FLR\\.?|FLOORING)${OF}$`, 'i')],
  ['base', new RegExp(`^(BASES?|BASEBOARDS?|COVE)${OF}$`, 'i')],
  // A wall named by its side (N, E., North Wall, N. Material) is one of the room's walls.
  ['walls', new RegExp(`^WALLS?${OF}$|^(NORTH|EAST|SOUTH|WEST|[NESW])\\.?(\\s+WALLS?)?${OF}$`, 'i')],
  ['ceiling', new RegExp(`^(CEILINGS?|CLG\\.?)${OF}$`, 'i')],
  ['generic', /^(FINISH(ES)?|FIN\.?|MATERIALS?|MAT'?L\.?|TYPE|CODE)$/i],
];

const headingOf = (str: string): Heading | null => HEADINGS.find(([, re]) => re.test(str.trim()))?.[0] ?? null;

/**
 * Which of a finish's columns names it: 0 a column headed with the finish alone (FLOOR), 1 a
 * material or type column (GWB, LAP), 2 a finish column (its paint, its tile).
 */
const priorityOf = (str: string) => (/\b(FINISH(ES)?|FIN\.?)$/i.test(str.trim()) ? 2 : /\b(MATERIALS?|MAT'?L\.?|TYPE|CODE)$/i.test(str.trim()) ? 1 : 0);

/**
 * The order a finish's columns are read in: a ceiling by its material (an ACT or GWB ceiling,
 * not its paint); a floor, base or wall by its finish (the tile or paint on the block wall),
 * the material only when no finish is given.
 */
const READ_ORDER: Record<FinishRole, number[]> = { ceiling: [0, 1, 2], floor: [0, 2, 1], base: [0, 2, 1], walls: [0, 2, 1] };

/** A room number as schedules print it: 101, 101a, B23, 2.14, or with its RM / ROOM prefix (RM 001). */
const ROOM_NO = /^(?:(?:RM\.?|ROOM)\s*)?(?:[A-Z]{1,2})?\d{1,4}(?:\.\d{1,3})?[A-Za-z]?$/i;
const ROOM_PREFIX = /^(?:RM\.?|ROOM)\s*(?=\S*\d)/i;
const EMPTY = /^([-–—]+|N\/?A|NONE|\.|\/)$/i;
/** An existing finish to remain: nothing to take off. */
const EXISTING = /^(EX|EXIST\.?|EXISTING|EXG\.?)$/i;

/** The code used most often in a cell list, first on a tie. */
function byUse(codes: string[]): string[] {
  const count = new Map<string, number>();
  for (const c of codes) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
}

type Line = { cy: number; h: number; texts: PageText[] };
type Column = { role: Role; priority: number; x0: number; x1: number; cx: number };

const level = (t: PageText) => !t.angle || Math.abs(t.angle) < 0.1;
/** Turned a quarter: a narrow column's heading written up the page. */
const turned = (t: PageText) => t.angle !== undefined && Math.abs(Math.abs(t.angle) - Math.PI / 2) < 0.1;

/** The texts level with `t` and lettered like it, in one run along the line (gaps no wider than a table's widest column). */
function lineOf(texts: PageText[], t: PageText, gap = Math.max(30 * t.h, 150)): Line {
  const row = texts.filter((o) => level(o) && Math.abs(o.cy - t.cy) < 0.6 * Math.max(t.h, 3) && o.h < 1.6 * t.h && o.h > 0.6 * t.h).sort((a, b) => a.cx - b.cx);
  let i = row.indexOf(t);
  let j = i;
  while (i > 0 && row[i].cx - row[i].w / 2 - (row[i - 1].cx + row[i - 1].w / 2) < gap) i--;
  while (j < row.length - 1 && row[j + 1].cx - row[j + 1].w / 2 - (row[j].cx + row[j].w / 2) < gap) j++;
  return { cy: t.cy, h: t.h, texts: row.slice(i, j + 1) };
}

/** The texts level with `t` over a header's width. */
function spanOf(texts: PageText[], t: PageText, x0: number, x1: number): Line {
  const row = texts.filter((o) => level(o) && Math.abs(o.cy - t.cy) < 0.6 * Math.max(t.h, 3) && o.h < 1.6 * t.h && o.h > 0.6 * t.h && o.cx > x0 - 20 && o.cx < x1 + 20);
  return { cy: t.cy, h: t.h, texts: row.sort((a, b) => a.cx - b.cx) };
}

/** Vertical rules of a table crossing height `y`, as x positions. */
function rulesAt(lines: Segment[] | undefined, y: number, x0: number, x1: number): number[] {
  if (!lines) return [];
  return lines
    .filter((s) => Math.abs(s.x1 - s.x2) < 0.5 && Math.min(s.y1, s.y2) < y - 1 && Math.max(s.y1, s.y2) > y + 1 && s.x1 > x0 - 40 && s.x1 < x1 + 40)
    .map((s) => s.x1)
    .sort((a, b) => a - b);
}

/** A heading in a schedule's header: its text and the box it takes on the sheet. */
type Head = { t: PageText; x0: number; x1: number; top: number; bottom: number; cx: number; cy: number };

const headBox = (t: PageText): Head =>
  turned(t)
    ? { t, x0: t.cx - t.h / 2, x1: t.cx + t.h / 2, top: t.cy - t.w / 2, bottom: t.cy + t.w / 2, cx: t.cx, cy: t.cy }
    : { t, x0: t.cx - t.w / 2, x1: t.cx + t.w / 2, top: t.cy - t.h / 2, bottom: t.cy + t.h / 2, cx: t.cx, cy: t.cy };

/**
 * The header of a schedule around a heading text: every line of headings stacked with it
 * (ROOM over NO.; FLOORING over FIN | BASE; WALLS over NORTH over MATL | FIN), and headings
 * turned up the page under them. Null when the text is not in a header.
 */
function headerBand(texts: PageText[], anchor: PageText): { heads: Head[]; bottom: number } | null {
  const h = anchor.h;
  const isHead = (o: PageText) => headingOf(o.str) !== null;
  // A header's headings can be far apart over a wide column (a room's name).
  const gap = Math.max(40 * h, 250);
  const first = lineOf(texts, anchor, gap);
  let x0 = Math.min(...first.texts.map((t) => t.cx - t.w / 2));
  let x1 = Math.max(...first.texts.map((t) => t.cx + t.w / 2));
  // A header line is mostly headings: a schedule's first row of codes is not.
  const headerLine = (l: Line) => {
    const n = l.texts.filter(isHead).length;
    return n >= 2 && n >= 0.5 * l.texts.length;
  };
  if (!headerLine(first)) return null;
  const lines = [first];
  for (const dir of [1, -1]) {
    let cur = first;
    for (let k = 0; k < (dir > 0 ? 4 : 2); k++) {
      const next = texts
        .filter((o) => level(o) && isHead(o) && o.h < 1.6 * h && o.h > 0.6 * h && dir * (o.cy - cur.cy) > 0.6 * h && dir * (o.cy - cur.cy) < 4.5 * h && o.cx > x0 - 20 && o.cx < x1 + 20)
        .sort((a, b) => dir * (a.cy - b.cy))[0];
      if (!next) break;
      // Its line, across the table found so far and on along the line.
      const run = lineOf(texts, next, gap);
      const l = { ...run, texts: [...new Set([...run.texts, ...spanOf(texts, next, x0, x1).texts])].sort((a, b) => a.cx - b.cx) };
      if (!headerLine(l)) break;
      lines.push(l);
      x0 = Math.min(x0, ...l.texts.map((t) => t.cx - t.w / 2));
      x1 = Math.max(x1, ...l.texts.map((t) => t.cx + t.w / 2));
      cur = l;
    }
  }
  // Each line over the whole table's width: a group line's headings can be far apart.
  const heads = lines.flatMap((l) => spanOf(texts, l.texts[0], x0, x1).texts.filter(isHead)).map(headBox);
  if ((globalThis as any).__DEBUG) (globalThis as any).__DEBUG('DBG lines', lines.map((l) => `${l.cy}:${l.texts.map((t) => t.str).join('|')}`).join(' // '));
  let bottom = Math.max(...heads.map((b) => b.bottom));
  // Headings of narrow columns, turned up the page, just under the lines.
  const lowest = Math.max(...lines.map((l) => l.cy));
  for (const t of texts) {
    if (!turned(t) || !isHead(t) || t.h > 1.6 * h || t.h < 0.4 * h || t.cx < x0 - 20 || t.cx > x1 + 20) continue;
    const b = headBox(t);
    if (b.top < lowest || b.top - lowest > 6 * h) continue;
    heads.push(b);
    bottom = Math.max(bottom, b.bottom);
  }
  return { heads, bottom };
}

/**
 * The columns of a header: the headings nothing else is written under. Each takes its own
 * heading's role, or, for a FINISH, MATERIAL or a wall's side, the role of the nearest heading
 * over it (FLOOR over MATERIAL | FINISH). A heading's cell is its text's width, or the table's
 * rules round it when they hold no other heading of its line.
 */
function columnsOf(heads: Head[], lines: Segment[] | undefined): Column[] {
  const sameLine = (b: Head) => heads.filter((o) => o !== b && Math.abs(o.cy - b.cy) < 0.6 * b.t.h && turned(o.t) === turned(b.t));
  /** The table's rules round a heading, when they hold no other heading of its line. */
  const ruled = (b: Head): [number, number] | null => {
    // At its top, middle and foot: a two-line cell's rules can break where its neighbours' lines do.
    const rules = [...new Set([b.top + 1, b.cy, b.bottom - 1].flatMap((y) => rulesAt(lines, y, b.x0 - 400, b.x1 + 400)))].sort((p, q) => p - q);
    const lo = rules.filter((x) => x < b.x0 + 1).pop();
    const hi = rules.find((x) => x > b.x1 - 1);
    if (lo === undefined || hi === undefined) return null;
    return sameLine(b).some((o) => o.cx > lo && o.cx < hi) ? null : [lo, hi];
  };
  const rules = new Map(heads.map((b) => [b, ruled(b)]));
  const under = (b: Head, o: Head) => {
    const [lo, hi] = rules.get(b) ?? [b.x0, b.x1];
    return o.top > b.bottom - 0.5 && o.x1 > lo + 0.5 && o.x0 < hi - 0.5;
  };
  let leaves = heads.filter((b) => !heads.some((o) => o !== b && under(b, o))).sort((a, b) => a.cx - b.cx);
  // ROOM over NO. | NAME is their group, though written over neither.
  const bare = (b: Head) => /^ROOM$/i.test(b.t.str.trim());
  if (leaves.some((b) => headingOf(b.t.str) === 'room') && leaves.some((b) => headingOf(b.t.str) === 'name' && !bare(b))) leaves = leaves.filter((b) => !bare(b));
  if (!leaves.length) return [];
  const gaps = leaves
    .slice(1)
    .map((b, i) => b.cx - leaves[i].cx)
    .sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[gaps.length >> 1] : 0;
  /**
   * What a group heading spans: its rules, else halfway to the headings beside it on its line
   * (half a column past its text where there is none).
   */
  const spans = new Map<Head, [number, number]>();
  const span = (b: Head): [number, number] => {
    const known = spans.get(b);
    if (known) return known;
    let out = rules.get(b);
    if (!out) {
      const line = sameLine(b);
      const left = line.filter((o) => o.cx < b.cx).sort((p, q) => q.cx - p.cx)[0];
      const right = line.filter((o) => o.cx > b.cx).sort((p, q) => p.cx - q.cx)[0];
      out = [left ? (left.x1 + b.x0) / 2 : b.x0 - pitch / 2, right ? (b.x1 + right.x0) / 2 : b.x1 + pitch / 2];
      // Within the heading over it (NORTH under WALLS stops where WALLS does).
      spans.set(b, out);
      const up = over(b);
      if (up) {
        const [lo, hi] = span(up);
        out = [Math.max(out[0], Math.min(lo, b.x0)), Math.min(out[1], Math.max(hi, b.x1))];
      }
    }
    spans.set(b, out);
    return out;
  };
  /** The nearest group heading over a heading: the line just above first. */
  function over(leaf: Head): Head | null {
    const above = heads.filter((o) => {
      // A column's heading is no group: BASE FINISH written tall beside FLOOR over FINISH.
      if (o === leaf || o.bottom > leaf.top + 0.5 || leaves.includes(o)) return false;
      const [lo, hi] = span(o);
      return leaf.cx > lo && leaf.cx < hi;
    });
    return above.sort((a, b) => b.cy - a.cy || Math.abs(a.cx - leaf.cx) - Math.abs(b.cx - leaf.cx))[0] ?? null;
  }
  if ((globalThis as any).__DEBUG) for (const b of heads) (globalThis as any).__DEBUG('DBG head', b.t.str, Math.round(b.cx), Math.round(b.cy), 'span', span(b).map(Math.round), 'ruled', rules.get(b)?.map(Math.round), 'over', leaves.includes(b) ? over(b)?.t.str : '-');
  const named = leaves.some((b) => headingOf(b.t.str) === 'name' && !/^ROOM$/i.test(b.t.str.trim()));
  const cols: Column[] = leaves.map((b) => {
    const str = b.t.str.trim();
    let h = headingOf(str)!;
    // ROOM over a column of numbers, beside a NAME column, is the number.
    if (h === 'name' && /^ROOM$/i.test(str) && named) h = 'room';
    const g = over(b);
    const gh = g ? headingOf(g.t.str) : null;
    const finishOver = gh === 'floor' || gh === 'base' || gh === 'walls' || gh === 'ceiling' ? gh : null;
    let role: Role;
    if (h === 'generic') role = finishOver ?? 'other';
    // A wall's side over a column (NORTH over MATERIAL) gives way to a finish heading over it all only for walls.
    else if (h === 'walls') role = 'walls';
    else if (h === 'height') role = gh === 'ceiling' || /CLG|CEIL/i.test(str) ? 'height' : 'other';
    // Under BULKHEADS or REMARKS, a heading is theirs.
    else if (gh === 'other' && h !== 'room' && h !== 'name') role = 'other';
    else role = h;
    return { role, priority: priorityOf(str), x0: b.x0, x1: b.x1, cx: b.cx };
  });
  // Ceiling heights only under a ceiling heading: one height column on its own is a ceiling's too.
  if (!cols.some((c) => c.role === 'height')) {
    const lone = leaves.filter((b) => headingOf(b.t.str) === 'height');
    if (lone.length === 1) {
      const g = over(lone[0]);
      if (!g || headingOf(g.t.str) !== 'other') cols[leaves.indexOf(lone[0])].role = 'height';
    }
  }
  return cols;
}

/**
 * Reads a room finish schedule from a sheet's text: a header with a room number column
 * and floor plus one of base, walls or ceiling, then one line per room. Headings can be
 * stacked in two or three lines (CEILINGS over MATERIAL | FINISH | HEIGHT; WALLS over
 * NORTH over MATL | FIN), and narrow columns' headings turned up the page: a plain FINISH
 * or MATERIAL column takes the heading over it. Each cell goes to the column it sits in
 * (between the table's rules when `segs` are given, else the nearest heading); a cell
 * written on two lines is read as one. A per-wall schedule's wall finishes collapse to the
 * room's walls. Several schedules on one sheet are read together. Returns null when the
 * sheet has none.
 */
export function readFinishSchedule(texts: PageText[], segs?: Segment[]): FinishSchedule | null {
  const lines = segs?.filter((s) => !s.filled);
  const anchors = texts.filter((t) => level(t) && headingOf(t.str) === 'floor');
  const tables: { rows: ScheduleRow[]; columns: FinishRole[]; key: string }[] = [];
  const done = new Set<PageText>();
  for (const anchor of anchors) {
    if (done.has(anchor)) continue;
    const band = headerBand(texts, anchor);
    if (!band) continue;
    for (const b of band.heads) done.add(b.t);
    const columns = columnsOf(band.heads, lines);
    if (!columns.length) continue;
    const key = `${Math.round(band.bottom)}:${Math.round(columns[0].cx)}`;
    if (tables.some((t) => t.key === key)) continue;
    const roles = new Set(columns.map((c) => c.role));
    if ((globalThis as any).__DEBUG) (globalThis as any).__DEBUG('DBG anchor', anchor.str, anchor.cx, anchor.cy, 'cols', columns.map((c) => `${c.role}${c.priority}@${Math.round(c.cx)}`).join(' '));
    if (!roles.has('floor') || !['base', 'walls', 'ceiling'].some((r) => roles.has(r as Role))) continue;
    const left = Math.min(...columns.map((c) => c.x0));
    const right = Math.max(...columns.map((c) => c.x1));
    const bottom = band.bottom;
    const leafH = anchor.h;

    // Column edges: the table's rules between headings, else halfway between them.
    const rules = rulesAt(lines, bottom - leafH, left, right);
    const edges = columns.slice(1).map((c, i) => {
      const a = columns[i];
      const between = rules.filter((x) => x > a.x1 - 1 && x < c.x0 + 1);
      return between.length ? between[between.length - 1] : (a.cx + c.cx) / 2;
    });
    const columnAt = (x: number) => {
      let i = 0;
      while (i < edges.length && x > edges[i]) i++;
      return columns[i];
    };

    // Table cells read across the page: turned text near the table (a dimension) is not one.
    const below = texts.filter((t) => t.cy > bottom && t.cx > left - 120 && t.cx < right + 160 && level(t));
    // The room number column: its heading, or else the leftmost column of room-number-like cells.
    let roomCol = columns.find((c) => c.role === 'room');
    if (!roomCol) {
      const numbers = below.filter((t) => ROOM_NO.test(t.str) && /\d{2}|^[A-Z]/.test(t.str) && t.cx < columns.find((c) => c.role === 'floor')!.cx);
      if (!numbers.length) continue;
      const x = Math.min(...numbers.map((t) => t.cx));
      roomCol = columnAt(x);
      if (roomCol.role !== 'other' && roomCol.role !== 'name') continue;
      roomCol.role = 'room';
    }
    const rowsAt = below.filter((t) => ROOM_NO.test(t.str) && columnAt(t.cx) === roomCol && t.cx < right).sort((a, b) => a.cy - b.cy);
    if (rowsAt.length < 2) continue;
    // Stop at the first big gap: the schedule has ended.
    const pitches = rowsAt
      .slice(1)
      .map((r, i) => r.cy - rowsAt[i].cy)
      .sort((a, b) => a - b);
    const pitch = Math.max(4, pitches[Math.floor(pitches.length / 2)]);
    const kept = [rowsAt[0]];
    if (kept[0].cy - bottom > 6 * pitch + 4 * leafH) continue;
    for (const r of rowsAt.slice(1)) {
      if (r.cy - kept[kept.length - 1].cy > 4 * pitch) break;
      kept.push(r);
    }

    const rows: ScheduleRow[] = kept.map((r) => {
      const cells = below.filter((t) => t !== r && Math.abs(t.cy - r.cy) < pitch * 0.45 && t.cx > left - 20 && t.cx < right + 120).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
      const by = new Map<Column, string[]>();
      const existing = new Set<Column>();
      for (const c of cells) {
        // Nothing new (- or EX), or a note written across the table (--- EXISTING FINISHES ---).
        if (EMPTY.test(c.str) || edges.filter((x) => x > c.cx - c.w / 2 && x < c.cx + c.w / 2).length >= 3) continue;
        const col = columnAt(c.cx);
        if (EXISTING.test(c.str)) {
          existing.add(col);
          continue;
        }
        by.set(col, [...(by.get(col) ?? []), c.str.trim()]);
      }
      const cell = (col: Column) => by.get(col) ?? [];
      const finishes: ScheduleRow['finishes'] = {};
      const row: ScheduleRow = { number: r.str.replace(ROOM_PREFIX, ''), name: columns.filter((c) => c.role === 'name').flatMap(cell).join(' '), finishes };
      for (const role of ['floor', 'base', 'walls', 'ceiling'] as const) {
        const cols = columns.filter((c) => c.role === role);
        for (const p of READ_ORDER[role]) {
          const codes = byUse(cols.filter((c) => c.priority === p).flatMap(cell));
          // An existing finish to remain: nothing new, whatever its material.
          if (!codes.length && cols.some((c) => c.priority === p && existing.has(c))) break;
          if (!codes.length) continue;
          finishes[role] = codes[0];
          if (role === 'walls') {
            if (codes.length > 1) row.wallFinishes = codes;
            // Each wall listed (a column per wall, or the one cell) shared among the finishes on
            // it (T8/T10: two tiles on the wall): each finish takes its share of the room's walls.
            const sides = cols.filter((c) => c.priority === p).map((c) => cell(c)[0]).filter((c): c is string => !!c);
            const shares: Record<string, number> = {};
            for (const side of sides) {
              const parts = side.split(/\s*\/\s*/).filter(Boolean);
              const several = parts.length > 1 && parts.every((x) => /^[A-Z]{1,4}-?\d{0,3}[A-Z]?$/i.test(x));
              for (const x of several ? parts : [side]) shares[x] = (shares[x] ?? 0) + 1 / sides.length / (several ? parts.length : 1);
            }
            if (Object.keys(shares).length > 1) {
              row.wallShares = shares;
              // The room's wall finish is the one on most of its walls.
              finishes.walls = Object.entries(shares).sort((a, b) => b[1] - a[1])[0][0];
            }
          }
          break;
        }
      }
      const height = columns.filter((c) => c.role === 'height').flatMap(cell)[0];
      if (height) row.ceilingHeight = height;
      return row;
    });
    // The title block under a schedule (a sheet number, a scale) reads as rooms with nothing in them.
    while (rows.length && !Object.keys(rows[rows.length - 1].finishes).length) rows.pop();
    if (!rows.length) continue;
    tables.push({ rows, columns: (['floor', 'base', 'walls', 'ceiling'] as const).filter((r) => roles.has(r)), key });
  }
  if (!tables.length) return null;
  // Every schedule on the sheet, a room listed twice (two plans' schedules) taken once.
  const seen = new Set<string>();
  const rows = tables
    .flatMap((t) => t.rows)
    .filter((r) => {
      const k = r.number.toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const columns = (['floor', 'base', 'walls', 'ceiling'] as const).filter((r) => tables.some((t) => t.columns.includes(r)));
  return { rows, columns };
}

/** A ceiling height as printed (8'-6", 9', 2700, 2.7 m), in metres; null when it is not one. */
export function heightMeters(str: string): number | null {
  const s = str.trim().replace(/[’′‘]/g, "'").replace(/[”″“]/g, '"');
  const ft = /^(\d+)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"?)?$/.exec(s);
  if (ft) return (Number(ft[1]) * 12 + Number(ft[2] ?? 0) + (ft[3] ? Number(ft[3]) / Number(ft[4]) : 0)) * 0.0254;
  const m = /^(\d+(?:\.\d+)?)\s*(mm|m)?$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  if (m[2]?.toLowerCase() === 'm' || (!m[2] && v < 20)) return v;
  return v / 1000;
}

/** The room numbers a room takeoff's label starts with, e.g. "100 / 101 LOBBY" → 100, 101; "A / 101" (a lettered corridor) too. */
export function roomNumbersOf(label: string | undefined): string[] {
  if (!label) return [];
  const m = /^\s*((?:[A-Z]{0,2}\d{1,4}(?:\.\d{1,3})?[A-Za-z]?|[A-Z])(?:\s*\/\s*(?:[A-Z]{0,2}\d{1,4}(?:\.\d{1,3})?[A-Za-z]?|[A-Z]))*)(?=\s|$)/.exec(label);
  return m ? m[1].split('/').map((s) => s.trim()) : [];
}

/** A finish schedule read off one sheet. */
export interface ScheduleSheet {
  sheetName: string;
  /** The drawing file the sheet is in: a room takes its line from its own drawings first. */
  docId?: string;
  rows: ScheduleRow[];
}

export interface ScheduleMatch {
  /** Each room takeoff's line of the schedule, by measurement id. */
  rows: Map<string, { row: ScheduleRow; sheetName: string }>;
  /** Schedule lines no room takeoff carries the number of. */
  unmatched: { row: ScheduleRow; sheetName: string }[];
  /** Room takeoffs whose number no schedule lists (ids). */
  missing: string[];
}

/** A room number for matching across sheets: 101a on the plan is 101A in the schedule. */
const roomKey = (n: string) => n.replace(/[\s-]/g, '').toUpperCase();

/**
 * Matches room takeoffs to the lines of every finish schedule in the set by room number:
 * the plans and the schedule are usually different sheets (often one schedule per floor).
 * A room named by several tags takes the first number listed; a number listed on two
 * sheets is taken from the room's own drawings, else the first sheet.
 */
export function matchSchedules(rooms: { id: string; label?: string; docId?: string }[], sheets: ScheduleSheet[]): ScheduleMatch {
  const byKey = new Map<string, { row: ScheduleRow; sheetName: string; docId?: string }[]>();
  for (const sh of sheets)
    for (const row of sh.rows) {
      const k = roomKey(row.number);
      byKey.set(k, [...(byKey.get(k) ?? []), { row, sheetName: sh.sheetName, docId: sh.docId }]);
    }
  const rows: ScheduleMatch['rows'] = new Map();
  const used = new Set<ScheduleRow>();
  const missing: string[] = [];
  for (const room of rooms) {
    let hit: { row: ScheduleRow; sheetName: string } | undefined;
    for (const n of roomNumbersOf(room.label)) {
      const lines = byKey.get(roomKey(n));
      if (!lines) continue;
      hit = lines.find((l) => room.docId && l.docId === room.docId) ?? lines[0];
      break;
    }
    if (hit) {
      rows.set(room.id, { row: hit.row, sheetName: hit.sheetName });
      used.add(hit.row);
    } else missing.push(room.id);
  }
  // A line repeated on another sheet (the same room listed twice) is matched if either is.
  const usedKeys = new Set([...used].map((r) => roomKey(r.number)));
  const unmatched = sheets.flatMap((sh) => sh.rows.filter((r) => !usedKeys.has(roomKey(r.number))).map((row) => ({ row, sheetName: sh.sheetName })));
  const seen = new Set<string>();
  return { rows, unmatched: unmatched.filter((u) => !seen.has(roomKey(u.row.number)) && !!seen.add(roomKey(u.row.number))), missing };
}

/** A finish code as printed in a tag: EP1, CPT-1, CT-2, (CA1). */
const FINISH_CODE = /^\(?([A-Z]{1,4}-?\d{1,2}[A-Z]?)\)?$/;

/** A finish code with or without its dash, for matching EP1 to EP-1. */
export const sameCode = (a: string, b: string) => a.replace(/-/g, '').toUpperCase() === b.replace(/-/g, '').toUpperCase();

/** A finish code a legend explains: PT1, FL-1, MCT1, CT-2A, FL-EX, and lettered ones (EPB, CPT, LVT). */
const LEGEND_CODE = /^(?:[A-Z]{1,4}-?(?:\d{1,3}[A-Z]?|EX)|[A-Z]{2,4})$/;
/** A code for an existing finish to remain (FL-EX, PT-EX): nothing new to take off. */
const EXISTING_CODE = /-?EX$/;

/** One finish a legend lists: its code, what it is, and which of a room's finishes it is, when that can be told. */
export interface LegendEntry {
  code: string;
  role: FinishRole | null;
  description: string;
}

/** Which finish a legend section heading is about; 'any' for one that does not say (TILE, FINISHES), null for none (TRANSITIONS, MILLWORK). */
function sectionRole(heading: string): FinishRole | 'any' | null {
  const h = heading.trim().toUpperCase().replace(/:$/, '').replace(/\s+/g, ' ');
  if (/^(FLOOR(ING|S)?|FLOOR FINISH(ES)?|FLOORING FINISH(ES)?|RESILIENT FLOORING)$/.test(h)) return 'floor';
  if (/^(BASES?|BASE FINISH(ES)?|WALL BASES?)$/.test(h)) return 'base';
  if (/^(WALLS?|WALL FINISH(ES)?|PAINTS?|PAINT FINISH(ES)?|WALL (&|AND) CEILINGS?|WALL COVERINGS?)$/.test(h)) return 'walls';
  if (/^(CEILINGS?|CEILING FINISH(ES)?)$/.test(h)) return 'ceiling';
  if (/^(TILES?|TILING|FINISH(ES)?|MATERIALS?|.*\bLEGEND|.*\bSCHEDULE|ABBREVIATIONS?)$/.test(h)) return 'any';
  return null;
}

/** Which finish a legend's description says a code is: RUBBER BASE, FLOOR TILE, WALL TILE, ACOUSTIC CEILING TILE, CARPET. */
export function describedRole(description: string): FinishRole | null {
  const d = description.toUpperCase();
  if (/\bBASE\b|\bCOVE\b|\bSKIRTING\b/.test(d)) return 'base';
  if (/\bFLOOR(ING|S)?\b/.test(d)) return 'floor';
  if (/\bWALLS?\b|\bPAINT|BACKSPLASH|WAINSCOT/.test(d)) return 'walls';
  if (/\bCEILINGS?\b|\bACOUSTIC/.test(d)) return 'ceiling';
  if (/CARPET|\bLVT\b|\bVCT\b|LINOLEUM|MARMOLEUM|EPOXY|TERRAZZO|\bSEAL|POLISHED|SHEET VINYL|VINYL (TILE|PLANK|SHEET)|RUBBER (TILE|SHEET)|PORCELAIN|STAIR TREAD/.test(d)) return 'floor';
  return null;
}

/**
 * Reads a finish legend (or an abbreviations list): finish codes written one under another, each
 * with what it is written beside it, often under section headings (FLOOR:, BASE:, WALL &
 * CEILING:, TILE:). A code's finish comes from its section, or from its description where the
 * section does not say (TILE: CT1 FLOOR TILE, CT3 WALL TILE). A code in a section that is not a
 * room finish (TRANSITION, MILLWORK) has none.
 */
export function readFinishLegend(texts: PageText[], otherwise: FinishRole | null = null): Map<string, LegendEntry> {
  const flat = texts.filter(level).sort((a, b) => a.cy - b.cy);
  /** The texts with their centres between two heights (`flat` is sorted by height). */
  const between = (top: number, bottom: number) => {
    let lo = 0;
    let hi = flat.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (flat[mid].cy <= top) lo = mid + 1;
      else hi = mid;
    }
    const out: PageText[] = [];
    for (let i = lo; i < flat.length && flat[i].cy < bottom; i++) out.push(flat[i]);
    return out;
  };
  const codes = flat.filter((t) => LEGEND_CODE.test(t.str.trim()));
  // Codes one under another, left-aligned or centred in tags of one size: a list (three at least).
  const parent = codes.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const join = (i: number, j: number) => {
    parent[root(i)] = root(j);
  };
  const x0Of = (t: PageText) => t.cx - t.w / 2;
  const byX0 = codes.map((_, i) => i).sort((a, b) => x0Of(codes[a]) - x0Of(codes[b]));
  for (let k = 1; k < byX0.length; k++) if (x0Of(codes[byX0[k]]) - x0Of(codes[byX0[k - 1]]) < 3) join(byX0[k], byX0[k - 1]);
  const byCx = codes.map((_, i) => i).sort((a, b) => codes[a].cx - codes[b].cx);
  for (let k = 1; k < byCx.length; k++) if (codes[byCx[k]].cx - codes[byCx[k - 1]].cx < 1.5 * Math.max(codes[byCx[k]].h, 3)) join(byCx[k], byCx[k - 1]);
  const groups = new Map<number, PageText[]>();
  codes.forEach((c, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), c]));
  const columns = [...groups.values()].filter((g) => g.length >= 3);
  const out = new Map<string, LegendEntry>();
  for (const col of columns) {
    col.sort((a, b) => a.cy - b.cy);
    const entries: { t: PageText; description: string; words: PageText[] }[] = [];
    for (const [i, c] of col.entries()) {
      // What is written beside it, down to halfway to the codes above and below.
      const prev = col[i - 1];
      const next = col[i + 1];
      // A description of a few lines, often centred on its code's tag.
      const reach = 5 * Math.max(c.h, 5);
      const top = prev && c.cy - prev.cy < 2 * reach ? (prev.cy + c.cy) / 2 : c.cy - reach;
      const bottom = next && next.cy - c.cy < 2 * reach ? (next.cy + c.cy) / 2 : c.cy + reach;
      const x1 = c.cx + c.w / 2;
      const words = between(top, bottom)
        .filter((o) => o !== c && o.cx - o.w / 2 > x1 && o.cx - o.w / 2 < x1 + Math.max(60, 10 * c.h) && !LEGEND_CODE.test(o.str.trim()))
        .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
      const description = words.map((o) => o.str.trim()).join(' ');
      if (/[A-Za-z]{3,}/.test(description)) entries.push({ t: c, description, words });
    }
    if (entries.length < 3) continue;
    const listed = new Set(entries.map((e) => e.t));
    for (const { t: c, description, words } of entries) {
      // The section heading over it: the nearest heading (bigger, or ending in a colon) above, about level with the codes' left side.
      const x0 = c.cx - c.w / 2;
      const descH = Math.min(...words.map((o) => o.h), c.h * 1.3);
      const heading = between(c.cy - 400, c.cy - 0.5 * c.h)
        .filter((o) => Math.abs(o.cx - o.w / 2 - x0) < 30 && !listed.has(o) && (/:$/.test(o.str.trim()) || o.h > 1.15 * descH))
        .sort((a, b) => b.cy - a.cy)[0];
      const section = heading ? sectionRole(heading.str) : 'any';
      const role = section === 'any' ? (describedRole(description) ?? otherwise) : section;
      const code = c.str.trim();
      if (!out.has(code)) out.set(code, { code, role, description });
    }
  }
  return out;
}

/** A finish code as tagged on a plan: EP1, CPT-1, CT-2, FL-EX, (CA1), or a lettered one a legend lists (EPB). */
const TAG_CODE = /^\(?([A-Z]{1,4}-?(?:\d{1,3}[A-Z]?|EX))\)?$/;

/**
 * Finishes tagged on a finish plan: the codes in small tags just under each room's number tag,
 * stacked or side by side (FL-1 over BS-1; EP1 | RB1 | PT1). With a legend, each code is the
 * finish the legend says, except that tags written in a row read floor, base, walls in that
 * order (a row whose second code is a base); without one, the first code is the floor, a second
 * the base, a third the walls. Codes for existing finishes (FL-EX) are left out. `labels` are the
 * plan's room tags, with their boxes.
 */
export function readFinishTags(
  texts: PageText[],
  labels: { number: string; box?: [number, number, number, number] }[],
  legend?: Map<string, LegendEntry>,
  only?: FinishRole,
): ScheduleRow[] {
  // Only a legend's finishes count: its room names or millwork are not.
  const listed = [...(legend?.values() ?? [])].filter((e) => e.role);
  const entry = (code: string) => listed.find((e) => sameCode(e.code, code));
  const known = (code: string) => !!entry(code);
  const codeOf = (t: PageText) => {
    const s = t.str.trim();
    const m = TAG_CODE.exec(s);
    if (m) return m[1];
    return known(s) && LEGEND_CODE.test(s) ? s : null;
  };
  const tagged = texts.filter((t) => level(t) && codeOf(t));
  const rows: ScheduleRow[] = [];
  for (const l of labels) {
    if (!l.box) continue;
    const [x0, y0, x1, y1] = l.box;
    const h = y1 - y0;
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    // The tags under the box, each line close under the one before.
    const near = tagged.filter((t) => t.cy > y1 && t.cy < y1 + 8 * h && Math.abs(t.cx - cx) < Math.max(2.5 * w, 4 * h)).sort((a, b) => a.cy - b.cy);
    const chain: PageText[] = [];
    let last = y1;
    for (const t of near) {
      if (t.cy - last > (chain.length ? 2 : 2.5) * h) break;
      chain.push(t);
      last = Math.max(last, t.cy);
    }
    // Top to bottom, then left to right along a row.
    const lines: PageText[][] = [];
    for (const t of chain) {
      const line = lines.find((k) => Math.abs(k[0].cy - t.cy) < 0.5 * Math.max(t.h, 3));
      if (line) line.push(t);
      else lines.push([t]);
    }
    const codes = lines.flatMap((k) => k.sort((a, b) => a.cx - b.cx)).map((t) => codeOf(t)!);
    if (!codes.length) continue;
    // On a ceiling plan, the code under a room's number is its ceiling.
    if (only) {
      const c = codes.find((k) => !EXISTING_CODE.test(k) && (!listed.length || entry(k)));
      if (c) rows.push({ number: l.number, name: '', finishes: { [only]: c } });
      continue;
    }
    const roles = codes.map((c) => entry(c)?.role ?? null);
    const ordered = !listed.length || (codes.length >= 2 && roles[1] === 'base');
    const order: FinishRole[] = ['floor', 'base', 'walls'];
    const finishes: ScheduleRow['finishes'] = {};
    codes.forEach((c, i) => {
      const role = ordered ? (roles[i] === 'base' ? 'base' : (order[i] ?? null)) : roles[i];
      if (!role || finishes[role] || EXISTING_CODE.test(c)) return;
      // With a legend, a code it does not list is not a finish (a wall type tagged near the room).
      if (listed.length && !entry(c)) return;
      finishes[role] = c;
    });
    if (Object.keys(finishes).length) rows.push({ number: l.number, name: '', finishes });
  }
  return rows;
}

/** The finish codes tagged inside an outline (a ceiling plan's "(CA1)" tags over a room), deduplicated. */
export function codesInside(texts: PageText[], inside: (x: number, y: number) => boolean, accept: (code: string) => boolean): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    const m = FINISH_CODE.exec(t.str.trim());
    if (m && accept(m[1]) && inside(t.cx, t.cy)) out.add(m[1]);
  }
  return [...out];
}
