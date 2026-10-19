/**
 * Array helpers safe on arrays of any size. `Math.max(...a)` and `out.push(...a)` pass every
 * element as an argument and throw "Maximum call stack size exceeded" past about 100k elements,
 * which a dense sheet's linework (hatching, stippled ceilings) easily reaches.
 */

/** The largest value, as `Math.max(...a)`: -Infinity for none, NaN if any is NaN. */
export function maxOf(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v > m) m = v;
    else if (v !== v) return NaN;
  }
  return m;
}

/** The smallest value, as `Math.min(...a)`: Infinity for none, NaN if any is NaN. */
export function minOf(a: ArrayLike<number>): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v < m) m = v;
    else if (v !== v) return NaN;
  }
  return m;
}

/** Appends every item of `items` to `out`, as `out.push(...items)`. */
export function pushAll<T>(out: T[], items: readonly T[]): T[] {
  for (let i = 0; i < items.length; i++) out.push(items[i]);
  return out;
}

/** Union-find root of `i` with path compression, without recursion (chains can be long). */
export function findRoot(parent: number[] | Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r];
  while (parent[i] !== r) {
    const next = parent[i];
    parent[i] = r;
    i = next;
  }
  return r;
}
