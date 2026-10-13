import { useState } from 'react';
import type { TypeTotals } from '../quantities';
import { formatQty } from '../units';
import { Icon } from './Icons';

interface Props {
  totals: TypeTotals[];
  sheetTotals: TypeTotals[];
  sheetName?: string;
  onEdit: (typeId: string) => void;
}

/** Project totals per takeoff type, with each assembly item's quantity. */
export function QuantityPanel({ totals, sheetTotals, sheetName, onEdit }: Props) {
  const [scope, setScope] = useState<'all' | 'sheet'>('all');
  const anything = totals.some((t) => t.vars.N > 0 || t.unscaled > 0);
  const used = (scope === 'sheet' ? sheetTotals : totals).filter((t) => t.vars.N > 0 || t.unscaled > 0);
  if (!anything)
    return (
      <div className="empty-note">
        <Icon name="sigma" size={22} />
        <p>Quantities for the whole project appear here as you take off, with every material in each assembly.</p>
      </div>
    );
  return (
    <div className="quantities">
      <div className="list-toolbar">
        <div className="segmented small" role="tablist" aria-label="Quantities for">
          <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All sheets
          </button>
          <button role="tab" aria-selected={scope === 'sheet'} className={scope === 'sheet' ? 'on' : ''} onClick={() => setScope('sheet')} disabled={!sheetName}>
            {sheetName ? `Sheet ${sheetName}` : 'This sheet'}
          </button>
        </div>
      </div>
      {used.length === 0 && <p className="muted empty-line">Nothing taken off on this sheet yet.</p>}
      {used.map((t) => (
        <section className="qty-card" key={t.type.id}>
          <button className="qty-head" onClick={() => onEdit(t.type.id)} title="Edit type and assembly">
            <span className="dot" style={{ background: t.type.color }} />
            <span className="qty-name">{t.type.name}</span>
            <span className="qty-val">
              {formatQty(t.primary)} <span className="qty-unit">{t.unit}</span>
            </span>
          </button>
          {t.unscaled > 0 && (
            <div className="inline-warn">
              {t.unscaled} takeoff{t.unscaled > 1 ? 's' : ''} on sheets without a scale, not counted
            </div>
          )}
          {t.items.length > 0 && (
            <table className="qty-items">
              <tbody>
                {t.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}</td>
                    <td className="num">
                      {it.value !== null ? formatQty(it.value) : <span className="err" title={it.error ?? ''}>check formula</span>}
                    </td>
                    <td className="unit-col">{it.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
