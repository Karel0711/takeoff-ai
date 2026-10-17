import type { PageText } from '../pageText';

/**
 * What a drawing set says its type tags are, read from its own text (no AI):
 *
 * - an assembly types sheet: headings such as "Partition (p) Types:", "WALL TYPES",
 *   "Floor (f) Types:" with the type codes listed under them. Codes under a wall,
 *   partition, furring or foundation wall heading are wall types; codes under floor,
 *   roof, ceiling, soffit, door or window headings are not.
 * - a symbol legend on a plan: a placeholder code in its symbol ("w#", "p#", "Wxx")
 *   beside what it stands for ("Partition Type", "Window Type, see A300 Sheets"). That
 *   gives which code prefixes are walls and which are something else.
 */
export interface SetTypes {
  /** Wall type codes as the set writes them (px7, EW3A). */
  wall: string[];
  /** Codes the set lists as other assemblies (floor fx2, ceiling c1, soffit sx1). */
  other: string[];
  /** Kind of each wall code read from its heading: exterior, partition, furring, foundation. */
  kinds: Record<string, string>;
  /** Code prefixes a legend gives as walls (w, p) and as other things (W window, f floor). */
  wallPrefixes: string[];
  otherPrefixes: string[];
}

export const emptySetTypes = (): SetTypes => ({ wall: [], other: [], kinds: {}, wallPrefixes: [], otherPrefixes: [] });

/**
 * A type code as drawings write them: one to four letters (an "x" in them often marks
 * existing work: px7, fwx2), an optional dash, a number and an optional letter.
 */
export const CODE = /^[A-Za-z]{1,4}-?\d{1,3}[A-Za-z]?$/;

const WALL_WORDS = /\b(?:walls?|partitions?|furring|linings?|shaft\s*walls?|demising|chase|parapets?)\b/i;
const OTHER_WORDS = /\b(?:floors?|roofs?|ceilings?|soffits?|slabs?|decks?|doors?|windows?|openings?|frames?|glazing|storefronts?|millwork|casework|equipment|rooms?|fixtures?|finish(?:es)?|stairs?|curtain\s*walls?|louvres?|louvers?|bulkheads?)\b/i;
/** A heading over a list of types: "Partition (p) Types:", "WALL TYPES", "Floor Assemblies". */
const HEADING = /^(.{2,48}?)\s*(?:\(([A-Za-z]{1,4})\)\s*)?(?:types?|assembl(?:y|ies)|schedule)(?:\s*[-–(]?\s*continued\)?)?\s*:?$/i;

/** A code's letters without the digits, and without a trailing existing-work "x" (px7 → p). */
export function codePrefix(code: string): { letters: string; base: string } {
  const letters = code.replace(/-?\d.*$/, '');
  const base = letters.length > 1 && /x$/i.test(letters) ? letters.slice(0, -1) : letters;
  return { letters, base };
}

/** What a heading or legend description names: a kind of wall, or something else. */
export function describes(text: string, partitionsListed = false): 'exterior' | 'partition' | 'furring' | 'foundation' | 'other' | null {
  const t = text.replace(/\([^)]*\)/g, ' ');
  // "Curtain wall" and "wall finishes" are not wall types.
  if (/curtain\s*walls?|wall\s+finish/i.test(t)) return 'other';
  if (WALL_WORDS.test(t)) {
    if (/foundation/i.test(t)) return 'foundation';
    if (/furring|lining/i.test(t)) return 'furring';
    if (/exterior|\bext\b|outside|cladding|parapet/i.test(t)) return 'exterior';
    if (/partition|interior|\bint\b|demising|shaft|chase/i.test(t)) return 'partition';
    // A plain "Wall Types" beside a list of partition types is the outside walls.
    return partitionsListed ? 'exterior' : 'partition';
  }
  if (OTHER_WORDS.test(t)) return 'other';
  return null;
}

interface Heading {
  text: string;
  kind: NonNullable<ReturnType<typeof describes>>;
  prefix?: string;
  x0: number;
  cy: number;
}

/**
 * The codes an assembly types sheet lists, sorted by the heading each sits under: the
 * nearest heading above it in its column (and, when the heading names its prefix
 * "(fw)", only codes with that prefix).
 */
export function readTypeSheet(texts: PageText[], pageWidth: number, pageHeight = pageWidth * 0.7): Pick<SetTypes, 'wall' | 'other' | 'kinds'> | null {
  const owner = listedCodes(texts, pageWidth, pageHeight);
  const out = { wall: [] as string[], other: [] as string[], kinds: {} as Record<string, string> };
  for (const [t, kind] of owner) {
    const code = t.str.trim();
    if (kind === 'other') {
      if (!out.other.includes(code)) out.other.push(code);
    } else if (!out.wall.includes(code)) {
      out.wall.push(code);
      out.kinds[code] = kind;
    }
  }
  return out.wall.length + out.other.length ? out : null;
}

/** The codes a sheet lists under type headings (a schedule or legend), each with its heading's kind. */
export function listedCodes(texts: PageText[], pageWidth: number, pageHeight = pageWidth * 0.7): Map<PageText, Heading['kind']> {
  const heights = texts.map((t) => t.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const raw = texts.filter((t) => Math.abs(Math.sin(t.angle ?? 0)) < 0.5 && HEADING.test(t.str.trim()));
  // Headings stand out from the notes by their size, when the sheet sizes them.
  const big = raw.filter((t) => t.h >= median * 1.3);
  const pool = big.length >= 2 ? big : raw;
  const partitionsListed = pool.some((t) => /partition|interior/i.test(t.str));
  const headings: (Heading & { left: number; right: number })[] = [];
  for (const t of pool) {
    const m = HEADING.exec(t.str.trim())!;
    const kind = describes(m[1], partitionsListed);
    if (!kind) continue;
    headings.push({ text: t.str, kind, prefix: m[2], x0: t.cx - t.w / 2, cy: t.cy, left: 0, right: 0 });
  }
  if (headings.length < 1) return new Map();
  // Each heading's column: from its start (or, with no column to its left, well left of it:
  // a title centred over its table) to where the next column starts.
  for (const h of headings) {
    const before = headings.some((o) => o.x0 < h.x0 - 40 && o.x0 > h.x0 - pageWidth * 0.25);
    h.left = h.x0 - (before ? 10 : pageWidth * 0.12);
    h.right = headings.filter((o) => o.x0 > h.x0 + 40).reduce((m, o) => Math.min(m, o.x0 - 10), h.x0 + pageWidth * 0.25);
  }
  const codes = texts.filter((t) => CODE.test(t.str.trim()) && Math.abs(Math.sin(t.angle ?? 0)) < 0.5).sort((a, b) => a.cy - b.cy);
  // A list runs down its column: it ends at the next heading in the column, or at a gap
  // no table row leaves (a plan's own tags further down the sheet are not in it).
  const gap = pageHeight * 0.12;
  const owner = new Map<PageText, (typeof headings)[number]>();
  for (const h of headings) {
    let last = h.cy;
    for (const t of codes) {
      if (t.cy <= h.cy || t.cx < h.left || t.cx > h.right) continue;
      if (t.cy - last > gap) break;
      if (headings.some((o) => o !== h && Math.abs(o.x0 - h.x0) <= 40 && o.cy > h.cy && o.cy < t.cy)) break;
      last = t.cy;
      if (h.prefix && h.prefix.toLowerCase() !== codePrefix(t.str.trim()).base.toLowerCase()) continue;
      const prev = owner.get(t);
      if (!prev || h.cy > prev.cy) owner.set(t, h);
    }
  }
  return new Map([...owner].map(([t, h]) => [t, h.kind]));
}

/** A legend placeholder: a prefix and "#", "##", "xx" or "XX" in place of the number (w#, Wxx). */
const PLACEHOLDER = /^([A-Za-z]{1,4})(?:#{1,2}|xx|XX)$/;

/**
 * Prefixes a symbol legend explains: each placeholder with the words to its right on
 * its line ("p#  Partition Type", "Wxx  Window Type, see A300 Sheets").
 */
export function readTagLegend(texts: PageText[]): Pick<SetTypes, 'wallPrefixes' | 'otherPrefixes'> {
  const wallPrefixes: string[] = [];
  const otherPrefixes: string[] = [];
  for (const t of texts) {
    const m = PLACEHOLDER.exec(t.str.trim());
    if (!m) continue;
    const right = texts
      .filter((o) => o !== t && o.cx - o.w / 2 > t.cx && o.cx - o.w / 2 - (t.cx + t.w / 2) < 30 * t.h && Math.abs(o.cy - t.cy) < 1.5 * Math.max(t.h, o.h))
      .sort((a, b) => a.cx - a.w / 2 - (b.cx - b.w / 2));
    if (!right.length) continue;
    // The first words beside it name the symbol ("Foundation Wall Type, Wall Type").
    const kind = describes(right[0].str);
    if (!kind) continue;
    const list = kind === 'other' ? otherPrefixes : wallPrefixes;
    if (!list.includes(m[1])) list.push(m[1]);
  }
  return { wallPrefixes, otherPrefixes };
}

/** Merges what each sheet of a set says. */
export function mergeSetTypes(parts: Partial<SetTypes>[]): SetTypes {
  const out = emptySetTypes();
  for (const p of parts) {
    for (const c of p.wall ?? []) if (!out.wall.includes(c)) out.wall.push(c);
    for (const c of p.other ?? []) if (!out.other.includes(c) && !out.wall.includes(c)) out.other.push(c);
    Object.assign(out.kinds, p.kinds ?? {});
    for (const c of p.wallPrefixes ?? []) if (!out.wallPrefixes.includes(c)) out.wallPrefixes.push(c);
    for (const c of p.otherPrefixes ?? []) if (!out.otherPrefixes.includes(c)) out.otherPrefixes.push(c);
  }
  out.other = out.other.filter((c) => !out.wall.includes(c));
  // A prefix explained both ways on different sheets says nothing.
  const both = out.wallPrefixes.filter((c) => out.otherPrefixes.includes(c));
  out.wallPrefixes = out.wallPrefixes.filter((c) => !both.includes(c));
  out.otherPrefixes = out.otherPrefixes.filter((c) => !both.includes(c));
  return out;
}

export type TagClass = { wall: true; confirmed: boolean } | { wall: false; generic: boolean };

/**
 * Whether a code on a plan is a wall type tag, by what the set says:
 * the project's own wall types, then the set's assembly types sheet, then its symbol
 * legend's prefixes, then the usual wall prefixes (`fallback`). A set that lists its wall
 * types makes any other code something else; without a list, an unknown code counts
 * only when its leader lands on a wall (`generic`).
 */
export function classifyCode(code: string, set: SetTypes, known: readonly string[], fallback: (code: string) => boolean): TagClass | null {
  const plain = code.replace('-', '');
  if (known.includes(plain) || known.includes(code)) return { wall: true, confirmed: true };
  if (set.wall.includes(code) || set.wall.includes(plain)) return { wall: true, confirmed: true };
  if (set.other.includes(code) || set.other.includes(plain)) return null;
  const { letters, base } = codePrefix(plain);
  // Exact case first: W (window) and w (wall) are different symbols on some sets.
  const exact = (list: string[]) => list.includes(letters) || list.includes(base);
  const loose = (list: string[]) => list.some((q) => [letters, base].some((p) => q.toLowerCase() === p.toLowerCase()));
  if (exact(set.otherPrefixes)) return null;
  // The set lists its wall types and this is none of them (a legend's "w#" does not add w1).
  if (set.wall.length >= 2) return null;
  if (exact(set.wallPrefixes)) return { wall: true, confirmed: true };
  if (loose(set.otherPrefixes) && !loose(set.wallPrefixes)) return null;
  if (loose(set.wallPrefixes) && !loose(set.otherPrefixes)) return { wall: true, confirmed: true };
  if (known.length) return { wall: false, generic: true };
  return fallback(plain) ? { wall: true, confirmed: false } : { wall: false, generic: true };
}
