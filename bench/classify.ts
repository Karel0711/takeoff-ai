import type { Sheet } from '../src/model';

// How sheets are sorted lives with the app (src/sheetKind.ts, src/sheetScale.ts): the runner sorts them as the app does.
export { classifySheet, type PlanLevel, type SheetClass } from '../src/sheetKind';
export { viewTitle } from '../src/sheetScale';

/** A drawing file issued as an addendum or revision ("arch-add3.pdf", "Addendum 2", "rev1", "reissue"). */
export const isRevisionFile = (file: string) => /add(?:endum)?[-_ ]?\d|addendum|(?:^|[-_ ])rev(?:ision)?[-_ ]?\d*(?:[-_ .]|$)|re-?issue|revised/i.test(file.replace(/\.pdf$/i, '') + '.');

/** Its addendum or revision number, 0 for an original issue. */
const revisionNumber = (file: string) => {
  const m = /(?:add(?:endum)?|rev(?:ision)?)[-_ ]?(\d+)/i.exec(file);
  return m ? +m[1] : isRevisionFile(file) ? 0.5 : 0;
};

/** The order the drawings were issued: as `listed` (key.json's drawings) where given, else originals first, then addenda by number. */
export function issueOrder(files: string[], listed: string[] = []): string[] {
  const name = (f: string) => f.split('/').pop()!;
  const rank = (f: string) => {
    const i = listed.indexOf(name(f));
    return i >= 0 ? i : listed.length + revisionNumber(name(f));
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
}

/**
 * Sheets an addendum re-issued: a sheet of an earlier file with the number (and, when both have
 * one, the title) of a sheet in a later addendum or revision file, at the same size. The app asks
 * to move takeoffs onto such a re-issue and marks the old sheet superseded; an estimator takes
 * off the latest. Two buildings' sets sharing sheet numbers (neither an addendum) are both kept.
 */
export function reissued<S extends Pick<Sheet, 'id' | 'docId' | 'name' | 'title' | 'width' | 'height'>>(sheets: S[], files: { id: string; file: string }[]): Map<string, S> {
  const order = new Map(files.map((f, i) => [f.id, i]));
  const out = new Map<string, S>();
  for (const n of sheets) {
    const file = files.find((f) => f.id === n.docId);
    if (!file || !isRevisionFile(file.file) || /^Page \d+$/.test(n.name)) continue;
    for (const o of sheets) {
      if ((order.get(o.docId) ?? 0) >= (order.get(n.docId) ?? 0) || o.name !== n.name) continue;
      if (Math.abs(o.width - n.width) >= 1 || Math.abs(o.height - n.height) >= 1) continue;
      if (o.title && n.title && o.title.trim().toUpperCase() !== n.title.trim().toUpperCase()) continue;
      out.set(o.id, n);
    }
  }
  return out;
}
