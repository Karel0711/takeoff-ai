import type { ExtractedAssembly } from '../ai/schema';
import { buildTakeoffType } from '../assemblyBuilder';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType, type Units } from '../model';
import type { PDFDocumentProxy, PDFPageProxy } from '../pdf';
import { runsToLines, type TypeLines } from '../walls/runsToLines';
import { mergeSetTypes, type SetTypes } from '../walls/setTypes';
import { setTypesOf, sheetWallTakeoff, type KnownWalls } from '../walls/sheetWallTakeoff';
import { tagKind, type WallTakeoffResult } from '../walls/wallTakeoff';
import type { Automation } from './result';
import { PALETTE } from './set';

const codeOf = (typeName: string) => typeName.split(' – ')[0].trim();
/** A wall code's choice: a new type for it. */
export const NEW_TYPE = '__new__';
/** A wall code's choice: not added. */
export const SKIP = '__skip__';

/** The assembly types read with AI on the project's sheets: this drawing file's first (another building's WE1 may be a different wall). */
export const wallLegendFor = (p: Project, sheet: Sheet): ExtractedAssembly[] =>
  [...p.sheets.filter((s) => s.docId === sheet.docId), ...p.sheets.filter((s) => s.docId !== sheet.docId)].flatMap((s) => s.aiAssemblies?.assemblies ?? []);

/** Wall assemblies of the legend by code (the first of each code). */
export function wallsFromLegend(legend: ExtractedAssembly[]): Map<string, ExtractedAssembly> {
  const out = new Map<string, ExtractedAssembly>();
  for (const a of legend) if ((a.category === 'interior_wall' || a.category === 'exterior_wall') && !out.has(a.code)) out.set(a.code, a);
  return out;
}

/**
 * The project's wall types, once read from an assembly schedule: other codes on the plan
 * (W1 for a window on some sets) are tags only where a leader puts them on a wall.
 */
export function knownWallsOf(fromLegend: Map<string, ExtractedAssembly>, types: TakeoffType[]): { codes: string[]; exterior: string[] } {
  const codes = new Set(fromLegend.keys());
  for (const t of types) if (t.kind === 'linear' && t.assemblyTitle) codes.add(codeOf(t.name).replace('-', ''));
  const exterior = [...fromLegend.values()].filter((a) => a.category === 'exterior_wall').map((a) => a.code);
  return { codes: [...codes], exterior };
}

/** Partition codes that stop at doors to start with: finish-only types (finishes don't run across a door), and types that remember it from an earlier takeoff. */
export function stopsAtDoorsOf(legend: ExtractedAssembly[], types: TakeoffType[]): Set<string> {
  const finishOnly = (text: string) => /finish(es)?\s+only/i.test(text);
  const out = new Set<string>();
  for (const a of legend) if (finishOnly([a.title, ...a.notes].join(' '))) out.add(a.code.replace('-', ''));
  for (const t of types) {
    if (t.kind !== 'linear') continue;
    // A type remembers the choice from an earlier wall takeoff.
    if (t.stopsAtDoors ?? finishOnly(`${t.name} ${t.assemblyTitle ?? ''} ${t.description ?? ''}`)) out.add(codeOf(t.name).replace('-', ''));
    else if (t.stopsAtDoors === false) out.delete(codeOf(t.name).replace('-', ''));
  }
  return out;
}

export interface WallRead {
  result: WallTakeoffResult;
  lines: TypeLines[];
  /** What the drawing set says its type codes are. */
  setTypes?: SetTypes;
}

/**
 * What the whole drawing set says its type codes are: this drawing file's type sheets and
 * legends first, then the project's other files' (an addendum re-issuing the exterior wall
 * types leaves the interior ones on the original set's types sheet).
 */
export async function projectSetTypes(doc: PDFDocumentProxy | undefined, others: PDFDocumentProxy[] = []): Promise<SetTypes | undefined> {
  const files = [...(doc ? [doc] : []), ...others.filter((d) => d !== doc)];
  const parts = (await Promise.all(files.map((d) => setTypesOf(d).catch(() => undefined)))).filter((x): x is SetTypes => !!x);
  if (!parts.length) return undefined;
  if (parts.length === 1) return parts[0];
  // This file's kinds win: another building's code may be another kind of wall.
  const merged = mergeSetTypes(parts);
  return { ...merged, kinds: Object.assign({}, ...[...parts].reverse().map((q) => q.kinds)) };
}

/** Reads the walls of a plan with a scale, by tagged type. `others`: the project's other drawing files. */
export async function readWalls(
  page: PDFPageProxy,
  doc: PDFDocumentProxy | undefined,
  sheet: Sheet,
  opts: { maxOpening: number; throughDoors: boolean; stopAt: string[]; known: { codes: string[]; exterior: string[] }; others?: PDFDocumentProxy[] },
): Promise<WallRead> {
  const setTypes = await projectSetTypes(doc, opts.others);
  const known: KnownWalls = { ...opts.known, set: setTypes };
  const result = await sheetWallTakeoff(page, sheet, opts.maxOpening, opts.throughDoors, opts.stopAt, known);
  return { result, lines: runsToLines(result.runs), setTypes };
}

/**
 * The type each wall code goes to to start with: the project's type of that code (this drawing
 * file's first: two buildings can share a code), else a new type, except codes that are none
 * of the project's or set's wall types (a door tag whose leader touches a wall): not added.
 */
export function wallChoiceFor(code: string, sheet: Sheet, types: TakeoffType[], known: { codes: string[] }, setTypes?: SetTypes): string {
  const linear = types.filter((t) => t.kind === 'linear');
  const hit =
    linear.find((t) => codeOf(t.name) === code && t.fromDoc === sheet.docId) ?? linear.find((t) => codeOf(t.name) === code && !t.fromDoc) ?? linear.find((t) => codeOf(t.name) === code);
  if (hit) return hit.id;
  const unknown = known.codes.length > 0 && !known.codes.includes(code) && !setTypes?.wall.includes(code);
  return unknown ? SKIP : NEW_TYPE;
}

/**
 * The wall lines as takeoffs: each code to the type chosen for it (new types built from the
 * legend's assembly when it has one), with whether each partition type stops at doors.
 */
export function wallTakeoffOf(
  lines: TypeLines[],
  opts: {
    choice: (code: string) => string;
    sheet: Sheet;
    types: TakeoffType[];
    units: Units;
    fromLegend: Map<string, ExtractedAssembly>;
    exterior: string[];
    setTypes?: SetTypes;
    stopAt: Set<string>;
    palette?: string[];
  },
): { types: TakeoffType[]; measurements: Measurement[]; stopsAtDoors: Map<string, boolean> } {
  const palette = opts.palette ?? PALETTE;
  const newTypes: TakeoffType[] = [];
  const measurements: Measurement[] = [];
  const stopsAtDoors = new Map<string, boolean>();
  for (const l of lines) {
    const c = opts.choice(l.code);
    if (c === SKIP) continue;
    let typeId = c;
    if (c === NEW_TYPE) {
      const a = opts.fromLegend.get(l.code);
      const index = opts.types.length + newTypes.length;
      const height = opts.units === 'metric' ? 3 : 10;
      const t: TakeoffType = a
        ? buildTakeoffType(a, opts.units, index, height)
        : { id: newId(), name: l.code, color: palette[index % palette.length], kind: 'linear', height, items: [] };
      newTypes.push(t);
      typeId = t.id;
    }
    if (tagKind(l.code, opts.exterior, opts.setTypes?.kinds) === 'partition') stopsAtDoors.set(typeId, opts.stopAt.has(l.code));
    for (const points of l.lines) {
      measurements.push({ id: newId(), sheetId: opts.sheet.id, typeId, points: points.map((p) => [...p] as Pt), holes: [], source: 'walls' });
    }
  }
  return { types: newTypes, measurements, stopsAtDoors };
}

/** Adds a wall takeoff to the project, replacing the sheet's earlier one if asked, and records which types stop at doors. */
export const applyWalls =
  (sheetId: string, r: { types: TakeoffType[]; measurements: Measurement[]; replaceEarlier: boolean; stopsAtDoors: Map<string, boolean> }) =>
  (p: Project): Project => ({
    ...p,
    types: [...p.types, ...r.types].map((t) =>
      r.stopsAtDoors.has(t.id) && (t.stopsAtDoors ?? false) !== r.stopsAtDoors.get(t.id) ? { ...t, stopsAtDoors: r.stopsAtDoors.get(t.id) } : t,
    ),
    measurements: [...p.measurements.filter((m) => !(r.replaceEarlier && m.sheetId === sheetId && m.source === 'walls')), ...r.measurements],
  });

/** Wall takeoff on one plan as the dialog starts (through doors, every wall code to its default type), replacing an earlier run. */
export async function automateWalls(
  p: Project,
  page: PDFPageProxy,
  doc: PDFDocumentProxy | undefined,
  sheet: Sheet,
  maxOpening: number,
  others: PDFDocumentProxy[] = [],
  /** Codes already taken off on the overall plans: an enlarged plan of the same walls adds only the others. */
  skip?: Set<string>,
): Promise<Automation & { read?: WallRead }> {
  if (!sheet.metersPerPoint) return { message: 'Set the sheet scale first.' };
  const legend = wallLegendFor(p, sheet);
  const fromLegend = wallsFromLegend(legend);
  const known = knownWallsOf(fromLegend, p.types);
  const stopAt = stopsAtDoorsOf(legend, p.types);
  const read = await readWalls(page, doc, sheet, { maxOpening, throughDoors: true, stopAt: [...stopAt], known, others });
  if (!read.lines.length) return { message: 'No tagged walls found.', read };
  const choice = new Map(read.lines.map((l) => [l.code, skip?.has(l.code) ? SKIP : wallChoiceFor(l.code, sheet, p.types, known, read.setTypes)]));
  const made = wallTakeoffOf(read.lines, { choice: (c) => choice.get(c) ?? SKIP, sheet, types: p.types, units: p.units, fromLegend, exterior: known.exterior, setTypes: read.setTypes, stopAt });
  const codes = read.lines.filter((l) => choice.get(l.code) !== SKIP).map((l) => l.code);
  return { message: `${codes.length} wall types: ${codes.join(', ')}`, read, apply: applyWalls(sheet.id, { ...made, replaceEarlier: true }) };
}
