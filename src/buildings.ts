import type { Doc, Project, Sheet } from './model';
import { typeTotals, type TypeTotals } from './quantities';

/**
 * The building a drawing set is for, read from its file name: "VB07_Compiled_Drawings" is
 * VB07, "Building B - Arch" is Building B. Otherwise the file name itself.
 */
export function guessBuilding(name: string): string {
  const stem = name.replace(/\.pdf$/i, '').trim();
  const words = stem.replace(/[_]+/g, ' ');
  const named = words.match(/\b(?:building|bldg|block|tower|phase|wing|pavilion)\.?\s*[-#]?\s*[A-Z0-9]{1,4}\b/i);
  if (named) return named[0].replace(/\s+/g, ' ').replace(/^bldg\.?/i, 'Building');
  // A building code: VB07, B12, T2 — letters and a number, standing on its own.
  const code = words.split(/[\s\-–,()]+/).find((w) => /^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(w));
  return code ?? stem;
}

/** A drawing set's building: as set by the estimator, or read from its name. */
export const buildingOfDoc = (doc: Doc | undefined): string => (doc ? doc.building?.trim() || guessBuilding(doc.name) : 'Unassigned');

/** The building a sheet belongs to. */
export function buildingOf(project: Project, sheet: Sheet): string {
  return sheet.building?.trim() || buildingOfDoc(project.docs.find((d) => d.id === sheet.docId));
}

/** Every building in the project, in drawing order. */
export function buildingsOf(project: Project): string[] {
  return [...new Set(project.sheets.map((s) => buildingOf(project, s)))];
}

/** The project with only the takeoffs on one building's sheets. */
export function onBuilding(project: Project, building: string): Project {
  const sheets = new Set(project.sheets.filter((s) => buildingOf(project, s) === building).map((s) => s.id));
  return { ...project, measurements: project.measurements.filter((m) => sheets.has(m.sheetId)) };
}

export type QtyGrouping = 'type' | 'building' | 'division' | 'building-division';

/** Quantities in sections: per building, per division, or both (building, then division within it). */
export interface QtySection {
  title: string;
  totals?: TypeTotals[];
  sections?: QtySection[];
}

const divisionOf = (t: TypeTotals) => t.type.division?.trim() || 'No division';
const byDivision = (totals: TypeTotals[]): QtySection[] => {
  const used = totals.filter((t) => t.vars.N > 0 || t.unscaled > 0);
  const names = [...new Set(used.map(divisionOf))].sort((a, b) => (a === 'No division' ? 1 : b === 'No division' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  return names.map((title) => ({ title, totals: used.filter((t) => divisionOf(t) === title) }));
};

export function quantitySections(project: Project, grouping: QtyGrouping): QtySection[] {
  if (grouping === 'type') return [{ title: '', totals: typeTotals(project) }];
  if (grouping === 'division') return byDivision(typeTotals(project));
  return buildingsOf(project)
    .map((b) => {
      const totals = typeTotals(onBuilding(project, b));
      return grouping === 'building' ? { title: b, totals } : { title: b, sections: byDivision(totals) };
    })
    .filter((s) => (s.totals ?? s.sections!.flatMap((x) => x.totals ?? [])).some((t) => t.vars.N > 0 || t.unscaled > 0));
}
