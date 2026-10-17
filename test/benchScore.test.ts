import { describe, expect, it } from 'vitest';
import { classifySheet } from '../bench/classify';
import { codeOfName, splitRoomLabel, type ResultItem } from '../bench/items';
import { codeParts, keyItemsOf, normCode, overall, scoreJob, scorecardMarkdown, unitInfo, type KeyItem } from '../bench/score';

const item = (p: Partial<ResultItem>): ResultItem => ({ category: 'wall', code: null, name: '', qty: 0, unit: 'LF', sheets: [], tool: 'walls', ...p });
const key = (p: Partial<KeyItem>): KeyItem => ({ category: 'wall', code: null, description: '', qty: 0, unit: 'LF', ...p });

describe('benchmark scoring', () => {
  it('reads codes case-, dash- and existing-x-tolerantly', () => {
    expect(normCode('PX-1')).toBe('px1');
    expect(codeParts('px1')).toEqual({ stem: 'p1', existing: true });
    expect(codeParts('P1-X')).toEqual({ stem: 'p1', existing: true });
    expect(codeParts('EW3A')).toEqual({ stem: 'ew3a', existing: false });
  });

  it('converts units', () => {
    expect(unitInfo('LF')).toEqual({ dim: 'L', toBase: 0.3048 });
    expect(unitInfo('m²')!.dim).toBe('A');
    expect(unitInfo('ea')!.dim).toBe('N');
    expect(unitInfo('furlong')).toBeNull();
  });

  it('matches by code, sums per code, converts units and scores error', () => {
    const items = [item({ code: 'p1', qty: 100, unit: 'LF' }), item({ code: 'px7', qty: 50, unit: 'LF' }), item({ code: 'w9', qty: 10, unit: 'LF' })];
    const k = [
      key({ code: 'P-1', qty: 60 * 0.3048, unit: 'm', sheets: ['A212'] }),
      key({ code: 'P1', qty: 40 * 0.3048, unit: 'm', sheets: ['A213'] }),
      key({ code: 'PX7', qty: 40, unit: 'LF' }),
      key({ code: 'WX2', qty: 30, unit: 'LF' }),
      key({ category: 'window', code: 'W144', qty: 3, unit: 'EA' }),
    ];
    const s = scoreJob('t', items, k);
    const wall = s.categories.find((c) => c.category === 'wall')!;
    expect(wall.keyItems).toBe(3);
    expect(wall.matched).toBe(2);
    expect(wall.extra).toBe(1);
    const p1 = s.items.find((i) => i.key.code === 'P-1')!;
    expect(p1.error).toBeCloseTo(0, 6);
    expect(p1.key.qty).toBeCloseTo(30.48, 2);
    expect(s.items.find((i) => i.key.code === 'PX7')!.error).toBeCloseTo(0.25, 6);
    // (1 + 0.75 + 0) / 3
    expect(wall.score).toBeCloseTo(0.5833, 3);
    // A category the key has and no tool produced scores 0.
    const win = s.categories.find((c) => c.category === 'window')!;
    expect(win).toMatchObject({ tool: null, matched: 0, score: 0 });
  });

  it('pairs an existing code with its x moved, then ignoring it, and symbols by description', () => {
    const s = scoreJob(
      't',
      [item({ code: 'p7x', qty: 10 }), item({ category: 'symbol', tool: 'symbols', name: 'Recessed pot light', qty: 12, unit: 'EA' })],
      [key({ code: 'PX7', qty: 10 }), key({ category: 'symbol', description: 'Pot light, recessed', qty: 10, unit: 'EA' })],
    );
    expect(s.items.find((i) => i.key.code === 'PX7')!.how).toBe('code (x moved)');
    const sym = s.items.find((i) => i.category === 'symbol')!;
    expect(sym.how).toBe('description');
    expect(sym.error).toBeCloseTo(0.2, 6);
  });

  it('does not compare quantities of different dimensions', () => {
    const s = scoreJob('t', [item({ category: 'wall_finish', tool: 'finishes', code: 'PT1', qty: 500, unit: 'SF' })], [key({ category: 'wall_finish', code: 'PT-1', qty: 100, unit: 'LF' })]);
    expect(s.items[0]).toMatchObject({ how: 'code', error: null, score: 0 });
  });

  it('pairs a merged room line by any of its numbers', () => {
    const s = scoreJob('t', [item({ category: 'room', tool: 'rooms', code: '101a / 101b', qty: 200, unit: 'SF' })], [key({ category: 'room', code: '101B', qty: 200, unit: 'SF' })]);
    expect(s.items[0].error).toBe(0);
  });

  it('keeps tools apart and scores the best per category; overall and markdown', () => {
    const items = [item({ category: 'ceiling', tool: 'ceilings', code: 'c1', qty: 90, unit: 'SF' }), item({ category: 'ceiling', tool: 'finishes', code: 'C1', qty: 50, unit: 'SF' })];
    const s = scoreJob('j', items, keyItemsOf({ units: 'imperial', items: [key({ category: 'ceiling', code: 'C-1', qty: 100, unit: 'SF' })] }));
    const c = s.categories[0];
    expect(c.tool).toBe('ceilings');
    expect(c.byTool).toHaveLength(2);
    expect(overall([s])[0].score).toBeCloseTo(0.9, 6);
    const md = scorecardMarkdown([{ score: s }, { score: scoreJob('nokey', items, null) }]);
    expect(md).toContain('## Overall');
    expect(md).toContain('| ceiling | ceilings | 1 | 1 | 0 | 10% | 90% |');
    expect(md).toContain('No key.json');
  });

  it('reads codes and room numbers from takeoff names', () => {
    expect(codeOfName('px7')).toBe('px7');
    expect(codeOfName('CPT-1 – Floor finish')).toBe('CPT-1');
    expect(codeOfName('Doors')).toBeNull();
    expect(codeOfName('Ceiling – new suspended T-bar, 2×4')).toBeNull();
    expect(splitRoomLabel('101a / 101b Office / Corridor')).toEqual({ code: '101a / 101b', name: 'Office / Corridor' });
    expect(splitRoomLabel('B23')).toEqual({ code: 'B23', name: '' });
  });

  it('sorts sheets by their titles', () => {
    const k = (title: string) => classifySheet({ name: 'A1', title }).kind;
    expect(k('Ground Floor Plan')).toBe('floor plan');
    expect(k('LEVEL 2')).toBe('floor plan');
    expect(k('Basement Floor Removals Plan')).toBe('other');
    expect(k('LEVEL 1 - EXISTING FLOOR PLAN & RCP')).toBe('other');
    expect(k('Second Floor Reflected Ceiling Plan')).toBe('RCP');
    expect(k('Ground Floor Finishes Plan')).toBe('finish plan');
    expect(k('Ground Floor Room Finishes Schedule')).toBe('schedule');
    expect(k('Assembly Types')).toBe('assembly');
    expect(k('FIRE ALARM LAYOUT - LEVEL 1')).toBe('other');
    expect(k('Roof Plan')).toBe('other');
    expect(k('RISER DIAGRAM, NOTES AND LEGEND')).toBe('legend');
  });
});

describe('benchmark scoring: totals', () => {
  it('compares an uncoded door count with every door line together', () => {
    const s = scoreJob(
      't',
      [item({ category: 'window', tool: 'doors', name: 'W – Openings tagged W', qty: 16, unit: 'EA' }), item({ category: 'window', tool: 'doors', name: 'X', qty: 4, unit: 'EA' })],
      [key({ category: 'window', description: 'Windows', qty: 25, unit: 'EA' })],
    );
    expect(s.items[0]).toMatchObject({ how: 'category total', error: 0.2 });
    expect(s.categories[0]).toMatchObject({ matched: 1, extra: 0 });
  });

  it('compares several uncoded door lines together, after the coded ones', () => {
    const s = scoreJob(
      't',
      [item({ category: 'door', tool: 'doors', name: 'Doors', qty: 40, unit: 'EA' }), item({ category: 'door', tool: 'doors', name: 'A – Openings tagged A', qty: 4, unit: 'EA' })],
      [key({ category: 'door', description: 'HM doors', qty: 33, unit: 'EA' }), key({ category: 'door', description: 'WSC doors', qty: 11, unit: 'EA' })],
    );
    expect(s.items.map((i) => [i.how, i.error])).toEqual([
      ['category total', 0],
      ['category total', 0],
    ]);
  });
});

describe('benchmark drawing files', () => {
  it('orders addenda after the original and marks re-issued sheets', async () => {
    const { isRevisionFile, issueOrder, reissued } = await import('../bench/classify');
    expect(isRevisionFile('arch-add3.pdf')).toBe(true);
    expect(isRevisionFile('drawings-add4-reissue.pdf')).toBe(true);
    expect(isRevisionFile('arch-garage.pdf')).toBe(false);
    expect(isRevisionFile('drawings-all.pdf')).toBe(false);
    expect(issueOrder(['/j/arch-add1.pdf', '/j/arch.pdf', '/j/drawings-add3.pdf'])).toEqual(['/j/arch.pdf', '/j/arch-add1.pdf', '/j/drawings-add3.pdf']);
    expect(issueOrder(['/j/arch-add1.pdf', '/j/arch-garage.pdf', '/j/arch-office.pdf'], ['arch-office.pdf', 'arch-garage.pdf', 'arch-add1.pdf'])).toEqual(['/j/arch-office.pdf', '/j/arch-garage.pdf', '/j/arch-add1.pdf']);
    const s = (id: string, docId: string, name: string, title?: string) => ({ id, docId, name, title, width: 100, height: 100 });
    const sheets = [s('o1', 'office', 'A2.1', 'Office plan'), s('g1', 'garage', 'A2.1', 'Garage plan'), s('n1', 'add', 'A2.1', 'GARAGE PLAN'), s('g2', 'garage', 'A3.1')];
    const files = [{ id: 'office', file: 'arch-office.pdf' }, { id: 'garage', file: 'arch-garage.pdf' }, { id: 'add', file: 'arch-add1.pdf' }];
    expect([...reissued(sheets, files).keys()]).toEqual(['g1']);
  });
});
