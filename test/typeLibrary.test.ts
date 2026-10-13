import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/formula';
import { formulaVars } from '../src/quantities';
import { TYPE_LIBRARY } from '../src/typeLibrary';

describe('type library', () => {
  it('every formula works in both unit systems', () => {
    for (const units of ['metric', 'imperial'] as const) {
      for (const e of TYPE_LIBRARY) {
        const t = e.make(units);
        expect(t.kind).toBe(e.kind);
        for (const it of t.items) {
          const r = evaluate(it.formula, formulaVars({ L: 10, H: t.height, A: 30, P: 22, N: 2, I: 0 }, t));
          expect(r.ok, `${e.name}: ${it.name} = ${it.formula}`).toBe(true);
        }
      }
    }
  });

  it('works out a 2×4 acoustic ceiling and a slab', () => {
    const act = TYPE_LIBRARY.find((e) => e.key === 'act-2x4')!.make('imperial');
    const vars = formulaVars({ L: 0, H: 9, A: 800, P: 120, N: 1, I: 0 }, act);
    const qty = (name: string) => {
      const r = evaluate(act.items.find((i) => i.name.startsWith(name))!.formula, vars);
      return r.ok ? r.value : NaN;
    };
    expect(qty('Tiles')).toBe(105); // 800 SF / 8 SF × 1.05
    expect(qty('Hanger')).toBe(50);
    const slab = TYPE_LIBRARY.find((e) => e.key === 'slab')!.make('imperial');
    const r = evaluate(slab.items.find((i) => i.name.startsWith('Concrete'))!.formula, formulaVars({ L: 0, H: 0, A: 540, P: 96, N: 1, I: 0 }, slab));
    expect(r.ok && r.value).toBeCloseTo((540 * 0.5 * 1.05) / 27, 6);
  });
});
