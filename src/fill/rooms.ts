import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { ringArea } from '../geometry';
import { SegmentIndex } from '../walls/bands';
import { dedupe, symbolLoop } from '../walls/tags';
import { fillRoom, type WallModel } from './roomFill';
import type { Segment } from './vectors';

/** A room tag: its number in a box, and the name printed with it. */
export interface RoomLabel {
  number: string;
  name: string;
  /** Centre of the number box, where the room is filled from. */
  at: Pt;
  /** The number box (x0, y0, x1, y1), when the number is boxed. */
  box?: [number, number, number, number];
}

export interface FoundRoom {
  labels: RoomLabel[];
  /** The room's outline, or why it could not be filled. */
  points: Pt[] | null;
  reason?: 'on-wall' | 'not-closed' | 'no-walls' | 'not-connected';
  /** Area in square sheet points. */
  area: number;
  /** Outline length across door openings, in sheet points. */
  openings?: number;
}

/**
 * A room number: a short code of digits with an optional letter prefix and suffix, or a
 * dotted level number (101, 101a, B23, M01, B24S, 2.14).
 */
export const ROOM_NUMBER = /^(?:[A-Z]{1,2})?\d{1,4}(?:\.\d{1,3})?[A-Za-z]?$/;
/** Type tags and other short codes (W2, CB1, EW3A, S114A, fx2, px7) that sit near room names but are not part of them. */
const TAG_LIKE = /^[A-Za-z]{1,4}-?\d{1,4}[A-Za-z]?$/;
/** Words that are notes or device marks round a tag, not a room's name: x, sim, UP, DN, a dimension. */
const NOT_NAME = /^([A-Za-z]|sim\.?|typ\.?|UP|DN|\d.*['"].*|[\d.,/\s-]+|\d+(\.\d+)?\s*(hr|hour|min)\b.*)$/i;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** The rectangle closed round a text (drawn once or doubled), if any. */
function boxAround(t: PageText, index: SegmentIndex, lines: Segment[]): Box | null {
  const r = Math.max(t.w, t.h) * 0.5 + 14;
  const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
  const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
  const candidates = local.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
  for (const pen of new Set(candidates.map((s) => s.width))) {
    const loop = symbolLoop(
      candidates.filter((s) => s.width === pen),
      t.cx,
      t.cy,
    );
    // A box, or a box drawn double (one inside the other).
    if (loop.length !== 4 && loop.length !== 8) continue;
    const axisAligned = loop.every((s) => Math.abs(s.x1 - s.x2) < 0.2 || Math.abs(s.y1 - s.y2) < 0.2);
    if (!axisAligned) continue;
    const xs = loop.flatMap((s) => [s.x1, s.x2]);
    const ys = loop.flatMap((s) => [s.y1, s.y2]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  return null;
}

/**
 * A legend line rather than a tag: the boxed sample code with its explanation written
 * beside it ("07  Room Numbers, see Room Finish Schedule").
 */
function legendLine(texts: PageText[], t: PageText, box: Box): boolean {
  const h = box.y1 - box.y0;
  return texts.some(
    (o) =>
      o !== t &&
      o.cx - o.w / 2 > box.x1 - 1 &&
      o.cx - o.w / 2 < box.x1 + Math.max(4 * h, 20) &&
      Math.abs(o.cy - (box.y0 + box.y1) / 2) < h &&
      /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(o.str),
  );
}

/**
 * Finds room tags: a room number (101, 101a, B23, M01, 2.14) inside a small rectangle,
 * with the room name on the lines just above or just below the box. The sheet's own
 * habit decides which side a name is read from when there is text on both. Door and
 * window numbers sit in ovals or hexagons, so only rectangular boxes count; a boxed code
 * explained beside it is a legend, not a room.
 */
export function findRoomLabels(texts: PageText[], segs: Segment[]): RoomLabel[] {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  const boxed: { t: PageText; box: Box; above: string; below: string; lettered: boolean }[] = [];
  for (const t of texts) {
    // A corridor can be lettered (A, C) rather than numbered: boxed, with its name by it.
    const lettered = /^[A-Z]$/.test(t.str);
    if (!ROOM_NUMBER.test(t.str) && !lettered) continue;
    // Without a letter prefix a code needs two digits (07, 101, 2.14): one digit (1, 1.1) is a keynote or equipment mark.
    if (!lettered && !/^[A-Z]/.test(t.str) && !/\d{2}/.test(t.str)) continue;
    const box = boxAround(t, index, lines);
    if (!box) continue;
    const cx = (box.x0 + box.x1) / 2;
    const above = nameNear(texts, t, cx, box.y0, box.x1 - box.x0, -1);
    const below = nameNear(texts, t, cx, box.y1, box.x1 - box.x0, 1);
    if (!above && !below && legendLine(texts, t, box)) continue;
    boxed.push({ t, box, above, below, lettered });
  }
  // Which side this sheet writes names on: where most tags have one.
  const nAbove = boxed.filter((b) => b.above).length;
  const nBelow = boxed.filter((b) => b.below).length;
  const first = nBelow > nAbove ? 'below' : 'above';
  const second = first === 'below' ? 'above' : 'below';
  // A room plan has a run of tags. A lone boxed code (a keynote, a sheet number in the title
  // block) or a boxed letter on a sheet without numbered rooms (a symbol) is not one; nor is
  // a box under a title-block caption (Dwg. No.).
  const caption = (name: string) => /^(dwg|drawing|sheet|project|job|plot|file)\.?\s*(no\.?|number|#)?:?$/i.test(name.trim());
  const keep = boxed.filter((b) => !caption(b[first] || b[second]));
  const numbered = keep.filter((b) => !b.lettered);
  const named = numbered.filter((b) => b.above || b.below).length;
  const roomTags = named >= 3 || numbered.length >= 5 ? numbered.length : named;
  const out: RoomLabel[] = [];
  for (const b of keep) {
    const name = b[first] || b[second];
    if (b.lettered && (!name || roomTags < 3)) continue;
    if (!name && named < 3 && numbered.length < 5) continue;
    const { box } = b;
    out.push({ number: b.t.str, name, at: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2], box: [box.x0, box.y0, box.x1, box.y1] });
  }
  if (out.length) return out;

  // No boxed tags on the sheet: many sets print the room number bare, under the room
  // name. Take numbers with a name directly above them that are not in any symbol
  // (door and window numbers sit in ovals and hexagons).
  for (const t of texts) {
    if (!/^[A-Z]?\d{3,4}[A-Za-z]?$/.test(t.str)) continue;
    const name = nameNear(texts, t, t.cx, t.cy - t.h / 2, t.w, -1);
    if (!name) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    // Only lines wholly near the number: a small room's own walls are not a symbol round it.
    const near = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i])).filter((s) => near(s.x1, s.y1) && near(s.x2, s.y2));
    const enclosed = [...new Set(local.map((s) => s.width))].some((pen) => symbolLoop(local.filter((s) => s.width === pen), t.cx, t.cy).length > 0);
    if (enclosed || caption(name)) continue;
    out.push({ number: t.str, name, at: [t.cx, t.cy] });
  }
  // A plan has a run of them: one alone is a title block's drawing number or a note.
  return out.length >= 2 ? out : [];
}

/** A door tag: the door's number in an oval, circle or hexagon on a plan. */
export interface DoorTag {
  number: string;
  at: Pt;
}

/**
 * Finds door tags: a number (101, 102A, D12) inside a closed symbol that is not a
 * rectangle (room numbers sit in rectangles). A number tagged twice on one sheet (a
 * second plan of the same floor) counts once.
 */
export function findDoorTags(texts: PageText[], segs: Segment[]): DoorTag[] {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  const out: DoorTag[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    if (!/^[A-Z]?\d{3,4}[A-Za-z]?$/.test(t.str) || seen.has(t.str)) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
    for (const pen of new Set(candidates.map((s) => s.width))) {
      const loop = symbolLoop(
        candidates.filter((s) => s.width === pen),
        t.cx,
        t.cy,
      );
      // Ovals and circles come as many chords, hexagons as six sides; rectangles (drawn
      // single or double) are rooms.
      if (loop.length < 5 || loop.every((s) => Math.abs(s.x1 - s.x2) < 0.2 || Math.abs(s.y1 - s.y2) < 0.2)) continue;
      seen.add(t.str);
      out.push({ number: t.str, at: [t.cx, t.cy] });
      break;
    }
  }
  return out;
}

/**
 * The room name: text lines stacked just above `edge` (side -1) or just below it (side 1),
 * centred on the box (or flush with its left side), each line close under the one before.
 * Notes and device marks round a tag (CR, SD) sit off to one side and are left out.
 */
function nameNear(texts: PageText[], t: PageText, cx: number, edge: number, width: number, side: -1 | 1, left = cx - width / 2): string {
  const words = texts.filter(
    (o) =>
      o !== t &&
      Math.abs((o.angle ?? 0) - (t.angle ?? 0)) < 0.1 &&
      // Lettering of the tag's own size: a big symbol letter (CJ) is not a name.
      o.h < 2 * t.h &&
      o.h > 0.5 * t.h &&
      side * (o.cy - edge) > 0 &&
      side * (o.cy - edge) < 6 * Math.max(o.h, 5) &&
      Math.abs(o.cx - cx) < o.w / 2 + width + 20 &&
      /[A-Za-z]{2}/.test(o.str) &&
      !ROOM_NUMBER.test(o.str) &&
      !TAG_LIKE.test(o.str) &&
      !NOT_NAME.test(o.str),
  );
  // Text lines: runs level with each other and close together, read left to right.
  const rows: { cy: number; h: number; x0: number; x1: number; str: string }[] = [];
  for (const o of [...words].sort((a, b) => a.cx - b.cx)) {
    const row = rows.find((r) => Math.abs(r.cy - o.cy) < 0.5 * Math.max(o.h, 3) && o.cx - o.w / 2 - r.x1 < 1.5 * Math.max(o.h, 3));
    if (row) {
      row.x1 = o.cx + o.w / 2;
      row.str += ` ${o.str}`;
    } else rows.push({ cy: o.cy, h: Math.max(o.h, 5), x0: o.cx - o.w / 2, x1: o.cx + o.w / 2, str: o.str });
  }
  const tol = Math.max(4, 0.25 * width);
  // A name is a few words; a sentence of notes is not one.
  const aligned = (r: (typeof rows)[number]) =>
    r.str.length <= 32 && (Math.abs((r.x0 + r.x1) / 2 - cx) <= tol || Math.abs(r.x0 - left) <= 3);
  const block: string[] = [];
  let last = edge;
  for (const r of rows.filter(aligned).sort((a, b) => side * (a.cy - b.cy))) {
    // The first line close to the box, each next close under the one before.
    if (side * (r.cy - last) > (block.length ? 1.9 : 2.6) * r.h) break;
    block.push(r.str);
    last = r.cy;
  }
  return (side < 0 ? block.reverse() : block).join(' ');
}

/** Fills one tag's room, within a window around the tag. */
/** Whether an outline's extent covers a box: the room around a tag, not the one beyond a wall. */
const spans = (pts: Pt[], [x0, y0, x1, y1]: [number, number, number, number]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return Math.min(...xs) <= x0 && Math.max(...xs) >= x1 && Math.min(...ys) <= y0 && Math.max(...ys) >= y1;
};

/** Whether an outline lies within a box (give or take a point): the tag box itself. */
const withinBox = (pts: Pt[], [x0, y0, x1, y1]: [number, number, number, number]) => pts.every(([x, y]) => x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1);

function fillOne(model: WallModel, label: RoomLabel, sheetW: number, sheetH: number): FoundRoom {
  // A space that leaks past the window is an open area or a gap in the walls, left for
  // drawing by hand (or named by another tag inside it, below).
  let res = fillRoom(model, [label.at], sheetW, sheetH, 2);
  // Drawn without lineweights, the number's own box is in the wall pen and fills first:
  // start again just outside it, below, above the name, then to either side.
  if (res.ok && label.box && withinBox(res.points, label.box)) {
    const [x0, y0, x1, y1] = label.box;
    const [cx, cy] = label.at;
    const w = x1 - x0;
    const h = y1 - y0;
    for (const seed of [
      [cx, y1 + h * 0.8],
      [cx, y0 - h * 2.6],
      [x0 - w * 0.4, cy],
      [x1 + w * 0.4, cy],
    ] as Pt[]) {
      const next = fillRoom(model, [seed], sheetW, sheetH, 2);
      // The tag's own room spans its box; a seed that crossed a wall finds another room.
      if (next.ok && !withinBox(next.points, label.box) && spans(next.points, label.box)) {
        res = next;
        break;
      }
    }
  }
  return res.ok
    ? { labels: [label], points: res.points, area: Math.abs(ringArea(res.points)), openings: res.openings }
    : { labels: [label], points: null, reason: res.reason, area: 0 };
}

/** Adds one tag to the rooms found so far, filling its room unless another tag already did. */
function place(rooms: FoundRoom[], label: RoomLabel, fill: () => FoundRoom) {
  // Sheets often repeat their room tags on a second plan (dimension or demolition
  // plan): the same room again. Keep the copy that fills.
  const twin = rooms.find((r) => r.labels.some((l) => l.number === label.number));
  if (twin?.points) return;
  // Several tags in one open space share its outline.
  const shared = rooms.find((r) => r.points && pointInRing(label.at, r.points));
  if (shared) {
    shared.labels.push(label);
    return;
  }
  const found = fill();
  if (twin) {
    if (found.points) rooms[rooms.indexOf(twin)] = found;
  } else rooms.push(found);
}

/** A tag that found no closed room but sits inside a room another tag found names that room too. */
function adoptStrays(rooms: FoundRoom[]) {
  for (const r of [...rooms]) {
    if (r.points) continue;
    const home = rooms.find((o) => o.points && r.labels.every((l) => pointInRing(l.at, o.points!)));
    if (home) {
      home.labels.push(...r.labels);
      rooms.splice(rooms.indexOf(r), 1);
    }
  }
}

/**
 * An outline holding many rooms' tags has leaked through walls the model missed (walls
 * drawn in another pen, an opening too wide): it is not any one of those rooms. Its tags
 * are left unclosed, to fill again with other settings or draw by hand. One open space
 * named by two or three tags (a corridor and the lobby it opens into) is kept.
 */
const MAX_SHARED = 3;
function splitLeaks(rooms: FoundRoom[]): FoundRoom[] {
  return rooms.flatMap((r) =>
    r.points && new Set(r.labels.map((l) => l.number)).size > MAX_SHARED
      ? r.labels.map((l): FoundRoom => ({ labels: [l], points: null, reason: 'not-closed', area: 0 }))
      : [r],
  );
}

/** Fills each labelled room. Tags that land in one space share its outline. */
export function fillRooms(model: WallModel, labels: RoomLabel[], sheetW: number, sheetH: number): FoundRoom[] {
  const rooms: FoundRoom[] = [];
  for (const label of labels) place(rooms, label, () => fillOne(model, label, sheetW, sheetH));
  adoptStrays(rooms);
  return splitLeaks(rooms);
}

/** Like fillRooms, but yields between rooms so the page stays responsive, reporting progress. */
export async function fillRoomsAsync(
  model: WallModel,
  labels: RoomLabel[],
  sheetW: number,
  sheetH: number,
  onProgress: (done: number, total: number) => void,
): Promise<FoundRoom[]> {
  const rooms: FoundRoom[] = [];
  for (let i = 0; i < labels.length; i++) {
    onProgress(i, labels.length);
    await new Promise((r) => setTimeout(r, 0));
    place(rooms, labels[i], () => fillOne(model, labels[i], sheetW, sheetH));
  }
  adoptStrays(rooms);
  onProgress(labels.length, labels.length);
  return splitLeaks(rooms);
}

function pointInRing([x, y]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
