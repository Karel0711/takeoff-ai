import { countSymbolsInSet, findLegends, legendSymbols, pickSymbol, type SetSheet, type SymbolTally } from '../fill/autoSymbols';
import { guessDivision } from '../divisionGuess';
import { newId, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import { checkScale } from '../scaleCheck';
import { titleBlockBox } from '../titleBlock';
import type { Automation } from './result';
import { pause, PALETTE, type SetAccess } from './set';

/** A symbol counted across the set, to add as a count type under `name`. */
export interface SymbolChoice {
  tally: SymbolTally;
  name: string;
}

/**
 * Count symbols, with nothing marked: every legend in the set is found and each line drawn with
 * a symbol counted on the sheets that legend is for (or, given a symbol clicked on `picked.sheet`,
 * that one on every sheet at its scale). The counts are returned for checking before anything
 * is added; `message` says why there are none.
 */
export async function symbolTallies(p: Project, access: SetAccess, picked?: { sheet: Sheet; at: Pt }): Promise<{ tallies: SymbolTally[]; message?: string }> {
  const set: (SetSheet & { sheet: Sheet })[] = p.sheets.filter((x) => !x.superseded).map((x) => ({ id: x.id, name: x.name, width: x.width, height: x.height, sheet: x }));
  const byId = new Map(set.map((x) => [x.id, x]));
  const segsOf = (x: SetSheet) => access.segments(byId.get(x.id)!.sheet);
  access.progress?.(picked ? 'Looking at this symbol…' : 'Finding legends…');
  await pause(30);
  let home: (typeof set)[number] | undefined;
  let symbol = null;
  if (picked) {
    home = byId.get(picked.sheet.id);
    const segs = home && (await segsOf(home));
    if (!home || !segs) return { tallies: [] };
    const texts = await access.texts(home.sheet);
    // Named after the legend line it matches, when this sheet has one.
    const block = titleBlockBox(texts, home.width, home.height);
    const legends = findLegends(texts, segs, home.width, home.height, block ? [block] : []).flatMap((l) => legendSymbols(l, texts, segs));
    symbol = pickSymbol(segs, texts, picked.at, legends, 60);
    if (!symbol) return { tallies: [], message: 'No symbol there. Click right on its linework.' };
  }
  const tallies = await countSymbolsInSet(
    set,
    {
      texts: (x) => access.texts(byId.get(x.id)!.sheet),
      segments: segsOf,
      exclude: (x, texts) => {
        const b = titleBlockBox(texts, x.width, x.height);
        return b ? [b] : [];
      },
      sameScale: async (x, from) => {
        const a = byId.get(x.id)!.sheet;
        const b = byId.get(from.id)!.sheet;
        if (a.metersPerPoint && b.metersPerPoint) return Math.abs(a.metersPerPoint / b.metersPerPoint - 1) <= 0.01;
        // Unscaled: the scale read from its dimensions, and nothing when there are none to read.
        const want = b.metersPerPoint;
        const segs = await segsOf(x);
        const read = segs ? checkScale(await access.texts(a), segs, p.units) : null;
        return !!want && !!read && read.agree >= 5 && Math.abs(read.metersPerPoint / want - 1) <= 0.02;
      },
      progress: access.progress,
    },
    symbol && home ? { symbol, home } : undefined,
  );
  return tallies.length ? { tallies } : { tallies, message: 'No symbol legend found. Click a symbol on the sheet to count it on every sheet.' };
}

/** The choices the count dialog starts with: every symbol found at least once, under its legend name. */
export const defaultSymbolChoices = (tallies: SymbolTally[]): SymbolChoice[] => tallies.filter((t) => t.total > 0).map((tally) => ({ tally, name: tally.symbol.label }));

/** Adds the symbols chosen as count types (a type of that name already there gets its symbol count replaced). */
export function symbolTakeoff(p: Project, choices: SymbolChoice[]): Automation & { typeIds: string[] } {
  const types: TakeoffType[] = [];
  const ids = choices.map((c) => {
    const got = p.types.find((t) => t.kind === 'count' && t.name === c.name) ?? types.find((t) => t.name === c.name);
    if (got) return got.id;
    const t: TakeoffType = {
      id: newId(),
      name: c.name,
      color: PALETTE[(p.types.length + types.length) % PALETTE.length],
      kind: 'count',
      height: 0,
      division: guessDivision(c.name),
      items: [{ id: newId(), name: c.name, unit: 'ea', formula: 'N' }],
    };
    types.push(t);
    return t.id;
  });
  const added: Project['measurements'] = choices.flatMap((c, i) =>
    c.tally.places.flatMap((pl) => pl.at.map((at) => ({ id: newId(), sheetId: pl.sheetId, typeId: ids[i], points: [at], holes: [], source: 'symbols' as const }))),
  );
  const typeIds = new Set(ids);
  return {
    typeIds: ids,
    message: `Counted ${added.length} symbol${added.length === 1 ? '' : 's'} as ${choices.length} type${choices.length === 1 ? '' : 's'}`,
    apply: (q) => ({ ...q, types: [...q.types, ...types], measurements: [...q.measurements.filter((m) => !(m.source === 'symbols' && typeIds.has(m.typeId))), ...added] }),
  };
}
