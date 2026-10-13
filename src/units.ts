import type { Units } from './model';

/** Metres covered by one PDF point on paper (1 pt = 1/72 in). */
const PAPER_M_PER_PT = 0.0254 / 72;
const M_PER_FT = 0.3048;

export const SCALE_PRESETS: Record<Units, string[]> = {
  metric: ['1:1000', '1:500', '1:250', '1:200', '1:100', '1:75', '1:50', '1:25', '1:20', '1:10', '1:5'],
  imperial: [
    '1/16" = 1\'-0"',
    '3/32" = 1\'-0"',
    '1/8" = 1\'-0"',
    '3/16" = 1\'-0"',
    '1/4" = 1\'-0"',
    '3/8" = 1\'-0"',
    '1/2" = 1\'-0"',
    '3/4" = 1\'-0"',
    '1" = 1\'-0"',
    '1 1/2" = 1\'-0"',
    '1" = 10\'',
    '1" = 20\'',
    '1" = 30\'',
    '1" = 40\'',
    '1" = 50\'',
    '1" = 100\'',
  ],
};

function parseFraction(text: string): number | null {
  const t = text.trim();
  let match = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (match) return Number(match[1]) + Number(match[2]) / Number(match[3]);
  match = /^(\d+)\/(\d+)$/.exec(t);
  if (match) return Number(match[1]) / Number(match[2]);
  match = /^\d+(\.\d+)?$/.exec(t);
  if (match) return Number(t);
  return null;
}

/**
 * Parses a drawing scale notation into real metres per PDF point.
 * Accepts ratios ("1:100", "1 : 50") and imperial notation
 * ("1/8\" = 1'-0\"", "1\" = 20'").
 */
export function parseScale(label: string): number | null {
  const ratio = /^\s*1\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(label);
  if (ratio) {
    const n = Number(ratio[1]);
    return n > 0 ? n * PAPER_M_PER_PT : null;
  }
  // Architectural: <paper inches>" = 1'-0"
  const arch = /^\s*([\d\s/.]+?)\s*"\s*=\s*1\s*'\s*(?:-\s*0\s*"?)?\s*$/.exec(label);
  if (arch) {
    const paperIn = parseFraction(arch[1]);
    if (!paperIn || paperIn <= 0) return null;
    return (M_PER_FT / paperIn) * (1 / 72);
  }
  // Engineering: 1" = <feet>'
  const eng = /^\s*1\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'\s*$/.exec(label);
  if (eng) {
    const feet = Number(eng[1]);
    return feet > 0 ? (feet * M_PER_FT) / 72 : null;
  }
  return null;
}

/** Ratios used for drawing scales; other "1:n" text on sheets is usually a callout or note. */
const STANDARD_RATIOS = new Set([
  2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000,
]);

/** Finds standard ratio scale notations ("1 : 100") in sheet text, excluding 1:1. */
export function findScaleHints(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<![\d.])1\s*:\s*(\d{1,4})(?![\d.])/g)) {
    const n = Number(match[1]);
    if (STANDARD_RATIOS.has(n)) found.add(`1:${n}`);
  }
  const metric = [...found].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  // Imperial notes: 1/8" = 1'-0", 1 1/2"=1'-0", 1" = 20' (straight or curly quotes, any spacing).
  const imperial = new Set<string>();
  const inch = `(?:"|''|\u2033|\u201d)`;
  const foot = `(?:'|\u2032|\u2019)`;
  const re = new RegExp(`(?<![\\d/])(\\d+(?:\\s+\\d+\\/\\d+)?(?:\\/\\d+)?)\\s*${inch}\\s*=\\s*(\\d+)\\s*${foot}(?:\\s*-?\\s*0\\s*${inch})?`, 'g');
  for (const match of text.matchAll(re)) {
    const paper = parseFraction(match[1]);
    if (!paper) continue;
    const mpp = (Number(match[2]) * M_PER_FT) / (paper * 72);
    const preset = SCALE_PRESETS.imperial.find((l) => Math.abs(parseScale(l)! / mpp - 1) < 0.005);
    if (preset) imperial.add(preset);
  }
  return [...metric, ...SCALE_PRESETS.imperial.filter((l) => imperial.has(l))];
}

/**
 * Parses a real-world length typed by the user into metres.
 * Metric: "3.5" (m), "3500mm", "350cm", "3.5m". Imperial: "12.5" (ft), "12'6\"", "12' 6 1/2\"", "150\"".
 */
export function parseLength(input: string, units: Units): number | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  const metric = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/.exec(t);
  if (metric && (units === 'metric' || metric[2])) {
    const value = Number(metric[1]);
    const factor = metric[2] === 'mm' ? 0.001 : metric[2] === 'cm' ? 0.01 : metric[2] === 'm' ? 1 : 1;
    return value > 0 ? value * factor : null;
  }
  if (units === 'imperial' && /^\d+(\.\d+)?$/.test(t)) {
    const value = Number(t);
    return value > 0 ? value * M_PER_FT : null;
  }
  const imperial = /^(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:([\d\s/.]+?)\s*")?$/.exec(t);
  if (imperial && (imperial[1] || imperial[2])) {
    const feet = imperial[1] ? Number(imperial[1]) : 0;
    const inches = imperial[2] ? parseFraction(imperial[2]) : 0;
    if (inches === null) return null;
    const total = feet + inches / 12;
    return total > 0 ? total * M_PER_FT : null;
  }
  return null;
}

/** Converts metres to project length units (m or ft). */
export const toLength = (meters: number, units: Units): number =>
  units === 'metric' ? meters : meters / M_PER_FT;

/** Converts square metres to project area units (m² or SF). */
export const toArea = (sqMeters: number, units: Units): number =>
  units === 'metric' ? sqMeters : sqMeters / (M_PER_FT * M_PER_FT);

export const lengthUnit = (units: Units): string => (units === 'metric' ? 'm' : 'ft');
export const areaUnit = (units: Units): string => (units === 'metric' ? 'm²' : 'SF');

export function formatQty(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** A calibrated scale written as the nearest familiar notation, e.g. "≈ 1:200" or "≈ 1/8\" = 1'-0\"". */
export function equivalentScale(metersPerPoint: number, units: Units): string {
  const ratio = metersPerPoint / (0.0254 / 72);
  if (units === 'metric') return `≈ 1:${ratio >= 20 ? Math.round(ratio) : Number(ratio.toFixed(1))}`;
  // Paper inches per real foot.
  const inchesPerFoot = 12 / ratio;
  const sixteenths = Math.round(inchesPerFoot * 16);
  if (sixteenths >= 1 && Math.abs(sixteenths / 16 - inchesPerFoot) / inchesPerFoot < 0.02) {
    const whole = Math.floor(sixteenths / 16);
    let num = sixteenths % 16;
    let den = 16;
    while (num && num % 2 === 0) {
      num /= 2;
      den /= 2;
    }
    const frac = num ? `${whole ? `${whole} ` : ''}${num}/${den}` : `${whole}`;
    return `≈ ${frac}" = 1'-0"`;
  }
  return `≈ 1" = ${Math.round(ratio / 12)}'`;
}

