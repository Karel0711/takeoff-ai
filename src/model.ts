export type Units = 'metric' | 'imperial';
export type Kind = 'area' | 'linear' | 'count';

/** A point in sheet space: PDF points (1/72 in) from the page's top-left corner. */
export type Pt = [number, number];

export interface Doc {
  id: string;
  name: string;
}

export type ScaleSource = 'detected' | 'preset' | 'calibrated';

export interface Sheet {
  id: string;
  docId: string;
  /** 1-based page number within the document. */
  page: number;
  name: string;
  width: number;
  height: number;
  /** Real-world metres represented by one PDF point; null until the scale is set. */
  metersPerPoint: number | null;
  scaleLabel: string | null;
  scaleSource: ScaleSource | null;
  /** Scale notations found on the sheet, offered as one-click choices. */
  scaleHints: string[];
}

/**
 * One material line of an assembly. The formula is evaluated against the
 * type's totals: L (length), H (height), A (area), P (perimeter), N (count).
 */
export interface AssemblyItem {
  id: string;
  name: string;
  unit: string;
  formula: string;
}

export interface TakeoffType {
  id: string;
  name: string;
  color: string;
  kind: Kind;
  /** Wall or room height in project length units; drives A = L × H for linear types. */
  height: number;
  items: AssemblyItem[];
}

export interface Measurement {
  id: string;
  sheetId: string;
  typeId: string;
  points: Pt[];
  /** Cutouts subtracted from an area measurement. */
  holes: Pt[][];
}

export interface Project {
  version: 1;
  name: string;
  units: Units;
  docs: Doc[];
  sheets: Sheet[];
  types: TakeoffType[];
  measurements: Measurement[];
}

export const newId = (): string => crypto.randomUUID();

const item = (name: string, unit: string, formula: string): AssemblyItem => ({
  id: newId(),
  name,
  unit,
  formula,
});

/** Starter takeoff types modelled on common GC scopes. Users edit or delete them freely. */
export function defaultTypes(units: Units): TakeoffType[] {
  const m = units === 'metric';
  const len = m ? 'm' : 'ft';
  const area = m ? 'm²' : 'SF';
  // Stud spacing, board sheet area (4×8), standard wall height.
  const s610 = m ? 0.61 : 2;
  const s406 = m ? 0.406 : 1.333;
  const sheet = m ? 2.973 : 32;
  const h = m ? 3.0 : 10;

  return [
    {
      id: newId(),
      name: 'W1 – Interior wall (92mm steel stud @ 610, 16mm GWB both sides)',
      color: '#e4572e',
      kind: 'linear',
      height: h,
      items: [
        item('Wall area', area, 'A'),
        item('92mm steel studs', 'ea', `ceil(L / ${s610}) + N`),
        item('92mm track (top + bottom)', len, '2 * L'),
        item('16mm GWB, 2 sides + 10% waste', area, '2 * A * 1.1'),
        item('GWB sheets 4×8', 'ea', `ceil(2 * A * 1.1 / ${sheet})`),
        item('Tape & finish', area, '2 * A'),
      ],
    },
    {
      id: newId(),
      name: 'FR1 – Exterior wall furring (64mm stud @ 406, 16mm GWB)',
      color: '#17bebb',
      kind: 'linear',
      height: h,
      items: [
        item('Furring area', area, 'A'),
        item('64mm steel studs', 'ea', `ceil(L / ${s406}) + N`),
        item('64mm track', len, '2 * L'),
        item('16mm GWB, 1 side + 10% waste', area, 'A * 1.1'),
      ],
    },
    {
      id: newId(),
      name: 'Floor finish',
      color: '#76b041',
      kind: 'area',
      height: h,
      items: [
        item('Floor area', area, 'A'),
        item('Floor finish + 10% waste', area, 'A * 1.1'),
        item('Base', len, 'P'),
      ],
    },
    {
      id: newId(),
      name: 'Ceiling',
      color: '#ffc914',
      kind: 'area',
      height: h,
      items: [
        item('Ceiling area', area, 'A'),
        item('Wall paint (perimeter × height)', area, 'P * H'),
      ],
    },
    {
      id: newId(),
      name: 'Doors',
      color: '#7d5ba6',
      kind: 'count',
      height: h,
      items: [item('Door, frame & hardware', 'ea', 'N')],
    },
  ];
}

export function newProject(units: Units = 'metric'): Project {
  return {
    version: 1,
    name: 'Untitled project',
    units,
    docs: [],
    sheets: [],
    types: defaultTypes(units),
    measurements: [],
  };
}
