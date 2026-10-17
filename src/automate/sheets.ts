import { segmentsOnce } from '../fill/sheetWalls';
import { newId, type Sheet, type Units } from '../model';
import { pageTexts } from '../pageText';
import { inspectPage, type PDFDocumentProxy, type PDFPageProxy } from '../pdf';
import { checkScale } from '../scaleCheck';
import { readTitleBlock } from '../titleBlock';
import { parseScale } from '../units';

/**
 * A page of a newly added drawing as a sheet: named from its title block (its sheet number,
 * with the drawing title beside it), and its scale read. `noText`: the page has (almost) no
 * text layer, so tags can't be read on it. Frees the page after.
 */
export async function sheetFromPage(pg: PDFPageProxy, n: number, docId: string, units: Units | undefined): Promise<{ sheet: Sheet; noText: boolean }> {
  const info = await inspectPage(pg);
  // Named from the title block: its sheet number, with the drawing title beside it.
  const named = info.textRuns >= 5 ? readTitleBlock(await pageTexts(pg), info.width, info.height) : { number: null, title: null };
  // A single standard scale on the sheet is applied automatically and flagged for checking;
  // a sheet noting its scale in both systems (1:100 and 1/8" = 1'-0") gets the project's.
  const inUnits = info.scaleHints.filter((h) => /^1:/.test(h) === (units === 'metric'));
  let detected = info.scaleHints.length === 1 ? info.scaleHints[0] : inUnits.length === 1 ? inUnits[0] : null;
  // No scale printed (a plan whose title gives none): the one its dimensions agree on.
  if (!detected && !info.scaleHints.length && info.textRuns >= 20) {
    const read = checkScale(await pageTexts(pg), await segmentsOnce(pg), units ?? 'metric');
    if (read && read.agree >= 5) detected = read.label;
  }
  pg.cleanup();
  return {
    noText: info.textRuns < 5,
    sheet: {
      id: newId(),
      docId,
      page: n,
      name: named.number ?? info.name ?? `Page ${n}`,
      ...(named.title ? { title: named.title } : {}),
      width: info.width,
      height: info.height,
      metersPerPoint: detected ? parseScale(detected) : null,
      scaleLabel: detected,
      scaleSource: detected ? 'detected' : null,
      scaleHints: info.scaleHints,
    },
  };
}

/** Every page of a drawing file as sheets, as the app makes them on upload. */
export async function sheetsOf(pdf: PDFDocumentProxy, docId: string, units: Units | undefined, progress?: (n: number, of: number) => void): Promise<{ sheets: Sheet[]; noText: number }> {
  const sheets: Sheet[] = [];
  let noText = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    progress?.(n, pdf.numPages);
    const read = await sheetFromPage(await pdf.getPage(n), n, docId, units);
    if (read.noText) noText++;
    sheets.push(read.sheet);
  }
  return { sheets, noText };
}
