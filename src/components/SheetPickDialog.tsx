import { useEffect, useState } from 'react';

export interface SheetPick {
  sheetId: string;
  name: string;
  /** What was found there, e.g. "3 areas · 12.4 m²". */
  found: string;
  /** A caution shown with the row, e.g. that the sheet has no scale to compare. */
  note?: string;
}

interface Props {
  title: string;
  intro: string;
  rows: SheetPick[];
  onAdd: (sheetIds: string[]) => void;
  onClose: () => void;
}

/** What a search of every sheet found, sheet by sheet, to keep or leave out before adding. */
export function SheetPickDialog({ title, intro, rows, onAdd, onClose }: Props) {
  const [on, setOn] = useState(() => new Set(rows.map((r) => r.sheetId)));
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const toggle = (id: string) =>
    setOn((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>{title}</h3>
          <button onClick={onClose}>Cancel</button>
        </div>
        <p className="muted small-text">{intro}</p>
        <table className="rooms-table sheet-pick">
          <tbody>
            {rows.map((r) => (
              <tr key={r.sheetId} className={on.has(r.sheetId) ? '' : 'disabled-row'}>
                <td>
                  <input type="checkbox" checked={on.has(r.sheetId)} onChange={() => toggle(r.sheetId)} aria-label={`Add on ${r.name}`} />
                </td>
                <td>
                  <b>{r.name}</b>
                  {r.note && <div className="field-hint">{r.note}</div>}
                </td>
                <td className="num">{r.found}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-actions sticky library-actions">
          <button className="primary" disabled={!on.size} onClick={() => onAdd(rows.filter((r) => on.has(r.sheetId)).map((r) => r.sheetId))}>
            {on.size ? `Add on ${on.size} sheet${on.size === 1 ? '' : 's'}` : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
