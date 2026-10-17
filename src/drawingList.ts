import type { PageText } from './pageText';

/** A line of a drawing list: a sheet number and its title. */
export interface ListedSheet {
  number: string;
  title: string;
}

/** A sheet number as drawing lists print them: A6.1, A-201, S2.01, M1-03, E0-02. */
const SHEET_NO = /^[A-Z]{1,2}[-.]?\d{1,3}(?:[.-]\d{1,3})?[A-Z]?$/;

/**
 * The drawing list on a sheet (a cover or title sheet's index of drawings): columns of sheet
 * numbers, each with its title just right of it on its line. Columns are read left to right,
 * each top to bottom, which is the order the set is bound in. Empty when the sheet has no
 * column of at least four numbered titles.
 */
export function readDrawingList(texts: PageText[]): ListedSheet[] {
  const upright = texts.filter((t) => !t.angle || Math.abs(t.angle) < 0.1);
  const entries: { at: PageText; number: string; title: string }[] = [];
  for (const t of upright) {
    const number = t.str.trim();
    if (!SHEET_NO.test(number)) continue;
    const title = upright
      .filter((o) => o !== t && Math.abs(o.cy - t.cy) < 0.5 * Math.max(o.h, t.h) && o.cx - o.w / 2 > t.cx + t.w / 2 - 0.5 && o.cx - o.w / 2 - (t.cx + t.w / 2) < 8 * t.h)
      .sort((a, b) => a.cx - b.cx)[0];
    if (!title || !/[A-Za-z]{3}/.test(title.str) || SHEET_NO.test(title.str.trim())) continue;
    entries.push({ at: t, number, title: title.str.replace(/\s+/g, ' ').trim() });
  }
  // Columns: numbers whose left edges line up.
  const columns: (typeof entries)[] = [];
  for (const e of entries.sort((a, b) => a.at.cy - b.at.cy)) {
    const left = e.at.cx - e.at.w / 2;
    const col = columns.find((c) => Math.abs(c[0].at.cx - c[0].at.w / 2 - left) <= 3);
    if (col) col.push(e);
    else columns.push([e]);
  }
  return columns
    .filter((c) => c.length >= 4)
    .sort((a, b) => a[0].at.cx - b[0].at.cx)
    .flatMap((c) => c.map((e) => ({ number: e.number, title: e.title })));
}

/** A sheet number's series: the part before its last separator (A6.1 → A6, M1-03 → M1). */
const series = (n: string) => n.replace(/[.-]\d+[A-Z]?$/, '');

/**
 * Names pages that carry no sheet number of their own (no text layer: lettering drawn as
 * linework) from the drawing list, by where they are bound: a run of unnamed pages between
 * two named sheets takes the numbers the list puts between those two, when it lists exactly
 * that many. `named(i)` is page i's sheet number, or null for an unnamed page.
 */
export function namesFromList(pages: (string | null)[], list: ListedSheet[]): (ListedSheet | null)[] {
  const out: (ListedSheet | null)[] = pages.map(() => null);
  if (list.length < 4) return out;
  const indexOf = (n: string) => list.findIndex((l) => l.number === n);
  const named = new Set(pages.filter((p): p is string => !!p).map(series));
  for (let i = 0; i < pages.length; i++) {
    if (pages[i] !== null) continue;
    let j = i;
    while (j < pages.length && pages[j] === null) j++;
    // pages i..j-1 are unnamed
    const before = i > 0 ? pages[i - 1] : null;
    const after = j < pages.length ? pages[j] : null;
    if (before && after) {
      const a = indexOf(before);
      const b = indexOf(after);
      let between = a >= 0 && b > a ? list.slice(a + 1, b) : [];
      // The list can name sheets this file does not have (bound elsewhere, or dropped): of a
      // series some of whose sheets are here by name, the rest are not these pages.
      if (between.length > j - i) between = between.filter((l) => !named.has(series(l.number)));
      if (between.length && between.length === j - i) for (let k = i; k < j; k++) out[k] = between[k - i];
    }
    i = j;
  }
  return out;
}
