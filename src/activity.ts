import { newId, type Measurement, type Project, type Sheet, type TakeoffType } from './model';
import { measurementVars, primaryOf, primaryUnit } from './quantities';
import { formatQty } from './units';

/** One change to the project, kept in the activity log. */
export interface ActivityEvent {
  id: string;
  /** ISO time. */
  at: string;
  /** Changes made together (one wall takeoff, one undo) share a batch. */
  batch: string;
  /** What made the change, e.g. "Measure", "Fill room", "Wall takeoff", "Undo". */
  source: string;
  action: 'created' | 'updated' | 'deleted';
  what: 'takeoff' | 'type' | 'sheet' | 'drawings';
  /** The takeoff type's name, the sheet's name or the file name. */
  name: string;
  sheet?: string;
  /** Quantity or what changed, e.g. "12.4 m" or "scale 1:100". */
  detail?: string;
}

const codeOf = (name: string) => name.split(' – ')[0].trim();

function quantity(m: Measurement, type: TakeoffType | undefined, sheet: Sheet | undefined, project: Project): string | undefined {
  if (!type || !sheet) return undefined;
  const v = measurementVars(m, type, sheet, project.units);
  return v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, project.units)}` : 'no scale';
}

/** Everything that changed between two versions of a project, as activity events. */
export function diffProjects(prev: Project, next: Project, source: string, at = new Date()): ActivityEvent[] {
  const batch = newId();
  const out: ActivityEvent[] = [];
  const event = (e: Omit<ActivityEvent, 'id' | 'at' | 'batch' | 'source'>) =>
    out.push({ id: newId(), at: at.toISOString(), batch, source, ...e });

  const typesBefore = new Map(prev.types.map((t) => [t.id, t]));
  const typesAfter = new Map(next.types.map((t) => [t.id, t]));
  const sheetsBefore = new Map(prev.sheets.map((s) => [s.id, s]));
  const sheetsAfter = new Map(next.sheets.map((s) => [s.id, s]));

  if (prev.measurements !== next.measurements) {
    const before = new Map(prev.measurements.map((m) => [m.id, m]));
    const after = new Map(next.measurements.map((m) => [m.id, m]));
    for (const m of next.measurements) {
      const old = before.get(m.id);
      if (old === m) continue;
      const type = typesAfter.get(m.typeId);
      const sheet = sheetsAfter.get(m.sheetId);
      const detail = [m.label, quantity(m, type, sheet, next)].filter(Boolean).join(' · ');
      if (!old) event({ action: 'created', what: 'takeoff', name: codeOf(type?.name ?? 'Takeoff'), sheet: sheet?.name, detail });
      else {
        const moved = old.typeId !== m.typeId ? ` (was ${codeOf(typesBefore.get(old.typeId)?.name ?? '?')})` : '';
        event({ action: 'updated', what: 'takeoff', name: codeOf(type?.name ?? 'Takeoff'), sheet: sheet?.name, detail: `${detail ?? ''}${moved}` });
      }
    }
    for (const m of prev.measurements) {
      if (after.has(m.id)) continue;
      const type = typesBefore.get(m.typeId);
      const sheet = sheetsBefore.get(m.sheetId);
      event({ action: 'deleted', what: 'takeoff', name: codeOf(type?.name ?? 'Takeoff'), sheet: sheet?.name, detail: [m.label, quantity(m, type, sheet, prev)].filter(Boolean).join(' · ') });
    }
  }

  if (prev.types !== next.types) {
    for (const t of next.types) {
      const old = typesBefore.get(t.id);
      if (old === t) continue;
      if (!old) event({ action: 'created', what: 'type', name: t.name });
      else event({ action: 'updated', what: 'type', name: t.name, detail: old.name !== t.name ? `renamed from ${old.name}` : undefined });
    }
    for (const t of prev.types) if (!typesAfter.has(t.id)) event({ action: 'deleted', what: 'type', name: t.name });
  }

  if (prev.docs !== next.docs) {
    for (const d of next.docs) {
      if (prev.docs.some((x) => x.id === d.id)) continue;
      const count = next.sheets.filter((s) => s.docId === d.id).length;
      event({ action: 'created', what: 'drawings', name: d.name, detail: `${count} sheet${count === 1 ? '' : 's'}` });
    }
    for (const d of prev.docs) if (!next.docs.some((x) => x.id === d.id)) event({ action: 'deleted', what: 'drawings', name: d.name });
  }

  if (prev.sheets !== next.sheets) {
    for (const s of next.sheets) {
      const old = sheetsBefore.get(s.id);
      if (!old || old === s) continue;
      if (old.scaleLabel !== s.scaleLabel || old.metersPerPoint !== s.metersPerPoint) {
        event({ action: 'updated', what: 'sheet', name: s.name, detail: s.scaleLabel ? `scale ${s.scaleLabel}` : 'scale cleared' });
      } else if (old.name !== s.name) {
        event({ action: 'updated', what: 'sheet', name: s.name, detail: `renamed from ${old.name}` });
      }
    }
  }
  return out;
}

/** Events grouped by batch, newest first, for display. */
export function groupActivity(events: ActivityEvent[]): ActivityEvent[][] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const g = groups.get(e.batch);
    if (g) g.push(e);
    else groups.set(e.batch, [e]);
  }
  return [...groups.values()].sort((a, b) => b[0].at.localeCompare(a[0].at));
}

/** One line describing a group of events, e.g. "Added 31 takeoffs on A2.1". */
export function describeGroup(g: ActivityEvent[]): string {
  if (g.length === 1) {
    const e = g[0];
    const verb = e.action === 'created' ? 'Added' : e.action === 'deleted' ? 'Deleted' : 'Changed';
    const noun = e.what === 'takeoff' ? `${e.name} takeoff` : e.what === 'type' ? `type ${e.name}` : e.what === 'sheet' ? `sheet ${e.name}` : `drawings ${e.name}`;
    return `${verb} ${noun}`;
  }
  const counts = (action: ActivityEvent['action'], what: ActivityEvent['what']) => g.filter((e) => e.action === action && e.what === what).length;
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  for (const [action, verb] of [
    ['created', 'added'],
    ['updated', 'changed'],
    ['deleted', 'deleted'],
  ] as const) {
    const t = counts(action, 'takeoff');
    const y = counts(action, 'type');
    const s = counts(action, 'sheet');
    const d = counts(action, 'drawings');
    const items = [t && plural(t, 'takeoff'), y && plural(y, 'type'), s && plural(s, 'sheet'), d && plural(d, 'drawing set')].filter(Boolean);
    if (items.length) parts.push(`${verb} ${items.join(', ')}`);
  }
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
