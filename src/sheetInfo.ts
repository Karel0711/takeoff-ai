import { findScaleHints } from './units';

/** A text run positioned in sheet space (PDF points from the top-left corner). */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  size: number;
}

const SHEET_NUMBER = /^[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,3})?[A-Z]?$/;

/**
 * Guesses the sheet number from the title block: the largest sheet-number-shaped
 * text in the right-hand or bottom strip of the sheet, where title blocks live.
 */
export function guessSheetNumber(runs: TextRun[], width: number, height: number): string | null {
  let best: TextRun | null = null;
  for (const run of runs) {
    const str = run.str.trim();
    if (!SHEET_NUMBER.test(str)) continue;
    const inTitleBlock = run.x > width * 0.7 || run.y > height * 0.8;
    if (!inTitleBlock) continue;
    if (!best || run.size > best.size) best = { ...run, str };
  }
  return best?.str ?? null;
}

export interface SheetInfo {
  name: string | null;
  scaleHints: string[];
}

export function inspectRuns(runs: TextRun[], width: number, height: number): SheetInfo {
  return {
    name: guessSheetNumber(runs, width, height),
    scaleHints: findScaleHints(runs.map((r) => r.str).join(' ')),
  };
}
