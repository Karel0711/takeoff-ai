import { describe, expect, it } from 'vitest';
import { codesInside, heightMeters, matchSchedules, readFinishSchedule, readFinishTags, roomNumbersOf, sameCode } from '../src/finishSchedule';
import { finishType, newProject, type Measurement, type Sheet, defaultTypes } from '../src/model';
import type { PageText } from '../src/pageText';
import { typeTotals } from '../src/quantities';

const text = (str: string, cx: number, cy: number): PageText => ({ str, cx, cy, w: str.length * 4, h: 5 });

describe('room finish schedule', () => {
  // A schedule with a two-line header, an N/E/S/W wall group and a remarks column.
  const header = [
    text('ROOM', 60, 100),
    text('NO.', 40, 112),
    text('NAME', 110, 112),
    text('FLOOR', 200, 112),
    text('BASE', 250, 112),
    text('WALLS', 330, 100),
    text('N', 300, 112),
    text('E', 320, 112),
    text('S', 340, 112),
    text('W', 360, 112),
    text('CEILING', 420, 112),
    text('REMARKS', 500, 112),
  ];
  const row = (y: number, no: string, name: string, floor: string, base: string, walls: string[], ceiling: string, remark = '') => [
    text(no, 40, y),
    text(name, 110, y),
    text(floor, 200, y),
    text(base, 250, y),
    ...walls.map((w, i) => text(w, 300 + 20 * i, y)),
    text(ceiling, 420, y),
    ...(remark ? [text(remark, 500, y)] : []),
  ];
  const texts = [
    text('ROOM FINISH SCHEDULE', 200, 80),
    ...header,
    ...row(130, '101', 'LOBBY', 'PT-1', 'RB-1', ['P1', 'P1', 'P2', 'P1'], 'ACT-1'),
    ...row(142, '102', 'RENTAL SHOP', 'SC', '—', ['P1', 'P1', 'P1', 'P1'], 'EXP', 'SEALED CONCRETE'),
    ...row(154, '103', 'STORAGE', 'SC', 'RB-1', ['P1', 'P1', 'P1', 'P1'], 'GWB'),
    // A note far below is not part of the schedule.
    text('204', 40, 600),
  ];

  it('reads one line per room with the code in each finish column', () => {
    const s = readFinishSchedule(texts)!;
    expect(s.columns).toEqual(['floor', 'base', 'walls', 'ceiling']);
    expect(s.rows).toEqual([
      { number: '101', name: 'LOBBY', finishes: { floor: 'PT-1', base: 'RB-1', walls: 'P1', ceiling: 'ACT-1' }, wallFinishes: ['P1', 'P2'] },
      { number: '102', name: 'RENTAL SHOP', finishes: { floor: 'SC', walls: 'P1', ceiling: 'EXP' } },
      { number: '103', name: 'STORAGE', finishes: { floor: 'SC', base: 'RB-1', walls: 'P1', ceiling: 'GWB' } },
    ]);
  });

  it('finds nothing on a sheet without a schedule', () => {
    expect(readFinishSchedule([text('FLOOR PLAN', 100, 100), text('101', 100, 200)])).toBeNull();
  });

  it('reads room numbers from room takeoff names', () => {
    expect(roomNumbersOf('112 RECEIVING & GEN. STORAGE')).toEqual(['112']);
    expect(roomNumbersOf('100 / 101 LOBBY')).toEqual(['100', '101']);
    expect(roomNumbersOf('Lobby')).toEqual([]);
    // Lettered corridors.
    expect(roomNumbersOf('A / 101 CORRIDOR / RECEPTION')).toEqual(['A', '101']);
    expect(roomNumbersOf('C STAFF CORRIDOR')).toEqual(['C']);
    // Numbers with letters and levels.
    expect(roomNumbersOf('101a Program Room')).toEqual(['101a']);
    expect(roomNumbersOf('B24S / B24N Corridor')).toEqual(['B24S', 'B24N']);
    expect(roomNumbersOf('M01 Shelter Intake')).toEqual(['M01']);
    expect(roomNumbersOf('2.14 WC')).toEqual(['2.14']);
  });
});

describe('a wide schedule with grouped headings', () => {
  // As on 84 Frederick: ROOM over NO. | ROOM NAME, FLOORING over SUBSTRATE | FLOOR | FLOOR
  // REMARKS, then BASE, a SUB | FINISH pair under each of NORTH/EAST/SOUTH/WEST WALL, and
  // CEILINGS over MATERIAL | FINISH | HEIGHT. A section line ("Ground Floor") between rows.
  const t = (str: string, cx: number, cy: number): PageText => ({ str, cx, cy, w: str.length * 3.4, h: 5.7 });
  const walls = ['North Wall', 'East Wall', 'South Wall', 'West Wall'];
  const header = [
    t('Room Finishes Schedule', 180, 84),
    t('Room', 102, 103),
    t('Flooring', 254, 103),
    ...walls.map((w, i) => t(w, 830 + 97 * i, 103)),
    t('Ceilings', 1316, 103),
    t('Bulkheads', 1651, 103),
    t('No.', 97, 121),
    t('Room Name', 146, 121),
    t('Substrate', 256, 121),
    t('Floor', 316, 121),
    t('Floor Remarks', 402, 121),
    t('Substrate', 522, 121),
    t('Base', 578, 121),
    t('Base Remarks', 661, 121),
    ...walls.flatMap((_, i) => [t('Sub', 805 + 97 * i, 121), t('Finish', 854 + 97 * i, 121)]),
    t('Wall Remarks', 1197, 121),
    t('Material', 1316, 121),
    t('Finish', 1377, 121),
    t('Height (a.f.f.)', 1455, 121),
    t('Ceiling Remarks', 1533, 121),
    t('Materials', 1648, 121),
    t('Finish', 1708, 121),
    t('Height (a.f.f)', 1784, 121),
    t('Bulkhead Remarks', 1862, 121),
    t('Ground Floor', 116, 139),
  ];
  const row = (y: number, no: string, name: string, floor: string, base: string, wall: string[], ceiling: string, ht: string) => [
    t(no, 100, y),
    t(name, 150, y),
    t('CONC', 262, y),
    t(floor, 316, y),
    t('New floor finish (to 096500)', 425, y),
    t('CMU / GWB', 537, y),
    t(base, 578, y),
    t('New Base (to 096500)', 661, y),
    ...wall.flatMap((w, i) => [t('GWB', 805 + 97 * i, y), t(w, 854 + 97 * i, y)]),
    t('New paint finishes (to 099000)', 1228, y),
    t(ceiling, 1310, y),
    t(ceiling === 'GWB' ? 'PT' : 'PRE', 1377, y),
    t(ht, 1450, y),
    t('-', 1648, y),
  ];
  const texts = [
    ...header,
    ...row(157, '101a', 'Program Room', 'SV', 'SVC', ['PT', 'PT', 'PT', 'PT'], 'LAP', '8’-0”'),
    ...row(175, '109', 'Kitchen', 'CT', 'CT', ['CT', 'CT', 'CT', 'PT'], 'LAP', '8’-0”'),
    ...row(193, 'M01', 'Shelter Intake', 'LVT', 'VBC', ['PT', '-', 'PT', 'PT'], 'GWB', '8’-6”'),
  ];

  it('gives each finish the column under its heading, the material before its paint', () => {
    const s = readFinishSchedule(texts)!;
    expect(s.columns).toEqual(['floor', 'base', 'walls', 'ceiling']);
    expect(s.rows).toEqual([
      { number: '101a', name: 'Program Room', finishes: { floor: 'SV', base: 'SVC', walls: 'PT', ceiling: 'LAP' }, ceilingHeight: '8’-0”' },
      { number: '109', name: 'Kitchen', finishes: { floor: 'CT', base: 'CT', walls: 'CT', ceiling: 'LAP' }, wallFinishes: ['CT', 'PT'], ceilingHeight: '8’-0”' },
      { number: 'M01', name: 'Shelter Intake', finishes: { floor: 'LVT', base: 'VBC', walls: 'PT', ceiling: 'GWB' }, ceilingHeight: '8’-6”' },
    ]);
  });

  it('reads ceiling heights in feet and inches or millimetres', () => {
    expect(heightMeters('8’-6”')).toBeCloseTo(102 * 0.0254);
    expect(heightMeters(`9'`)).toBeCloseTo(108 * 0.0254);
    expect(heightMeters('2700')).toBeCloseTo(2.7);
    expect(heightMeters('2.7 m')).toBeCloseTo(2.7);
    expect(heightMeters('varies')).toBeNull();
  });

  it('matches rooms on the plans to the lines of every schedule sheet by number', () => {
    const ground = readFinishSchedule(texts)!;
    const basement = { sheetName: 'A911', docId: 'd', rows: [{ number: 'B23', name: 'Office', finishes: { floor: 'LVT' } }] };
    const match = matchSchedules(
      [
        { id: 'a', label: '101A Program Room', docId: 'd' },
        { id: 'b', label: 'B23 Office', docId: 'd' },
        { id: 'c', label: '102b / 109 Sleeping / Kitchen', docId: 'd' },
        { id: 'd', label: '999 Attic', docId: 'd' },
      ],
      [basement, { sheetName: 'A912', docId: 'd', rows: ground.rows }],
    );
    expect([...match.rows].map(([id, r]) => [id, r.row.number, r.sheetName])).toEqual([
      ['a', '101a', 'A912'],
      ['b', 'B23', 'A911'],
      ['c', '109', 'A912'],
    ]);
    expect(match.unmatched.map((u) => u.row.number)).toEqual(['M01']);
    expect(match.missing).toEqual(['d']);
  });
});

describe('room finish quantities', () => {
  it('counts a room toward its floor and ceiling as area and its base and walls as perimeter', () => {
    const p = { ...newProject('metric'), types: defaultTypes('metric') };
    const sheet: Sheet = {
      id: 's',
      docId: 'd',
      page: 1,
      name: 'A1',
      width: 1000,
      height: 1000,
      metersPerPoint: 0.01,
      scaleLabel: null,
      scaleSource: null,
      scaleHints: [],
    };
    const room = p.types.find((t) => t.kind === 'area')!;
    const floor = finishType('floor', 'CPT-1', 'metric', '#000');
    const base = finishType('base', 'RB-1', 'metric', '#000');
    const walls = { ...finishType('walls', 'P1', 'metric', '#000'), height: 2.7 };
    const m: Measurement = {
      id: 'm',
      sheetId: 's',
      typeId: room.id,
      // 5 m × 4 m
      points: [
        [0, 0],
        [500, 0],
        [500, 400],
        [0, 400],
      ],
      holes: [],
      finishes: { floor: floor.id, base: base.id, walls: walls.id },
    };
    const totals = typeTotals({ ...p, sheets: [sheet], types: [...p.types, floor, base, walls], measurements: [m] });
    const of = (id: string) => totals.find((t) => t.type.id === id)!;
    expect(of(floor.id).primary).toBeCloseTo(20);
    expect(of(base.id).primary).toBeCloseTo(18);
    expect(of(walls.id).vars.A).toBeCloseTo(18 * 2.7);
    // Wall finishes are priced by area, so that is their total.
    expect(of(walls.id).primary).toBeCloseTo(18 * 2.7);
    expect(of(walls.id).unit).toBe('m²');
    expect(of(room.id).primary).toBeCloseTo(20);
    // A finish of the room's own type does not count it twice.
    const again = typeTotals({ ...p, sheets: [sheet], types: [...p.types, floor], measurements: [{ ...m, finishes: { floor: room.id } }] });
    expect(again.find((t) => t.type.id === room.id)!.primary).toBeCloseTo(20);

    // A 0.9 m door: base stops at it, paint loses only the door opening (2.1 m high), and the
    // ceiling's perimeter trim runs over the door head.
    const ceiling = finishType('ceiling', 'ACT-1', 'metric', '#000');
    const door: Measurement = { ...m, openings: 90, finishes: { ...m.finishes, ceiling: ceiling.id } };
    const withDoor = typeTotals({ ...p, sheets: [sheet], types: [...p.types, floor, base, walls, ceiling], measurements: [door] });
    const at = (id: string) => withDoor.find((t) => t.type.id === id)!;
    expect(at(base.id).primary).toBeCloseTo(17.1);
    expect(at(walls.id).vars.A).toBeCloseTo(18 * 2.7 - 0.9 * 2.1);
    const trim = at(ceiling.id).items.find((it) => it.name === 'Perimeter trim')!;
    expect(trim.value).toBeCloseTo(18);

    // A room with its ceiling height from the schedule: walls are painted up to it.
    const low = typeTotals({ ...p, sheets: [sheet], types: [...p.types, floor, base, walls], measurements: [{ ...m, ceilingHeight: 2.4 }] });
    expect(low.find((t) => t.type.id === walls.id)!.vars.A).toBeCloseTo(18 * 2.4);
  });
});

describe('finishes tagged on the drawings', () => {
  const t = (str: string, cx: number, cy: number): PageText => ({ str, cx, cy, w: str.length * 3.3, h: 5.6 });
  it('reads the floor code boxed under each room tag of a finish plan', () => {
    const texts = [t('WC', 668, 466), t('112', 668, 481), t('EP1', 668, 498), t('LOCKER ROOM', 900, 470), t('114', 900, 481), t('CPT-1', 900, 498), t('PT-1', 668, 560)];
    const rows = readFinishTags(texts, [
      { number: '112', box: [656, 474, 681, 489] },
      { number: '114', box: [888, 474, 912, 489] },
      { number: '115' },
    ]);
    expect(rows.map((r) => [r.number, r.finishes.floor])).toEqual([
      ['112', 'EP1'],
      ['114', 'CPT-1'],
    ]);
  });

  it('reads the ceiling tagged inside a room on a ceiling plan', () => {
    const texts = [t('2667', 50, 40), t('(CA1)', 50, 48), t('(CA2)', 300, 48), t('WP1', 60, 60)];
    const inRoom = (x: number, y: number) => x > 0 && x < 100 && y > 0 && y < 100;
    expect(codesInside(texts, inRoom, (c) => ['CA1', 'CA2'].includes(c))).toEqual(['CA1']);
    expect(sameCode('EP1', 'EP-1')).toBe(true);
  });
});
