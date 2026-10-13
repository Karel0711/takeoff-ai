import type { ScoreReport } from '../eval/score';

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');

function Stat({ label, n, d }: { label: string; n: number; d: number }) {
  const state = d === 0 ? '' : n === d ? 'good' : n / d >= 0.8 ? 'fair' : 'poor';
  return (
    <div className={`stat ${state}`}>
      <span className="stat-value">
        {n}/{d}
      </span>
      <span className="stat-label">
        {label} · {pct(n, d)}
      </span>
    </div>
  );
}

/** Differences between the AI's reading and the estimator's transcription, worst first. */
export function ScorePanel({ report, keyName }: { report: ScoreReport; keyName: string }) {
  const problems = report.assemblies.flatMap((a) => {
    const out: string[] = [];
    if (!a.found) return [`${a.label}: not returned`];
    if (a.titleSimilarity < 0.6) out.push(`${a.code}: title differs`);
    if (a.categoryMatch === false) out.push(`${a.code}: wrong category`);
    for (const l of a.layers) {
      if (!l.found) out.push(`${a.code}: missing layer “${l.expected}”`);
      else if (!l.numbersMatch) out.push(`${a.code}: “${l.found}” should be “${l.expected}”`);
      if (l.found && l.spacing && l.spacing.found !== l.spacing.expected)
        out.push(`${a.code}: spacing ${l.spacing.found ?? 'not recorded'} should be ${l.spacing.expected} mm`);
    }
    for (const x of a.extraLayers) out.push(`${a.code}: extra layer “${x}”`);
    if (a.thickness && (a.thickness.found === null || Math.abs(a.thickness.found - a.thickness.expected) > 5))
      out.push(`${a.code}: overall ${a.thickness.found ?? 'not recorded'} should be ${a.thickness.expected} mm`);
    return out;
  });

  return (
    <div className="score">
      <div className="score-head">
        Scored against <strong>{keyName}</strong>
        {report.sheet && <> · sheet {report.sheet}</>}
      </div>
      {report.expectedTypes === 0 ? (
        <p className="warn">That workbook has no assembly schedule for this sheet.</p>
      ) : (
        <>
          <div className="stats">
            <Stat label="types" n={report.foundTypes} d={report.expectedTypes} />
            <Stat label="layers exact" n={report.layersExact} d={report.layersExpected} />
            <Stat label="spacings" n={report.spacingsCorrect} d={report.spacingsExpected} />
            <Stat label="thickness" n={report.thicknessCorrect} d={report.thicknessExpected} />
            <Stat label="category" n={report.categoriesCorrect} d={report.categoriesChecked} />
          </div>
          {report.unexpectedTypes.length > 0 && (
            <p className="warn">Not in the workbook for this sheet: {report.unexpectedTypes.join(', ')}</p>
          )}
          {problems.length === 0 ? (
            <p className="muted">No differences found.</p>
          ) : (
            <details open={problems.length <= 12}>
              <summary>
                {problems.length} difference{problems.length === 1 ? '' : 's'}
              </summary>
              <ul className="problems">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
