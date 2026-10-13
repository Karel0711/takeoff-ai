import { describe, expect, it } from 'vitest';
import { boxSelect } from '../src/boxSelect';
import type { Measurement, Pt } from '../src/model';

const m = (id: string, points: Pt[]): Measurement => ({ id, sheetId: 's', typeId: 't', points, holes: [] });

const count = m('count', [[50, 50]]);
const line = m('line', [
  [0, 120],
  [200, 120],
]);
const room = m('room', [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
]);
const far = m('far', [[500, 500]]);
const all = [count, line, room, far];
const isArea = (x: Measurement) => x.id === 'room' || x.id === 'donut';

describe('box select', () => {
  it('dragged left to right, takes only what lies wholly inside', () => {
    expect(boxSelect(all, [40, 40, 60, 60], isArea)).toEqual(['count']);
    expect(boxSelect(all, [-10, -10, 110, 110], isArea)).toEqual(['count', 'room']);
    expect(boxSelect(all, [-10, -10, 210, 130], isArea)).toEqual(['count', 'line', 'room']);
  });

  it('dragged right to left, also takes what it touches', () => {
    // Crosses the line and the room's right edge, holds no point of either.
    expect(boxSelect(all, [150, 90, 90, 130], isArea)).toEqual(['line', 'room']);
    // Wholly inside the room: touches the room (and holds the count).
    expect(boxSelect(all, [60, 40, 40, 60], isArea)).toEqual(['count', 'room']);
  });

  it('takes nothing from an empty stretch of sheet', () => {
    expect(boxSelect(all, [300, 300, 400, 400], isArea)).toEqual([]);
    expect(boxSelect(all, [400, 300, 300, 400], isArea)).toEqual([]);
  });

  it('treats a line of several points as open, not as an outline', () => {
    const bend = m('bend', [
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    // Inside the triangle the line would close, touching none of it.
    expect(boxSelect([bend], [80, 10, 70, 20], isArea)).toEqual([]);
  });

  it('leaves out an area whose hole the box sits in', () => {
    const donut = { ...room, id: 'donut', holes: [[[30, 30], [70, 30], [70, 70], [30, 70]] as Pt[]] };
    expect(boxSelect([donut], [60, 40, 40, 60], isArea)).toEqual([]);
  });
});
