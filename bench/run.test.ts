/**
 * The benchmark runner: runs the app's automatic takeoff tools on whole drawing sets in Node and
 * scores them against estimators' takeoffs.
 *
 *   One job:  JOB=<slug or folder> npx vitest run -c bench/vitest.config.ts bench/run.test.ts
 *   Every job: npx vitest run -c bench/vitest.config.ts bench/run.test.ts
 *   Score only (no re-run): npx vitest run -c bench/vitest.config.ts bench/score.test.ts
 *
 * TOOLS=walls,rooms,doors,finishes,ceilings,symbols,sprinklers runs only those (Count symbols
 * is the slow one: minutes on a big set).
 *
 * A job is a folder of drawing PDFs with an optional key.json, in BENCH (default
 * /home/claude/bench). Each run writes <job>/result.json, then BENCH/SCORECARD.md and
 * BENCH/scorecard.json over every job with a result. JOB can also be a folder elsewhere: its
 * scorecard goes in the folder above it.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { it } from 'vitest';
import { jobPdfs, runJobTo, type JobResult } from './runJob';
import { writeScorecard } from './scorecard';

const BENCH = process.env.BENCH ?? '/home/claude/bench';

it('benchmark', async () => {
  const job = process.env.JOB;
  const dirs = job
    ? [existsSync(resolve(job)) && job.includes('/') ? resolve(job) : join(BENCH, job)]
    : existsSync(BENCH)
      ? readdirSync(BENCH)
          .map((d) => join(BENCH, d))
          .filter((d) => statSync(d).isDirectory() && jobPdfs(d).length)
      : [];
  if (!dirs.length) throw new Error(`No jobs: ${job ? `${job} not found` : `no folders with PDFs in ${BENCH}`}`);
  const log = (s: string) => process.stdout.write(`${s}\n`);
  for (const dir of dirs) {
    const t = Date.now();
    try {
      const r = await runJobTo(dir, dir, log, process.env.TOOLS?.split(',').map((t) => t.trim()).filter(Boolean));
      log(`${r.job}: ${r.items.length} items, ${r.errors.length} errors, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    } catch (e) {
      // One job failing does not stop the others: it is scored with nothing produced.
      const error = e instanceof Error ? (e.stack ?? e.message) : String(e);
      log(`${dir}: FAILED ${error}`);
      const failed: JobResult = { job: basename(dir), files: [], units: 'metric', unitsWhy: '', ranAt: new Date().toISOString(), ms: Date.now() - t, sheets: [], tools: [], notRun: [], items: [], errors: [{ tool: 'run', error }] };
      writeFileSync(join(dir, 'result.json'), JSON.stringify(failed, null, 1));
    }
  }
  const out = writeScorecard(job ? dirname(dirs[0]) : BENCH);
  log(`Scorecard: ${out}`);
});
