import { describe, expect, it } from 'vitest';
import { guessDivision } from '../src/divisionGuess';

describe('division from an item name', () => {
  it('places legend lines in their trade', () => {
    expect(guessDivision('DOWNLIGHT')).toBe('26 Electrical');
    expect(guessDivision('ACT-1 ACOUSTIC TILE, 2X4 GRID')).toBe('09 Finishes');
    expect(guessDivision('GWB-1 PAINTED GYPSUM BOARD')).toBe('09 Finishes');
    expect(guessDivision('FIRE HYDRANT')).toBe('20-25 Mechanical');
    expect(guessDivision('NEW ASPHALT AREA')).toBe('32 Exterior Improvements');
    expect(guessDivision('CHAIN LINK FENCE')).toBe('32 Exterior Improvements');
    expect(guessDivision('HYDRO POLE')).toBe('33 Utilities');
    expect(guessDivision('BUILDING ENTRANCE / EXIT')).toBe('08 Openings');
    expect(guessDivision('PROPERTY BOUNDARY')).toBeUndefined();
  });
});

describe('division guesses that read past the first keyword', () => {
  it('keeps trades apart', () => {
    expect(guessDivision('PLUMBING FIXTURES')).toBe('20-25 Mechanical');
    expect(guessDivision('ACOUSTIC WALL PANELS')).toBe('09 Finishes');
    expect(guessDivision('TOILET PARTITIONS')).toBe('10 Specialties');
    expect(guessDivision('DOOR HEADS')).toBe('08 Openings');
    expect(guessDivision('LIGHT FIXTURE TYPE A')).toBe('26 Electrical');
    expect(guessDivision('ELECTRICAL PANEL')).toBe('26 Electrical');
  });
});
