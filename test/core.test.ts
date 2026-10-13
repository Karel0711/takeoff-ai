import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/formula';
import { orthoSnap, polylineLength, ringArea, ringLength } from '../src/geometry';
import { newProject, type Project } from '../src/model';
import { typeTotals } from '../src/quantities';
import { findScaleHints, parseLength, parseScale } from '../src/units';

describe('parseScale', () => {
  it('converts metric ratios to metres per point', () => {
    // At 1:100 one paper inch (72 pt) is 2.54 m.
    expect(parseScale('1:100')! * 72).toBeCloseTo(2.54, 9);
    expect(parseScale('1 : 50')! * 72).toBeCloseTo(1.27, 9);
  });
  it('converts architectural and engineering notation', () => {
    // 1/8" = 1'-0": one paper inch is 8 ft.
    expect((parseScale('1/8" = 1\'-0"')! * 72) / 0.3048).toBeCloseTo(8, 9);
    expect((parseScale('1 1/2" = 1\'-0"')! * 72) / 0.3048).toBeCloseTo(2 / 3, 9);
    expect((parseScale('1" = 20\'')! * 72) / 0.3048).toBeCloseTo(20, 9);
  });
  it('rejects unknown notation', () => {
    expect(parseScale('NTS')).toBeNull();
    expect(parseScale('1:0')).toBeNull();
  });
});

describe('findScaleHints', () => {
  it('finds standard ratio scales and ignores 1:1 and callouts', () => {
    expect(findScaleHints('FLOOR PLAN 1 : 100  DETAIL 1:20 1:1 1 : 100 SEE 1:7')).toEqual(['1:20', '1:100']);
  });
});

describe('parseLength', () => {
  it('parses metric input', () => {
    expect(parseLength('3.5', 'metric')).toBeCloseTo(3.5);
    expect(parseLength('3500mm', 'metric')).toBeCloseTo(3.5);
  });
  it('parses imperial input', () => {
    expect(parseLength('12\'6"', 'imperial')).toBeCloseTo(12.5 * 0.3048);
    expect(parseLength('12\' 6 1/2"', 'imperial')).toBeCloseTo((12 + 6.5 / 12) * 0.3048);
    expect(parseLength('10', 'imperial')).toBeCloseTo(3.048);
    expect(parseLength('2m', 'imperial')).toBeCloseTo(2);
  });
  it('rejects garbage', () => {
    expect(parseLength('abc', 'metric')).toBeNull();
    expect(parseLength('0', 'metric')).toBeNull();
  });
});

describe('geometry', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('measures rings and polylines', () => {
    expect(ringArea(square)).toBe(100);
    expect(ringLength(square)).toBe(40);
    expect(polylineLength(square)).toBe(30);
  });
  it('snaps orthogonally', () => {
    expect(orthoSnap([0, 0], [10, 2])).toEqual([10, 0]);
    expect(orthoSnap([0, 0], [2, 10])).toEqual([0, 10]);
  });
});

describe('evaluate', () => {
  it('follows precedence and supports functions', () => {
    expect(evaluate('2 + 3 * 4', {})).toEqual({ ok: true, value: 14 });
    expect(evaluate('ceil(L / 0.61) + N', { L: 10, N: 2 })).toEqual({ ok: true, value: 19 });
    expect(evaluate('-2 ^ 2', {})).toEqual({ ok: true, value: -4 });
    expect(evaluate('max(1, 2, 3) * (1 + 1)', {})).toEqual({ ok: true, value: 6 });
  });
  it('reports errors instead of throwing', () => {
    expect(evaluate('L +', { L: 1 }).ok).toBe(false);
    expect(evaluate('X', {}).ok).toBe(false);
    expect(evaluate('alert(1)', {}).ok).toBe(false);
    expect(evaluate('1 / 0', {}).ok).toBe(false);
  });
});

describe('typeTotals', () => {
  it('rolls wall and room takeoffs into assembly quantities', () => {
    const p: Project = newProject('metric');
    const mpp = parseScale('1:100')!;
    // 1000 pt at 1:100 = 35.278 m.
    const ptsFor = (meters: number) => meters / mpp;
    p.sheets.push({
      id: 's1',
      docId: 'd',
      page: 1,
      name: 'A2.1',
      width: 2592,
      height: 1728,
      metersPerPoint: mpp,
      scaleLabel: '1:100',
      scaleSource: 'preset',
      scaleHints: [],
    });
    p.sheets.push({ ...p.sheets[0], id: 's2', metersPerPoint: null, scaleLabel: null, scaleSource: null });
    const wall = p.types[0];
    const floor = p.types.find((t) => t.kind === 'area')!;
    wall.height = 3;
    p.measurements.push(
      { id: 'm1', sheetId: 's1', typeId: wall.id, points: [[0, 0], [ptsFor(10), 0]], holes: [] },
      { id: 'm2', sheetId: 's1', typeId: wall.id, points: [[0, 0], [0, ptsFor(5)]], holes: [] },
      { id: 'm3', sheetId: 's2', typeId: wall.id, points: [[0, 0], [0, 100]], holes: [] },
      {
        id: 'm4',
        sheetId: 's1',
        typeId: floor.id,
        points: [[0, 0], [ptsFor(10), 0], [ptsFor(10), ptsFor(8)], [0, ptsFor(8)]],
        holes: [[[0, 0], [ptsFor(2), 0], [ptsFor(2), ptsFor(2)], [0, ptsFor(2)]]],
      },
    );
    const totals = typeTotals(p);
    const w = totals.find((t) => t.type.id === wall.id)!;
    expect(w.primary).toBeCloseTo(15);
    expect(w.vars.A).toBeCloseTo(45);
    expect(w.vars.N).toBe(2);
    expect(w.unscaled).toBe(1);
    expect(w.items.find((i) => i.name.includes('studs'))!.value).toBe(Math.ceil(15 / 0.61) + 2);
    const f = totals.find((t) => t.type.id === floor.id)!;
    expect(f.primary).toBeCloseTo(80 - 4);
    expect(f.vars.P).toBeCloseTo(36 + 8);
  });
});
