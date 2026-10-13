import type { TypeTotals } from '../quantities';
import { formatQty } from '../units';

interface Props {
  totals: TypeTotals[];
  onEdit: (typeId: string) => void;
}

export function QuantityPanel({ totals, onEdit }: Props) {
  const used = totals.filter((t) => t.vars.N > 0 || t.unscaled > 0);
  return (
    <div className="panel quantities">
      <div className="panel-head">
        <h3>Quantities</h3>
      </div>
      {used.length === 0 && <p className="muted">Measure something to see quantities here.</p>}
      {used.map((t) => (
        <div className="qty-type" key={t.type.id}>
          <div className="qty-head" onClick={() => onEdit(t.type.id)} title="Edit type and assembly">
            <span className="swatch" style={{ background: t.type.color }} />
            <span className="qty-name">{t.type.name}</span>
            <span className="qty-val">
              {formatQty(t.primary)} {t.unit}
            </span>
          </div>
          {t.unscaled > 0 && (
            <div className="warn">
              {t.unscaled} measurement{t.unscaled > 1 ? 's' : ''} on sheets without a scale (not counted)
            </div>
          )}
          <table className="items readonly">
            <tbody>
              {t.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td className="num">
                    {it.value !== null ? formatQty(it.value) : <span className="err" title={it.error ?? ''}>error</span>}
                  </td>
                  <td className="unit-col">{it.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
