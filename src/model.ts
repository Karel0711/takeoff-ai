import type { ExtractedAssembly } from './ai/schema';

export type Units = 'metric' | 'imperial';
export type Kind = 'area' | 'linear' | 'count';

/** A point in sheet space: PDF points (1/72 in) from the page's top-left corner. */
export type Pt = [number, number];

export interface SavedLegendRead {
  assemblies: ExtractedAssembly[];
  /** Type tags printed on the sheet, for the coverage check. */
  printed: string[];
  answeredBy: string;
  readAt: string;
  seconds: number;
}

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
  /** The last AI reading of this sheet's assembly legend, kept so it can be reviewed again without re-running. */
  aiAssemblies?: SavedLegendRead;
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
  /** Estimate division the type is priced in, e.g. "09 Finishes". */
  division?: string;
  /** Subtrade package it is grouped under, e.g. "Drywall / ceiling sub". */
  package?: string;
  /** Assembly heading as scheduled, e.g. "TYPICAL INTERIOR WALL – 1HR F.R.R.". */
  assemblyTitle?: string;
  /** Assembly build-up, e.g. the layers from the legend. */
  description?: string;
}

/** Estimate divisions, named as on the estimator's bid workbook tabs. */
export const DIVISIONS = [
  '01 General Requirements',
  '02 Existing Conditions',
  '03 Concrete',
  '04 Masonry',
  '05 Metals',
  '06 Wood Framing & Partitions',
  '06 Mass Timber (CLT Glulam)',
  '07 Thermal & Moisture',
  '07 Roofing',
  '08 Openings',
  '09 Finishes',
  '10 Specialties',
  '14 Conveying Equipment',
  '20-25 Mechanical',
  '26 Electrical',
  '31 Earthwork',
  '32 Exterior Improvements',
  '33 Utilities',
];

export interface Measurement {
  id: string;
  sheetId: string;
  typeId: string;
  points: Pt[];
  /** Cutouts subtracted from an area measurement. */
  holes: Pt[][];
  /** Made by the automatic wall takeoff, so a re-run can replace it. */
  source?: 'walls';
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
      division: '06 Wood Framing & Partitions',
      package: 'Drywall & framing sub',
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
      division: '06 Wood Framing & Partitions',
      package: 'Drywall & framing sub',
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
      division: '09 Finishes',
      package: 'Flooring sub',
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
      division: '09 Finishes',
      package: 'Drywall & ceiling sub',
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
      division: '08 Openings',
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
