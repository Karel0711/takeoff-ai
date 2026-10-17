import { segmentsOnce } from '../fill/sheetWalls';
import { newId, type Sheet, type Units } from '../model';
import { pageTexts } from '../pageText';
import { inspectPage, type PDFDocumentProxy, type PDFPageProxy } from '../pdf';
import { checkScale } from '../scaleCheck';
import { namesFromList, readDrawingList, type ListedSheet } from '../drawingList';
import { classifySheet } from '../sheetKind';
import { mainDrawingScale, scaleHintsOf, scaleNotes, viewTitle } from '../sheetScale';
import { readTitleBlock } from '../titleBlock';
import { parseScale } from '../units';

/**
 * A page of a newly added drawing as a sheet: named from its title block (its sheet number,
 * with the drawing title beside it; with no title there, its biggest drawing title), and its
 * scale read. `noText`: the page has (almost) no text layer, so tags can't be read on it. Frees
 * the page after.
 */
export async function sheetFromPage(pg: PDFPageProxy, n: number, docId: string, units: Units | undefined): Promise<{ sheet: Sheet; noText: boolean; list: ListedSheet[] }> {
  const info = await inspectPage(pg);
  const texts = info.textRuns >= 5 ? await pageTexts(pg) : [];
  // Named from the title block: its sheet number, with the drawing title beside it.
  const named = texts.length ? readTitleBlock(texts, info.width, info.height) : { number: null, title: null };
  const title = named.title ?? (texts.length ? viewTitle(texts) : null);
  // Every scale noted, "=" or not (some exports draw the sign as linework).
  const hints = texts.length ? scaleHintsOf(texts, scaleNotes(texts)) : info.scaleHints;
  // A single standard scale on the sheet is applied automatically and flagged for checking;
  // a sheet noting its scale in both systems (1:100 and 1/8" = 1'-0") gets the project's.
  const inUnits = hints.filter((h) => /^1:/.test(h) === (units === 'metric'));
  let detected = hints.length === 1 ? hints[0] : inUnits.length === 1 ? inUnits[0] : null;
  // Several noted (a plan with its details): the main drawing's.
  const several = inUnits.length > 1 ? inUnits : hints;
  if (!detected && several.length > 1) detected = mainDrawingScale(several, texts, await segmentsOnce(pg), units ?? 'metric', title ?? undefined)?.label ?? null;
  // No scale printed (a plan whose title gives none): the one its dimensions agree on.
  if (!detected && !hints.length && info.textRuns >= 20) {
    const read = checkScale(texts, await segmentsOnce(pg), units ?? 'metric');
    if (read && read.agree >= 5) detected = read.label;
  }
  pg.cleanup();
  return {
    // A drawing list on the page (a cover sheet's index), for naming pages that carry no text.
    list: texts.length ? readDrawingList(texts) : [],
    noText: info.textRuns < 5,
    sheet: {
      id: newId(),
      docId,
      page: n,
      name: named.number ?? info.name ?? `Page ${n}`,
      ...(title ? { title } : {}),
      width: info.width,
      height: info.height,
      metersPerPoint: detected ? parseScale(detected) : null,
      scaleLabel: detected,
      scaleSource: detected ? 'detected' : null,
      scaleHints: hints,
    },
  };
}

const PLAN_KINDS = new Set(['floor plan', 'RCP', 'finish plan']);
/** The level a plan is of ("SECOND FLOOR", "LEVEL 2", "BASEMENT"), to pair a ceiling plan with its floor plan. */
const levelOf = (title: string) =>
  /\b(BASEMENT|CELLAR|GROUND|MAIN|MEZZANINE|PENTHOUSE|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|\d+(?:ST|ND|RD|TH))\b|\bLEVEL\s*(\w+)/
    .exec(title.toUpperCase())
    ?.slice(1)
    .find(Boolean) ?? null;

/** Sheets of one size, give or take a re-save's trim (a page cropped a few points differently). */
const sameSize = (a: Sheet, b: Sheet) => Math.abs(a.width - b.width) <= Math.max(1, 0.03 * b.width) && Math.abs(a.height - b.height) <= Math.max(1, 0.03 * b.height);

/**
 * Plans that note no scale and whose dimensions read none (a reflected ceiling plan has few):
 * the scale of the drawing file's plans on sheets of the same size, the way an estimator scales
 * an RCP like its floor plan. The plan of the same level when there is one, else the scale every
 * such plan of the file is at; left unscaled when they differ.
 */
export function scalesFromSet(sheets: Sheet[]): Sheet[] {
  const kind = new Map(sheets.map((s) => [s.id, classifySheet(s).kind]));
  return sheets.map((s) => {
    if (s.metersPerPoint || s.scaleHints.length || !PLAN_KINDS.has(kind.get(s.id)!)) return s;
    const peers = sheets.filter((o) => o !== s && o.docId === s.docId && o.metersPerPoint && o.scaleLabel && PLAN_KINDS.has(kind.get(o.id)!) && sameSize(o, s));
    const level = levelOf(s.title ?? '');
    const same = level ? peers.filter((o) => levelOf(o.title ?? '') === level) : [];
    const from = same.length ? same : peers.length >= 2 ? peers : [];
    const labels = new Set(from.map((o) => o.scaleLabel));
    if (labels.size !== 1) return s;
    const label = [...labels][0]!;
    return { ...s, metersPerPoint: parseScale(label), scaleLabel: label, scaleSource: 'detected' as const };
  });
}

/** Every page of a drawing file as sheets, as the app makes them on upload. */
export async function sheetsOf(pdf: PDFDocumentProxy, docId: string, units: Units | undefined, progress?: (n: number, of: number) => void): Promise<{ sheets: Sheet[]; noText: number }> {
  const sheets: Sheet[] = [];
  let noText = 0;
  let list: ListedSheet[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progress?.(n, pdf.numPages);
    const read = await sheetFromPage(await pdf.getPage(n), n, docId, units);
    if (read.noText) noText++;
    sheets.push(read.sheet);
    if (read.list.length > list.length) list = read.list;
  }
  return { sheets: scalesFromSet(namedFromList(sheets, list)), noText };
}

/**
 * Pages with no sheet number read (lettering drawn as linework) named from the set's drawing
 * list by where they are bound, between two sheets it lists (an RCP pair between A5.2 and A7.1
 * is A6.1 and A6.2), with the list's title when the page has none.
 */
export function namedFromList(sheets: Sheet[], list: ListedSheet[]): Sheet[] {
  if (!list.length) return sheets;
  const unnamed = (x: Sheet) => /^Page \d+$/.test(x.name);
  const names = namesFromList(sheets.map((x) => (unnamed(x) ? null : x.name)), list);
  return sheets.map((x, i) => (names[i] ? { ...x, name: names[i]!.number, ...(x.title ? {} : { title: names[i]!.title }) } : x));
}
