import { guessDivision } from '../divisionGuess';
import { findLegends } from '../fill/autoSymbols';
import { findLegendAreas } from '../fill/legend';
import { dashLines, pairParallels } from '../fill/runs';
import { buildWallModel, fillRoom } from '../fill/roomFill';
import { findEnclosedTags } from '../fill/typeTags';
import type { Segment } from '../fill/vectors';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { drawingTitles } from '../sheetScale';
import { titleBlockBox } from '../titleBlock';
import type { Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';

/**
 * Automate › Keynotes and demolition: the architect's numbered notes, taken off where the plans
 * point to them, as an estimator works a renovation set.
 *
 * - A sheet's keynote list ("5  REMOVE AND DISPOSE OF EXISTING RUBBER CLIMBING WALL", a washroom
 *   accessory legend "7  INTERIOR LOCK BUTTON") is read off the sheet, and every tag of a note's
 *   number on the sheet (a number in a box, circle or hexagon) counts one.
 * - On a demolition plan, a note that removes a surface (flooring, a ceiling, tile, a slab) is
 *   measured as the area of the room its tag is in; every other note is counted.
 * - On a demolition plan, walls drawn dashed (to be demolished) are measured as one length.
 */

export interface KeynotesResult extends Automation {
  checks: string[];
}

export interface Keynote {
  number: string;
  text: string;
  /** The note's own number run (not a tag). */
  run: PageText;
}

const pointIn = ([x, y]: Pt, ring: Pt[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const upright = (t: PageText) => Math.abs(Math.sin(t.angle ?? 0)) < 0.1;

/**
 * Numbered notes listed down a column: a number alone (no full stop: "1." is a general note) with
 * the note's words starting just right of it, three or more one under another; each note's words
 * run on down to the next number.
 */
export function keynoteList(texts: PageText[]): Keynote[] {
  const nums = texts.filter((t) => upright(t) && /^\d{1,2}$/.test(t.str.trim()));
  const withWords = nums
    .map((n) => {
      const words = texts.filter((o) => o !== n && upright(o) && Math.abs(o.cy - n.cy) < n.h * 0.6 && o.cx - o.w / 2 > n.cx + n.w / 2 && o.cx - o.w / 2 - (n.cx + n.w / 2) < n.h * 9 && /^[A-Z*"(][A-Za-z]/.test(o.str.trim()));
      return { n, first: words.sort((a, b) => a.cx - b.cx)[0] };
    })
    .filter((x) => x.first && /[A-Za-z]{3}/.test(x.first.str));
  // Columns: numbers whose words start at one left edge.
  const cols = new Map<number, typeof withWords>();
  for (const x of withWords) {
    const k = Math.round((x.first.cx - x.first.w / 2) / 4);
    const key = [...cols.keys()].find((c) => Math.abs(c - k) <= 1) ?? k;
    cols.set(key, [...(cols.get(key) ?? []), x]);
  }
  const out: Keynote[] = [];
  for (const col of cols.values()) {
    if (col.length < 3) continue;
    col.sort((a, b) => a.n.cy - b.n.cy);
    const left = Math.min(...col.map((x) => x.first.cx - x.first.w / 2));
    col.forEach((x, i) => {
      const next = col[i + 1]?.n.cy ?? x.n.cy + x.n.h * 6;
      const lines = texts
        .filter((o) => upright(o) && Math.abs(o.cx - o.w / 2 - left) <= 3 && o.cy >= x.n.cy - x.n.h * 0.5 && o.cy < next - x.n.h * 0.5 && o.cy - x.n.cy < x.n.h * 6)
        .sort((a, b) => a.cy - b.cy);
      const text = lines
        .map((l) => l.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({ number: x.n.str.trim(), text, run: x.n });
    });
  }
  // One note per number: the first list wins (a sheet with two lists keeps both only if their numbers differ).
  const seen = new Set<string>();
  return out.filter((k) => (seen.has(k.number) ? false : (seen.add(k.number), true)));
}

/** A note removing a room's surface, measured as the room's area: flooring, a ceiling (not a thing hung from one). */
const AREA = /^(FLOORING|CARPET|[A-Z ]*\bFLOOR (AND BASE|TILE|FINISH)|[A-Z ]*\b(ACT|TILE|ACOUSTIC|GYPSUM BOARD|PLASTER) CEILING|[A-Z ]*\bCEILING(,| AND| TILES?\b|$)(?! MOUNTED))/i;

/** Whether a sheet is an architectural demolition plan. */
export const isDemoPlan = (s: Sheet, texts: PageText[]) => {
  if (s.superseded || !s.metersPerPoint || tradeOfNumber(s.name ?? '')) return false;
  const t = [s.title ?? '', ...drawingTitles(texts).slice(0, 3).map((d) => d.str)].join(' ').toUpperCase();
  return /\bPLANS?\b/.test(t) && /DEMOLITION|\bDEMO\b|REMOVALS?/.test(t);
};

const SITE_SURFACE = /\b(ASPHALT|PAVEMENT|PAVING|PAVERS?|CONCRETE|GRASS|SOD|SEED|TOPSOIL|GRAVEL|GRANULAR|LANDSCAP\w*|MULCH|PLANTING)\b/i;

const short = (text: string) => {
  const t = text.replace(/^REMOVE AND DISPOSE OF (EXISTING )?/i, '').replace(/\.\s.*$/, '').replace(/[.,;:]+$/, '');
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};

export async function automateKeynotes(p: Project, access: SetAccess, maxOpening = 3): Promise<KeynotesResult> {
  const checks: string[] = [];
  const sheets = p.sheets.filter((s) => !s.superseded && !tradeOfNumber(s.name ?? ''));
  const fresh: TakeoffType[] = [];
  const added: Measurement[] = [];
  const typeFor = (name: string, kind: TakeoffType['kind'], division: string, unit: string) => {
    const got = p.types.find((t) => t.name === name && t.kind === kind) ?? fresh.find((t) => t.name === name && t.kind === kind);
    if (got) return got.id;
    const t: TakeoffType = { id: newId(), name, color: PALETTE[(p.types.length + fresh.length) % PALETTE.length], kind, height: kind === 'linear' ? 10 : 0, division, items: [{ id: newId(), name, unit, formula: kind === 'area' ? 'A' : kind === 'linear' ? 'L' : 'N' }] };
    fresh.push(t);
    return t.id;
  };
  const units = p.units === 'metric';
  let lists = 0;
  let unfilled = 0;
  for (const [i, s] of sheets.entries()) {
    access.progress?.(`Keynotes… ${s.name} (${i + 1} of ${sheets.length})`);
    if (i % 3 === 0) await pause();
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      const notes = keynoteList(texts);
      const demo = isDemoPlan(s, texts);
      const heads = [s.title ?? '', ...drawingTitles(texts).slice(0, 3).map((d) => d.str)].join(' ').toUpperCase();
      // Notes on plans of the building (not a code, site or life safety plan's notes).
      const planSheet = /\bPLANS?\b/.test(heads) && !/CODE|SITE|LIFE SAFETY|KEY PLAN/.test(heads);
      const site = !!s.metersPerPoint && /\bSITE PLAN\b/.test(heads) && !/KEY PLAN|LOCATION/.test(heads);
      if (!notes.length && !demo && !site) return;
      const segs = await access.segments(s);
      if (!segs) return;
      const box = titleBlockBox(texts, s.width, s.height);
      const outside = ([x, y]: Pt) => !box || x < box[0] || x > box[2] || y < box[1] || y > box[3];
      if (notes.length) {
        lists++;
        const own = new Set(notes.map((n) => n.run));
        const byNumber = new Map(notes.map((n) => [n.number, n]));
        const tags = findEnclosedTags(texts, segs, (c) => /^\d{1,2}\*?$/.test(c)).filter((t) => !t.others.length && outside(t.at) && !texts.some((x) => own.has(x) && Math.hypot(x.cx - t.at[0], x.cy - t.at[1]) < 1));
        // A model of the walls, once, for rooms to measure removals in.
        let model: ReturnType<typeof buildWallModel> | null = null;
        const filled: { note: string; points: Pt[] }[] = [];
        for (const t of tags) {
          const n = byNumber.get(t.code.replace('*', ''));
          if (!n) continue;
          const what = short(n.text);
          if (demo) {
            const name = `Demo ${n.number}: ${what}`;
            if (AREA.test(n.text.replace(/^REMOVE AND DISPOSE OF (EXISTING )?|^REMOVE (EXISTING )?/i, ''))) {
              model ??= buildWallModel(segs, s.metersPerPoint, { maxOpening });
              // A second tag of the note in a room already measured: the same room.
              if (filled.some((f) => f.note === n.number && pointIn(t.at, f.points))) continue;
              const r = fillRoom(model, [t.at], s.width, s.height);
              if (r.ok) {
                filled.push({ note: n.number, points: r.points });
                added.push({ id: newId(), sheetId: s.id, typeId: typeFor(name, 'area', '02 Existing Conditions', units ? 'm²' : 'SF'), points: r.points, holes: [], source: 'demolition', label: `${n.number}` });
                continue;
              }
              unfilled++;
            }
            added.push({ id: newId(), sheetId: s.id, typeId: typeFor(`${name} (each)`, 'count', '02 Existing Conditions', 'ea'), points: [t.at], holes: [], source: 'demolition', label: n.number });
          } else {
            if (!planSheet) continue;
            const name = `Note ${n.number} (${s.name}): ${what}`;
            added.push({ id: newId(), sheetId: s.id, typeId: typeFor(name, 'count', guessDivision(n.text) ?? '10 Specialties', 'ea'), points: [t.at], holes: [], source: 'demolition', label: n.number });
          }
        }
      }
      if (site) {
        // A site plan's legend swatches (asphalt, concrete, grass): every area hatched the same way.
        const legends = findLegends(texts, segs, s.width, s.height, box ? [box] : []);
        for (const l of legends) {
          const rows = l.rows.filter((r) => r.graphic && (r.kind === 'area' || SITE_SURFACE.test(r.label)));
          for (const r of rows) r.kind = 'area';
          findLegendAreas(rows, segs, l.box, s.width, s.height, s.metersPerPoint!);
          for (const r of rows) {
            // A swatch filled solid (asphalt grey): the shapes filled in its colour.
            if (!r.areas?.length && r.graphic) r.areas = sameFill(segs, r.graphic, l.box);
            if (!r.areas?.length) continue;
            const name = `Site: ${r.label.replace(/\s+/g, ' ').trim()}`;
            const id = typeFor(name, 'area', guessDivision(r.label) ?? '32 Exterior Improvements', units ? 'm²' : 'SF');
            for (const a of r.areas) added.push({ id: newId(), sheetId: s.id, typeId: id, points: a.points, holes: [], source: 'demolition', label: r.label.slice(0, 30) });
          }
        }
      }
      if (demo) {
        // Walls to demolish: drawn dashed, two lines 3" to 14" (75 to 350 mm) apart.
        const pt = (m: number) => m / s.metersPerPoint!;
        const dashed = dashLines(segs, pt(0.5)).filter((g: Segment) => outside([g.x1, g.y1]));
        const walls = pairParallels(dashed, pt(0.075), pt(0.36), pt(0.45));
        const id = typeFor('Demo: walls and partitions shown dashed', 'linear', '02 Existing Conditions', units ? 'm' : 'ft');
        for (const w of walls) added.push({ id: newId(), sheetId: s.id, typeId: id, points: [w.a, w.b], holes: [], source: 'demolition', label: 'dashed wall' });
      }
    });
  }
  if (!added.length) return { message: lists ? 'Keynote lists found, but no tags of their numbers on the sheets.' : 'No keynote lists or demolition plans.', checks };
  if (unfilled) checks.push(`${unfilled} demolition keynote${unfilled === 1 ? '' : 's'} for a surface (flooring, ceiling, slab) did not sit in a closed room; counted instead of measured. Measure those areas by hand.`);
  checks.push('Demolition walls are the walls drawn dashed on the demolition plans, measured once along their length (height per the demolition notes). Overhead and hidden lines drawn dashed can be picked up too: check them on the plan.');
  const ids = new Set(added.map((m) => m.typeId));
  return {
    message: `Took off ${added.length} keynotes and demolition items as ${ids.size} types`,
    checks,
    apply: (q) => ({ ...q, types: [...q.types, ...fresh], measurements: [...q.measurements.filter((m) => !(m.source === 'demolition' && ids.has(m.typeId))), ...added] }),
  };
}

/** Shapes filled in the colour a legend swatch is filled with, outside the legend: their outlines and areas. */
export function sameFill(segs: Segment[], [gx0, gy0, gx1, gy1]: [number, number, number, number], legend: [number, number, number, number]) {
  const inBox = (x: number, y: number, b: number[]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  const colours = new Map<string, number>();
  for (const g of segs) if (g.filled && g.color && !/^#(f{6}|0{6})$/i.test(g.color) && inBox(g.x1, g.y1, [gx0 - 1, gy0 - 1, gx1 + 1, gy1 + 1])) colours.set(g.color, (colours.get(g.color) ?? 0) + 1);
  const colour = [...colours].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!colour) return [];
  const subs = new Map<number, Segment[]>();
  for (const g of segs) if (g.filled && g.color === colour && g.sub !== undefined && !inBox(g.x1, g.y1, legend)) subs.set(g.sub, [...(subs.get(g.sub) ?? []), g]);
  const out: { points: Pt[]; area: number; how: 'hatch' }[] = [];
  for (const list of subs.values()) {
    const points: Pt[] = [[list[0].x1, list[0].y1], ...list.map((g) => [g.x2, g.y2] as Pt)];
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      a += x1 * y2 - x2 * y1;
    }
    if (Math.abs(a) / 2 > 50) out.push({ points, area: Math.abs(a) / 2, how: 'hatch' });
  }
  return out;
}
