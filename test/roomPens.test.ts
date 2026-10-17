import { describe, expect, it } from 'vitest';
import { buildWallModel } from '../src/fill/roomFill';
import { fillRooms, findRoomLabels } from '../src/fill/rooms';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

// 1:100-ish: sizes below are in metres.
const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
let sub = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, width: number, extra: Partial<Segment> = {}): Segment => ({
  x1: pt(x1),
  y1: pt(y1),
  x2: pt(x2),
  y2: pt(y2),
  width,
  filled: false,
  ...extra,
});
/** A line drawn in pieces about `step` m long, as CAD exports often do. */
function pieces(x1: number, y1: number, x2: number, y2: number, width: number, step = 0.5): Segment[] {
  const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / step));
  return Array.from({ length: n }, (_, i) => seg(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, x1 + ((x2 - x1) * (i + 1)) / n, y1 + ((y2 - y1) * (i + 1)) / n, width));
}
const rect = (x1: number, y1: number, x2: number, y2: number, width: number, step = 0.5) => [
  ...pieces(x1, y1, x2, y1, width, step),
  ...pieces(x2, y1, x2, y2, width, step),
  ...pieces(x2, y2, x1, y2, width, step),
  ...pieces(x1, y2, x1, y1, width, step),
];
/** A room tag: the number in a box, the name below. */
function tag(number: string, name: string, x: number, y: number) {
  const b = [x - 0.4, y - 0.15, x + 0.4, y + 0.15];
  const segs = [seg(b[0], b[1], b[2], b[1], 0.2), seg(b[2], b[1], b[2], b[3], 0.2), seg(b[2], b[3], b[0], b[3], 0.2), seg(b[0], b[3], b[0], b[1], 0.2)];
  const texts: PageText[] = [
    { str: number, cx: pt(x), cy: pt(y), w: number.length * 4, h: 5 },
    { str: name, cx: pt(x), cy: pt(y + 0.35), w: name.length * 4, h: 5 },
  ];
  return { segs, texts };
}
/** A building 16 x 6 m inside, exterior walls 0.3 m thick in a heavy pen. */
const shell = [...rect(0, 0, 16.6, 6.6, 0.7, 2), ...rect(0.3, 0.3, 16.3, 6.3, 0.7, 2)];
const W = pt(20);
const H = pt(10);
const area = (pts: number) => pts * MPP * MPP;

describe('room fill chooses wall linework room by room', () => {
  it('closes rooms whose partitions are drawn in a lighter pen, and fills the rest as before', () => {
    // Two 0.1 m partitions in a light pen split the shell into three rooms.
    const parts = [...pieces(5.3, 0.3, 5.3, 6.3, 0.3), ...pieces(5.4, 0.3, 5.4, 6.3, 0.3), ...pieces(10.3, 0.3, 10.3, 6.3, 0.3), ...pieces(10.4, 0.3, 10.4, 6.3, 0.3)];
    const tags = [tag('101', 'Office', 2.8, 3), tag('102', 'Office', 7.8, 3), tag('103', 'Storage', 13.3, 3)];
    const segs = [...shell, ...parts, ...tags.flatMap((t) => t.segs)];
    const model = buildWallModel(segs, MPP);
    expect(model.pens).toEqual(['0.70']);
    const rooms = fillRooms(model, findRoomLabels(tags.flatMap((t) => t.texts), segs), W, H);
    expect(rooms.map((r) => r.labels.map((l) => l.number).join('+'))).toEqual(['101', '102', '103']);
    expect(rooms.map((r) => area(r.area))).toEqual([expect.closeTo(30, 0), expect.closeTo(29.4, 0), expect.closeTo(35.4, 0)]);
  });

  it('does not take furniture in the lighter pen round a tag for a room', () => {
    // One open space with two tags; a desk outline in the lighter pen round one of them. The
    // same pen draws a stub of partition, so it is tried as wall.
    const desk = rect(1.5, 2.2, 4.5, 4.2, 0.3);
    const stub = [...pieces(8.3, 0.3, 8.3, 5.3, 0.3), ...pieces(8.4, 0.3, 8.4, 5.3, 0.3)];
    const tags = [tag('101', 'Lobby', 3, 3), tag('102', 'Lounge', 12, 3)];
    const segs = [...shell, ...desk, ...stub, ...tags.flatMap((t) => t.segs)];
    const model = buildWallModel(segs, MPP);
    expect(model.lighter?.()?.pens).toEqual(['0.70', '0.30']);
    const rooms = fillRooms(model, findRoomLabels(tags.flatMap((t) => t.texts), segs), W, H);
    expect(rooms.map((r) => r.labels.map((l) => l.number).join('+'))).toEqual(['101+102']);
    expect(area(rooms[0].area)).toBeCloseTo(96, 0);
  });

  it('leaves a room open rather than take a desk outline round its tag', () => {
    // The shell open to the outside along a 6 m stretch, so the room does not close; a desk
    // in the lighter pen (which also draws a stub of partition) closes round the tag.
    const open = [...rect(0, 0, 16.6, 6.6, 0.7, 2), ...rect(0.3, 0.3, 16.3, 6.3, 0.7, 2)].filter((s) => !(s.y1 > pt(6.2) && s.y2 > pt(6.2) && Math.min(s.x1, s.x2) >= pt(4) && Math.max(s.x1, s.x2) <= pt(12.1)));
    const desk = rect(1.5, 2.2, 4.5, 4.2, 0.3);
    const stub = [...pieces(8.3, 0.3, 8.3, 5.3, 0.3), ...pieces(8.4, 0.3, 8.4, 5.3, 0.3)];
    const t = tag('101', 'Lobby', 3, 3);
    const segs = [...open, ...desk, ...stub, ...t.segs];
    const rooms = fillRooms(buildWallModel(segs, MPP), findRoomLabels(t.texts, segs), W, H);
    expect(rooms.map((r) => r.points)).toEqual([null]);
  });

  it('keeps pens given by the caller as they are', () => {
    const parts = [...pieces(8.3, 0.3, 8.3, 6.3, 0.3), ...pieces(8.4, 0.3, 8.4, 6.3, 0.3)];
    const tags = [tag('101', 'Office', 4, 3), tag('102', 'Office', 12, 3)];
    const segs = [...shell, ...parts, ...tags.flatMap((t) => t.segs)];
    const rooms = fillRooms(buildWallModel(segs, MPP, { pens: ['0.70'] }), findRoomLabels(tags.flatMap((t) => t.texts), segs), W, H);
    expect(rooms.map((r) => r.labels.map((l) => l.number).join('+'))).toEqual(['101+102']);
  });
});

describe('room tags with leaders', () => {
  it('fills the small room a tag points into, not the room the tag stands in', () => {
    // A WC (2 x 2 m) in the corner of a room, its partition in the wall pen with a door gap;
    // its tag stands in the room with a leader ending in a dot inside the WC.
    const wc = [seg(14.3, 0.3, 14.3, 1.2, 0.7), seg(14.4, 0.3, 14.4, 1.2, 0.7), seg(14.3, 2.1, 14.3, 2.3, 0.7), seg(14.4, 2.1, 14.4, 2.2, 0.7)];
    const wcTop = [seg(14.3, 2.3, 16.3, 2.3, 0.7), seg(14.4, 2.2, 16.3, 2.2, 0.7)];
    const room = tag('101', 'Room', 6, 3);
    const wcTag = tag('101b', 'WC', 12, 1.2);
    const leader = seg(12.4, 1.2, 15.2, 1.2, 0.2);
    const dot = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * 2 * Math.PI;
      const b = ((i + 1) / 8) * 2 * Math.PI;
      return seg(15.3 + 0.1 * Math.cos(a), 1.2 + 0.1 * Math.sin(a), 15.3 + 0.1 * Math.cos(b), 1.2 + 0.1 * Math.sin(b), 0, { filled: true, sub: 9999 });
    });
    const segs = [...shell, ...wc, ...wcTop, ...room.segs, ...wcTag.segs, leader, ...dot];
    const labels = findRoomLabels([...room.texts, ...wcTag.texts], segs);
    expect(labels.find((l) => l.number === '101b')?.seed?.map((v) => v * MPP)).toEqual([expect.closeTo(15.3, 1), expect.closeTo(1.2, 1)]);
    const rooms = fillRooms(buildWallModel(segs, MPP), labels, W, H);
    expect(rooms.map((r) => r.labels.map((l) => l.number).join('+'))).toEqual(['101', '101b']);
    expect(area(rooms[1].area)).toBeCloseTo(1.9 * 1.9, 0);
  });

  it('takes no leader from a line that merely touches the box', () => {
    const t = tag('101', 'Room', 6, 3);
    const line = seg(6.4, 3, 9, 3, 0.2);
    const labels = findRoomLabels(t.texts, [...shell, ...t.segs, line]);
    expect(labels[0].seed).toBeUndefined();
  });
});

describe('symbols drawn in the wall pen', () => {
  it('does not read a row of keynote triangles as a wall', () => {
    // Triangles 0.8 m wide in the wall pen, bases on one line across the room from wall to wall.
    const tri = (x: number, y: number) => {
      const s = sub++;
      return [seg(x, y, x + 0.8, y, 0.7, { sub: s }), seg(x + 0.8, y, x + 0.4, y - 0.7, 0.7, { sub: s }), seg(x + 0.4, y - 0.7, x, y, 0.7, { sub: s })];
    };
    const row = Array.from({ length: 9 }, (_, i) => tri(0.3 + i * 1.9, 2)).flat();
    const tags = [tag('101', 'Hall', 8, 4)];
    const segs = [...shell, ...row, ...tags.flatMap((t) => t.segs)];
    const rooms = fillRooms(buildWallModel(segs, MPP), findRoomLabels(tags.flatMap((t) => t.texts), segs), W, H);
    expect(area(rooms[0].area)).toBeCloseTo(96, 0);
  });
});
