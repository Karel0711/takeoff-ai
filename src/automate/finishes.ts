import { codesInside, heightMeters, matchSchedules, readFinishSchedule, readFinishTags, roomNumbersOf, sameCode, type ScheduleRow, type ScheduleSheet } from '../finishSchedule';
import { findRoomLabels } from '../fill/rooms';
import { pointInRing } from '../fill/similar';
import { FINISH_ROLES, finishType, type FinishRole, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import { toLength } from '../units';
import { perSheet, PALETTE, type SetAccess } from './set';

export type Finishes = Partial<Record<FinishRole, string>>;

const codeOf = (name: string) => name.split(' – ')[0].trim().toUpperCase();

/** The rooms finishes go on: named area takeoffs (or ones Rooms made), in room-number order. Areas a legend found are a finish already, not rooms. */
export function finishRooms(project: Project): Measurement[] {
  const areaTypeIds = new Set(project.types.filter((t) => t.kind === 'area').map((t) => t.id));
  return project.measurements
    .filter((m) => areaTypeIds.has(m.typeId) && m.source !== 'legend' && (m.label || m.source === 'rooms'))
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', undefined, { numeric: true }));
}

/**
 * A type for this finish code: one already named with it (the one from `docId`, the drawings
 * the room is on, first: two buildings' FA1), or a new one added to `fresh`.
 */
export function finishTypeFor(project: Project, role: FinishRole, code: string, pool: TakeoffType[], fresh: TakeoffType[], docId?: string, palette = PALETTE): string {
  const kind = FINISH_ROLES.find((r) => r.role === role)!.kind;
  const all = [...pool, ...fresh].filter((t) => t.kind === kind && sameCode(codeOf(t.name), code));
  const hit = all.find((t) => docId && t.fromDoc === docId) ?? all.find((t) => !t.fromDoc) ?? all[0];
  if (hit) return hit.id;
  const t = finishType(role, code, project.units, palette[(pool.length + fresh.length) % palette.length]);
  fresh.push(t);
  return t.id;
}

/** Finishes read from the drawings for the room takeoffs. */
export interface FinishesRead {
  /** Finishes per room takeoff (merged into what each has). */
  picks: Map<string, Finishes>;
  /** Ceiling heights per room takeoff, in project length units. */
  heights: Map<string, number>;
  /** New finish types the picks use. */
  fresh: TakeoffType[];
  note: string;
  /** Schedule lines no room matched, and rooms no line matched. */
  unmatched: { rows: string[]; rooms: string[] } | null;
  /** Where the finishes came from. */
  from: 'schedule' | 'tags' | 'none';
}

/**
 * Reads every room finish schedule in the set (often one sheet per floor, apart from the
 * plans) and gives each room takeoff the finishes and ceiling height of the line with its
 * number. Lines and rooms that did not match are listed. With no schedule, finishes tagged on
 * the drawings instead (see `readFinishTagsIn`). `pool`: the types to reuse.
 */
export async function readFinishes(project: Project, rooms: Measurement[], access: SetAccess, pool: TakeoffType[], palette = PALETTE): Promise<FinishesRead> {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const found: (ScheduleSheet & { sheet: Sheet })[] = [];
  const targets = project.sheets.filter((x) => !x.superseded);
  for (const [i, sheet] of targets.entries()) {
    access.progress?.(`Looking for finish schedules… sheet ${i + 1} of ${targets.length}`);
    await perSheet(access, sheet, async () => {
      const texts = await access.texts(sheet);
      if (!readFinishSchedule(texts)) return;
      // Read again along the table's rules, so each cell lands in its own column.
      const segs = await access.segments(sheet);
      if (!segs) return;
      const schedule = readFinishSchedule(texts, segs);
      if (schedule?.rows.length) found.push({ sheet, sheetName: sheet.name, docId: sheet.docId, rows: schedule.rows });
    });
  }
  if (!found.length) return readFinishTagsIn(project, rooms, access, pool, palette);
  const match = matchSchedules(
    rooms.map((m) => ({ id: m.id, label: m.label, docId: sheets.get(m.sheetId)?.docId })),
    found,
  );
  const fresh: TakeoffType[] = [];
  const roomType = new Map(rooms.map((m) => [m.id, m.typeId]));
  const picks = new Map<string, Finishes>();
  const heights = new Map<string, number>();
  for (const [id, { row }] of match.rows) {
    const docId = sheets.get(rooms.find((m) => m.id === id)!.sheetId)?.docId;
    const f: Finishes = {};
    for (const [role, code] of Object.entries(row.finishes) as [FinishRole, string][]) {
      const t = finishTypeFor(project, role, code, pool, fresh, docId, palette);
      if (t !== roomType.get(id)) f[role] = t;
    }
    picks.set(id, f);
    const h = row.ceilingHeight ? heightMeters(row.ceilingHeight) : null;
    if (h) heights.set(id, +toLength(h, project.units).toFixed(3));
  }
  const rowsRead = found.reduce((n, f) => n + f.rows.length, 0);
  const label = (id: string) => rooms.find((m) => m.id === id)?.label ?? 'Unnamed area';
  return {
    from: 'schedule',
    picks,
    heights,
    fresh,
    unmatched:
      match.unmatched.length || match.missing.length
        ? { rows: match.unmatched.map((u) => `${u.row.number}${u.row.name ? ` ${u.row.name}` : ''} (${u.sheetName})`), rooms: match.missing.map(label) }
        : null,
    note:
      `Read ${found.length} finish schedule${found.length === 1 ? '' : 's'} (${found.map((f) => f.sheetName).join(', ')}): ${rowsRead} room${rowsRead === 1 ? '' : 's'}, ` +
      `${match.rows.size} of your ${rooms.length} room takeoffs matched` +
      (fresh.length ? `, ${fresh.length} new finish type${fresh.length === 1 ? '' : 's'}.` : '.'),
  };
}

/**
 * No finish schedule: finishes tagged on the drawings instead. Floors from a finish plan
 * (the code boxed under each room's number), ceilings from a ceiling plan drawn over the
 * same outline as the room's plan (the ceiling type tagged inside each room).
 */
export async function readFinishTagsIn(project: Project, rooms: Measurement[], access: SetAccess, pool: TakeoffType[], palette = PALETTE): Promise<FinishesRead> {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const ceilingCodes = new Set(
    project.sheets.flatMap((x) => x.aiAssemblies?.assemblies ?? []).filter((a) => a.category === 'ceiling').map((a) => a.code.toUpperCase()),
  );
  for (const t of project.types) if (t.kind === 'area' && /CEILING/i.test(`${t.name} ${t.assemblyTitle ?? ''}`)) ceilingCodes.add(codeOf(t.name));
  // Per drawing file: two buildings in one project can both have a room 100.
  const floors = new Map<string, { sheet: Sheet; rows: ScheduleRow[]; matched: number }>();
  const ceilings = new Map<string, { sheet: Sheet; codes: Map<string, string> }>();
  const docRooms = (docId: string) => rooms.filter((m) => sheets.get(m.sheetId)?.docId === docId);
  const numbersIn = (docId: string) => {
    const out = new Map<string, string[]>();
    for (const m of docRooms(docId)) for (const n of roomNumbersOf(m.label)) out.set(n, [...(out.get(n) ?? []), m.id]);
    return out;
  };
  for (const [i, sheet] of project.sheets.entries()) {
    access.progress?.(`Reading finish tags… sheet ${i + 1} of ${project.sheets.length}`);
    const own = numbersIn(sheet.docId);
    if (!own.size) continue;
    await perSheet(access, sheet, async () => {
      const texts = await access.texts(sheet);
      // Floors: room tags with a finish code under them.
      if (texts.filter((t) => own.has(t.str.trim())).length >= Math.min(2, own.size)) {
        const segs = await access.segments(sheet);
        if (!segs) return;
        const rows = readFinishTags(texts, findRoomLabels(texts, segs));
        const matched = rows.filter((r) => own.has(r.number)).length;
        const best = floors.get(sheet.docId);
        if (matched >= 1 && (!best || matched > best.matched)) floors.set(sheet.docId, { sheet, rows, matched });
      }
      // Ceilings: one ceiling code inside a room, on another sheet of its plan's size.
      if (!ceilingCodes.size) return;
      const codes = new Map<string, string>();
      for (const m of docRooms(sheet.docId)) {
        const plan = sheets.get(m.sheetId);
        if (!plan || plan.id === sheet.id || Math.abs(plan.width - sheet.width) > 1 || Math.abs(plan.height - sheet.height) > 1) continue;
        const found = codesInside(texts, (x, y) => pointInRing([x, y], m.points), (c) => ceilingCodes.has(c.toUpperCase()));
        if (found.length === 1) codes.set(m.id, found[0]);
      }
      const best = ceilings.get(sheet.docId);
      if (codes.size >= 1 && (!best || codes.size > best.codes.size)) ceilings.set(sheet.docId, { sheet, codes });
    });
  }
  const empty = { picks: new Map(), heights: new Map(), fresh: [], unmatched: null };
  if (!floors.size && !ceilings.size)
    return { ...empty, from: 'none', note: 'No room finish schedule or finish tags found on these drawings. Pick the finishes by hand, or select rooms and set them together.' };
  const fresh: TakeoffType[] = [];
  const roomType = new Map(rooms.map((m) => [m.id, m.typeId]));
  const picks = new Map<string, Finishes>();
  for (const [docId, f] of floors) {
    const own = numbersIn(docId);
    for (const row of f.rows) {
      for (const id of own.get(row.number) ?? []) {
        const t = finishTypeFor(project, 'floor', row.finishes.floor!, pool, fresh, docId, palette);
        if (t !== roomType.get(id)) picks.set(id, { ...picks.get(id), floor: t });
      }
    }
  }
  for (const [docId, c] of ceilings) {
    for (const [id, code] of c.codes) {
      const t = finishTypeFor(project, 'ceiling', code, pool, fresh, docId, palette);
      if (t !== roomType.get(id)) picks.set(id, { ...picks.get(id), ceiling: t });
    }
  }
  const n = (k: number) => `${k} room${k === 1 ? '' : 's'}`;
  const parts = [
    ...(floors.size ? [`floors tagged on ${[...floors.values()].map((f) => `${f.sheet.name} (${n(f.matched)})`).join(', ')}`] : []),
    ...(ceilings.size ? [`ceilings tagged on ${[...ceilings.values()].map((c) => `${c.sheet.name} (${n(c.codes.size)})`).join(', ')}`] : []),
  ];
  return {
    ...empty,
    from: 'tags',
    picks,
    fresh,
    note: `No finish schedule; read the ${parts.join('; ')}${fresh.length ? `; ${fresh.length} new finish type${fresh.length === 1 ? '' : 's'}` : ''}. Check the rooms left blank.`,
  };
}

/** Saves finishes read from the drawings on the rooms, as the dialog's Save does with nothing changed by hand. */
export const applyFinishes =
  (read: FinishesRead) =>
  (p: Project): Project => {
    const used = new Set([...read.picks.values()].flatMap((f) => Object.values(f)));
    return {
      ...p,
      types: [...p.types, ...read.fresh.filter((t) => used.has(t.id))],
      measurements: p.measurements.map((m) => {
        const f = read.picks.get(m.id);
        const h = read.heights.get(m.id);
        return f || h !== undefined ? { ...m, ...(f ? { finishes: { ...m.finishes, ...f } } : {}), ...(h !== undefined ? { ceilingHeight: h } : {}) } : m;
      }),
    };
  };
