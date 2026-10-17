import type { Project, Units } from '../src/model';
import { contributions } from '../src/quantities';

/** Takeoff categories, as the answer keys use them. */
export type Category = 'wall' | 'ceiling' | 'floor' | 'base' | 'wall_finish' | 'door' | 'window' | 'room' | 'symbol' | 'other';
export const CATEGORIES: Category[] = ['wall', 'ceiling', 'floor', 'base', 'wall_finish', 'door', 'window', 'room', 'symbol', 'other'];

/** Units of quantities, as the answer keys write them. */
export type BenchUnit = 'LF' | 'SF' | 'EA' | 'm' | 'm2';

/** One takeoff the tools produced. */
export interface ResultItem {
  category: Category;
  code: string | null;
  name: string;
  qty: number;
  unit: BenchUnit;
  /** Sheet numbers it was measured on. */
  sheets: string[];
  /** The automation that made it. */
  tool: string;
}

const unitFor = (dim: 'L' | 'A' | 'N', units: Units): BenchUnit => (dim === 'N' ? 'EA' : units === 'metric' ? (dim === 'L' ? 'm' : 'm2') : dim === 'L' ? 'LF' : 'SF');

/** A type name's code, when its first part reads as one ("p1 – Partition", "CPT-1 – Floor finish"). */
export function codeOfName(name: string): string | null {
  const head = name.split(' – ')[0].trim();
  return /^[A-Za-z]{0,4}[-.]?[A-Za-z]{0,3}\d{1,4}[A-Za-z]?(?:[-.]\d{1,3}[A-Za-z]?)?$/.test(head) && /\d/.test(head) ? head : null;
}

/** "101a / 101b Office / Corridor" → the room numbers and the name. */
export function splitRoomLabel(label: string): { code: string | null; name: string } {
  const m = /^(\S+(?:\s\/\s\S+)*)(?:\s+(.*))?$/.exec(label.trim());
  return m ? { code: m[1], name: m[2] ?? '' } : { code: null, name: label };
}

/**
 * The takeoffs in the project, as items to score: one per takeoff type (per finish role for room
 * finishes), and one per room for Rooms. Quantities in project units, as the app totals them
 * (`contributions`, the same numbers its quantities panel and Excel export show). `toolOfType`:
 * which automation made each type.
 */
export function resultItems(p: Project, toolOfType: Map<string, string>): ResultItem[] {
  const sheetName = new Map(p.sheets.map((s) => [s.id, s.name]));
  const groups = new Map<string, ResultItem & { set: Set<string> }>();
  const add = (key: string, item: Omit<ResultItem, 'sheets'>, sheetId: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ...item, qty: 0, sheets: [], set: new Set() }));
    g.qty += item.qty;
    g.set.add(sheetName.get(sheetId) ?? sheetId);
  };
  for (const c of contributions(p)) {
    if (!c.vars) continue;
    const t = c.type;
    const tool = c.role ? 'finishes' : (toolOfType.get(t.id) ?? c.m.source ?? 'manual');
    // Wall types and finish types are named by their code ("px7", "LVT – Floor finish").
    const code = c.role || tool === 'walls' ? t.name.split(' – ')[0].trim() : codeOfName(t.name);
    if (c.role) {
      const category: Category = c.role === 'walls' ? 'wall_finish' : c.role;
      const dim = c.role === 'base' ? 'L' : 'A';
      add(`fin|${c.role}|${t.id}`, { category, code, name: t.name, qty: dim === 'L' ? c.vars.L : c.vars.A, unit: unitFor(dim, p.units), tool }, c.sheet.id);
      continue;
    }
    if (c.m.source === 'rooms') {
      const r = splitRoomLabel(c.m.label ?? '');
      add(`room|${c.m.id}`, { category: 'room', code: r.code, name: r.name || (c.m.label ?? ''), qty: c.vars.A, unit: unitFor('A', p.units), tool }, c.sheet.id);
      continue;
    }
    const dim = t.kind === 'count' ? 'N' : t.kind === 'linear' ? (t.headline === 'area' ? 'A' : 'L') : 'A';
    const qty = dim === 'N' ? c.vars.N : dim === 'L' ? c.vars.L : c.vars.A;
    let category: Category = 'other';
    if (tool === 'walls') category = 'wall';
    // Opening tags lettered W (W144) are windows.
    else if (tool === 'doors') category = /^W – /.test(t.name) ? 'window' : 'door';
    else if (tool === 'symbols') category = /\bwindow\b/i.test(t.name) ? 'window' : /\bdoor\b/i.test(t.name) ? 'door' : 'symbol';
    else if (tool === 'ceilings') category = /demolish/i.test(t.name) ? 'other' : 'ceiling';
    else if (tool === 'sprinklers') category = t.kind === 'count' && /head/i.test(t.name) ? 'symbol' : 'other';
    add(`type|${t.id}`, { category, code, name: t.name, qty, unit: unitFor(dim, p.units), tool }, c.sheet.id);
  }
  return [...groups.values()].map(({ set, ...g }) => ({ ...g, qty: +g.qty.toFixed(3), sheets: [...set].sort() }));
}
