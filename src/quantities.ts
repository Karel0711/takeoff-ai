import { evaluate } from './formula';
import { polylineLength, ringArea, ringLength } from './geometry';
import type { Measurement, Project, Sheet, TakeoffType, Units } from './model';
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
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  return project.types.map((type) => {
    const vars: Vars = { L: 0, H: type.height, A: 0, P: 0, N: 0 };
    let unscaled = 0;
    for (const m of project.measurements) {
      if (m.typeId !== type.id) continue;
      const sheet = sheets.get(m.sheetId);
      if (!sheet) continue;
      const v = measurementVars(m, type, sheet, project.units);
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
