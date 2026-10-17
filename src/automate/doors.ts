import { findDoorTags, findRoomLabels, type DoorTag } from '../fill/rooms';
import { newId, type Project, type Sheet, type TakeoffType } from '../model';
import type { Automation } from './result';
import { perSheet, PALETTE, type SetAccess } from './set';

/**
 * Door tags on `current`, or on every sheet. Elevations and sections carry level markers (4000,
 * 8570) in ovals that look like door tags. Door numbers follow the room numbers (door 113A by
 * room 113), so only tags in the sheet's room-number range count; other sheets than `current`
 * also need a plan's worth of them.
 */
export async function findDoorTagsIn(p: Project, access: SetAccess, current: Sheet, everywhere: boolean): Promise<{ sheetId: string; tags: DoorTag[] }[]> {
  const found: { sheetId: string; tags: DoorTag[] }[] = [];
  const targets = everywhere ? p.sheets.filter((x) => !x.superseded || x.id === current.id) : [current];
  for (const [i, x] of targets.entries()) {
    if (everywhere) access.progress?.(`Finding door tags… sheet ${i + 1} of ${targets.length}`);
    await perSheet(access, x, async () => {
      const segs = await access.segments(x);
      if (!segs) return;
      const texts = await access.texts(x);
      let tags = findDoorTags(texts, segs);
      // (Lettered rooms, corridor A, have no number to go by.)
      const rooms = findRoomLabels(texts, segs)
        .map((r) => parseInt(r.number.replace(/^\D/, ''), 10))
        .filter((n) => !Number.isNaN(n));
      if (rooms.length) {
        const [lo, hi] = [Math.min(...rooms) - 20, Math.max(...rooms) + 20];
        // On the sheet being counted, doors numbered on their own (D001) are kept; only
        // numbers well above the rooms' (level markers) go. Other sheets keep the range.
        tags = tags.filter((d) => {
          const n = parseInt(d.number.replace(/^\D/, ''), 10);
          return x.id === current.id ? n <= hi : n >= lo && n <= hi;
        });
      }
      if (x.id !== current.id && (!rooms.length || tags.length < 4)) return;
      found.push({ sheetId: x.id, tags });
    });
  }
  return found;
}

/**
 * Door tags as count takeoffs, named by their number; prefixed tags (S114A) by prefix. A door
 * number counts once in the project (enlarged plans repeat tags), on the first sheet it appears;
 * doors already counted under their number are left alone (on `current`, or anywhere when
 * counting every sheet).
 */
export function doorTakeoff(p: Project, found: { sheetId: string; tags: DoorTag[] }[], current: Sheet, everywhere: boolean): Automation {
  const total = found.reduce((n, f) => n + f.tags.length, 0);
  if (!total) return { message: `No door tags on ${everywhere ? 'any sheet' : 'this sheet'}. A door tag is a door number in an oval, circle or hexagon.` };
  const newTypes: TakeoffType[] = [];
  const typeFor = (prefix: string): string => {
    const name = prefix ? `${prefix} – Openings tagged ${prefix}` : 'Doors';
    const hit = [...p.types, ...newTypes].find((t) => t.kind === 'count' && (prefix ? t.name.split(' – ')[0] === prefix : /^doors?\b/i.test(t.name)));
    if (hit) return hit.id;
    const t: TakeoffType = {
      id: newId(),
      name,
      color: PALETTE[(p.types.length + newTypes.length) % PALETTE.length],
      kind: 'count',
      height: p.units === 'metric' ? 3 : 10,
      division: '08 Openings',
      items: [{ id: newId(), name: prefix ? `Opening ${prefix}` : 'Door, frame & hardware', unit: 'ea', formula: 'N' }],
    };
    newTypes.push(t);
    return t.id;
  };
  const counted = new Set(p.measurements.filter((m) => m.label && (everywhere || m.sheetId === current.id)).map((m) => `${m.typeId}|${m.label}`));
  const added = found.flatMap(({ sheetId, tags }) =>
    tags.flatMap((d) => {
      const typeId = typeFor(/^[A-Z]/.test(d.number) ? d.number[0] : '');
      const key = `${typeId}|${d.number}`;
      if (counted.has(key)) return [];
      counted.add(key);
      return [{ id: newId(), sheetId, typeId, points: [d.at], holes: [], label: d.number }];
    }),
  );
  if (!added.length) return { message: `All ${total} door tags ${everywhere ? 'on the drawings' : 'on this sheet'} are already counted.` };
  const used = new Set(added.map((m) => m.typeId));
  const byType = [...used].map((id) => `${added.filter((m) => m.typeId === id).length} ${([...p.types, ...newTypes].find((t) => t.id === id)?.name ?? '').split(' – ')[0]}`);
  const sheets = new Set(added.map((m) => m.sheetId)).size;
  return {
    message: `Counted ${byType.join(', ')}${everywhere ? ` on ${sheets} sheet${sheets === 1 ? '' : 's'}` : ''}`,
    apply: (q) => ({ ...q, types: [...q.types, ...newTypes.filter((t) => used.has(t.id))], measurements: [...q.measurements, ...added] }),
  };
}
