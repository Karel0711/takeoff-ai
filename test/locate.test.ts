import { describe, expect, it } from 'vitest';
import { middleOf, roomLocator, roomTags } from '../src/locate';
import type { PageText } from '../src/pageText';
import type { Segment } from '../src/fill/vectors';

const text = (str: string, cx: number, cy: number, h = 7): PageText => ({ str, cx, cy, w: str.length * h * 0.7, h });
const line = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 2 }) as Segment;
/** A wall: two faces 6 pt apart, cut into pieces as exports do. */
const wall = (x1: number, y1: number, x2: number, y2: number): Segment[] => {
  const v = x1 === x2;
  const out: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [i / 4, (i + 1) / 4];
    const [ax, ay, bx, by] = [x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b];
    out.push(line(ax, ay, bx, by), v ? line(ax + 6, ay, bx + 6, by) : line(ax, ay + 6, bx, by + 6));
  }
  return out;
};

describe('room tags', () => {
  it('reads the name above or below the number', () => {
    const tags = roomTags([text('BEDROOM', 100, 100), text('104', 100, 115), text('112', 300, 100), text('MOP ROOM', 300, 115)]);
    expect(tags.map((t) => t.name).sort()).toEqual(['104 BEDROOM', '112 MOP ROOM']);
  });

  it('skips words that name no room', () => {
    expect(roomTags([text('UP', 100, 100), text('20', 100, 112)])).toEqual([]);
  });
});

describe('room locator', () => {
  // Two rooms side by side, split by a wall at x = 200.
  const walls: Segment[] = [wall(200, 0, 200, 400), wall(0, 0, 400, 0), wall(0, 400, 400, 400), wall(0, 0, 0, 400), wall(400, 0, 400, 400)].flat();
  const texts = [text('BEDROOM', 150, 50), text('104', 150, 65), text('BEDROOM', 250, 350), text('105', 250, 365)];

  it('picks the tag in sight, not the nearest through a wall', () => {
    const where = roomLocator(texts, walls, null);
    expect(where([190, 340])).toBe('104 BEDROOM');
    expect(where([210, 60])).toBe('105 BEDROOM');
  });

  it('is null far from any tag', () => {
    expect(roomLocator(texts, walls, null, 100)([3000, 3000])).toBeNull();
  });
});

describe('middle of a takeoff', () => {
  it('is halfway along a run and the middle of an area', () => {
    expect(middleOf([[0, 0], [10, 0], [10, 10]])).toEqual([10, 0]);
    expect(middleOf([[0, 0], [10, 0], [10, 20], [0, 20]], true)).toEqual([5, 10]);
  });
});
