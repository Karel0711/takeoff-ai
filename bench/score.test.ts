// Re-scores the existing result.json files against key.json without re-running the tools:
//   npx vitest run -c bench/vitest.config.ts bench/score.test.ts   (BENCH=<folder> for another one)
import { it } from 'vitest';
import { writeScorecard } from './scorecard';

it('scorecard', () => {
  process.stdout.write(`Scorecard: ${writeScorecard(process.env.BENCH ?? '/home/claude/bench')}\n`);
});
