import type { Project } from '../model';

/**
 * What an automation found: the change it makes to the project (applied as one undoable
 * change in the app, straight to the project in the benchmark) and what to tell the user.
 * Without `apply`, nothing was found and `message` says why.
 */
export type Automation = { message: string; apply?: (p: Project) => Project };

/**
 * A tool's new run in place of its last one: every takeoff the tool made before (marked with its
 * `source`) goes, and so do the types only those takeoffs used (a type renamed between runs is
 * not left behind empty). Types the estimator made or still uses stay.
 */
export function replaceRun(q: Project, source: NonNullable<Project['measurements'][number]['source']>, types: Project['types'], added: Project['measurements']): Project {
  const before = new Set(q.measurements.filter((m) => m.source === source).map((m) => m.typeId));
  const kept = q.measurements.filter((m) => m.source !== source);
  const used = new Set<string>();
  for (const m of kept) {
    used.add(m.typeId);
    for (const id of Object.values(m.finishes ?? {})) if (id) used.add(id);
    for (const id of Object.keys(m.wallShares ?? {})) used.add(id);
  }
  for (const m of added) used.add(m.typeId);
  const fresh = new Set(types.map((t) => t.id));
  return {
    ...q,
    types: [...q.types.filter((t) => !before.has(t.id) || used.has(t.id) || fresh.has(t.id)), ...types.filter((t) => !q.types.some((x) => x.id === t.id))],
    measurements: [...kept, ...added],
  };
}
