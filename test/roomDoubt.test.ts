import { describe, expect, it } from 'vitest';
import { notRoomCodes, roomDoubt } from '../src/automate/rooms';
import type { FoundRoom } from '../src/fill/rooms';
import type { TakeoffType } from '../src/model';

const room = (number: string, name: string, area: number): FoundRoom =>
  ({ labels: [{ number, name, at: [0, 0] }], points: [[0, 0], [1, 0], [1, 1]], area }) as unknown as FoundRoom;
const type = (name: string, kind: TakeoffType['kind'] = 'length') => ({ id: name, name, kind }) as TakeoffType;

describe('rooms that are likely not rooms', () => {
  const codes = notRoomCodes([type('W4'), type('EX1 – Exterior wall'), type('Rooms', 'area'), type('Doors', 'count')], { wall: ['W-12'], other: ['C1'] });
  it('reads the set’s and the project’s type codes, not bare numbers or names', () => {
    expect([...codes].sort()).toEqual(['C1', 'EX1', 'W12', 'W4']);
  });
  const mpp = 0.01; // 1 pt = 1 cm: 10,000 pt² = 1 m²
  it('an unnamed boxed wall code is not a room', () => {
    expect(roomDoubt(room('W4', '', 50_000), codes, mpp)).toMatch(/type code/);
    expect(roomDoubt(room('W12', '', 50_000), codes, mpp)).toMatch(/type code/);
  });
  it('a named room keeps its tag even when it looks like a code', () => {
    expect(roomDoubt(room('C1', 'CORRIDOR', 50_000), codes, mpp)).toBeNull();
    expect(roomDoubt(room('101', '', 50_000), codes, mpp)).toBeNull();
  });
  it('a sliver under 1 m² is not a room', () => {
    expect(roomDoubt(room('104', 'STORAGE', 5_000), codes, mpp)).toMatch(/Under 1 m²/);
    expect(roomDoubt(room('104', 'STORAGE', 5_000), codes, null)).toBeNull();
  });
});
