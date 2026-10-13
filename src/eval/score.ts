import type { ExtractedAssembly, ExtractedLayer } from '../ai/schema';
import type { ExpectedAssembly } from './answerKey';

/**
 * Scores an AI legend extraction against the estimator's transcription.
 * Text is compared loosely (wording, punctuation and spacing vary), but every
 * number in a layer (sizes, spacings) must match exactly: a wrong stud size
 * or spacing is a wrong takeoff even if the words look right.
 */

const normalize = (s: string) =>
  s
    .toUpperCase()
    .replace(/±/g, '+/-')
    .replace(/(\d)\s*MM\b/g, '$1MM')
    .replace(/[^A-Z0-9+/.]+/g, ' ')
    .trim();

const tokens = (s: string) => new Set(normalize(s).split(' ').filter((t) => t.length > 1 || /\d/.test(t)));

/** Dice similarity of word sets, 0 to 1. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size && !tb.size) return 1;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/** Numbers that matter in a layer: sizes and spacings ("16mm", "610", "38X89" → 38, 89). */
export function numbersIn(s: string): number[] {
  return [...normalize(s).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).sort((x, y) => x - y);
}

const sameNumbers = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Spacing printed in a layer, e.g. "@ 610mm O.C." or "@ 610mm FRAMING O.C.". */
const spacingIn = (s: string) => {
  const m = /@\s*(\d{2,4})\s*MM/i.exec(s);
  return m ? Number(m[1]) : null;
};

const MATCH_THRESHOLD = 0.5;

export interface LayerResult {
  expected: string;
  found: string | null;
  similarity: number;
  numbersMatch: boolean;
  /** Expected spacing vs the spacing_mm the AI recorded, when the layer has one. */
  spacing?: { expected: number; found: number | null };
}

export interface AssemblyResult {
  code: string;
  label: string;
  found: boolean;
  titleSimilarity: number;
  categoryMatch: boolean | null;
  layers: LayerResult[];
  /** AI layers that matched nothing in the key. */
  extraLayers: string[];
  thickness?: { expected: number; found: number | null };
}

export interface ScoreReport {
  sheet: string | null;
  expectedTypes: number;
  foundTypes: number;
  /** Tags the AI returned that are not in the key for this sheet. */
  unexpectedTypes: string[];
  layersExpected: number;
  layersMatched: number;
  layersExact: number;
  extraLayers: number;
  spacingsExpected: number;
  spacingsCorrect: number;
  thicknessExpected: number;
  thicknessCorrect: number;
  categoriesChecked: number;
  categoriesCorrect: number;
  assemblies: AssemblyResult[];
}

/** Best one-to-one pairing of expected and found layers, greedily by similarity. */
function alignLayers(expected: string[], found: ExtractedLayer[]) {
  const pairs: { e: number; f: number; sim: number }[] = [];
  expected.forEach((e, ei) =>
    found.forEach((f, fi) => {
      const sim = similarity(e, f.material);
      if (sim >= MATCH_THRESHOLD) pairs.push({ e: ei, f: fi, sim });
    }),
  );
  pairs.sort((x, y) => y.sim - x.sim);
  const usedE = new Set<number>();
  const usedF = new Set<number>();
  const match = new Map<number, { f: number; sim: number }>();
  for (const p of pairs) {
    if (usedE.has(p.e) || usedF.has(p.f)) continue;
    usedE.add(p.e);
    usedF.add(p.f);
    match.set(p.e, { f: p.f, sim: p.sim });
  }
  return { match, unusedFound: found.map((_, i) => i).filter((i) => !usedF.has(i)) };
}

/** Furring and CMU partitions sit under interior walls in schedules; accept either wall category for them. */
const categoryMatches = (expected: ExpectedAssembly, found: ExtractedAssembly) =>
  expected.category === found.category ||
  (expected.category === 'interior_wall' && found.category === 'exterior_wall' && /^FR/.test(expected.code));

export function scoreExtraction(
  key: ExpectedAssembly[],
  extracted: ExtractedAssembly[],
  sheet: string | null = null,
): ScoreReport {
  const expected = sheet ? key.filter((k) => k.sheet === sheet) : key;
  const byCode = new Map<string, ExtractedAssembly[]>();
  for (const a of extracted) byCode.set(a.code.trim().toUpperCase(), [...(byCode.get(a.code.trim().toUpperCase()) ?? []), a]);
  const used = new Map<string, number>();

  const assemblies: AssemblyResult[] = expected.map((exp) => {
    // Repeated tags (R1 option 1 and 2) pair in order of appearance.
    const candidates = byCode.get(exp.code) ?? [];
    const n = used.get(exp.code) ?? 0;
    const found = candidates[n] ?? null;
    used.set(exp.code, n + 1);
    if (!found) {
      return {
        code: exp.code,
        label: exp.label,
        found: false,
        titleSimilarity: 0,
        categoryMatch: null,
        layers: exp.layers.map((e) => {
          const spacing = spacingIn(e);
          return {
            expected: e,
            found: null,
            similarity: 0,
            numbersMatch: false,
            ...(spacing ? { spacing: { expected: spacing, found: null } } : {}),
          };
        }),
        extraLayers: [],
        ...(exp.overallMm ? { thickness: { expected: exp.overallMm, found: null } } : {}),
      };
    }
    const { match, unusedFound } = alignLayers(exp.layers, found.layers);
    const layers: LayerResult[] = exp.layers.map((e, i) => {
      const m = match.get(i);
      const f = m ? found.layers[m.f] : null;
      const spacing = spacingIn(e);
      return {
        expected: e,
        found: f?.material ?? null,
        similarity: m?.sim ?? 0,
        numbersMatch: f ? sameNumbers(numbersIn(e), numbersIn(f.material)) : false,
        ...(spacing ? { spacing: { expected: spacing, found: f?.spacing_mm ?? null } } : {}),
      };
    });
    return {
      code: exp.code,
      label: exp.label,
      found: true,
      titleSimilarity: similarity(exp.title, found.title),
      categoryMatch: exp.category === 'other' ? null : categoryMatches(exp, found),
      layers,
      extraLayers: unusedFound.map((i) => found.layers[i].material),
      ...(exp.overallMm ? { thickness: { expected: exp.overallMm, found: found.total_thickness_mm } } : {}),
    };
  });

  const expectedCodes = new Set(expected.map((e) => e.code));
  const allLayers = assemblies.flatMap((a) => a.layers);
  const spacings = allLayers.filter((l) => l.spacing);
  const thick = assemblies.filter((a) => a.thickness);
  const cats = assemblies.filter((a) => a.categoryMatch !== null);
  return {
    sheet,
    expectedTypes: expected.length,
    foundTypes: assemblies.filter((a) => a.found).length,
    unexpectedTypes: [...new Set(extracted.map((a) => a.code.trim().toUpperCase()))].filter((c) => !expectedCodes.has(c)),
    layersExpected: allLayers.length,
    layersMatched: allLayers.filter((l) => l.found).length,
    layersExact: allLayers.filter((l) => l.found && l.numbersMatch).length,
    extraLayers: assemblies.reduce((n, a) => n + a.extraLayers.length, 0),
    spacingsExpected: spacings.length,
    spacingsCorrect: spacings.filter((l) => l.spacing!.found === l.spacing!.expected).length,
    thicknessExpected: thick.length,
    // "Overall" values are rounded on drawings; allow 5 mm.
    thicknessCorrect: thick.filter((a) => a.thickness!.found !== null && Math.abs(a.thickness!.found - a.thickness!.expected) <= 5)
      .length,
    categoriesChecked: cats.length,
    categoriesCorrect: cats.filter((a) => a.categoryMatch).length,
    assemblies,
  };
}
