import { useEffect, useState } from 'react';
import type { SymbolTally } from '../fill/autoSymbols';
import type { TakeoffType } from '../model';

export interface SymbolChoice {
  tally: SymbolTally;
  name: string;
}

interface Props {
  tallies: SymbolTally[];
  /** Sheet names by id, for the per-sheet counts. */
  sheetName: (id: string) => string;
  /** The types in use: a line already a type gets its count replaced, not doubled. */
  existing: TakeoffType[];
  onAdd: (choices: SymbolChoice[]) => void;
  /** Count a symbol clicked on the sheet instead (one the legend's drawing does not match). */
  onPick: () => void;
  onClose: () => void;
}

/** Symbols counted across the set, one row per legend line: check, rename, then add as count types. */
export function SymbolCountDialog({ tallies, sheetName, existing, onAdd, onPick, onClose }: Props) {
  const [draft, setDraft] = useState(() => tallies.map((t) => ({ on: t.total > 0, name: t.symbol.label })));
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const set = (i: number, patch: Partial<(typeof draft)[number]>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const picked = draft.filter((d) => d.on && d.name.trim());
  const legends = [...new Set(tallies.map((t) => t.symbol.legend).filter(Boolean))];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Count symbols" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Count symbols</h3>
          <button onClick={onClose}>Cancel</button>
        </div>
        <p className="muted small-text">
          {legends.length ? `Read from ${legends.join(', ')}. ` : ''}Each line drawn with a symbol is counted on the sheets its legend is for, at that sheet&rsquo;s scale. Where
          the plan draws a symbol differently from its legend it is not found: click one on the sheet to count it.
        </p>
        <table className="rooms-table legend-table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th className="num">Count</th>
              <th>Sheets</th>
            </tr>
          </thead>
          <tbody>
            {tallies.map((t, i) => {
              const d = draft[i];
              const already = existing.find((x) => x.kind === 'count' && x.name === d.name.trim());
              return (
                <tr key={t.symbol.key} className={d.on ? '' : 'disabled-row'}>
                  <td>
                    <input type="checkbox" checked={d.on} onChange={(e) => set(i, { on: e.target.checked })} aria-label={`Add ${d.name}`} />
                  </td>
                  <td>
                    <input className="room-name" value={d.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Type name" />
                    {already && <div className="field-hint">Already a type: its symbol count is replaced.</div>}
                  </td>
                  <td className="num">{t.total || '—'}</td>
                  <td className="muted small-text">
                    {t.total
                      ? t.places
                          .slice(0, 4)
                          .map((p) => `${sheetName(p.sheetId)} ${p.at.length}`)
                          .join(' · ') + (t.places.length > 4 ? ` · +${t.places.length - 4} more` : '')
                      : 'none found, click one on the sheet'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row-actions sticky library-actions">
          <button onClick={onPick}>Click a symbol on the sheet…</button>
          <button
            className="primary"
            disabled={!picked.length}
            onClick={() => onAdd(draft.flatMap((d, i) => (d.on && d.name.trim() ? [{ tally: tallies[i], name: d.name.trim() }] : [])))}
          >
            {picked.length ? `Add ${picked.length} type${picked.length === 1 ? '' : 's'}` : 'Add types'}
          </button>
        </div>
      </div>
    </div>
  );
}
