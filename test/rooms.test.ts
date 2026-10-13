import { describe, expect, it } from 'vitest';
import { findDoorTags, findRoomLabels, fillRooms } from '../src/fill/rooms';
import type { WallModel } from '../src/fill/roomFill';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.57): Segment => ({ x1: pt(x1), y1: pt(y1), x2: pt(x2), y2: pt(y2), width, filled: false });
const rect = (x1: number, y1: number, x2: number, y2: number, width = 0.57) => [
  seg(x1, y1, x2, y1, width),
  seg(x2, y1, x2, y2, width),
  seg(x2, y2, x1, y2, width),
  seg(x1, y2, x1, y1, width),
];
const text = (str: string, x: number, y: number): PageText => ({ str, cx: pt(x), cy: pt(y), w: str.length * 4.5, h: 5 });

/** A room tag drawn as a small box (in metres) around the number at (x, y). */
const tagBox = (x: number, y: number) => rect(x - 0.35, y - 0.18, x + 0.35, y + 0.18, 0.24);
/** A door tag: the number in an octagon. */
function oval(x: number, y: number): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    const b = ((i + 1) / 8) * 2 * Math.PI;
    out.push(seg(x + 0.4 * Math.cos(a), y + 0.25 * Math.sin(a), x + 0.4 * Math.cos(b), y + 0.25 * Math.sin(b), 0.24));
  }
  return out;
}

// Two rooms, 5 x 4 m and 3 x 4 m (inside faces), split by a 0.2 m wall.
const walls = [...rect(0, 0, 8.4, 4.4), ...rect(0.2, 0.2, 8.2, 4.2), seg(5.2, 0.2, 5.2, 4.2), seg(5.4, 0.2, 5.4, 4.2)];
const model: WallModel = { lines: walls, pens: ['0.57'], stats: [], bridges: 0, openings: [] };
const W = pt(30);
const H = pt(10);

describe('room takeoff', () => {
  const lines = [...walls, ...tagBox(2.7, 2.5), ...tagBox(6.8, 2.5), ...oval(5.3, 1)];
  const texts = [
    text('RECEIVING &', 2.7, 1.9),
    text('STORAGE', 2.7, 2.15),
    text('112', 2.7, 2.5),
    text('W2', 2.0, 2.2),
    text('STAFF OFFICE', 6.8, 2.15),
    text('116', 6.8, 2.5),
    text('201', 5.3, 1),
  ];

  it('finds room numbers in boxes with the name above, not door numbers in ovals', () => {
    const labels = findRoomLabels(texts, lines);
    expect(labels.map((l) => [l.number, l.name])).toEqual([
      ['112', 'RECEIVING & STORAGE'],
      ['116', 'STAFF OFFICE'],
    ]);
  });

  it('fills each room to the inside face of its walls', () => {
    const rooms = fillRooms(model, findRoomLabels(texts, lines), W, H);
    expect(rooms.map((r) => r.area * MPP * MPP)).toEqual([expect.closeTo(20, 2), expect.closeTo(11.2, 2)]);
  });

  it('takes bare room numbers under a name when no room number is boxed', () => {
    const bare = [...walls, ...oval(5.3, 1)];
    const labels = findRoomLabels(texts, bare);
    // 201 sits in a door oval, and W2 is a type tag: neither is a room.
    expect(labels.map((l) => [l.number, l.name])).toEqual([
      ['112', 'RECEIVING & STORAGE'],
      ['116', 'STAFF OFFICE'],
    ]);
  });

  it('finds door tags in ovals, not room numbers in boxes', () => {
    expect(findDoorTags(texts, lines).map((d) => d.number)).toEqual(['201']);
  });

  it('keeps one copy of a room tagged again on a second plan', () => {
    const again = [...lines, ...tagBox(20, 2.5)];
    const labels = findRoomLabels([...texts, text('112', 20, 2.5)], again);
    const rooms = fillRooms(model, labels, W, H);
    expect(rooms.filter((r) => r.labels.some((l) => l.number === '112'))).toHaveLength(1);
    expect(rooms.find((r) => r.labels[0].number === '112')?.points).not.toBeNull();
  });
});

describe('rooms drawn without lineweights', () => {
  it('fills the tag’s own room when its box sits just above a wall', async () => {
    const { buildWallModel } = await import('../src/fill/roomFill');
    const { fillRooms, findRoomLabels } = await import('../src/fill/rooms');
    const s = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, width: 0.5, filled: false });
    const rect = (x0: number, y0: number, x1: number, y1: number) => [s(x0, y0, x1, y0), s(x1, y0, x1, y1), s(x1, y1, x0, y1), s(x0, y1, x0, y0)];
    // Two rooms, one above the other, a 4 pt partition between; everything in one pen.
    const segs = [...rect(-6, -6, 206, 210), ...rect(0, 0, 200, 100), ...rect(0, 104, 200, 204), ...rect(90, 85, 114, 97), ...rect(90, 150, 114, 162)];
    const texts = [
      { str: 'ROOM A', cx: 102, cy: 75, w: 30, h: 5 },
      { str: '101', cx: 102, cy: 91, w: 12, h: 5 },
      { str: 'ROOM B', cx: 102, cy: 140, w: 30, h: 5 },
      { str: '102', cx: 102, cy: 156, w: 12, h: 5 },
    ];
    const model = buildWallModel(segs, (100 * 0.0254) / 72, { pens: ['0.50'] });
    const rooms = fillRooms(model, findRoomLabels(texts, segs), 400, 400);
    // Each room on its own (without lineweights the tag box notches it a few percent).
    expect(rooms.map((r) => r.labels.map((l) => l.number).join('+')).sort()).toEqual(['101', '102']);
    for (const r of rooms) expect(r.area / 20000).toBeGreaterThan(0.9);
  });
});
