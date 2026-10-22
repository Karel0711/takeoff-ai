/**
 * Runs the app's own whole-set takeoff (src/automate/wholeSet.ts) on a job folder in Node and
 * writes <job>/whole.json: the project it made and its review, for drawing over the sheets.
 *   JOB=/path/to/job npx vitest run -c bench/vitest.config.ts bench/whole.test.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { takeOffWholeSet, reviewText } from '../src/automate/wholeSet';
import { newProject } from '../src/model';
import { reissued } from '../src/reissue';
import { jobPdfs } from './runJob';
import { makeSheets, NodeSet, openDoc, unitsOf } from './nodeSet';
import { issueOrder } from '../src/reissue';

it('whole set', async () => {
  const dir = process.env.JOB!;
  const files = issueOrder(jobPdfs(dir));
  const docs = await Promise.all(files.map((f) => openDoc(f)));
  const units = (await unitsOf(docs)).units;
  const { sheets } = await makeSheets(docs, units);
  const newer = reissued(sheets, docs);
  for (const s of sheets) if (newer.has(s.id)) s.superseded = true;
  const project = { ...newProject(units), name: 'job', docs: docs.map((d) => ({ id: d.id, name: d.file })), sheets };
  const set = new NodeSet(new Map(docs.map((d) => [d.id, d])), sheets);
  const access = {
    page: (s: (typeof sheets)[number]) => set.page(s),
    texts: (s: (typeof sheets)[number]) => set.texts(s),
    segments: (s: (typeof sheets)[number]) => set.segments(s),
    doc: (s: (typeof sheets)[number]) => set.doc(s),
    docs: () => docs.map((d) => d.pdf),
  };
  const t = Date.now();
  const r = await takeOffWholeSet(project, access as never, { maxOpening: 3, progress: (s) => process.stdout.write(`${s}\n`) });
  const text = reviewText('job', r);
  process.stdout.write(`${text}\n${((Date.now() - t) / 1000).toFixed(0)} s\n`);
  writeFileSync(join(dir, 'whole.json'), JSON.stringify({ project: r.project, review: r.review, notes: [...r.notes], files: docs.map((d) => ({ id: d.id, file: d.file })) }));
}, 3_600_000);
