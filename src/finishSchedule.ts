import type { FinishRole } from './model';
import type { PageText } from './pageText';

/** One room's line of a room finish schedule: the finish code in each column. */
export interface ScheduleRow {
  number: string;
  name: string;
  finishes: Partial<Record<FinishRole, string>>;
}

export interface FinishSchedule {
  rows: ScheduleRow[];
  /** The columns found, for showing what was read. */
  columns: FinishRole[];
}

type Column = { role: FinishRole | 'room' | 'name' | 'other'; x: number; y: number };

const HEADER: [Column['role'], RegExp][] = [
  ['room', /^(ROOM|RM\.?)\s*(NO\.?|#|NUMBER)$|^(NO\.?|NUMBER|#)$/i],
  ['name', /NAME|^ROOM$|^DESCRIPTION$/i],
  ['floor', /^(FLOOR|FLR\.?)(\s+(FINISH|MATERIAL|MAT'?L|FIN\.?))?$|^FLOORING$/i],
  ['base', /^(BASE|COVE)(\s+(FINISH|MATERIAL|FIN\.?))?$/i],
  ['walls', /^WALLS?(\s+(FINISH|MATERIAL|FIN\.?))?$|^(NORTH|EAST|SOUTH|WEST)(\s+WALL)?$/i],
  ['ceiling', /^(CEILING|CLG\.?)(\s+(FINISH|MATERIAL|TYPE|FIN\.?))?$/i],
  ['other', /HEIGHT|^HT\.?$|REMARK|NOTE|COMMENT/i],
];

const ROOM_NO = /^[A-Z]?\d{2,4}[A-Z]?$/;
const EMPTY = /^([-–—]+|N\/?A|NONE|\.)$/i;

const roleOf = (str: string) => HEADER.find(([, re]) => re.test(str.trim()))?.[0] ?? null;

/** The code used most often in a cell list, first on a tie. */
function mostCommon(codes: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const c of codes) count.set(c, (count.get(c) ?? 0) + 1);
  let best: string | undefined;
  for (const [c, n] of count) if (!best || n > count.get(best)!) best = c;
  return best;
}

/**
 * Reads a room finish schedule from a sheet's text: a header row with a room number
 * column and at least floor plus one of base, walls or ceiling, then one line per room.
 * Each data cell goes to the header column nearest it. Returns null when the sheet has none.
 */
export function readFinishSchedule(texts: PageText[]): FinishSchedule | null {
  const headers = texts.flatMap((t) => {
    const role = roleOf(t.str);
    return role ? [{ role, x: t.cx, y: t.cy, h: t.h }] : [];
  });
  let best: FinishSchedule | null = null;
  for (const floor of headers.filter((h) => h.role === 'floor')) {
    // The header band: header words level with the floor heading (headings may be stacked).
    const band = headers.filter((h) => Math.abs(h.y - floor.y) <= Math.max(30, 6 * floor.h) && Math.abs(h.x - floor.x) <= 900);
    const roles = new Set(band.map((h) => h.role));
    if (!['base', 'walls', 'ceiling'].some((r) => roles.has(r as Column['role']))) continue;
    const columns: Column[] = band.map(({ role, x, y }) => ({ role, x, y }));
    const left = Math.min(...columns.map((c) => c.x));
    const right = Math.max(...columns.map((c) => c.x));
    const bottom = Math.max(...band.map((h) => h.y + h.h));

    const below = texts.filter((t) => t.cy > bottom && t.cx > left - 120 && t.cx < right + 160);
    // The room number column: its heading, or else the leftmost column of room-number-like cells.
    let roomX = columns.find((c) => c.role === 'room')?.x;
    if (roomX === undefined) {
      const numbers = below.filter((t) => ROOM_NO.test(t.str) && t.cx < floor.x);
      if (!numbers.length) continue;
      roomX = Math.min(...numbers.map((t) => t.cx));
      columns.push({ role: 'room', x: roomX, y: floor.y });
    }
    const nearest = (x: number) => columns.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));

    const rowsAt = below
      .filter((t) => ROOM_NO.test(t.str) && nearest(t.cx).role === 'room')
      .sort((a, b) => a.cy - b.cy);
    if (rowsAt.length < 2) continue;
    // Stop at the first big gap: the schedule has ended.
    const pitches = rowsAt.slice(1).map((r, i) => r.cy - rowsAt[i].cy).sort((a, b) => a - b);
    const pitch = Math.max(4, pitches[Math.floor(pitches.length / 2)]);
    const kept = [rowsAt[0]];
    for (const r of rowsAt.slice(1)) {
      if (r.cy - kept[kept.length - 1].cy > 4 * pitch) break;
      kept.push(r);
    }

    const rows: ScheduleRow[] = kept.map((r) => {
      const cells = below.filter((t) => t !== r && Math.abs(t.cy - r.cy) < pitch * 0.45).sort((a, b) => a.cx - b.cx);
      const by = new Map<Column['role'], string[]>();
      for (const c of cells) {
        if (EMPTY.test(c.str)) continue;
        const col = nearest(c.cx).role;
        by.set(col, [...(by.get(col) ?? []), c.str.trim()]);
      }
      const finishes: ScheduleRow['finishes'] = {};
      for (const role of ['floor', 'base', 'walls', 'ceiling'] as const) {
        const code = mostCommon(by.get(role) ?? []);
        if (code) finishes[role] = code;
      }
      return { number: r.str, name: (by.get('name') ?? []).join(' '), finishes };
    });
    const found = (['floor', 'base', 'walls', 'ceiling'] as const).filter((r) => roles.has(r));
    if (!best || rows.length > best.rows.length) best = { rows, columns: found };
  }
  return best;
}

/** The room numbers a room takeoff's label starts with, e.g. "100 / 101 LOBBY" → 100, 101. */
export function roomNumbersOf(label: string | undefined): string[] {
  if (!label) return [];
  const m = /^\s*([A-Z]?\d{2,4}[A-Z]?(?:\s*\/\s*[A-Z]?\d{2,4}[A-Z]?)*)/.exec(label);
  return m ? m[1].split('/').map((s) => s.trim()) : [];
}
