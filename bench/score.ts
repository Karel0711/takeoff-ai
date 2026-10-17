import { similarity } from '../src/eval/score';
import { CATEGORIES, type Category, type ResultItem } from './items';

/**
 * Scores what the tools took off (result.json) against an estimator's takeoff (key.json).
 * No file access here (see bench/*.test.ts for the runners), so it is unit-tested with the app.
 */

/** One line of an estimator's takeoff. */
export interface KeyItem {
  category: Category;
  code: string | null;
  description: string;
  qty: number;
  unit: string;
  sheets?: string[];
}

/** key.json: a list of items, or {units?, items}. */
export function keyItemsOf(json: unknown): KeyItem[] {
  const list = Array.isArray(json) ? json : ((json as { items?: unknown[] })?.items ?? []);
  return (list as KeyItem[]).filter((k) => k && typeof k.qty === 'number' && CATEGORIES.includes(k.category));
}

type Dim = 'L' | 'A' | 'N';
/** A unit's dimension and its factor to metres, square metres or each. */
export function unitInfo(unit: string): { dim: Dim; toBase: number } | null {
  const u = unit.trim().toLowerCase().replace(/\s+/g, '').replace('²', '2').replace(/\.$/, '');
  if (/^(lf|ft|feet|foot|lft|linft|'|lnft)$/.test(u)) return { dim: 'L', toBase: 0.3048 };
  if (/^(m|lm|meters?|metres?)$/.test(u)) return { dim: 'L', toBase: 1 };
  if (/^mm$/.test(u)) return { dim: 'L', toBase: 0.001 };
  if (/^(sf|sqft|ft2|squarefeet)$/.test(u)) return { dim: 'A', toBase: 0.09290304 };
  if (/^(m2|sqm|sm)$/.test(u)) return { dim: 'A', toBase: 1 };
  if (/^(ea|each|no|nr|pcs?|count|qty|unit|units)$/.test(u)) return { dim: 'N', toBase: 1 };
  return null;
}

/** A code as compared: case, dashes, dots and spaces ignored. */
export const normCode = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A code with its "existing" x taken out and noted: px1, p1x, P-X1 are all p + 1 existing.
 * Null when it doesn't read as letters + number.
 */
export function codeParts(c: string): { stem: string; existing: boolean } | null {
  const n = normCode(c);
  const m = /^([a-z]*?)(x?)(\d+[a-wyz]?(?:\d+[a-wyz]?)?)(x?)$/.exec(n);
  if (!m) return null;
  return { stem: `${m[1]}${m[3]}`, existing: !!(m[2] || m[4]) };
}

const BASE_UNIT: Record<Dim, string> = { L: 'm', A: 'm2', N: 'EA' };

interface Group {
  key: string;
  code: string | null;
  label: string;
  dim: Dim | null;
  /** Quantity in base units (m, m², ea). */
  qty: number;
  sheets: string[];
}

/** Lines of one category grouped by code (or description, when there is no code), quantities summed in base units. */
function groupItems(items: { code: string | null; label: string; qty: number; unit: string; sheets?: string[] }[]): Group[] {
  const out = new Map<string, Group>();
  for (const it of items) {
    const u = unitInfo(it.unit);
    const key = it.code ? `c:${normCode(it.code)}` : `d:${it.label.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    let g = out.get(key);
    if (!g) out.set(key, (g = { key, code: it.code, label: it.label, dim: u?.dim ?? null, qty: 0, sheets: [] }));
    if (u && g.dim && u.dim !== g.dim) g.dim = null;
    g.qty += u ? it.qty * u.toBase : it.qty;
    for (const s of it.sheets ?? []) if (!g.sheets.includes(s)) g.sheets.push(s);
  }
  return [...out.values()];
}

/** How a key line and a tool line were paired. */
export type MatchHow = 'code' | 'code (x moved)' | 'code (existing x ignored)' | 'description' | 'ceiling material' | 'category total';

/**
 * The ceiling material a line names, in any of the words estimators and architects use for
 * it (GWB, gyp, gypsum board, drywall; ACT, acoustic tile, lay-in, T-bar, SAT; ...), what
 * follows "c/w" or "complete with" (its framing) left out. Null when it names none or several.
 */
export function ceilingMaterial(label: string): string | null {
  const head = label.split(/\b(?:c\/w|complete with|w\/)\b/i)[0];
  const found = [
    /\b(gyp(sum)?|gwb|gb|drywall|wallboard|plasterboard)\b/i.test(head) && 'gypsum',
    /\b(act-?\d*|acoustic(al)?|acoustuc|lay-?in|t-?bar|sat\d*|ceiling tiles?)\b/i.test(head) && 'acoustic tile',
    /\b(wood|cedar|plywood|slat|plank)\b/i.test(head) && 'wood',
    /\bmetal\b/i.test(head) && 'metal',
  ].filter(Boolean) as string[];
  return found.length === 1 ? found[0] : null;
}

export interface ItemScore {
  category: Category;
  /** The estimator's line. */
  key: { code: string | null; description: string; qty: number; unit: string };
  /** The tool's line paired with it, if any. */
  got: { code: string | null; name: string; qty: number; unit: string; tool: string } | null;
  how: MatchHow | null;
  /** |tool − key| / key, in the key's units; null when unmatched or not comparable (different dimensions). */
  error: number | null;
  /** 1 − error (0 at worst); 0 when unmatched or not comparable. */
  score: number;
}

export interface CategoryScore {
  category: Category;
  /** The tool scored (the one scoring best when several produced the category); null when none did. */
  tool: string | null;
  keyItems: number;
  matched: number;
  /** Tool lines the key lacks. */
  extra: number;
  medianError: number | null;
  /** Mean item score over the key's lines: 0 to 1. Null when the key has none in this category. */
  score: number | null;
  /** Every tool that produced the category, scored on its own. */
  byTool: { tool: string; matched: number; extra: number; medianError: number | null; score: number | null }[];
}

export interface JobScore {
  job: string;
  hasKey: boolean;
  categories: CategoryScore[];
  items: ItemScore[];
  /** With no key: what the tools produced per category. */
  produced: { category: Category; tool: string; items: number; totals: Record<string, number> }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const DESC_MATCH = 0.5;

/** Pairs a category's key groups with one tool's groups: by code, then (symbols, doors, windows, other) by description. */
/** A pairing; `keyTotal`: the key lines compared together (a category total), in base units. */
type Pair = { g: Group; how: MatchHow; keyTotal?: number };

/** `named`: the tool's lines are named for what they are (a legend line), not generic ("Doors" from door tags), so descriptions can pair them. */
function pair(keys: Group[], got: Group[], category: Category, named = true): { pairs: Map<Group, Pair>; used: Set<Group> } {
  const out = new Map<Group, Pair>();
  const used = new Set<Group>();
  const take = (k: Group, g: Group, how: MatchHow) => {
    out.set(k, { g, how });
    used.add(g);
  };
  const codesOf = (g: Group) => (g.code ? g.code.split(/\s*\/\s*/) : []);
  // Exact code (a tool line covering several rooms "101 / 102" pairs by any of them).
  for (const k of keys) {
    if (!k.code) continue;
    const hit = got.find((g) => !used.has(g) && codesOf(g).some((c) => normCode(c) === normCode(k.code!)));
    if (hit) take(k, hit, 'code');
  }
  // The existing marker anywhere (px1 = p1x = P-X1), then ignoring it.
  for (const loose of [false, true]) {
    for (const k of keys) {
      if (!k.code || out.has(k)) continue;
      const kp = codeParts(k.code);
      if (!kp) continue;
      const hit = got.find((g) => !used.has(g) && codesOf(g).some((c) => {
        const gp = codeParts(c);
        return !!gp && gp.stem === kp.stem && (loose || gp.existing === kp.existing);
      }));
      if (hit) take(k, hit, loose ? 'code (existing x ignored)' : 'code (x moved)');
    }
  }
  if (named && ['symbol', 'door', 'window', 'other', 'ceiling'].includes(category)) {
    const cands: { k: Group; g: Group; s: number }[] = [];
    for (const k of keys) {
      if (out.has(k)) continue;
      for (const g of got) {
        if (used.has(g)) continue;
        const s = Math.max(similarity(k.label, g.label), k.code && g.label ? similarity(k.code, g.label) : 0);
        if (s >= DESC_MATCH) cands.push({ k, g, s });
      }
    }
    for (const c of cands.sort((a, b) => b.s - a.s)) if (!out.has(c.k) && !used.has(c.g)) take(c.k, c.g, 'description');
  }
  // Ceilings the key names by material alone ("GWB Ceiling", "ACT 610x1220"): the tool's
  // untyped lines of that material together (the areas it typed by what is drawn in them),
  // when the key has one such line for the material.
  if (named && category === 'ceiling') {
    for (const k of keys) {
      if (out.has(k) || k.code) continue;
      const m = ceilingMaterial(k.label);
      if (!m || keys.some((o) => o !== k && !out.has(o) && !o.code && ceilingMaterial(o.label) === m)) continue;
      const gs = got.filter((g) => !used.has(g) && !g.code && ceilingMaterial(g.label) === m);
      if (!gs.length) continue;
      const dims = new Set(gs.map((g) => g.dim));
      const total: Group = { key: `material:${m}`, code: null, label: gs.map((g) => g.label).join(' + '), dim: dims.size === 1 ? gs[0].dim : null, qty: gs.reduce((n, g) => n + g.qty, 0), sheets: [] };
      out.set(k, { g: total, how: 'ceiling material' });
      for (const g of gs) used.add(g);
    }
  }
  // Doors and windows the key gives as uncoded counts ("Doors 110 EA", "HM doors 33 EA" + "WSC doors
  // 28 EA"): those lines together against every tool line of the category not paired by code.
  const loose = keys.filter((k) => !k.code && !out.has(k));
  const rest = got.filter((g) => !used.has(g));
  if ((category === 'door' || category === 'window') && loose.length && rest.length && loose.length === keys.filter((k) => !out.has(k)).length) {
    const dims = new Set(rest.map((g) => g.dim));
    const total: Group = { key: 'total', code: null, label: `all ${rest.length} ${category} line${rest.length === 1 ? '' : 's'}`, dim: dims.size === 1 ? rest[0].dim : null, qty: rest.reduce((n, g) => n + g.qty, 0), sheets: [] };
    const keyTotal = loose.reduce((n, k) => n + k.qty, 0);
    for (const k of loose) out.set(k, { g: total, how: 'category total', keyTotal });
    for (const g of rest) used.add(g);
  }
  return { pairs: out, used };
}

/** Scores one job. `items`: result.json's; `key`: key.json's (null: no key, structure only). */
export function scoreJob(job: string, items: ResultItem[], key: KeyItem[] | null): JobScore {
  const produced = [...new Set(items.map((i) => `${i.category}|${i.tool}`))].map((ct) => {
    const [category, tool] = ct.split('|') as [Category, string];
    const mine = items.filter((i) => i.category === category && i.tool === tool);
    const totals: Record<string, number> = {};
    for (const i of mine) totals[i.unit] = +((totals[i.unit] ?? 0) + i.qty).toFixed(2);
    return { category, tool, items: mine.length, totals };
  });
  if (!key) return { job, hasKey: false, categories: [], items: [], produced };
  const scores: ItemScore[] = [];
  const categories: CategoryScore[] = [];
  for (const category of CATEGORIES) {
    const keyLines = key.filter((k) => k.category === category);
    const keyGroups = groupItems(keyLines.map((k) => ({ code: k.code, label: k.description, qty: k.qty, unit: k.unit, sheets: k.sheets })));
    const tools = [...new Set(items.filter((i) => i.category === category).map((i) => i.tool))];
    if (!keyGroups.length && !tools.length) continue;
    const keyUnit = (g: Group) => keyLines.find((k) => (k.code ? `c:${normCode(k.code)}` : `d:${k.description.toLowerCase().replace(/\s+/g, ' ').trim()}`) === g.key)!.unit;
    const byTool = tools.map((tool) => {
      const mine = items.filter((i) => i.category === category && i.tool === tool);
      const got = groupItems(mine.map((i) => ({ code: i.code, label: i.name, qty: i.qty, unit: i.unit, sheets: i.sheets })));
      const { pairs, used } = pair(keyGroups, got, category, tool !== 'doors');
      const lines: ItemScore[] = keyGroups.map((k) => {
        const p = pairs.get(k);
        const unit = keyUnit(k);
        const f = unitInfo(unit)?.toBase ?? 1;
        const want = p?.keyTotal ?? k.qty;
        const comparable = !!p && !!k.dim && k.dim === p.g.dim && want > 0;
        const error = comparable ? Math.abs(p!.g.qty - want) / want : null;
        return {
          category,
          key: { code: k.code, description: k.label, qty: +(k.qty / f).toFixed(2), unit },
          got: p ? { code: p.g.code, name: p.g.label, qty: +(p.g.qty / (p.g.dim === k.dim ? f : 1)).toFixed(2), unit: p.g.dim === k.dim ? unit : BASE_UNIT[p.g.dim ?? 'N'], tool } : null,
          how: p?.how ?? null,
          error: error === null ? null : +error.toFixed(4),
          score: error === null ? 0 : Math.max(0, 1 - error),
        };
      });
      const matched = lines.filter((l) => l.got).length;
      const errs = lines.flatMap((l) => (l.error === null ? [] : [l.error]));
      return {
        tool,
        lines,
        matched,
        extra: got.filter((g) => !used.has(g)).length,
        medianError: median(errs),
        score: keyGroups.length ? lines.reduce((n, l) => n + l.score, 0) / keyGroups.length : null,
      };
    });
    const best = [...byTool].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.matched - a.matched)[0];
    if (best) scores.push(...best.lines);
    else
      scores.push(
        ...keyGroups.map((k) => {
          const unit = keyUnit(k);
          return { category, key: { code: k.code, description: k.label, qty: +(k.qty / (unitInfo(unit)?.toBase ?? 1)).toFixed(2), unit }, got: null, how: null, error: null, score: 0 };
        }),
      );
    categories.push({
      category,
      tool: best?.tool ?? null,
      keyItems: keyGroups.length,
      matched: best?.matched ?? 0,
      extra: best?.extra ?? 0,
      medianError: best?.medianError ?? null,
      score: keyGroups.length ? (best?.score ?? 0) : null,
      byTool: byTool.map(({ lines: _lines, ...t }) => t),
    });
  }
  return { job, hasKey: true, categories, items: scores, produced };
}

/** Every job's categories together: counts summed, the median over every item's error, the mean item score. */
export function overall(jobs: JobScore[]): CategoryScore[] {
  const keyed = jobs.filter((j) => j.hasKey);
  return CATEGORIES.flatMap((category) => {
    const rows = keyed.flatMap((j) => j.categories.filter((c) => c.category === category));
    if (!rows.length) return [];
    const items = keyed.flatMap((j) => j.items.filter((i) => i.category === category));
    const keyItems = rows.reduce((n, r) => n + r.keyItems, 0);
    return [
      {
        category,
        tool: [...new Set(rows.map((r) => r.tool).filter(Boolean))].join(', ') || null,
        keyItems,
        matched: rows.reduce((n, r) => n + r.matched, 0),
        extra: rows.reduce((n, r) => n + r.extra, 0),
        medianError: median(items.flatMap((i) => (i.error === null ? [] : [i.error]))),
        score: keyItems ? items.reduce((n, i) => n + i.score, 0) / keyItems : null,
        byTool: [],
      },
    ];
  });
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const num = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1));

function categoryTable(rows: CategoryScore[]): string[] {
  const out = ['| Category | Tool | Key items | Matched | Tool items not in key | Median qty error | Score |', '|---|---|---:|---:|---:|---:|---:|'];
  for (const r of rows) {
    out.push(`| ${r.category} | ${r.tool ?? '— (none)'} | ${r.keyItems} | ${r.matched} | ${r.extra} | ${pct(r.medianError)} | ${pct(r.score)} |`);
    for (const t of r.byTool.length > 1 ? r.byTool.filter((t) => t.tool !== r.tool) : [])
      out.push(`| ↳ ${r.category} | ${t.tool} | | ${t.matched} | ${t.extra} | ${pct(t.medianError)} | ${pct(t.score)} |`);
  }
  return out;
}

/** Facts about a run shown under its job heading. */
export interface RunInfo {
  units: string;
  sheets: number;
  scaled: number;
  classes: Record<string, number>;
  ms: number;
  tools: { tool: string; ms: number; message: string; error?: string }[];
  errors: number;
  /** The first errors, one line each. */
  errorLines?: string[];
  unscaled: string[];
}

/** SCORECARD.md: one table per job and an overall table. */
export function scorecardMarkdown(jobs: { score: JobScore; run?: RunInfo }[], when = new Date()): string {
  const lines: string[] = [`# Takeoff AI benchmark scorecard`, '', `Run ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC. Score per category = mean over the key's lines of (1 − |tool − key| / key), 0 for a line the tools missed or measured in another dimension; the best-scoring tool counts when several produce a category.`, ''];
  const keyed = jobs.filter((j) => j.score.hasKey);
  lines.push('## Overall', '');
  if (keyed.length) {
    lines.push(`${keyed.length} job${keyed.length === 1 ? '' : 's'} with a key.`, '', ...categoryTable(overall(keyed.map((j) => j.score))), '');
  } else lines.push('No job has a key.json yet.', '');
  for (const { score, run } of jobs) {
    lines.push(`## ${score.job}`, '');
    if (run) {
      const classes = Object.entries(run.classes).map(([k, n]) => `${n} ${k}`).join(', ');
      lines.push(`${run.sheets} sheets (${classes}), ${run.scaled} with a scale, ${run.units}. Run time ${(run.ms / 1000).toFixed(0)} s. ${run.errors ? `**${run.errors} errors** (see result.json).` : 'No errors.'}`, '');
      if (run.errorLines?.length) lines.push(...run.errorLines.map((e) => `- Error: ${e.replace(/\|/g, '/')}`), '');
      if (run.unscaled.length) lines.push(`Unscaled: ${run.unscaled.join(', ')}.`, '');
      lines.push('| Tool | Time | Result |', '|---|---:|---|');
      for (const t of run.tools) lines.push(`| ${t.tool} | ${(t.ms / 1000).toFixed(1)} s | ${(t.error ? `ERROR ${t.error.split('\n')[0]}` : t.message).replace(/\|/g, '/')} |`);
      lines.push('');
    }
    if (!score.hasKey) {
      lines.push('No key.json: what the tools produced.', '', '| Category | Tool | Items | Total |', '|---|---|---:|---|');
      for (const p of score.produced) lines.push(`| ${p.category} | ${p.tool} | ${p.items} | ${Object.entries(p.totals).map(([u, q]) => `${num(q)} ${u}`).join(', ')} |`);
      lines.push('');
      continue;
    }
    lines.push(...categoryTable(score.categories), '');
    lines.push('<details><summary>Per item</summary>', '', '| Category | Key code | Key description | Key qty | Tool line | Tool qty | Match | Error |', '|---|---|---|---:|---|---:|---|---:|');
    for (const i of score.items)
      lines.push(
        `| ${i.category} | ${i.key.code ?? ''} | ${i.key.description.replace(/\|/g, '/')} | ${num(i.key.qty)} ${i.key.unit} | ${i.got ? `${i.got.code ?? i.got.name} (${i.got.tool})`.replace(/\|/g, '/') : '—'} | ${i.got ? `${num(i.got.qty)} ${i.got.unit}` : ''} | ${i.how ?? ''} | ${pct(i.error)} |`,
      );
    lines.push('', '</details>', '');
  }
  return lines.join('\n');
}
