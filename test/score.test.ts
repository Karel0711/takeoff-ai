import { describe, expect, it } from 'vitest';
import type { ExtractedAssembly } from '../src/ai/schema';
import { parseScheduleRows, splitLayers } from '../src/eval/answerKey';
import { numbersIn, scoreExtraction, similarity } from '../src/eval/score';

const rows = [
  ['Architectural assembly types'],
  ['INTERIOR WALL TYPES - A0.3'],
  ['Type', 'Design / assembly name', 'Construction', 'Notes'],
  ['W1', 'TYPICAL INTERIOR WALL', '• 16mm GYPSUM BOARD\n• 92mm METAL STUDS FRAMING @ 610mm O.C.\n• 16mm GYPSUM BOARD', 'Overall 125.'],
  ['FR1', 'TYPICAL EXTERIOR WALL FURRING', '• 16mm GYPSUM BOARD\n• 64mm METAL STUDS @ 406mm O.C.', 'Overall 80.'],
  ['FLOOR TYPES - A0.3'],
  ['Type', 'Design / assembly name', 'Construction', 'Notes'],
  ['F1', 'INTERIOR SLAB-ON-GRADE (R16)', '• 150mm CAST-IN-PLACE CONCRETE SLAB\n• 100mm EPS RIGID INSULATION', ''],
  ['ROOF TYPES - A0.2'],
  ['Type', 'Design / assembly name', 'Construction', 'Notes'],
  ['R1 (opt 1)', 'MAIN ROOF - OPTION 1', '• STANDING SEAM METAL ROOF', ''],
  ['R1 (opt 2)', 'MAIN ROOF - OPTION 2', '• 2-PLY MODIFIED BITUMEN MEMBRANE', ''],
];

const asFound = (code: string, category: ExtractedAssembly['category'], title: string, layers: [string, number | null][], total: number | null = null): ExtractedAssembly => ({
  code,
  category,
  title,
  layers: layers.map(([material, spacing]) => ({ material, role: 'other', thickness_mm: null, spacing_mm: spacing })),
  total_thickness_mm: total,
  notes: [],
});

describe('parseScheduleRows', () => {
  it('reads codes, layers, sheets, categories and overall thickness', () => {
    const key = parseScheduleRows(rows);
    expect(key.map((k) => [k.code, k.sheet, k.category])).toEqual([
      ['W1', 'A0.3', 'interior_wall'],
      ['FR1', 'A0.3', 'interior_wall'],
      ['F1', 'A0.3', 'floor'],
      ['R1', 'A0.2', 'roof'],
      ['R1', 'A0.2', 'roof'],
    ]);
    expect(key[0].layers).toEqual(['16mm GYPSUM BOARD', '92mm METAL STUDS FRAMING @ 610mm O.C.', '16mm GYPSUM BOARD']);
    expect(key[0].overallMm).toBe(125);
    expect(key[3].label).toBe('R1 (opt 1)');
  });

  it('labels sections from the tab name when headings name no sheet', () => {
    const key = parseScheduleRows(
      [['STRUCTURAL TYPES'], ['Type', 'Design', 'Construction', 'Notes'], ['MF1', 'MAT FOOTING', '• 600mm CONCRETE', '']],
      'Schedules S0.2',
    );
    expect(key[0].sheet).toBe('S0.2');
  });

  it('splits bullets or lines', () => {
    expect(splitLayers('• A\n• B')).toEqual(['A', 'B']);
    expect(splitLayers('A\nB')).toEqual(['A', 'B']);
  });
});

describe('similarity and numbers', () => {
  it('ignores punctuation and spacing but keeps numbers', () => {
    expect(similarity('92mm METAL STUDS @ 610mm O.C.', '92 mm metal studs @610mm o.c.')).toBe(1);
    expect(numbersIn('38X89 WOOD FRAMING @ 406mm O.C.')).toEqual([38, 89, 406]);
  });
});

describe('scoreExtraction', () => {
  const key = parseScheduleRows(rows);

  it('gives full marks for a faithful reading of one sheet', () => {
    const r = scoreExtraction(
      key,
      [
        asFound('W1', 'interior_wall', 'TYPICAL INTERIOR WALL', [['16mm GYPSUM BOARD', null], ['92mm METAL STUDS FRAMING @ 610mm O.C.', 610], ['16mm GYPSUM BOARD', null]], 125),
        asFound('FR1', 'interior_wall', 'TYPICAL EXTERIOR WALL FURRING', [['16mm GYPSUM BOARD', null], ['64mm METAL STUDS @ 406mm O.C.', 406]], 80),
        asFound('F1', 'floor', 'INTERIOR SLAB-ON-GRADE (R16)', [['150mm CAST-IN-PLACE CONCRETE SLAB', null], ['100mm EPS RIGID INSULATION', null]]),
      ],
      'A0.3',
    );
    expect(r).toMatchObject({
      expectedTypes: 3,
      foundTypes: 3,
      layersExpected: 7,
      layersExact: 7,
      spacingsCorrect: 2,
      spacingsExpected: 2,
      thicknessCorrect: 2,
      categoriesCorrect: 3,
      extraLayers: 0,
      unexpectedTypes: [],
    });
  });

  it('catches wrong numbers, spacings, missing types and extras', () => {
    const r = scoreExtraction(
      key,
      [
        asFound('W1', 'interior_wall', 'TYPICAL INTERIOR WALL', [['16mm GYPSUM BOARD', null], ['92mm METAL STUDS FRAMING @ 406mm O.C.', 406], ['16mm GYPSUM BOARD', null], ['ACOUSTIC SEALANT', null]], 140),
        asFound('F1', 'roof', 'INTERIOR SLAB', [['150mm CAST-IN-PLACE CONCRETE SLAB', null]]),
        asFound('W9', 'interior_wall', 'NOT ON SHEET', []),
      ],
      'A0.3',
    );
    expect(r.foundTypes).toBe(2);
    expect(r.unexpectedTypes).toEqual(['W9']);
    expect(r.layersExpected).toBe(7);
    // W1: 2 boards exact, studs matched but wrong number; F1: slab exact; FR1 missing.
    expect(r.layersMatched).toBe(4);
    expect(r.layersExact).toBe(3);
    expect(r.extraLayers).toBe(1);
    // FR1 is missing, so its spacing counts as wrong too.
    expect(r.spacingsExpected).toBe(2);
    expect(r.spacingsCorrect).toBe(0);
    expect(r.thicknessCorrect).toBe(0);
    expect(r.categoriesCorrect).toBe(1);
  });

  it('pairs repeated tags in order', () => {
    const r = scoreExtraction(
      key,
      [asFound('R1', 'roof', 'MAIN ROOF - OPTION 1', [['STANDING SEAM METAL ROOF', null]]), asFound('R1', 'roof', 'MAIN ROOF - OPTION 2', [['2-PLY MODIFIED BITUMEN MEMBRANE', null]])],
      'A0.2',
    );
    expect(r.foundTypes).toBe(2);
    expect(r.layersExact).toBe(2);
  });
});
