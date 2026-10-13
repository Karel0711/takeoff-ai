import { evaluate } from './formula';
import { polylineLength, ringArea, ringLength } from './geometry';
import { FINISH_ROLES, type FinishRole, type Measurement, type Project, type Sheet, type TakeoffType, type Units } from './model';
import { areaUnit, lengthUnit, toArea, toLength } from './units';

/** Formula variables in project units. */
export interface Vars {
  /** Length (linear types). */
  L: number;
  /** Type height. */
  H: number;
  /** Area: measured area for area types, L × H for linear types. */
  A: number;
  /** Perimeter (area types). */
  P: number;
  /** Number of measurements (runs, rooms or counted items). */
  N: number;
}

/** Quantities of one measurement, or null when its sheet has no scale yet. */
export function measurementVars(m: Measurement, type: TakeoffType, sheet: Sheet, units: Units): Vars | null {
  const H = type.height;
  if (type.kind === 'count') return { L: 0, H, A: 0, P: 0, N: 1 };
  const mpp = sheet.metersPerPoint;
  if (mpp === null) return null;
  if (type.kind === 'linear') {
    const L = toLength(polylineLength(m.points) * mpp, units);
    return { L, H, A: L * H, P: 0, N: 1 };
  }
  const areaPts = ringArea(m.points) - m.holes.reduce((sum, h) => sum + ringArea(h), 0);
  const perimPts = ringLength(m.points) + m.holes.reduce((sum, h) => sum + ringLength(h), 0);
  return {
    L: 0,
    H,
    A: toArea(Math.max(0, areaPts) * mpp * mpp, units),
    P: toLength(perimPts * mpp, units),
    N: 1,
  };
}

/**
 * What a room counts toward a finish type: an area type takes the room's area (and
 * perimeter), a linear type its perimeter as length, so A = perimeter × the type's height.
 */
export function finishVars(room: Measurement, type: TakeoffType, sheet: Sheet, units: Units): Vars | null {
  if (type.kind === 'count') return { L: 0, H: type.height, A: 0, P: 0, N: 1 };
  if (type.kind === 'area') return measurementVars(room, type, sheet, units);
  const mpp = sheet.metersPerPoint;
  if (mpp === null) return null;
  const L = toLength((ringLength(room.points) + room.holes.reduce((sum, h) => sum + ringLength(h), 0)) * mpp, units);
  return { L, H: type.height, A: L * type.height, P: 0, N: 1 };
}

/** One measurement's share of one type: drawn as that type, or a room finished with it. */
export interface Contribution {
  m: Measurement;
  type: TakeoffType;
  sheet: Sheet;
  /** Null when the sheet has no scale. */
  vars: Vars | null;
  /** Set when the share comes from a room's finishes. */
  role?: FinishRole;
}

/** Every measurement's share of every type, in measurement order. */
export function contributions(project: Project): Contribution[] {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const types = new Map(project.types.map((t) => [t.id, t]));
  const out: Contribution[] = [];
  for (const m of project.measurements) {
    const sheet = sheets.get(m.sheetId);
    if (!sheet) continue;
    const type = types.get(m.typeId);
    if (type) out.push({ m, type, sheet, vars: measurementVars(m, type, sheet, project.units) });
    if (!m.finishes) continue;
    for (const { role } of FINISH_ROLES) {
      const t = m.finishes[role] ? types.get(m.finishes[role]!) : undefined;
      if (t) out.push({ m, type: t, sheet, vars: finishVars(m, t, sheet, project.units), role });
    }
  }
  return out;
}

/** The headline quantity for a type kind: area, length or count. */
export function primaryOf(kind: TakeoffType['kind'], vars: Vars): number {
  return kind === 'area' ? vars.A : kind === 'linear' ? vars.L : vars.N;
}

export function primaryUnit(kind: TakeoffType['kind'], units: Units): string {
  return kind === 'area' ? areaUnit(units) : kind === 'linear' ? lengthUnit(units) : 'ea';
}

export interface ItemResult {
  name: string;
  unit: string;
  formula: string;
  value: number | null;
  error: string | null;
}

export interface TypeTotals {
  type: TakeoffType;
  vars: Vars;
  primary: number;
  unit: string;
  /** Measurements left out because their sheet has no scale. */
  unscaled: number;
  items: ItemResult[];
}

export function typeTotals(project: Project): TypeTotals[] {
  const byType = new Map<string, Contribution[]>();
  for (const c of contributions(project)) byType.set(c.type.id, [...(byType.get(c.type.id) ?? []), c]);
  return project.types.map((type) => {
    const vars: Vars = { L: 0, H: type.height, A: 0, P: 0, N: 0 };
    let unscaled = 0;
    for (const { vars: v } of byType.get(type.id) ?? []) {
      if (!v) {
        unscaled++;
        continue;
      }
      vars.L += v.L;
      vars.A += v.A;
      vars.P += v.P;
      vars.N += v.N;
    }
    const items = type.items.map((it): ItemResult => {
      const r = evaluate(it.formula, { ...vars });
      return r.ok
        ? { name: it.name, unit: it.unit, formula: it.formula, value: r.value, error: null }
        : { name: it.name, unit: it.unit, formula: it.formula, value: null, error: r.error };
    });
    return {
      type,
      vars,
      primary: primaryOf(type.kind, vars),
      unit: primaryUnit(type.kind, project.units),
      unscaled,
      items,
    };
  });
}
