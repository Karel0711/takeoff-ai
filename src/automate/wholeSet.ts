import { applyFinishes, finishRooms, readFinishes } from './finishes';
import { automateCeilings } from './ceilings';
import { doorTakeoff, findDoorTagsIn } from './doors';
import type { Automation } from './result';
import { automateRooms } from './rooms';
import { pause, type SetAccess } from './set';
import { automateSprinklers } from './sprinklers';
import { defaultSymbolChoices, symbolTakeoff, symbolTallies } from './symbols';
import { automateWalls, projectSetTypes } from './walls';
import { automateWindows } from './windows';
import { planShift as planShiftKnown, repeatedRuns } from './overlap';
import { findRoomLabels } from '../fill/rooms';
import type { Project, Pt, Sheet } from '../model';
import type { PDFDocumentProxy } from '../pdf';
import { classifySheet, type SheetKind } from '../sheetKind';
import { viewTitle } from '../sheetScale';
import { readTitleBlock } from '../titleBlock';

/**
 * Take off the whole set: every automatic tool over every sheet it belongs on, the way an
 * estimator works a set, in one go. Per new-work floor plan: walls (overall plans first, then
 * enlarged plans add only the wall types not already taken off), rooms on each level's plan;
 * then door tags on every sheet, window tags, room finishes from the schedules, ceilings on the
 * RCPs, legend symbols and sprinklers. A tool or sheet that fails is noted and the rest goes on.
 *
 * Alongside the takeoff it lists what an estimator has to look at, and the questions to send the
 * consultant (RFIs): sheets with no scale, rooms whose walls don't close, wall tags pointing at
 * no wall, rooms the finish schedule doesn't list and schedule lines with no room on the plans.
 * The same pipeline the benchmark scores (bench/runJob.ts).
 */

export interface WholeSetAccess extends SetAccess {
  /** A sheet's drawing file, once open. */
  doc(sheet: Sheet): PDFDocumentProxy | undefined;
  /** Every open drawing file (wall types can be listed in another file of the set). */
  docs(): PDFDocumentProxy[];
}

export interface ReviewItem {
  /** 'rfi': a question for the consultant; 'check': something to look at before pricing. */
  kind: 'rfi' | 'check';
  sheet?: string;
  sheetId?: string;
  text: string;
}

export interface WholeSetResult {
  /** The project with everything found added (apply as one change). */
  project: Project;
  /** One line per tool: what it did. */
  done: { tool: string; message: string; ms: number; error?: string }[];
  review: ReviewItem[];
  /** Per sheet: what was done there and what went wrong. */
  notes: Map<string, string[]>;
  ms: number;
  /** Sheets read as new-work floor plans, RCPs and so on, for the summary. */
  counts: { sheets: number; plans: number; noScale: number };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sheetLabel = (s: Sheet) => `${s.name}${s.title ? ` ${s.title}` : ''}`;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function takeOffWholeSet(
  start: Project,
  access: WholeSetAccess,
  opts: { maxOpening: number; progress?: (text: string) => void; signal?: { stopped: boolean }; show?: (sheetId: string) => void },
): Promise<WholeSetResult> {
  const t0 = now();
  let project = start;
  const done: WholeSetResult['done'] = [];
  const review: ReviewItem[] = [];
  const notes = new Map<string, string[]>();
  const note = (s: Sheet, text: string) => notes.set(s.id, [...(notes.get(s.id) ?? []), text]);
  const say = (text: string) => opts.progress?.(text);
  const toolOfType = new Map<string, string>();
  const apply = (tool: string, r: Automation) => {
    if (!r.apply) return;
    const before = new Set(project.types.map((t) => t.id));
    project = r.apply(project);
    for (const t of project.types) if (!before.has(t.id)) toolOfType.set(t.id, tool);
  };
  const run = async (tool: string, body: () => Promise<string>) => {
    if (opts.signal?.stopped) return;
    const t = now();
    try {
      done.push({ tool, message: await body(), ms: now() - t });
    } catch (e) {
      done.push({ tool, message: 'failed', error: errText(e), ms: now() - t });
      review.push({ kind: 'check', text: `${tool}: stopped with an error (${errText(e)}). Run it on its own from Automate.` });
    }
  };

  let live = project.sheets.filter((s) => !s.superseded);
  const kinds = new Map<string, SheetKind>();
  // Titles read again: one read before a fix (a title block's two-line title read as its last
  // line, "PLAN" for "LEVEL 1 (LOWER) DEMO PLAN") is put right, since what a sheet is decides
  // which tools run on it.
  const retitled = new Map<string, string>();
  for (const s of live) {
    const texts = await access.texts(s).catch(() => []);
    const fresh = texts.length ? (readTitleBlock(texts, s.width, s.height).title ?? viewTitle(texts)) : null;
    let title = s.title;
    if (fresh && fresh !== title && (!title || fresh.toUpperCase().includes(title.toUpperCase()))) {
      title = fresh;
      retitled.set(s.id, fresh);
    }
    kinds.set(s.id, classifySheet({ name: s.name, title }));
  }
  if (retitled.size) {
    project = { ...project, sheets: project.sheets.map((s) => (retitled.has(s.id) ? { ...s, title: retitled.get(s.id) } : s)) };
    live = project.sheets.filter((s) => !s.superseded);
  }
  const plans = live
    .filter((s) => kinds.get(s.id)!.kind === 'floor plan')
    .sort((a, b) => +(kinds.get(a.id)!.level === 'enlarged') - +(kinds.get(b.id)!.level === 'enlarged'));
  const levels = plans.filter((s) => kinds.get(s.id)!.level === 'level');
  /** The floor a plan is of, from its title ("LEVEL 1 ENLARGED FLOOR PLAN" is level 1). */
  const levelOf = (s: Sheet) => {
    const t = `${s.title ?? ''}`.toUpperCase();
    const m = /\bLEVEL\s*([A-Z0-9]+)|\b(BASEMENT|CELLAR|GROUND|MAIN|MEZZANINE|FIRST|SECOND|THIRD|FOURTH|FIFTH|ROOF)\b|\b(\d+)(?:ST|ND|RD|TH)\s+FLOOR/.exec(t);
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };
  const enlargedLabels = new Map<string, { number: string; at: Pt }[]>();
  /** Room numbers tagged on the plans, and what happened to each (for telling RFIs from things to fix by hand). */
  const tagged = new Map<string, string>();
  const roomKey = (n: string) => n.replace(/[\s.-]/g, '').toUpperCase();

  // Sheets the tools need a scale on.
  const needScale = live.filter((s) => !s.metersPerPoint && ['floor plan', 'RCP', 'finish plan'].includes(kinds.get(s.id)!.kind));
  for (const s of needScale) {
    review.push({
      kind: 'check',
      sheet: s.name,
      sheetId: s.id,
      text:
        s.scaleHints.length > 1
          ? `${sheetLabel(s)}: no scale set, the sheet notes several (${s.scaleHints.join(', ')}). Set it, then run again for this sheet.`
          : `${sheetLabel(s)}: no scale set. Set it, then run again for this sheet.`,
    });
    if (s.scaleHints.length > 1) review.push({ kind: 'rfi', sheet: s.name, sheetId: s.id, text: `Please confirm the scale of the main plan on ${s.name} (the sheet shows ${s.scaleHints.join(' and ')}).` });
  }

  for (const kind of ['walls', 'rooms'] as const) {
    await run(kind, async () => {
      const of = kind === 'walls' ? plans : levels;
      let made = 0;
      for (const [i, s] of of.entries()) {
        if (opts.signal?.stopped) break;
        if (!s.metersPerPoint) {
          note(s, `${kind}: not run (no scale)`);
          continue;
        }
        say(`Whole set: ${kind} on ${s.name} (${i + 1} of ${of.length})…`);
        opts.show?.(s.id);
        await pause();
        try {
          const page = await access.page(s);
          if (!page) throw new Error('drawing not open');
          const enlarged = kinds.get(s.id)!.level === 'enlarged';
          // An enlarged plan adds the wall types its floor's overall plan left to it; a floor whose
          // overall plan tags no walls is taken off its enlarged plans whole.
          const floor = levelOf(s);
          const overall = new Set(plans.filter((o) => kinds.get(o.id)!.level !== 'enlarged' && (!floor || levelOf(o) === floor)).map((o) => o.id));
          const taken = new Set(
            project.types
              .filter((t) => toolOfType.get(t.id) === 'walls' && project.measurements.some((m) => m.typeId === t.id && overall.has(m.sheetId)))
              .map((t) => t.name.split(' – ')[0].trim()),
          );
          const doc = access.doc(s);
          const others = access.docs().filter((d) => d !== doc);
          if (kind === 'walls') {
            const r = await automateWalls(project, page, doc, s, opts.maxOpening, others, enlarged ? taken : undefined);
            apply('walls', r);
            if (enlarged) {
              // Enlarged plans of one floor often overlap: walls already taken off where they overlap count once.
              const segs = await access.segments(s);
              const labels = segs ? findRoomLabels(await access.texts(s), segs) : [];
              enlargedLabels.set(s.id, labels);
              const mine = project.measurements.filter((m) => m.sheetId === s.id && m.source === 'walls');
              const earlier = plans
                .filter((o) => o.id !== s.id && enlargedLabels.has(o.id) && (!floor || levelOf(o) === floor))
                .map((o) => ({ sheet: o, labels: enlargedLabels.get(o.id)!, runs: project.measurements.filter((m) => m.sheetId === o.id && m.source === 'walls') }));
              const code = (id: string) => project.types.find((t) => t.id === id)?.name.split(' – ')[0].trim() ?? id;
              const again = repeatedRuns(s, mine, labels, earlier, code);
              for (const e of earlier) {
                const shared = [...new Set(labels.map((l) => l.number).filter((n) => e.labels.some((o) => o.number === n)))];
                if (shared.length >= 2 && !planShiftKnown(labels, e.labels))
                  review.push({ kind: 'check', sheet: s.name, sheetId: s.id, text: `${s.name} and ${e.sheet.name} are enlarged plans of the same floor that overlap (rooms ${shared.join(', ')} are on both). Check walls tagged on both there are not counted twice.` });
              }
              if (again.size) {
                project = { ...project, measurements: project.measurements.filter((m) => !again.has(m.id)) };
                note(s, `walls: ${again.size} runs already taken off on an overlapping plan left out`);
              }
            }
            note(s, `walls: ${r.message}`);
            const lost = r.read?.result.unmatched ?? [];
            if (lost.length) {
              const codes = [...new Set(lost.map((u) => u.code))];
              review.push({ kind: 'check', sheet: s.name, sheetId: s.id, text: `${sheetLabel(s)}: ${lost.length} wall tag${lost.length === 1 ? '' : 's'} (${codes.join(', ')}) point at no wall the tool could follow. Measure those by hand.` });
            }
            if (r.apply) made++;
          } else {
            const r = await automateRooms(project, page, s, opts.maxOpening, await projectSetTypes(doc, others).catch(() => undefined));
            apply('rooms', r);
            note(s, `rooms: ${r.message}`);
            r.rooms.forEach((x, i) => {
              const nums = x.labels.map((l) => l.number);
              const why = r.shaded?.has(i) ? `in the shaded area outside the work on ${s.name}` : !x.points ? `did not close on ${s.name}` : nums.length > 1 ? `filled as one area with ${nums.join(', ')} on ${s.name}` : '';
              for (const n of nums) if (!tagged.has(roomKey(n)) || why === '') tagged.set(roomKey(n), why);
            });
            const merged = r.rooms.filter((x, i) => x.points && !r.shaded?.has(i) && x.labels.length > 1);
            if (merged.length)
              review.push({ kind: 'check', sheet: s.name, sheetId: s.id, text: `${sheetLabel(s)}: ${merged.map((x) => x.labels.map((l) => l.number).join(' + ')).join(', ')} filled as one area each (no wall drawn between them). Split them by hand if they are priced apart.` });
            const shadedNums = r.rooms.filter((_, i) => r.shaded?.has(i)).map((x) => x.labels.map((l) => l.number).join('/'));
            if (shadedNums.length)
              review.push({ kind: 'check', sheet: s.name, sheetId: s.id, text: `${sheetLabel(s)}: rooms ${shadedNums.join(', ')} are in the shaded area (existing, outside the work) and were left out.` });
            const open = r.rooms.filter((x) => !x.points);
            if (open.length) {
              const nums = open.map((x) => x.labels.map((l) => l.number).join('/')).join(', ');
              review.push({ kind: 'check', sheet: s.name, sheetId: s.id, text: `${sheetLabel(s)}: ${open.length} room${open.length === 1 ? '' : 's'} did not close (${nums}). Fill them by hand (Fill tool).` });
            }
            if (r.apply) made++;
          }
          page.cleanup();
        } catch (e) {
          note(s, `${kind}: error ${errText(e)}`);
          review.push({ kind: 'check', sheet: s.name, sheetId: s.id, text: `${sheetLabel(s)}: ${kind} failed (${errText(e)}).` });
        }
      }
      return of.length ? `${made} of ${of.length} plans` : 'no new-work floor plans found';
    });
  }

  await run('doors', async () => {
    const home = levels[0] ?? plans[0];
    if (!home) return 'not run: no floor plan';
    say('Whole set: door tags on every sheet…');
    await pause();
    const r = doorTakeoff(project, await findDoorTagsIn(project, access, home, true), home, true);
    apply('doors', r);
    return r.message;
  });

  await run('windows', async () => {
    say('Whole set: window tags…');
    await pause();
    const r = await automateWindows(project, access);
    apply('windows', r);
    return r.message;
  });

  await run('finishes', async () => {
    const rooms = finishRooms(project);
    if (!rooms.length) return 'not run: no rooms';
    say('Whole set: room finishes from the schedules…');
    await pause();
    const r = await readFinishes(project, rooms, access, project.types);
    apply('finishes', { message: r.note, apply: applyFinishes(r) });
    if (r.unmatched?.rooms.length)
      review.push({
        kind: 'rfi',
        text: `Rooms ${r.unmatched.rooms.slice(0, 25).join(', ')}${r.unmatched.rooms.length > 25 ? ` and ${r.unmatched.rooms.length - 25} more` : ''} are on the plans but not in the room finish schedule. Please confirm their finishes.`,
      });
    // A schedule line for a room tagged on a plan but not taken off is ours to fix; one tagged nowhere is a question.
    const lines = r.unmatched?.rows ?? [];
    const known = lines.filter((l) => tagged.has(roomKey(l.split(' ')[0])));
    const nowhere = lines.filter((l) => !tagged.has(roomKey(l.split(' ')[0])));
    for (const l of known) {
      const why = tagged.get(roomKey(l.split(' ')[0]));
      if (why && !why.startsWith('in the shaded')) review.push({ kind: 'check', text: `${l.replace(/ \([^)]*\)$/, '')}: in the finish schedule, ${why}. Take it off by hand so its finishes count.` });
    }
    if (nowhere.length)
      review.push({
        kind: 'rfi',
        text: `The room finish schedule lists ${nowhere.slice(0, 25).map((l) => l.replace(/ \([^)]*\)$/, '')).join(', ')}${nowhere.length > 25 ? ` and ${nowhere.length - 25} more` : ''}, which are not tagged on the floor plans. Please confirm where these rooms are and whether they are in the scope.`,
      });
    return r.note;
  });

  await run('ceilings', async () => {
    say('Whole set: ceilings on the RCPs…');
    await pause();
    const r = await automateCeilings(project, access, null);
    apply('ceilings', r);
    return r.message;
  });

  await run('symbols', async () => {
    say('Whole set: legend symbols…');
    await pause();
    const { tallies, message } = await symbolTallies(project, access);
    if (!tallies.length) return message ?? 'no legends with symbols';
    const choices = defaultSymbolChoices(tallies);
    if (!choices.length) return `${tallies.length} legend symbols, none found on the plans`;
    const r = symbolTakeoff(project, choices);
    apply('symbols', r);
    // Counted on the building's plans and ceiling plans only: a code plan's rating marks, a site plan's
    // paving and a finish plan's hatch swatches are not things to price by the each.
    const counted = new Set(live.filter((s) => ['floor plan', 'RCP'].includes(kinds.get(s.id)!.kind)).map((s) => s.id));
    const symbolTypes = new Set(project.types.filter((t) => toolOfType.get(t.id) === 'symbols').map((t) => t.id));
    const kept = project.measurements.filter((m) => !symbolTypes.has(m.typeId) || counted.has(m.sheetId));
    const used = new Set(kept.map((m) => m.typeId));
    project = { ...project, measurements: kept, types: project.types.filter((t) => !symbolTypes.has(t.id) || used.has(t.id)) };
    const left = project.types.filter((t) => symbolTypes.has(t.id)).length;
    if (!left) return 'no legend symbols on the floor plans or ceiling plans';
    const missing = tallies.length - choices.length;
    if (missing) review.push({ kind: 'check', text: `${missing} symbol${missing === 1 ? '' : 's'} in the legends were not found on any plan. Check whether they are used.` });
    return r.message;
  });

  await run('sprinklers', async () => {
    say('Whole set: sprinklers…');
    await pause();
    const r = await automateSprinklers(project, access, null);
    apply('sprinklers', r);
    return r.message;
  });

  return {
    project,
    done,
    review,
    notes,
    ms: now() - t0,
    counts: { sheets: live.length, plans: plans.length, noScale: needScale.length },
  };
}

/** The review as text: a numbered RFI list (to paste into the tender portal) and the checks. */
export function reviewText(projectName: string, r: WholeSetResult): string {
  const rfis = r.review.filter((x) => x.kind === 'rfi');
  const checks = r.review.filter((x) => x.kind === 'check');
  const lines = [`${projectName}: whole-set takeoff`, `${r.counts.sheets} sheets, ${r.counts.plans} floor plans, ${(r.ms / 1000).toFixed(0)} s`, ''];
  for (const d of r.done) lines.push(`${d.tool}: ${d.error ? `failed (${d.error})` : d.message}`);
  lines.push('', 'RFIs');
  if (rfis.length) rfis.forEach((x, i) => lines.push(`${i + 1}. ${x.text}`));
  else lines.push('None.');
  lines.push('', 'To check before pricing');
  if (checks.length) checks.forEach((x) => lines.push(`- ${x.text}`));
  else lines.push('Nothing flagged.');
  return lines.join('\n');
}
