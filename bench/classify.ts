import type { Sheet } from '../src/model';

export type SheetClass = 'floor plan' | 'RCP' | 'finish plan' | 'schedule' | 'legend' | 'assembly' | 'other';

/**
 * What a sheet is, from its number and title, as an estimator sorts a set: the plans the wall,
 * room and door tools run on are new-work floor plans of a building level. Demolition /
 * removals / existing plans, enlarged plans, roof and site plans and trade layouts (fire
 * alarm, sprinkler, lighting) are not floor plans for those tools. `why` says what decided it.
 */
export function classifySheet(sheet: Pick<Sheet, 'name' | 'title'>): { kind: SheetClass; why: string } {
  const t = `${sheet.title ?? ''}`.toUpperCase();
  const all = `${sheet.name} ${t}`.toUpperCase();
  if (/SCHEDULE/.test(t)) return { kind: 'schedule', why: 'title says schedule' };
  if (/ASSEMBL|\b(WALL|PARTITION|FLOOR|ROOF|CEILING|CONSTRUCTION)\s+TYPES\b|^TYPES\b/.test(t)) return { kind: 'assembly', why: 'title names assembly types' };
  if (/LEGEND|SYMBOLS|ABBREVIATIONS/.test(t)) return { kind: 'legend', why: 'title says legend' };
  const trade = /SPRINKLER|SUPPRESSION|FIRE PROTECTION|FIRE ALARM|LIGHTING|POWER|ELECTRICAL|MECHANICAL|PLUMBING|HVAC|DUCT|LAYOUT|STRUCTURAL|FRAMING|FOUNDATION/.test(t);
  const demo = /DEMO|REMOVAL|EXISTING/.test(t);
  if (/REFLECTED CEILING|\bRCP\b|CEILING PLAN/.test(all) && !/FLOOR PLAN/.test(t)) return { kind: 'RCP', why: demo ? 'reflected ceiling plan (demolition / existing)' : 'reflected ceiling plan' };
  if (/FINISH(ES)?\s+PLAN|FLOORING PLAN/.test(t)) return { kind: 'finish plan', why: 'title says finish plan' };
  const level = /\b(LEVEL|FLOOR|BASEMENT|CELLAR|GROUND|MAIN|MEZZANINE|STOREY|STORY|PENTHOUSE|FIRST|SECOND|THIRD|FOURTH|FIFTH)\b/.test(t);
  const plan = /\bPLANS?\b/.test(t);
  if (trade) return { kind: 'other', why: 'trade drawing' };
  if (demo) return { kind: 'other', why: 'demolition / existing plan' };
  if (/ROOF|SITE|KEY PLAN|ENLARGED|STAIR|WASHROOM|ELEVATOR|PART(IAL)? PLAN|DETAIL|SECTION|ELEVATION/.test(t)) return { kind: 'other', why: 'roof, site, enlarged or detail drawing' };
  // "Ground Floor Plan", "Level 2 Plan", or a title that is just a level ("LEVEL 1", "BASEMENT").
  if (level && (plan || /^(LEVEL\s*\w+|BASEMENT|CELLAR|GROUND( FLOOR)?|MAIN( FLOOR)?|MEZZANINE|\w+ FLOOR)$/.test(t.trim()))) return { kind: 'floor plan', why: 'floor plan of a level' };
  if (/^FLOOR PLANS?$/.test(t.trim())) return { kind: 'floor plan', why: 'title says floor plan' };
  return { kind: 'other', why: t ? 'not a plan of a level' : 'no title read' };
}

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
