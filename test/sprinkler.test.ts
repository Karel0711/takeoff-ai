import { describe, expect, it } from 'vitest';
import type { PageText } from '../src/pageText';
import type { SetAccess } from '../src/automate/set';
import { automateSprinklers } from '../src/automate/sprinklers';
import { isHeadLabel, pipeSizeOf, readSprinklerSheet, runsOf } from '../src/fill/sprinkler';
import { newProject, type Project, type Sheet } from '../src/model';
import type { Segment } from '../src/fill/vectors';

let sub = 1;
const line = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width: 0.96, filled: false, color: '#000000', sub: sub++, ...extra });
/** A sidewall head: a triangle in the pipe's pen, apex on the pipe end. */
const head = (x: number, y: number): Segment[] => {
  const s = sub++;
  return [line(x - 4, y + 7, x + 4, y + 7, { sub: s }), line(x + 4, y + 7, x, y, { sub: s }), line(x, y, x - 4, y + 7, { sub: s })];
};
const label = (str: string, cx: number, cy: number, angle = 0): PageText => ({ str, cx, cy, w: 6, h: 3.6, angle });

describe('fire sprinklers, with nothing marked', () => {
  // An 80 main along y = 100 with three 25 branches down to sidewall heads, one round a corner,
  // and the main capped at its far end. Walls in grey run alongside.
  const segs: Segment[] = [
    line(100, 100, 200, 100),
    line(200, 100, 300, 100),
    line(300, 100, 400, 100),
    line(200, 100, 200, 150),
    ...head(200, 150),
    line(300, 100, 300, 150),
    ...head(300, 150),
    line(400, 100, 400, 130),
    line(400, 130, 450, 130),
    line(450, 130, 450, 150),
    ...head(450, 150),
    line(100, 90, 500, 90, { color: '#989898' }),
    line(100, 110, 500, 110, { color: '#989898' }),
  ];
  const texts = [label('80', 150, 97), label('25', 197, 125, -Math.PI / 2)];
  const read = readSprinklerSheet(segs, texts, { width: 2835, height: 2004 }, [], { plan: true })!;

  it('finds the heads and the pipe without being shown either', () => {
    expect(read.heads.map((g) => [g.shape, g.at.length])).toEqual([['triangle', 3]]);
    expect(read.network!.style).toEqual({ width: 0.96, color: '#000000' });
  });

  it('sizes the pipe from its labels, carrying the main size straight on', () => {
    const bySize = new Map<string, number>();
    for (const p of read.network!.pieces) bySize.set(p.size ?? '?', (bySize.get(p.size ?? '?') ?? 0) + Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]));
    // The main is 300 long; the branches 50 + 50 + 100 take the size labelled on one of them.
    expect(Math.round(bySize.get('80')!)).toBe(300);
    expect(Math.round(bySize.get('25')!)).toBe(200);
  });

  it('counts the fittings: two tees, an elbow at each corner, a capped end', () => {
    const kinds = read.network!.fittings.map((f) => `${f.kind} ${f.size}`).sort();
    expect(kinds).toEqual(['cap 80', 'elbow 25', 'elbow 25', 'elbow 80', 'tee 80', 'tee 80']);
  });

  it('joins pieces of one size into runs', () => {
    expect(runsOf(read.network!.pieces).filter((r) => r.size === '80')).toHaveLength(1);
  });

  it('reads pipe sizes as printed', () => {
    expect(['25', '100Ø', '40 mm', '1-1/4"', '2"', '12', '101'].map(pipeSizeOf)).toEqual(['25', '100', '40', '1-1/4"', '2"', null, null]);
  });
});

/** A ring of 16 curve pieces, one drawn shape. */
const ring = (x: number, y: number, r: number, extra: Partial<Segment> = {}): Segment[] => {
  const s = sub++;
  return Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * 2 * Math.PI;
    const b = ((i + 1) / 16) * 2 * Math.PI;
    return line(x + r * Math.cos(a), y + r * Math.sin(a), x + r * Math.cos(b), y + r * Math.sin(b), { width: 1.08, curve: true, sub: s, ...extra });
  });
};
/** An upright head: a ring round a small ring. */
const upright = (x: number, y: number) => [...ring(x, y, 7.6), ...ring(x, y, 2.5)];
const note = (str: string, cx: number, cy: number): PageText => ({ str, cx, cy, w: str.length * 3.6, h: 4.5 });

describe('fire sprinklers drawn as heads only', () => {
  // Twelve upright heads on a grid, no pipe. Grey walls run between them, and a few wall ends
  // land beside heads, so a pen "reaches" heads without being pipe.
  const heads = [100, 200, 300, 400].flatMap((x) => [100, 200, 300].map((y) => [x, y] as const));
  const walls: Segment[] = [
    ...[150, 250].map((y) => line(50, y, 450, y, { width: 0.24, color: '#c0c0c0' })),
    ...[100, 200, 300, 400].map((x) => line(x + 3, 150, x + 3, 104, { width: 0.24, color: '#c0c0c0' })),
    line(150, 300, 105, 300, { width: 0.24, color: '#c0c0c0' }),
  ];
  const art = [...heads.flatMap(([x, y]) => upright(x, y)), ...walls];
  // A note with a leader: a short tick off the label, then a slanted line to the head's ring.
  const label = note('UPRIGHT SPRINKLER HEAD (TYP)', 600, 40);
  const left = 600 - label.w / 2;
  const leader = [line(left - 1, 40, left - 8, 40, { width: 0.42 }), line(left - 8, 40, 405, 93, { width: 0.42 })];
  const sheet = { width: 2448, height: 1584 };

  it('counts the heads a note points at, named by the note, and takes no walls as pipe', () => {
    const read = readSprinklerSheet([...art, ...leader], [label], sheet, [], { plan: true })!;
    expect(read.heads.map((g) => [g.named, g.at.length])).toEqual([['upright', 12]]);
    expect(read.network).toBeNull();
  });

  it('on a sprinkler plan with nothing named, takes the head symbol drawn most often', () => {
    const read = readSprinklerSheet(art, [], sheet, [], { plan: true })!;
    expect(read.heads.reduce((n, g) => n + g.at.length, 0)).toBe(12);
    expect(read.network).toBeNull();
  });

  it('on a sheet that is not a sprinkler plan, reads nothing unless a note names the heads', () => {
    expect(readSprinklerSheet(art, [], sheet)).toBeNull();
    expect(readSprinklerSheet([...art, ...leader], [label], sheet)!.heads[0].at).toHaveLength(12);
  });

  it('tells head notes from other fire protection notes', () => {
    expect(['UPRIGHT SPRINKLER HEAD (TYP)', 'SPRINKLER HEAD-NEW', 'PENDENT SPRINKLER', 'Sidewall head'].map(isHeadLabel)).toEqual([true, true, true, true]);
    expect(['FIRE EXTINGUISHER HEAD (TYP)', 'SPRINKLER LAYOUT-GROUND FLOOR', 'SPRINKLER MAIN', 'FIRE HOSE CABINET'].map(isHeadLabel)).toEqual([false, false, false, false]);
  });
});

describe('fire sprinklers takeoff', () => {
  const flat = (title: string, id: string, metersPerPoint?: number) =>
    ({ id, docId: 'd', page: 1, name: id, title, width: 2448, height: 1584, metersPerPoint }) as unknown as Sheet;
  const heads = [100, 200, 300].flatMap((x) => [100, 200].map((y) => upright(x, y)).flat());
  const label = note('UPRIGHT SPRINKLER HEAD (TYP)', 600, 40);
  const left = 600 - label.w / 2;
  const segs = [...heads, line(left - 1, 40, left - 8, 40, { width: 0.42 }), line(left - 8, 40, 305, 93, { width: 0.42 })];
  const access = (s: Segment[], t: PageText[]): SetAccess => ({ page: async () => null, segments: async () => s, texts: async () => t });

  it('says so when heads are drawn but no pipe', async () => {
    const p: Project = { ...newProject('metric'), sheets: [flat('SPRINKLER GROUND FLOOR', 'M450', 0.0176)] };
    const r = await automateSprinklers(p, access(segs, [label]), null);
    expect(r.message).toBe('Sprinklers on 1 sheet: 6 heads. No pipe is drawn on them, so none was taken off');
    const q = r.apply!(p);
    expect(q.types.map((t) => t.name)).toEqual(['Sprinkler head – upright (○)']);
  });

  it('with no sprinkler plan, finds nothing on an open sheet that shows no heads, never pipe alone', async () => {
    const p: Project = { ...newProject('metric'), sheets: [flat('FLOOR PLAN', 'A101', 0.0176)] };
    const pipeOnly = [line(100, 100, 400, 100), line(200, 100, 200, 150), line(300, 100, 300, 150)];
    expect((await automateSprinklers(p, access(pipeOnly, []), p.sheets[0])).message).toBe('No sprinklers found.');
    expect((await automateSprinklers(p, access(segs, [label]), p.sheets[0])).message).toMatch(/^Sprinklers on 1 sheet: 6 heads\./);
  });
});
