import {
  closeWide,
  cutIslands,
  fillRoomsAsync,
  findRoomLabels,
  type FoundRoom,
} from "../fill/rooms";
import { segmentsOf, wallModelFor } from "../fill/sheetWalls";
import {
  newId,
  type Measurement,
  type Project,
  type Pt,
  type Sheet,
  type TakeoffType,
  type Units,
} from "../model";
import { pageTexts } from "../pageText";
import type { PDFPageProxy } from "../pdf";
import type { Automation } from "./result";
import { PALETTE } from "./set";
import type { SetTypes } from "../walls/setTypes";

/** A code as compared across the set: upper case, no spaces, dashes or dots (W-4, w4 → W4). */
const norm = (code: string) => code.toUpperCase().replace(/[\s.\-–]/g, "");

/**
 * Codes the set uses for other things than rooms: the wall, floor and ceiling types its schedules
 * and legends list, and the codes of the project's own types (a wall type W4 taken off already).
 * Only codes with a letter: a bare number is a room's.
 */
export function notRoomCodes(
  types: TakeoffType[],
  set?: Pick<SetTypes, "wall" | "other">,
): Set<string> {
  const out = new Set<string>();
  const add = (c: string) => {
    const n = norm(c);
    if (/[A-Z]/.test(n) && /\d/.test(n) && n.length <= 8) out.add(n);
  };
  for (const c of [...(set?.wall ?? []), ...(set?.other ?? [])]) add(c);
  for (const t of types)
    if (!(t.kind === "area" && /^rooms?\b/i.test(t.name)))
      add(t.name.split(/\s+[–-]\s+|\s/)[0] ?? "");
  return out;
}

/** Below this a filled "room" is a tag on a wall or in a detail, not a room (m²). */
const MIN_ROOM_M2 = 1;

/**
 * Why a found room is likely not a room, or null: an unnamed tag whose code is one of the set's
 * other type codes (a wall tag W4 in a box), or a fill too small to be a room. Such rooms are
 * shown but not picked to start with.
 */
export function roomDoubt(
  room: FoundRoom,
  codes: Set<string>,
  metersPerPoint: number | null | undefined,
): string | null {
  const unnamed = !room.labels.some((l) => l.name);
  const clash = room.labels.find((l) => codes.has(norm(l.number)));
  if (unnamed && clash && room.labels.every((l) => codes.has(norm(l.number))))
    return `${clash.number} is a type code in this set, not a room`;
  if (
    room.points &&
    metersPerPoint &&
    room.area * metersPerPoint * metersPerPoint < MIN_ROOM_M2
  )
    return "Under 1 m²: likely a tag, not a room";
  return null;
}

export const roomNumber = (r: FoundRoom) =>
  r.labels.map((l) => l.number).join(" / ");
export const roomName = (r: FoundRoom) =>
  [...new Set(r.labels.map((l) => l.name).filter(Boolean))].join(" / ");

/**
 * Room takeoff on a plan with a scale: every room tag on the sheet (number in a box, name above
 * or below it), each room filled to the inside face of its walls. Rooms that did not close have
 * no points.
 */
export async function findRooms(
  page: PDFPageProxy,
  sheet: Sheet,
  maxOpening: number,
  progress?: (done: number, total: number) => void,
): Promise<FoundRoom[]> {
  const [segs, texts, model] = await Promise.all([
    segmentsOf(page),
    pageTexts(page),
    wallModelFor(page, sheet, maxOpening),
  ]);
  const labels = findRoomLabels(texts, segs);
  let rooms = await fillRoomsAsync(
    model,
    labels,
    sheet.width,
    sheet.height,
    progress ?? (() => {}),
  );
  // Rooms that leaked out through a wide doorway (an overhead door): again with doorways twice as wide closed.
  if (rooms.some((r) => !r.points && r.reason === "not-closed"))
    rooms = closeWide(
      rooms,
      await wallModelFor(page, sheet, 2 * maxOpening),
      labels,
      sheet.width,
      sheet.height,
    );
  return cutIslands(rooms);
}

/** The area type rooms go under to start with: one named Rooms, else null for a new one. */
export const roomsTypeOf = (types: TakeoffType[]): string | null =>
  types.find((t) => t.kind === "area" && /^rooms?\b/i.test(t.name))?.id ?? null;

/**
 * The picked rooms as named area takeoffs under `typeId` (null: a new type "Rooms"; their
 * floor, ceiling and other finishes are set in Room finishes).
 */
export function roomTakeoff(
  rooms: FoundRoom[],
  opts: {
    sheet: Sheet;
    typeId: string | null;
    picked: Set<number>;
    names: Map<number, string>;
    types: TakeoffType[];
    units: Units;
    palette?: string[];
  },
): { types: TakeoffType[]; measurements: Measurement[] } {
  const palette = opts.palette ?? PALETTE;
  const newTypes: TakeoffType[] = [];
  let target = opts.typeId;
  if (!target) {
    const t: TakeoffType = {
      id: newId(),
      name: "Rooms",
      color: palette[opts.types.length % palette.length],
      kind: "area",
      height: opts.units === "metric" ? 3 : 10,
      items: [],
      division: "09 Finishes",
    };
    newTypes.push(t);
    target = t.id;
  }
  const measurements: Measurement[] = rooms.flatMap((r, i) =>
    r.points && opts.picked.has(i)
      ? [
          {
            id: newId(),
            sheetId: opts.sheet.id,
            typeId: target,
            points: r.points.map((p) => [...p] as Pt),
            holes: (r.holes ?? []).map((h) => h.map((p) => [...p] as Pt)),
            ...(r.openings ? { openings: r.openings } : {}),
            source: "rooms" as const,
            label: `${roomNumber(r)} ${opts.names.get(i) ?? ""}`.trim(),
          },
        ]
      : [],
  );
  return { types: newTypes, measurements };
}

/** Adds rooms to the project, replacing the sheet's earlier rooms if asked. */
export const applyRooms =
  (
    sheetId: string,
    r: {
      types: TakeoffType[];
      measurements: Measurement[];
      replaceEarlier: boolean;
    },
  ) =>
  (p: Project): Project => ({
    ...p,
    types: [...p.types, ...r.types],
    measurements: [
      ...p.measurements.filter(
        (m) =>
          !(r.replaceEarlier && m.sheetId === sheetId && m.source === "rooms"),
      ),
      ...r.measurements,
    ],
  });

/** Rooms on one plan as the dialog starts: every room that closed, under its tag's name, replacing an earlier run. */
export async function automateRooms(
  p: Project,
  page: PDFPageProxy,
  sheet: Sheet,
  maxOpening: number,
  set?: SetTypes,
): Promise<Automation & { rooms: FoundRoom[] }> {
  if (!sheet.metersPerPoint)
    return { message: "Set the sheet scale first.", rooms: [] };
  const rooms = await findRooms(page, sheet, maxOpening);
  const codes = notRoomCodes(p.types, set);
  const picked = new Set(
    rooms.flatMap((r, i) =>
      r.points && !roomDoubt(r, codes, sheet.metersPerPoint) ? [i] : [],
    ),
  );
  if (!picked.size)
    return {
      message: rooms.length
        ? `None of ${rooms.length} room tags closed.`
        : "No room tags found on this sheet.",
      rooms,
    };
  const names = new Map(rooms.map((r, i) => [i, roomName(r)]));
  const made = roomTakeoff(rooms, {
    sheet,
    typeId: roomsTypeOf(p.types),
    picked,
    names,
    types: p.types,
    units: p.units,
  });
  return {
    message: `${picked.size} of ${rooms.length} rooms filled`,
    rooms,
    apply: applyRooms(sheet.id, { ...made, replaceEarlier: true }),
  };
}
