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

/** Heading words, most specific first (FLOOR REMARKS is a remark, not the floor). */
const HEADINGS: [Heading, RegExp][] = [
  ['other', /REMARK|NOTE|COMMENT|BULKHEAD|SUBSTRATE|^SUB\.?$|^SUBS$/i],
  ['height', /HEIGHT|^(CLG\.?\s*)?HT\.?$|A\.?F\.?F/i],
  ['room', /^(ROOM|RM\.?)\s*(NO\.?|#|NUMBER)$|^(NO\.?|NUMBER|#)$/i],
  ['name', /NAME|^DESCRIPTION$|^ROOM$|^SPACE$/i],
  ['floor', /^(FLOORS?|FLR\.?|FLOORING)(\s+(FINISH|MATERIAL|MAT'?L|FIN\.?|TYPE))?$/i],
  ['base', /^(BASES?|COVE)(\s+(FINISH|MATERIAL|FIN\.?|TYPE))?$/i],
  ['walls', /^WALLS?(\s+(FINISH|MATERIAL|FIN\.?|TYPE))?$|^(NORTH|EAST|SOUTH|WEST)(\s+WALLS?)?$|^[NESW]$/i],
  ['ceiling', /^(CEILINGS?|CLG\.?)(\s+(FINISH|MATERIAL|TYPE|FIN\.?))?$/i],
  ['generic', /^(FINISH(ES)?|FIN\.?|MATERIALS?|MAT'?L\.?|TYPE|CODE)$/i],
];

const headingOf = (str: string): Heading | null => HEADINGS.find(([, re]) => re.test(str.trim()))?.[0] ?? null;

/** Under a group heading, a material or type column names the finish before a plain FINISH column (GWB over its paint). */
const priorityOf = (str: string) => (/^(FINISH(ES)?|FIN\.?)$/i.test(str.trim()) ? 2 : 1);

const ROOM_NO = /^(?:[A-Z]{1,2})?\d{1,4}(?:\.\d{1,3})?[A-Za-z]?$/;
const EMPTY = /^([-–—]+|N\/?A|NONE|\.|\/)$/i;

/** The code used most often in a cell list, first on a tie. */
function byUse(codes: string[]): string[] {
  const count = new Map<string, number>();
  for (const c of codes) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
}

type Line = { cy: number; h: number; texts: PageText[] };
type Column = { role: Role; priority: number; x0: number; x1: number; cx: number };

const level = (t: PageText) => !t.angle || Math.abs(t.angle) < 0.1;

/** The texts level with `t` and lettered like it, in one run along the line (gaps no wider than a table's widest column). */
function lineOf(texts: PageText[], t: PageText): Line {
  const row = texts.filter((o) => level(o) && Math.abs(o.cy - t.cy) < 0.6 * Math.max(t.h, 3) && o.h < 1.6 * t.h && o.h > 0.6 * t.h).sort((a, b) => a.cx - b.cx);
  const gap = Math.max(30 * t.h, 150);
  let i = row.indexOf(t);
  let j = i;
  while (i > 0 && row[i].cx - row[i].w / 2 - (row[i - 1].cx + row[i - 1].w / 2) < gap) i--;
  while (j < row.length - 1 && row[j + 1].cx - row[j + 1].w / 2 - (row[j].cx + row[j].w / 2) < gap) j++;
  return { cy: t.cy, h: t.h, texts: row.slice(i, j + 1) };
}

/** The texts level with `t` over a header's width: a group line's headings can be far apart. */
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

/**
 * The header of a schedule around a heading text: its column line (the bottom line of
 * headings) and the group line over it (NORTH WALL over SUB | FINISH), if there is one.
 */
function headerAt(texts: PageText[], anchor: PageText): { leaf: Line; group: Line | null } {
  const line = lineOf(texts, anchor);
  const extent = (l: Line) => [Math.min(...l.texts.map((t) => t.cx - t.w / 2)), Math.max(...l.texts.map((t) => t.cx + t.w / 2))];
  const [x0, x1] = extent(line);
  // A line of headings just below makes this one the group line.
  const next = texts
    .filter((t) => level(t) && t.cy > line.cy + 0.6 * line.h && t.cy - line.cy < 4.5 * line.h && t.cx > x0 && t.cx < x1 && headingOf(t.str))
    .sort((a, b) => a.cy - b.cy)[0];
  if (next) {
    const below = lineOf(texts, next);
    if (below.texts.filter((t) => headingOf(t.str)).length >= 3) {
      const [b0, b1] = extent(below);
      return { leaf: below, group: spanOf(texts, anchor, b0, b1) };
    }
  }
  const prev = texts
    .filter((t) => level(t) && t.cy < line.cy - 0.6 * line.h && line.cy - t.cy < 4.5 * line.h && t.cx > x0 - 20 && t.cx < x1 + 20 && t.h < 1.6 * line.h)
    .sort((a, b) => b.cy - a.cy)[0];
  return { leaf: line, group: prev ? spanOf(texts, prev, x0, x1) : null };
}

/** The columns of a header: each heading's role, a generic heading taking its group's. */
function columnsOf(leaf: Line, group: Line | null, lines: Segment[] | undefined): Column[] {
  const leaves = [...leaf.texts].sort((a, b) => a.cx - b.cx);
  const x0 = leaves[0].cx - leaves[0].w / 2;
  const x1 = leaves[leaves.length - 1].cx + leaves[leaves.length - 1].w / 2;
  // Group spans: between the rules crossing the group line, else the nearest group heading.
  const groupRules = group ? rulesAt(lines, group.cy, x0, x1) : [];
  const groupOf = (t: PageText): PageText | null => {
    if (!group?.texts.length) return null;
    if (groupRules.length >= 2) {
      const lo = Math.max(-Infinity, ...groupRules.filter((x) => x < t.cx));
      const hi = Math.min(Infinity, ...groupRules.filter((x) => x > t.cx));
      return group.texts.find((g) => g.cx > lo && g.cx < hi) ?? null;
    }
    return group.texts.reduce((a, b) => (Math.abs(b.cx - t.cx) < Math.abs(a.cx - t.cx) ? b : a));
  };
  const named = leaves.some((t) => headingOf(t.str) === 'name' && !/^ROOM$/i.test(t.str.trim()));
  const cols: Column[] = leaves.map((t) => {
    let h = headingOf(t.str) ?? 'other';
    // ROOM over a column of numbers, beside a NAME column, is the number.
    if (h === 'name' && /^ROOM$/i.test(t.str.trim()) && named) h = 'room';
    const g = groupOf(t);
    const gh = g ? headingOf(g.str) : null;
    let role: Role;
    if (h === 'generic' || (h === 'walls' && /^[NESW]$/i.test(t.str.trim()))) role = gh === 'floor' || gh === 'base' || gh === 'walls' || gh === 'ceiling' ? gh : h === 'walls' ? 'walls' : 'other';
    else if (h === 'height') role = gh === 'ceiling' || /CLG|CEIL/i.test(t.str) ? 'height' : 'other';
    else role = h;
    return { role, priority: h === 'generic' ? priorityOf(t.str) : 0, x0: t.cx - t.w / 2, x1: t.cx + t.w / 2, cx: t.cx };
  });
  // Ceiling heights only under a ceiling heading: one height column on its own is a ceiling's too.
  if (!cols.some((c) => c.role === 'height')) {
    const lone = leaves.filter((t) => headingOf(t.str) === 'height');
    if (lone.length === 1 && !group) cols[leaves.indexOf(lone[0])].role = 'height';
  }
  return cols;
}

/**
 * Reads a room finish schedule from a sheet's text: a header with a room number column
 * and floor plus one of base, walls or ceiling, then one line per room. Headings can be
 * stacked in two lines (CEILINGS over MATERIAL | FINISH | HEIGHT; NORTH WALL over
 * SUB | FINISH): a plain FINISH or MATERIAL column takes the heading over it. Each cell
 * goes to the column it sits in (between the table's rules when `segs` are given, else
 * the nearest heading). A per-wall schedule's wall finishes collapse to the room's walls.
 * Several schedules on one sheet are read together. Returns null when the sheet has none.
 */
export function readFinishSchedule(texts: PageText[], segs?: Segment[]): FinishSchedule | null {
  const lines = segs?.filter((s) => !s.filled);
  const anchors = texts.filter((t) => level(t) && headingOf(t.str) === 'floor');
  const tables: { rows: ScheduleRow[]; columns: FinishRole[]; key: string }[] = [];
  for (const anchor of anchors) {
    const { leaf, group } = headerAt(texts, anchor);
    const key = `${Math.round(leaf.cy)}:${Math.round(leaf.texts[0].cx)}`;
    if (tables.some((t) => t.key === key)) continue;
    const columns = columnsOf(leaf, group, lines);
    const roles = new Set(columns.map((c) => c.role));
    if (!roles.has('floor') || !['base', 'walls', 'ceiling'].some((r) => roles.has(r as Role))) continue;
    const left = Math.min(...columns.map((c) => c.x0));
    const right = Math.max(...columns.map((c) => c.x1));
    const bottom = leaf.cy + leaf.h;

    // Column edges: the table's rules between headings, else halfway between them.
    const rules = rulesAt(lines, leaf.cy, left, right);
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
    if (kept[0].cy - bottom > 6 * pitch + 4 * leaf.h) continue;
    for (const r of rowsAt.slice(1)) {
      if (r.cy - kept[kept.length - 1].cy > 4 * pitch) break;
      kept.push(r);
    }

    const rows: ScheduleRow[] = kept.map((r) => {
      const cells = below.filter((t) => t !== r && Math.abs(t.cy - r.cy) < pitch * 0.45 && t.cx > left - 20 && t.cx < right + 120).sort((a, b) => a.cx - b.cx);
      const by = new Map<Column, string[]>();
      for (const c of cells) {
        if (EMPTY.test(c.str)) continue;
        const col = columnAt(c.cx);
        by.set(col, [...(by.get(col) ?? []), c.str.trim()]);
      }
      const finishes: ScheduleRow['finishes'] = {};
      const row: ScheduleRow = { number: r.str, name: columns.filter((c) => c.role === 'name').flatMap((c) => by.get(c) ?? []).join(' '), finishes };
      for (const role of ['floor', 'base', 'walls', 'ceiling'] as const) {
        const cols = columns.filter((c) => c.role === role);
        // The material column first (LAP, GWB), its finish (paint) only when there is no material.
        for (const p of [...new Set(cols.map((c) => c.priority))].sort()) {
          const codes = byUse(cols.filter((c) => c.priority === p).flatMap((c) => by.get(c) ?? []));
          if (!codes.length) continue;
          finishes[role] = codes[0];
          if (role === 'walls' && codes.length > 1) row.wallFinishes = codes;
          break;
        }
      }
      const height = columns.filter((c) => c.role === 'height').flatMap((c) => by.get(c) ?? [])[0];
      if (height) row.ceilingHeight = height;
      return row;
    });
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

/**
 * Floor finishes tagged on a finish plan: the code in a box just under each room's
 * number tag (EP1 under 112). `labels` are the plan's room tags, with their boxes.
 */
export function readFinishTags(texts: PageText[], labels: { number: string; box?: [number, number, number, number] }[]): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (const l of labels) {
    if (!l.box) continue;
    const [x0, y0, x1, y1] = l.box;
    const h = y1 - y0;
    const code = texts
      .filter((t) => FINISH_CODE.test(t.str.trim()) && t.cy > y1 && t.cy < y1 + 2.5 * h && Math.abs(t.cx - (x0 + x1) / 2) < (x1 - x0))
      .sort((a, b) => a.cy - b.cy)[0];
    if (code) rows.push({ number: l.number, name: '', finishes: { floor: FINISH_CODE.exec(code.str.trim())![1] } });
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
