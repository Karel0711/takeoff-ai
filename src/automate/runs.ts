import { chainRuns, ductSizes, pairParallels, sizeRuns, withoutSymbols, type DuctSize } from '../fill/runs';
import type { Segment } from '../fill/vectors';
import { layerService, layerStatus, type LayerService, type LayerStatus } from '../layers';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import { tradeOfNumber } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { toLength } from '../units';
import type { Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';

/**
 * Automate › Ductwork & piping: the runs on the trade plans of a set drawn in CAD with its
 * layers kept (most engineers' sets are). Each layer is read for what it is by its name: a duct
 * layer's two lines a duct's width apart become the duct's centreline, sized by the label along
 * it (24x12, 10"ø); a pipe or conduit layer's lines are its runs, by service (domestic cold
 * water, sanitary, heating…). Work on a demolition layer is taken off as removals; existing work
 * to stay is left out. Sets without layers are left to the estimator (the message says so).
 */

export interface RunsResult extends Automation {
  /** Things to check, for the whole-set review. */
  checks: string[];
}

const SKIP_TITLE = /\b(DETAILS?|SCHEDULES?|DIAGRAMS?|RISER|SECTIONS?|ELEVATIONS?|LEGEND|NOTES)\b/;

/** Trade plans (mechanical, plumbing, electrical, fire protection) with a scale. */
export function isTradePlan(s: Sheet): boolean {
  if (s.superseded || !s.metersPerPoint) return false;
  const trade = tradeOfNumber(s.name ?? '');
  if (!trade || !/^(M|MD|MH|MP|ME|P|PD|PL|E|ED|EL|EP|FP|FA|F)$/.test(trade)) return false;
  const t = (s.title ?? '').toUpperCase();
  return !SKIP_TITLE.test(t) || /\bPLANS?\b/.test(t);
}

type Group = { svc: LayerService; status: LayerStatus; segs: Segment[] };

/** A sheet's own trade linework by what it is and whether it is new, to remove or existing. */
export function tradeGroups(segs: Segment[], names: Map<string, string>, box: [number, number, number, number] | null): Group[] {
  const groups = new Map<string, Group>();
  const inBox = (s: Segment) => !!box && Math.min(s.x1, s.x2) >= box[0] && Math.max(s.x1, s.x2) <= box[2] && Math.min(s.y1, s.y2) >= box[1] && Math.max(s.y1, s.y2) <= box[3];
  for (const s of segs) {
    if (!s.layer) continue;
    const name = names.get(s.layer);
    // The sheet's own layers: one that came in with another drawing (the existing-conditions
    // drawing under a new-work plan, the architect's plan) is shown there, not taken off there.
    if (!name || name.includes('|')) continue;
    const svc = layerService(name);
    if (!svc || svc.kind === 'devices' || svc.kind === 'walls') continue;
    if (inBox(s)) continue;
    const status = layerStatus(name);
    const k = `${svc.key}|${status}`;
    const g = groups.get(k);
    if (g) g.segs.push(s);
    else groups.set(k, { svc, status, segs: [s] });
  }
  return [...groups.values()];
}

/** The type a run is taken off under: found by name, or made. */
function typeFor(p: Project, fresh: TakeoffType[], name: string, make: () => Omit<TakeoffType, 'id' | 'name' | 'color'>): string {
  const got = p.types.find((t) => t.name === name) ?? fresh.find((t) => t.name === name);
  if (got) return got.id;
  const t: TakeoffType = { id: newId(), name, color: PALETTE[(p.types.length + fresh.length) % PALETTE.length], ...make() };
  fresh.push(t);
  return t.id;
}

/** Widths of unlabelled ducts, grouped as an estimator would carry them: up to 8", 9-14", 15-24", 25-36", over 36". */
const BUCKETS_IN = [8, 14, 24, 36];
const BUCKETS_MM = [200, 350, 600, 900];
function bucketOf(width: number, metric: boolean): { name: string; mid: number } {
  const b = metric ? BUCKETS_MM : BUCKETS_IN;
  const u = metric ? ' mm' : '"';
  const i = b.findIndex((x) => width <= x + (metric ? 12 : 0.5));
  if (i === 0) return { name: `up to ${b[0]}${u}`, mid: b[0] * 0.75 };
  if (i < 0) return { name: `over ${b[b.length - 1]}${u}`, mid: b[b.length - 1] * 1.25 };
  return { name: `${b[i - 1] + (metric ? 0 : 1)}-${b[i]}${u}`, mid: (b[i - 1] + b[i]) / 2 };
}

const ductName = (s: DuctSize | null, width: number, metric: boolean) =>
  s ? (s.h === null ? `Duct ${s.w}${metric ? ' mm' : '"'} round` : `Duct ${s.w}x${s.h}`) : `Duct ${bucketOf(width, metric).name} wide, size not labelled`;

export async function automateRuns(p: Project, access: SetAccess): Promise<RunsResult> {
  const sheets = p.sheets.filter(isTradePlan);
  const checks: string[] = [];
  if (!sheets.length) return { message: 'No mechanical, plumbing or electrical plans with a scale.', checks };
  const metric = p.units === 'metric';
  const fresh: TakeoffType[] = [];
  const added: Measurement[] = [];
  const totals = new Map<string, number>();
  let layered = 0;
  for (const [i, s] of sheets.entries()) {
    access.progress?.(`Ductwork and piping… ${s.name} (${i + 1} of ${sheets.length})`);
    await pause();
    await perSheet(access, s, async () => {
      const names = (await access.layers?.(s)) ?? new Map<string, string>();
      if (!names.size) return;
      const segs = await access.segments(s);
      if (!segs) return;
      const texts = await access.texts(s);
      const groups = tradeGroups(segs, names, titleBlockBox(texts, s.width, s.height));
      if (!groups.length) return;
      layered++;
      const mpp = s.metersPerPoint!;
      const pt = (m: number) => m / mpp;
      const unit = metric ? pt(0.001) : pt(0.0254);
      const sizes = ductSizes(texts);
      for (const g of groups) {
        const remove = g.status === 'demo';
        if (g.status === 'exist') continue;
        const division = g.svc.division;
        if (g.svc.kind === 'duct') {
          // Duct sides 3" to 6' apart, stretches a foot or more.
          const lines = withoutSymbols(g.segs, pt(1.2));
          const runs = pairParallels(lines, pt(0.075), pt(1.85), pt(0.3));
          if (remove) {
            const id = typeFor(p, fresh, 'Remove: ductwork', () => ({ kind: 'linear', height: 0, division, items: [{ id: newId(), name: 'Remove ductwork', unit: metric ? 'm' : 'ft', formula: 'L' }] }));
            for (const r of runs) added.push(run(s, id, [r.a, r.b], 'Remove ductwork'));
            continue;
          }
          const sized = sizeRuns(runs, sizes, unit, metric);
          runs.forEach((r, k) => {
            const size = sized[k];
            const widthIn = r.width / unit;
            // An unlabelled stretch under 2 ft (0.6 m) is more likely a fitting or a box than a duct.
            if (!size && Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) < pt(0.6)) return;
            const name = ductName(size, widthIn, metric);
            const w = size ? size.w : bucketOf(widthIn, metric).mid;
            const h = size?.h ?? null;
            // Width and depth in the project's length unit, for the sheet metal formula.
            const toUnit = (n: number) => toLength(n * (metric ? 0.001 : 0.0254), p.units);
            const id = typeFor(p, fresh, name, () => ({
              kind: 'linear',
              height: 0,
              width: toUnit(w),
              ...(h !== null ? { depth: toUnit(h) } : {}),
              division,
              package: 'Mechanical sub',
              description: size ? `${size.text} duct, measured along its centreline on the plans.` : 'Ducts drawn without a size label near them, by their width on the plan. Sheet metal taken at the middle of the width range, square.',
              items:
                size && h === null
                  ? [{ id: newId(), name: 'Sheet metal (round, πD × L)', unit: metric ? 'm²' : 'SF', formula: 'L * 3.1416 * W' }]
                  : [{ id: newId(), name: h === null ? 'Sheet metal (est. square, 4W × L)' : 'Sheet metal (2(W + D) × L)', unit: metric ? 'm²' : 'SF', formula: h === null ? 'L * 4 * W' : 'L * 2 * (W + D)' }],
            }));
            added.push(run(s, id, [r.a, r.b], size?.text ?? `~${Math.round(widthIn)}${metric ? ' mm' : '"'}`));
          });
          continue;
        }
        // Pipes and conduit: runs of a foot (0.3 m) or more.
        // Symbols on the run's layer (valves, cleanouts, an extinguisher on a "Fire" layer) are not run.
        const chains = chainRuns(withoutSymbols(g.segs, pt(2)), pt(0.3));
        const name = remove ? `Remove: ${g.svc.label.toLowerCase()}` : g.svc.label;
        const id = typeFor(p, fresh, name, () => ({
          kind: 'linear',
          height: 0,
          division,
          ...(remove ? {} : { package: g.svc.trade === 'E' ? 'Electrical sub' : 'Mechanical sub' }),
          description: remove ? `${g.svc.label} on the demolition layers.` : `${g.svc.label}, measured along its runs on the plans (sizes per drawings).`,
          items: [{ id: newId(), name, unit: metric ? 'm' : 'ft', formula: 'L' }],
        }));
        for (const c of chains) added.push(run(s, id, c, g.svc.label));
        totals.set(name, (totals.get(name) ?? 0) + chains.length);
      }
    });
  }
  if (!layered) {
    checks.push('The mechanical and electrical drawings have no CAD layers, so ductwork and piping were not measured. Measure them by hand (Measure tool) or ask for the engineer\'s CAD-exported PDFs.');
    return { message: 'The trade drawings have no layers to read ductwork and piping from.', checks };
  }
  if (!added.length) return { message: 'No ductwork, piping or conduit on the trade plans.', checks };
  const unsized = added.filter((m) => /~/.test(m.label ?? '')).length;
  if (unsized) checks.push(`${unsized} duct stretch${unsized === 1 ? '' : 'es'} had no size label near them; their width was read off the plan. Check those sizes.`);
  checks.push('Ductwork and piping are measured along the runs on the plans: risers, drops and offsets up and down are not in the lengths. Fittings are not counted.');
  const typeIds = new Set([...fresh.map((t) => t.id), ...added.map((m) => m.typeId)]);
  return {
    message: `Measured ${added.length} runs on ${layered} trade plan${layered === 1 ? '' : 's'} as ${new Set(added.map((m) => m.typeId)).size} types`,
    checks,
    apply: (q) => ({ ...q, types: [...q.types, ...fresh], measurements: [...q.measurements.filter((m) => !(m.source === 'runs' && typeIds.has(m.typeId))), ...added] }),
  };
}

const run = (s: Sheet, typeId: string, points: Pt[], label: string): Measurement => ({ id: newId(), sheetId: s.id, typeId, points, holes: [], source: 'runs', label });
