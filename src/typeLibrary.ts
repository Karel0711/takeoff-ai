import { newId, type AssemblyItem, type Kind, type TakeoffType, type Units } from './model';

/** A ready-made takeoff type, for a sub to add in one click and adjust. */
export interface LibraryEntry {
  key: string;
  trade: string;
  name: string;
  kind: Kind;
  /** What the type is drawn as, in a few words. */
  note: string;
  make: (units: Units) => TakeoffType;
}

const item = (name: string, unit: string, formula: string): AssemblyItem => ({ id: newId(), name, unit, formula });

/**
 * One entry: `spec` receives the unit helpers and returns the type's fields.
 * Metric types measure in metres, imperial in feet; `u(m, ft)` picks the number.
 */
function entry(
  key: string,
  trade: string,
  name: string,
  kind: Kind,
  note: string,
  spec: (h: { u: (m: number, ft: number) => number; len: string; area: string; vol: string; metric: boolean }) => Omit<TakeoffType, 'id' | 'name' | 'kind'>,
): LibraryEntry {
  return {
    key,
    trade,
    name,
    kind,
    note,
    make: (units) => {
      const metric = units === 'metric';
      const fields = spec({
        u: (m, ft) => (metric ? m : ft),
        len: metric ? 'm' : 'ft',
        area: metric ? 'm²' : 'SF',
        vol: metric ? 'm³' : 'CY',
        metric,
      });
      return { id: newId(), name, kind, ...fields };
    },
  };
}

// Common sizes: 4×8 board, standard heights. Ceiling grids are 600/1200 mm in metric
// and 2'/4' in imperial.
const board = (u: (m: number, ft: number) => number) => u(2.973, 32);

export const TYPE_LIBRARY: LibraryEntry[] = [
  entry('partition-406', 'Drywall & framing', 'Interior partition – steel stud @ 406, GWB both sides', 'linear', 'Wall runs', ({ u, len, area }) => ({
    color: '#e4572e',
    height: u(3, 10),
    division: '06 Wood Framing & Partitions',
    package: 'Drywall & framing sub',
    items: [
      item('Wall area', area, 'A'),
      item('Steel studs @ 406', 'ea', `ceil(L / ${u(0.406, 1.333)}) + N`),
      item('Track (top + bottom)', len, '2 * L'),
      item('GWB, 2 sides + 10% waste', area, '2 * A * 1.1'),
      item('GWB sheets 4×8', 'ea', `ceil(2 * A * 1.1 / ${board(u)})`),
      item('Sound batts', area, 'A'),
      item('Tape & finish', area, '2 * A'),
    ],
  })),
  entry('furring', 'Drywall & framing', 'Wall furring – steel stud, GWB one side', 'linear', 'Wall runs', ({ u, len, area }) => ({
    color: '#17bebb',
    height: u(3, 10),
    division: '06 Wood Framing & Partitions',
    package: 'Drywall & framing sub',
    items: [
      item('Furring area', area, 'A'),
      item('Steel studs @ 406', 'ea', `ceil(L / ${u(0.406, 1.333)}) + N`),
      item('Track (top + bottom)', len, '2 * L'),
      item('GWB, 1 side + 10% waste', area, 'A * 1.1'),
      item('GWB sheets 4×8', 'ea', `ceil(A * 1.1 / ${board(u)})`),
      item('Tape & finish', area, 'A'),
    ],
  })),
  entry('bulkhead', 'Drywall & framing', 'GWB bulkhead', 'linear', 'Runs; set its width (W) and drop (D)', ({ u, len, area }) => ({
    color: '#c0392b',
    height: 0,
    width: u(0.6, 2),
    depth: u(0.6, 2),
    division: '09 Finishes',
    package: 'Drywall & ceiling sub',
    items: [
      item('Bulkhead board (soffit + face) + 10%', area, 'L * (W + D) * 1.1'),
      item('Track & framing', len, '3 * L'),
      item('Corner bead', len, 'L'),
    ],
  })),
  entry('act-2x4', 'Ceilings', 'Acoustic ceiling – 2×4 grid', 'area', 'Ceiling areas', ({ u, len, area, metric }) => ({
    color: '#ffc914',
    height: u(2.7, 9),
    division: '09 Finishes',
    package: 'Drywall & ceiling sub',
    items: [
      item('Ceiling area', area, 'A'),
      item('Tiles 2×4 + 5%', 'ea', `ceil(A * 1.05 / ${u(0.72, 8)})`),
      item('Main tees @ 4\', 12\' long', 'ea', metric ? 'ceil(A / 1.2 / 3.6 * 1.05)' : 'ceil(A / 4 / 12 * 1.05)'),
      item('4\' cross tees @ 2\'', 'ea', `ceil(A * 1.05 / ${u(0.72, 8)})`),
      item('Wall angle', len, 'P * 1.05'),
      item('Hanger wires @ 4\'×4\'', 'ea', `ceil(A / ${u(1.44, 16)})`),
    ],
  })),
  entry('act-2x2', 'Ceilings', 'Acoustic ceiling – 2×2 grid', 'area', 'Ceiling areas', ({ u, len, area, metric }) => ({
    color: '#f6ae2d',
    height: u(2.7, 9),
    division: '09 Finishes',
    package: 'Drywall & ceiling sub',
    items: [
      item('Ceiling area', area, 'A'),
      item('Tiles 2×2 + 5%', 'ea', `ceil(A * 1.05 / ${u(0.36, 4)})`),
      item('Main tees @ 4\', 12\' long', 'ea', metric ? 'ceil(A / 1.2 / 3.6 * 1.05)' : 'ceil(A / 4 / 12 * 1.05)'),
      item('4\' cross tees @ 2\'', 'ea', `ceil(A * 1.05 / ${u(0.72, 8)})`),
      item('2\' cross tees', 'ea', `ceil(A * 1.05 / ${u(0.72, 8)})`),
      item('Wall angle', len, 'P * 1.05'),
      item('Hanger wires @ 4\'×4\'', 'ea', `ceil(A / ${u(1.44, 16)})`),
    ],
  })),
  entry('gwb-ceiling', 'Ceilings', 'GWB ceiling – suspended', 'area', 'Ceiling areas', ({ u, len, area }) => ({
    color: '#ffd166',
    height: u(2.7, 9),
    division: '09 Finishes',
    package: 'Drywall & ceiling sub',
    items: [
      item('Ceiling area', area, 'A'),
      item('GWB + 10% waste', area, 'A * 1.1'),
      item('GWB sheets 4×8', 'ea', `ceil(A * 1.1 / ${board(u)})`),
      item('Furring channel @ 16"', len, `A / ${u(0.406, 1.333)}`),
      item('Main carrying channel @ 4\'', len, `A / ${u(1.2, 4)}`),
      item('Hanger wires @ 4\'×4\'', 'ea', `ceil(A / ${u(1.44, 16)})`),
      item('Perimeter track', len, 'P'),
      item('Tape & finish', area, 'A'),
    ],
  })),
  entry('carpet-tile', 'Flooring', 'Carpet tile', 'area', 'Floor areas', ({ len, area }) => ({
    color: '#76b041',
    height: 0,
    division: '09 Finishes',
    package: 'Flooring sub',
    items: [item('Floor area', area, 'A'), item('Carpet tile + 5% waste', area, 'A * 1.05'), item('Adhesive', area, 'A'), item('Base', len, 'P - O')],
  })),
  entry('lvt', 'Flooring', 'Luxury vinyl tile (LVT)', 'area', 'Floor areas', ({ len, area }) => ({
    color: '#4caf50',
    height: 0,
    division: '09 Finishes',
    package: 'Flooring sub',
    items: [item('Floor area', area, 'A'), item('LVT + 8% waste', area, 'A * 1.08'), item('Adhesive', area, 'A'), item('Rubber base', len, '(P - O) * 1.05')],
  })),
  entry('porcelain', 'Flooring', 'Porcelain tile floor', 'area', 'Floor areas', ({ len, area }) => ({
    color: '#2e7d32',
    height: 0,
    division: '09 Finishes',
    package: 'Flooring sub',
    items: [
      item('Floor area', area, 'A'),
      item('Tile + 10% waste', area, 'A * 1.1'),
      item('Setting bed & grout', area, 'A'),
      item('Crack isolation membrane', area, 'A'),
      item('Tile base', len, 'P - O'),
    ],
  })),
  entry('sealed-concrete', 'Flooring', 'Sealed concrete', 'area', 'Floor areas', ({ area }) => ({
    color: '#9e9e9e',
    height: 0,
    division: '09 Finishes',
    package: 'Flooring sub',
    items: [item('Floor area', area, 'A'), item('Sealer, 2 coats', area, '2 * A')],
  })),
  entry('base', 'Flooring', 'Rubber base', 'linear', 'Runs along walls', ({ len }) => ({
    color: '#558b2f',
    height: 0,
    division: '09 Finishes',
    package: 'Flooring sub',
    items: [item('Base + 5%', len, 'L * 1.05'), item('Outside corners (one per run)', 'ea', 'N')],
  })),
  entry('paint-walls', 'Painting', 'Paint walls – primer + 2 coats', 'linear', 'Wall runs; area is length × height', ({ u, area, metric }) => ({
    color: '#5c6bc0',
    height: u(3, 10),
    division: '09 Finishes',
    package: 'Painting sub',
    items: [
      item('Wall area', area, 'A'),
      item(metric ? 'Primer (10 m²/L)' : 'Primer (350 SF/gal)', metric ? 'L' : 'gal', `A / ${u(10, 350)}`),
      item(metric ? 'Finish paint, 2 coats (10 m²/L)' : 'Finish paint, 2 coats (350 SF/gal)', metric ? 'L' : 'gal', `2 * A / ${u(10, 350)}`),
    ],
  })),
  entry('paint-ceiling', 'Painting', 'Paint ceiling – 2 coats', 'area', 'Ceiling areas', ({ u, area, metric }) => ({
    color: '#7986cb',
    height: 0,
    division: '09 Finishes',
    package: 'Painting sub',
    items: [item('Ceiling area', area, 'A'), item(metric ? 'Paint, 2 coats (10 m²/L)' : 'Paint, 2 coats (350 SF/gal)', metric ? 'L' : 'gal', `2 * A / ${u(10, 350)}`)],
  })),
  entry('hm-door', 'Doors & openings', 'Hollow metal door & frame', 'count', 'One per door', () => ({
    color: '#7d5ba6',
    height: 0,
    division: '08 Openings',
    package: 'Doors & hardware sub',
    items: [item('HM frame', 'ea', 'N'), item('Door', 'ea', 'N'), item('Hardware set', 'ea', 'N'), item('Frame grout', 'ea', 'N')],
  })),
  entry('window', 'Doors & openings', 'Window', 'count', 'One per window', () => ({
    color: '#26a69a',
    height: 0,
    division: '08 Openings',
    package: 'Glazing sub',
    items: [item('Window unit', 'ea', 'N'), item('Sealant & backer (allowance)', 'ea', 'N')],
  })),
  entry('downlight', 'Electrical', 'Downlight / pot light', 'count', 'One per fixture', ({ u, len }) => ({
    color: '#ef6c00',
    height: 0,
    division: '26 Electrical',
    package: 'Electrical sub',
    items: [item('Fixture', 'ea', 'N'), item('Wire allowance per fixture', len, `N * ${u(6, 20)}`)],
  })),
  entry('receptacle', 'Electrical', 'Receptacle', 'count', 'One per outlet', ({ u, len }) => ({
    color: '#f4511e',
    height: 0,
    division: '26 Electrical',
    package: 'Electrical sub',
    items: [item('Receptacle & box', 'ea', 'N'), item('Cover plate', 'ea', 'N'), item('Wire allowance per device', len, `N * ${u(8, 25)}`)],
  })),
  entry('linear-led', 'Electrical', 'Linear LED light', 'linear', 'Fixture runs', ({ len }) => ({
    color: '#ff8f00',
    height: 0,
    division: '26 Electrical',
    package: 'Electrical sub',
    items: [item('Fixture length', len, 'L'), item('Runs (feeds)', 'ea', 'N')],
  })),
  entry('slab', 'Concrete', 'Slab on grade', 'area', 'Slab areas; set its thickness (T)', ({ u, len, area, vol, metric }) => ({
    color: '#8d6e63',
    height: 0,
    thickness: u(0.125, 0.5),
    division: '03 Concrete',
    package: 'Concrete sub',
    items: [
      item('Slab area', area, 'A'),
      item('Concrete + 5%', vol, metric ? 'A * T * 1.05' : 'A * T / 27 * 1.05'),
      item('Vapour barrier + 15% laps', area, 'A * 1.15'),
      item('Wire mesh + 10% laps', area, 'A * 1.1'),
      item('Edge form', len, 'P'),
    ],
  })),
  entry('footing', 'Concrete', 'Strip footing', 'linear', 'Footing runs; set width (W) and depth (D)', ({ u, len, vol, metric }) => ({
    color: '#6d4c41',
    height: 0,
    width: u(0.6, 2),
    depth: u(0.3, 1),
    division: '03 Concrete',
    package: 'Concrete sub',
    items: [
      item('Footing length', len, 'L'),
      item('Concrete + 5%', vol, metric ? 'L * W * D * 1.05' : 'L * W * D / 27 * 1.05'),
      item('Formwork (both sides)', metric ? 'm²' : 'SF', '2 * L * D'),
      item('Rebar (3 continuous bars)', len, '3 * L * 1.1'),
    ],
  })),
];

export const LIBRARY_TRADES = [...new Set(TYPE_LIBRARY.map((e) => e.trade))];
