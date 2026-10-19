import type { Segment } from '../fill/vectors';
import type { Sheet } from '../model';
import type { PageText } from '../pageText';
import type { PDFPageProxy } from '../pdf';

/** Colours new takeoff types take in turn. */
export const PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#ac8e68', '#5e5ce6', '#ff6961'];

/**
 * How an automation reads the drawing set. The app reads pages through its open pdf.js
 * documents and caches; the benchmark through pdf.js in Node. Both run the same automation.
 */
export interface SetAccess {
  /** A sheet's page, or null when its drawing is not open. */
  page(sheet: Sheet): Promise<PDFPageProxy | null>;
  /** A sheet's text runs. */
  texts(sheet: Sheet): Promise<PageText[]>;
  /** A sheet's linework, or null when its drawing is not open. */
  segments(sheet: Sheet): Promise<Segment[] | null>;
  /** Progress, for a busy indicator. */
  progress?(text: string): void;
  /**
   * Given, a sheet that fails is reported here and skipped, and the rest of the set goes on
   * (the benchmark). Not given, the error ends the run (the app shows it).
   */
  sheetError?(sheet: Sheet, error: unknown): void;
  /** Time spent on each sheet by an automation, in ms. */
  sheetTime?(sheet: Sheet, ms: number): void;
}

/** Runs one sheet's part of an automation: timed, and with its error reported (or thrown). */
export async function perSheet<T>(access: SetAccess, sheet: Sheet, run: () => Promise<T>): Promise<T | undefined> {
  const started = now();
  try {
    return await run();
  } catch (e) {
    if (!access.sheetError) throw e;
    access.sheetError(sheet, e);
    return undefined;
  } finally {
    access.sheetTime?.(sheet, now() - started);
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Lets the page repaint (a busy message) between long steps. */
export const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));
