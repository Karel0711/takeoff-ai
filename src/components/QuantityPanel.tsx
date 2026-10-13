import type { TypeTotals } from '../quantities';
import { formatQty } from '../units';
import { Icon } from './Icons';

interface Props {
  totals: TypeTotals[];
  onEdit: (typeId: string) => void;
}

/** Project totals per takeoff type, with each assembly item's quantity. */
export function QuantityPanel({ totals, onEdit }: Props) {
  const used = totals.filter((t) => t.vars.N > 0 || t.unscaled > 0);
  if (!used.length)
    return (
      <div className="empty-note">
        <Icon name="sigma" size={22} />
        <p>Quantities for the whole project appear here as you take off, with every material in each assembly.</p>
      </div>
    );
  return (
    <div className="quantities">
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
