import { useEffect, useState } from 'react';
import type { LegendRow } from '../fill/legend';
import type { Kind, TakeoffType } from '../model';

export interface LegendChoice {
  label: string;
  kind: Kind;
  row: LegendRow;
}

interface Props {
  sheetName: string;
  rows: LegendRow[];
  /** Whether the project has other sheets to count the symbols on. */
  multiSheet: boolean;
  /** The project's types, to spot a line whose code is already one (ACT-1 read from a finish schedule). */
  existing: TakeoffType[];
  onAdd: (choices: LegendChoice[], everywhere: boolean) => void;
  onClose: () => void;
}

/** How many a row will add: copies of its symbol, else its tag's places on the sheet. */
export const legendCount = (r: LegendRow) => (r.found?.length ? r.found.length : (r.tagged?.length ?? 0));

/** The rows read from a boxed legend, to turn into takeoff types (symbols counted). */
export function LegendDialog({ sheetName, rows, multiSheet, existing, onAdd, onClose }: Props) {
  const [everywhere, setEverywhere] = useState(false);
  // A line whose code (ACT-1, CPT-1) names a type already here would count that finish twice.
  const already = rows.map((r) => {
    const code = /^[A-Z]{1,4}-?\d{1,3}[A-Z]?\b/.exec(r.label)?.[0];
    return code ? existing.find((t) => t.name === code || t.name.startsWith(`${code} `)) : undefined;
  });
  const [draft, setDraft] = useState(() =>
    rows.map((r, i) => ({ on: !!r.graphic && !already[i], label: r.label.replace(/:$/, ''), kind: (r.kind ?? 'count') as Kind })),
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const set = (i: number, patch: Partial<(typeof draft)[number]>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const picked = draft.filter((d) => d.on && d.label.trim());

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Legend" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Legend · {sheetName}</h3>
          <button onClick={onClose}>Cancel</button>
        </div>
        <p className="muted small-text">
          Each line of the legend becomes a takeoff type. Symbols are counted where the same symbol, or its tag, is drawn on this sheet; hatches and line types
          are added as types to fill or trace.
        </p>
        <table className="rooms-table legend-table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Measured as</th>
              <th className="num">On this sheet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const d = draft[i];
              const n = legendCount(r);
              return (
                <tr key={i} className={d.on ? '' : 'disabled-row'}>
                  <td>
                    <input type="checkbox" checked={d.on} onChange={(e) => set(i, { on: e.target.checked })} aria-label={`Add ${d.label}`} />
                  </td>
                  <td>
                    <input className="room-name" value={d.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Type name" />
                    {already[i] && <div className="field-hint">Already a type here ({already[i]!.name}). Adding it again counts it twice.</div>}
                  </td>
                  <td>
                    <select value={d.kind} onChange={(e) => set(i, { kind: e.target.value as Kind })} aria-label="Measured as">
                      <option value="count">Count</option>
                      <option value="area">Area</option>
                      <option value="linear">Length</option>
                    </select>
                  </td>
                  <td className="num">
                    {d.kind === 'area' && r.areas?.length
                      ? `${r.areas.length} area${r.areas.length === 1 ? '' : 's'} hatched like this`
                      : d.kind !== 'count'
                      ? 'add, then fill or trace'
                      : n
                        ? `${n} found${r.found?.length ? '' : ` by tag ${r.tag}`}`
                        : 'none found, count with Symbols'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row-actions sticky library-actions">
          {multiSheet && rows.some((r) => r.sample) && (
            <label className="inline check-row legend-everywhere">
              <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> Also count the symbols on every other sheet
            </label>
          )}
          <button
            className="primary"
            disabled={!picked.length}
            onClick={() => onAdd(draft.flatMap((d, i) => (d.on && d.label.trim() ? [{ label: d.label.trim(), kind: d.kind, row: rows[i] }] : [])), everywhere)}
          >
            {picked.length ? `Add ${picked.length} type${picked.length === 1 ? '' : 's'}` : 'Add types'}
          </button>
        </div>
      </div>
    </div>
  );
}
