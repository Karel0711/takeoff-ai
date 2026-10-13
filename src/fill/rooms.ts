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
}

export interface FoundRoom {
  labels: RoomLabel[];
  /** The room's outline, or why it could not be filled. */
  points: Pt[] | null;
  reason?: 'on-wall' | 'not-closed' | 'no-walls' | 'not-connected';
  /** Area in square sheet points. */
  area: number;
}

const ROOM_NUMBER = /^[A-Z]?\d{2,4}[A-Z]?$/;
/** Type tags and other short codes (W2, CB1, EW3A, S114A) that sit near room names but are not part of them. */
const TAG_LIKE = /^[A-Z]{1,3}\d{1,4}[A-Z]?$/;

/**
 * Finds room tags: a room number inside a rectangle, with the room name on the
 * lines just above it. Door and window numbers sit in ovals or hexagons, so
 * only rectangular boxes count.
 */
export function findRoomLabels(texts: PageText[], segs: Segment[]): RoomLabel[] {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  const out: RoomLabel[] = [];
  for (const t of texts) {
    if (!ROOM_NUMBER.test(t.str)) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (const pen of new Set(candidates.map((s) => s.width))) {
      const loop = symbolLoop(
        candidates.filter((s) => s.width === pen),
        t.cx,
        t.cy,
      );
      if (loop.length !== 4) continue;
      const axisAligned = loop.every((s) => Math.abs(s.x1 - s.x2) < 0.2 || Math.abs(s.y1 - s.y2) < 0.2);
      if (!axisAligned) continue;
      const xs = loop.flatMap((s) => [s.x1, s.x2]);
      const ys = loop.flatMap((s) => [s.y1, s.y2]);
      box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      break;
    }
    if (!box) continue;
    // The room name: text lines stacked just above the box, centred over it.
    const cx = (box.x0 + box.x1) / 2;
    const above = texts
      .filter((o) => o !== t && !ROOM_NUMBER.test(o.str) && !TAG_LIKE.test(o.str) && /[A-Za-z]/.test(o.str))
      .filter((o) => o.cy < box.y0 && o.cy > box.y0 - 4 * Math.max(o.h, 5) && Math.abs(o.cx - cx) < Math.max(o.w / 2, box.x1 - box.x0) + 4)
      .sort((a, b) => a.cy - b.cy);
    // Keep only the block of lines that runs down to the box without a gap.
    const block: PageText[] = [];
    let bottom = box.y0;
    for (const o of [...above].reverse()) {
      if (bottom - o.cy > 2.4 * Math.max(o.h, 5)) break;
      block.unshift(o);
      bottom = o.cy;
    }
    out.push({ number: t.str, name: block.map((o) => o.str).join(' '), at: [cx, (box.y0 + box.y1) / 2] });
  }
  return out;
}

/** Fills one tag's room, within a window around the tag. */
function fillOne(model: WallModel, label: RoomLabel, sheetW: number, sheetH: number): FoundRoom {
  // A space that leaks past the window is an open area or a gap in the walls, left for
  // drawing by hand (or named by another tag inside it, below).
  const res = fillRoom(model, [label.at], sheetW, sheetH, 2);
  return res.ok
    ? { labels: [label], points: res.points, area: Math.abs(ringArea(res.points)) }
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

/** Fills each labelled room. Tags that land in one space share its outline. */
export function fillRooms(model: WallModel, labels: RoomLabel[], sheetW: number, sheetH: number): FoundRoom[] {
  const rooms: FoundRoom[] = [];
  for (const label of labels) place(rooms, label, () => fillOne(model, label, sheetW, sheetH));
  adoptStrays(rooms);
  return rooms;
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
  return rooms;
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
