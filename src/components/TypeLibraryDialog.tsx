import { useEffect, useState } from 'react';
import type { TakeoffType, Units } from '../model';
import { LIBRARY_TRADES, TYPE_LIBRARY } from '../typeLibrary';

interface Props {
  units: Units;
  /** Names already in the project, marked so they are not added twice by accident. */
  existing: Set<string>;
  onAdd: (types: TakeoffType[]) => void;
  onClose: () => void;
}

/** Ready-made takeoff types by trade, with their materials, to add in one go. */
export function TypeLibraryDialog({ units, existing, onAdd, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Type library" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Add types from the library</h3>
          <button onClick={onClose}>Cancel</button>
        </div>
        <p className="muted small-text">
          Each type comes with its materials worked out from what you measure ({units === 'metric' ? 'metric' : 'imperial'}). Change any of it after: waste,
          spacing, heights.
        </p>
        <div className="library">
          {LIBRARY_TRADES.map((trade) => (
            <section key={trade} className="library-trade">
              <div className="group-title">{trade}</div>
              {TYPE_LIBRARY.filter((e) => e.trade === trade).map((e) => (
                <label key={e.key} className={`library-row ${picked.has(e.key) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.has(e.key)} onChange={() => toggle(e.key)} />
                  <span className="row-main">
                    <span className="row-title">{e.name}</span>
                    <span className="row-sub">
                      {e.note}
                      {existing.has(e.name) ? ' · already in this project' : ''}
                    </span>
                  </span>
                  <span className="library-kind">{e.kind === 'area' ? 'Area' : e.kind === 'linear' ? 'Length' : 'Count'}</span>
                </label>
              ))}
            </section>
          ))}
        </div>
        <div className="row-actions sticky library-actions">
          <button
            className="primary"
            disabled={!picked.size}
            onClick={() => onAdd(TYPE_LIBRARY.filter((e) => picked.has(e.key)).map((e) => e.make(units)))}
          >
            {picked.size ? `Add ${picked.size} type${picked.size === 1 ? '' : 's'}` : 'Add types'}
          </button>
        </div>
      </div>
    </div>
  );
}
