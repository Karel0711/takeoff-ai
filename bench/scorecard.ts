import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobResult } from './runJob';
import { keyItemsOf, scoreJob, scorecardMarkdown, overall, type JobScore, type RunInfo } from './score';

/** Scores every job folder under `bench` that has a result.json; writes SCORECARD.md and scorecard.json there. Returns the markdown path. */
export function writeScorecard(bench: string): string {
  const jobs: { score: JobScore; run?: RunInfo }[] = [];
  for (const d of readdirSync(bench).sort()) {
    const dir = join(bench, d);
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'result.json'))) continue;
    try {
      const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as JobResult;
      const keyPath = join(dir, 'key.json');
      const key = existsSync(keyPath) ? keyItemsOf(JSON.parse(readFileSync(keyPath, 'utf8'))) : null;
      const classes: Record<string, number> = {};
      for (const s of result.sheets) {
        const c = s.superseded ? 'superseded by an addendum' : s.class;
        classes[c] = (classes[c] ?? 0) + 1;
      }
      jobs.push({
        score: scoreJob(d, result.items, key),
        run: {
          units: result.units,
          sheets: result.sheets.length,
          scaled: result.sheets.filter((s) => s.scale).length,
          classes,
          ms: result.ms,
          tools: result.tools,
          errors: result.errors.length,
          errorLines: result.errors.slice(0, 8).map((e) => `${e.sheet ? `${e.sheet} ` : ''}${e.tool}: ${e.error.split('\n')[0]}`),
          unscaled: result.sheets.filter((s) => !s.scale && !s.superseded && s.class !== 'other' && s.class !== 'schedule').map((s) => `${s.name} (${s.class})`),
        },
      });
    } catch (e) {
      jobs.push({ score: { job: `${d} (unreadable: ${e instanceof Error ? e.message : String(e)})`, hasKey: false, categories: [], items: [], produced: [] } });
    }
  }
  const md = join(bench, 'SCORECARD.md');
  writeFileSync(md, scorecardMarkdown(jobs));
  writeFileSync(
    join(bench, 'scorecard.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), overall: overall(jobs.map((j) => j.score)), jobs: jobs.map((j) => ({ ...j.score, run: j.run })) }, null, 1),
  );
  return md;
}
