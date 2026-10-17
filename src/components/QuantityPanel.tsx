import { useState, type ReactNode } from 'react';
import type { QtyGrouping, QtySection } from '../buildings';
import type { TypeTotals } from '../quantities';
import { formatQty } from '../units';
import { Icon } from './Icons';

/** A sheet a type is taken off on, with its share. */
export interface Where {
  sheetId: string;
  name: string;
  n: number;
  qty: number;
  unit: string;
}

interface Props {
  totals: TypeTotals[];
  sheetTotals: TypeTotals[];
  sheetName?: string;
  /** The project's quantities in the sections chosen with `grouping`. */
  sections: QtySection[];
  grouping: QtyGrouping;
  onGrouping: (g: QtyGrouping) => void;
  onEdit: (typeId: string) => void;
  whereOf: (typeId: string) => Where[];
  onShowType: (typeId: string, sheetId: string) => void;
}

const GROUPINGS: [QtyGrouping, string][] = [
  ['type', 'By type'],
  ['building', 'By file'],
  ['division', 'By division'],
  ['building-division', 'File › division'],
];

/** Project totals per takeoff type, with each assembly item's quantity. */
export function QuantityPanel({ totals, sheetTotals, sheetName, sections, grouping, onGrouping, onEdit, whereOf, onShowType }: Props) {
  const [scope, setScope] = useState<'all' | 'sheet'>('all');
  const anything = totals.some((t) => t.vars.N > 0 || t.unscaled > 0);
  const used = (scope === 'sheet' ? sheetTotals : totals).filter((t) => t.vars.N > 0 || t.unscaled > 0);
  const card = (t: TypeTotals) => (
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
          <WhereList typeId={t.type.id} whereOf={whereOf} onShow={onShowType} />
        </section>
  );
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
      {scope === 'all' && (
        <label className="qty-grouping">
          <span className="muted">Group</span>
          <select value={grouping} onChange={(e) => onGrouping(e.target.value as QtyGrouping)} aria-label="Group quantities">
            {GROUPINGS.map(([g, label]) => (
              <option key={g} value={g}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {used.length === 0 && <p className="muted empty-line">Nothing taken off on this sheet yet.</p>}
      {scope === 'sheet' || grouping === 'type' ? used.map(card) : sections.map((sec) => <Section key={sec.title} section={sec} depth={0} card={card} />)}
    </div>
  );
}

/** A building or division heading with its types (or its own sections) under it. */
function Section({ section, depth, card }: { section: QtySection; depth: number; card: (t: TypeTotals) => ReactNode }) {
  const [open, setOpen] = useState(true);
  const totals = (section.totals ?? []).filter((t) => t.vars.N > 0 || t.unscaled > 0);
  const count = section.sections ? section.sections.reduce((n, s) => n + (s.totals?.filter((t) => t.vars.N > 0).length ?? 0), 0) : totals.length;
  return (
    <div className={`qty-section depth-${depth}`}>
      <button className="qty-section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`doc-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={12} />
        </span>
        <span className="qty-section-title">{section.title}</span>
        <span className="doc-count">{count}</span>
      </button>
      {open && (section.sections ? section.sections.map((s) => <Section key={s.title} section={s} depth={depth + 1} card={card} />) : totals.map(card))}
    </div>
  );
}

/** Which sheets a type is taken off on: click one to go there and see them. */
function WhereList({ typeId, whereOf, onShow }: { typeId: string; whereOf: (typeId: string) => Where[]; onShow: (typeId: string, sheetId: string) => void }) {
  const [open, setOpen] = useState(false);
  const rows = open ? whereOf(typeId) : [];
  return (
    <div className="qty-where">
      <button className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`doc-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={11} />
        </span>
        Where
      </button>
      {open && (
        <ul>
          {rows.map((r) => (
            <li key={r.sheetId}>
              <button onClick={() => onShow(typeId, r.sheetId)} title="Show these on the sheet">
                <span className="where-sheet">{r.name}</span>
                <span className="muted">{r.n} takeoff{r.n > 1 ? 's' : ''}</span>
                <span className="num">
                  {formatQty(r.qty)} <span className="qty-unit">{r.unit}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
