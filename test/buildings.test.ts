import { describe, expect, it } from 'vitest';
import { buildingOf, guessBuilding, quantitySections } from '../src/buildings';
import type { Project } from '../src/model';

describe('buildings', () => {
  it('reads the building from the drawing file name', () => {
    expect(guessBuilding('VB07_Compiled_Drawings.pdf')).toBe('VB07');
    expect(guessBuilding('10 - VB06 Drawings - All (22 sh).pdf')).toBe('VB06');
    expect(guessBuilding('Bldg B - Architectural.pdf')).toBe('Building B');
    expect(guessBuilding('Tower 2 Structural.pdf')).toBe('Tower 2');
    expect(guessBuilding('Architectural.pdf')).toBe('Architectural');
  });

  const sheet = (id: string, docId: string) => ({ id, docId, page: 1, name: id, width: 100, height: 100, metersPerPoint: 1, scaleLabel: null, scaleSource: null, scaleHints: [] });
  const type = (id: string, division?: string) => ({ id, name: id, color: '#000', kind: 'count' as const, height: 0, items: [], division });
  const at = (id: string, sheetId: string, typeId: string) => ({ id, sheetId, typeId, points: [[1, 1]] as [number, number][], holes: [] });
  const project = {
    id: 'p',
    name: 'p',
    units: 'metric',
    docs: [
      { id: 'a', name: 'VB06 set.pdf' },
      { id: 'b', name: 'VB07 set.pdf', building: 'North wing' },
    ],
    sheets: [sheet('s1', 'a'), sheet('s2', 'b'), { ...sheet('s3', 'b'), building: 'Garage' }],
    types: [type('head', '21 Fire Suppression'), type('door', '08 Openings'), type('misc')],
    measurements: [at('1', 's1', 'head'), at('2', 's1', 'head'), at('3', 's2', 'head'), at('4', 's2', 'door'), at('5', 's3', 'misc')],
  } as unknown as Project;

  it('groups by the label the estimator set, else the file name; a sheet can differ', () => {
    expect(project.sheets.map((s) => buildingOf(project, s))).toEqual(['VB06 set', 'North wing', 'Garage']);
  });

  it('groups quantities by building, then by division', () => {
    const out = quantitySections(project, 'building-division').map((b) => [b.title, b.sections!.map((d) => [d.title, d.totals!.map((t) => `${t.type.id} ${t.vars.N}`)])]);
    expect(out).toEqual([
      ['VB06 set', [['21 Fire Suppression', ['head 2']]]],
      ['North wing', [['08 Openings', ['door 1']], ['21 Fire Suppression', ['head 1']]]],
      ['Garage', [['No division', ['misc 1']]]],
    ]);
  });
});
