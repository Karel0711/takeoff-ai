import type { Sheet } from '../src/model';

export type SheetClass = 'floor plan' | 'RCP' | 'finish plan' | 'schedule' | 'legend' | 'assembly' | 'other';

/** Which plan of the building a floor plan is: a level's, the foundation's or the roof's (walls are taken off all three, rooms only off levels). */
export type PlanLevel = 'level' | 'foundation' | 'roof';

const NOT_A_FLOOR_PLAN =
  /SITE|KEY PLAN|ENLARGED?|STAIR|WASHROOM|ELEVATOR|PART(IAL)? PLAN|DETAIL|SECTION|ELEVATION|LIFE SAFETY|FIRE SEPARATION|DISTANCE|PHASING|SEQUENC|STAGING|HOARDING|CODE|BID FORM|MILLWORK|FURNITURE|EQUIPMENT|FIXTURE|SIGNAGE|LANDSCAPE|GRADING|SERVICING|DRAINAGE|PAVING|SURVEY/;
const TRADE = /SPRINKLER|SUPPRESSION|FIRE PROTECTION|FIRE ALARM|LIGHTING|POWER|ELECTRICAL|MECHANICAL|PLUMBING|HVAC|DUCT|LAYOUT|STRUCTURAL|FRAMING|COMMUNICATION|DATA|SECURITY/;

/**
 * What a sheet is, from its title, as an estimator sorts a set: the plans the wall, room and
 * door tools run on are new-work plans of the building (a level's, its foundation's or its
 * roof's). Demolition / removals / existing plans, enlarged plans, site and life-safety plans
 * and trade layouts (fire alarm, sprinkler, lighting) are not. `why` says what decided it.
 */
export function classifySheet(sheet: Pick<Sheet, 'name' | 'title'>): { kind: SheetClass; why: string; level?: PlanLevel } {
  const t = `${sheet.title ?? ''}`.toUpperCase().replace(/\s+/g, ' ').trim();
  if (/SCHEDULE/.test(t)) return { kind: 'schedule', why: 'title says schedule' };
  if (/ASSEMBL|\b(WALL|PARTITION|FLOOR|ROOF|CEILING|CONSTRUCTION)\s+TYPES\b|^TYPES\b/.test(t)) return { kind: 'assembly', why: 'title names assembly types' };
  if (/LEGEND|SYMBOLS|ABBREVIATIONS/.test(t)) return { kind: 'legend', why: 'title says legend' };
  const demo = /DEMO|REMOVAL|EXISTING/.test(t);
  // "Floor plan & RCP" on one sheet is a floor plan; "RCP ground floor plan" a ceiling plan.
  const combined = /FLOOR PLAN\s*(&|AND|\+|\/)\s*(RCP|REFLECTED)|(RCP|REFLECTED CEILING PLAN)\s*(&|AND|\+|\/)\s*FLOOR PLAN/.test(t);
  if (/REFLECTED CEILING|\bRCP\b|CEILING PLAN/.test(t) && !combined) return { kind: 'RCP', why: demo ? 'reflected ceiling plan (demolition / existing)' : 'reflected ceiling plan' };
  if (/FINISH(ES)?\b.*\bPLANS?\b|FLOORING PLAN/.test(t)) return { kind: 'finish plan', why: 'title says finish plan' };
  if (TRADE.test(t)) return { kind: 'other', why: 'trade drawing' };
  if (demo) return { kind: 'other', why: 'demolition / existing plan' };
  if (/\bPLANS?\b/.test(t) && NOT_A_FLOOR_PLAN.test(t)) return { kind: 'other', why: 'site, enlarged, life-safety or other special plan' };
  if (/ROOF/.test(t) && /\bPLANS?\b/.test(t)) return { kind: 'floor plan', why: 'roof plan (walls only)', level: 'roof' };
  if (/FOUNDATION|FOOTING/.test(t) && /\bPLANS?\b/.test(t)) return { kind: 'floor plan', why: 'foundation plan (walls only)', level: 'foundation' };
  const level = /\b(LEVEL|FLOOR|BASEMENT|CELLAR|GROUND|MAIN|MEZZANINE|STOREY|STORY|PENTHOUSE|FIRST|SECOND|THIRD|FOURTH|FIFTH|UPPER|LOWER)\b/.test(t);
  const work = /\b(PROPOSED|NEW|CONSTRUCTION|RENOVATION|ADDITION|OVERALL|GENERAL ARRANGEMENT)\b/.test(t);
  if (/\bPLANS?\b/.test(t) && (level || work)) return { kind: 'floor plan', why: 'floor plan', level: 'level' };
  // A title that is just a level ("LEVEL 1", "BASEMENT").
  if (/^(LEVEL\s*\w+|BASEMENT|CELLAR|GROUND( FLOOR)?|MAIN( FLOOR)?|MEZZANINE|\w+ FLOOR)$/.test(t)) return { kind: 'floor plan', why: 'titled by its level', level: 'level' };
  if (/^(FLOOR )?PLANS?$/.test(t)) return { kind: 'floor plan', why: 'titled plan', level: 'level' };
  return { kind: 'other', why: t ? 'not a plan of the building' : 'no title read' };
}

/**
 * A sheet's title when its title block gave none: its most prominent drawing title (the
 * biggest text naming a plan, elevation, section, schedule or legend), the way an estimator
 * reads a sheet with no title block text.
 */
export function viewTitle(texts: { str: string; h: number }[]): string | null {
  const words = /\b(PLANS?|RCP|ELEVATIONS?|SECTIONS?|DETAILS?|SCHEDULES?|LEGENDS?|ASSEMBL\w*|TYPES)\b/i;
  // Any direction: a title block's title often runs up the sheet's edge.
  const c = texts.filter((t) => t.str.length >= 4 && t.str.length <= 80 && words.test(t.str) && !/^(SEE|REFER|NOTE|ALL|PROVIDE)\b/i.test(t.str) && !/:$/.test(t.str.trim()));
  if (!c.length) return null;
  const top = Math.max(...c.map((t) => t.h));
  return c.find((t) => t.h >= top * 0.98)!.str.trim();
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
