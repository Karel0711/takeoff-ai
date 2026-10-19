import { mentionsSprinklers, readSprinklerSheet, runsOf, sizeValue, type FittingKind, type HeadGroup, type HeadName, type HeadShape } from '../fill/sprinkler';
import { polylineLength } from '../geometry';
import { newId, type Project, type Sheet, type TakeoffType } from '../model';
import { titleBlockBox } from '../titleBlock';
import { formatQty, lengthUnit, toLength } from '../units';
import type { Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';

/** A sprinkler plan, by its sheet number and title. */
export const isSprinklerPlan = (x: Sheet) => {
  const t = `${x.name} ${x.title ?? ''}`;
  return /SPRINKLER|FIRE SUPPRESSION|FIRE PROTECTION/i.test(t) && !/DETAIL|RISER|NOTES|SCHEDULE|DIAGRAM|LEGEND/i.test(t);
};

/**
 * Fire sprinklers, with nothing marked: on every sprinkler plan, the heads are found and
 * counted by kind, the pipe is found, measured and sized from its labels, and its tees,
 * crosses, elbows and capped ends are counted. Each head carries its drop or sprig, each pipe
 * size its lengths, joints and hangers, so the quantities are the bill of materials.
 * A re-run replaces what the last run made. With no sprinkler plan, `current` is read.
 */
export async function automateSprinklers(p: Project, access: SetAccess, current: Sheet | null): Promise<Automation> {
  const metric = p.units === 'metric';
  const plans = p.sheets.filter((x) => !x.superseded && isSprinklerPlan(x));
  // With no sprinkler plan, the open sheet, read only for heads it shows.
  const targets = plans.length ? plans : current ? [current] : [];
  if (!targets.length) return { message: 'No sprinkler plans found.' };
  type Read = { sheet: Sheet; read: NonNullable<ReturnType<typeof readSprinklerSheet>> };
  const reads: Read[] = [];
  for (const [i, x] of targets.entries()) {
    access.progress?.(`Sprinklers: reading ${x.name} (${i + 1} of ${targets.length})…`);
    await pause();
    await perSheet(access, x, async () => {
      const segs = await access.segments(x);
      if (!segs) return;
      const texts = await access.texts(x);
      // A sheet not titled a sprinkler plan shows sprinklers only when it says so somewhere.
      if (!plans.length && !mentionsSprinklers(texts)) return;
      const block = titleBlockBox(texts, x.width, x.height);
      const read = readSprinklerSheet(segs, texts, x, block ? [block] : [], { plan: plans.length > 0 });
      // Pipe is measured only at a scale; heads are counted either way.
      if (read && !x.metersPerPoint) read.network = null;
      if (read) reads.push({ sheet: x, read });
    });
  }
  if (!reads.length) return { message: plans.length ? 'No sprinkler heads found on the sprinkler plans.' : 'No sprinklers found.' };
  const unscaledPipe = reads.filter((r) => !r.sheet.metersPerPoint).length;

  // Types, found by name so a re-run fills the same ones.
  const len = metric ? 'm' : 'ft';
  const sizeName = (size: string | null) => (size ? (size.endsWith('"') ? size : `${size} mm`) : 'unsized');
  const types: TakeoffType[] = [...p.types];
  const made: TakeoffType[] = [];
  let groupId = (p.groups ?? []).find((g) => g.name === 'Fire sprinklers')?.id;
  const newGroup = groupId ? null : { id: newId(), name: 'Fire sprinklers' };
  groupId ??= newGroup!.id;
  const typeFor = (name: string, kind: TakeoffType['kind'], items: { name: string; unit: string; formula: string }[]) => {
    const found = types.find((t) => t.name === name && t.kind === kind);
    if (found) return found.id;
    const t: TakeoffType = {
      id: newId(),
      name,
      color: PALETTE[types.length % PALETTE.length],
      kind,
      height: 0,
      // The estimator's workbook prices fire suppression in its mechanical tab.
      division: '20-25 Mechanical',
      package: 'Fire protection',
      groupId,
      items: items.map((it) => ({ id: newId(), ...it })),
    };
    types.push(t);
    made.push(t);
    return t.id;
  };
  const drop = metric ? { size: '25 mm', each: 0.6, sprig: 0.15 } : { size: '1"', each: 2, sprig: 0.5 };
  const HEADS: Record<HeadShape, { name: string; drop: boolean }> = {
    triangle: { name: 'Sprinkler head – sidewall (▲)', drop: true },
    'circle with dot': { name: 'Sprinkler head – pendent (◉)', drop: true },
    'open circle': { name: 'Sprinkler head – upright (○)', drop: false },
    'circle with slash': { name: 'Sprinkler head – ⊘ (see legend)', drop: true },
    other: { name: 'Sprinkler head – other', drop: true },
  };
  // Named by its note or legend line when one names it; by its drawing otherwise.
  const NAMED: Record<HeadName, HeadShape> = { upright: 'open circle', pendent: 'circle with dot', sidewall: 'triangle', concealed: 'circle with dot' };
  const headType = (g: HeadGroup) => {
    const tidy = (l: string) => l.replace(/\s*\((typ|typical)\.?\)\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const h = g.named
      ? g.named === 'concealed'
        ? { name: 'Sprinkler head – concealed', drop: true }
        : HEADS[NAMED[g.named]]
      : g.label
        ? { name: `Sprinkler head – ${tidy(g.label)}`, drop: true }
        : HEADS[g.shape];
    return typeFor(h.name, 'count', [
      { name: h.name.replace('Sprinkler head – ', 'Head, '), unit: 'ea', formula: 'N' },
      h.drop
        ? { name: `${drop.size} drop, ${drop.each} ${len} each`, unit: len, formula: `N * ${drop.each}` }
        : { name: `${drop.size} sprig, ${drop.sprig} ${len} each`, unit: len, formula: `N * ${drop.sprig}` },
      { name: 'Outlet fitting (reducer / tee)', unit: 'ea', formula: 'N' },
      ...(h.drop ? [{ name: 'Escutcheon', unit: 'ea', formula: 'N' }] : []),
    ]);
  };
  const pipeType = (size: string | null) => {
    const small = size ? sizeValue(size) <= 32 : true;
    const stick = metric ? 6.4 : 21;
    const hanger = metric ? (small ? 3.7 : 4.6) : small ? 12 : 15;
    return typeFor(`Sprinkler pipe ${sizeName(size)}`, 'linear', [
      { name: `Pipe ${sizeName(size)}`, unit: len, formula: 'L' },
      { name: `Pipe lengths (${stick} ${len})`, unit: 'ea', formula: `ceil(L / ${stick})` },
      { name: 'Joints / couplings', unit: 'ea', formula: `ceil(L / ${stick})` },
      { name: `Hangers (every ${hanger} ${len})`, unit: 'ea', formula: `ceil(L / ${hanger})` },
    ]);
  };
  const FITTING: Record<FittingKind, string> = { tee: 'Tee', cross: 'Cross', elbow: 'Elbow', cap: 'Cap / plugged end' };
  const fittingType = (kind: FittingKind, size: string | null) => {
    const name = `${FITTING[kind]} ${sizeName(size)}`;
    return typeFor(name, 'count', [{ name, unit: 'ea', formula: 'N' }]);
  };

  const added: Project['measurements'] = [];
  let heads = 0;
  let metres = 0;
  for (const { sheet: x, read } of reads) {
    for (const g of read.heads) for (const at of g.at) added.push({ id: newId(), sheetId: x.id, typeId: headType(g), points: [at], holes: [], source: 'sprinklers' });
    for (const r of runsOf(read.network?.pieces ?? [])) added.push({ id: newId(), sheetId: x.id, typeId: pipeType(r.size), points: r.points, holes: [], source: 'sprinklers' });
    for (const f of read.network?.fittings ?? []) added.push({ id: newId(), sheetId: x.id, typeId: fittingType(f.kind, f.size), points: [f.at], holes: [], source: 'sprinklers' });
    heads += read.heads.reduce((n, g) => n + g.at.length, 0);
    if (read.network) metres += read.network.pieces.reduce((n, q) => n + polylineLength([q.a, q.b]), 0) * x.metersPerPoint!;
  }
  const sheets = new Set(reads.map((r) => r.sheet.id));
  const piped = reads.some((r) => r.read.network?.pieces.length);
  const where = `Sprinklers on ${reads.length} sheet${reads.length === 1 ? '' : 's'}`;
  const noScale = unscaledPipe ? ` · ${unscaledPipe} sheet${unscaledPipe === 1 ? '' : 's'} without a scale: heads only, set the scale to measure pipe` : '';
  return {
    message: piped
      ? `${where}: ${heads} heads, ${formatQty(toLength(metres, p.units))} ${lengthUnit(p.units)} of pipe by size, fittings and drops${noScale}`
      : `${where}: ${heads} heads. No pipe is drawn on them, so none was taken off${noScale}`,
    apply: (q) => ({
      ...q,
      groups: newGroup ? [...(q.groups ?? []), newGroup] : q.groups,
      types: [...q.types, ...made],
      measurements: [...q.measurements.filter((m) => !(m.source === 'sprinklers' && sheets.has(m.sheetId))), ...added],
    }),
  };
}
