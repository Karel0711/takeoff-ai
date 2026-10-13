import { evaluate } from '../formula';
import { DIVISIONS, newId, type Kind, type TakeoffType, type Units } from '../model';
import type { Vars } from '../quantities';
import { formatQty, lengthUnit } from '../units';
import { Icon } from './Icons';

interface Props {
  type: TakeoffType;
  units: Units;
  totals: Vars | undefined;
  onChange: (type: TakeoffType) => void;
  onDelete: () => void;
  onClose: () => void;
}

const VARS_HELP: [keyof Vars, string][] = [
  ['L', 'Total length'],
  ['H', 'Height'],
  ['A', 'Area (L × H for linear types)'],
  ['P', 'Perimeter, incl. cutouts'],
  ['N', 'Number of runs, rooms or items'],
];

/** Edits a takeoff type: name, kind, colour, height, estimate grouping and its assembly items. */
export function TypeEditor({ type, units, totals, onChange, onDelete, onClose }: Props) {
  const set = (patch: Partial<TakeoffType>) => onChange({ ...type, ...patch });
  const vars = totals ?? { L: 0, H: type.height, A: 0, P: 0, N: 0 };

  return (
    <div className="type-editor">
      <div className="editor-head">
        <button className="back" onClick={onClose}>
          <Icon name="chevron" size={14} /> Done
        </button>
        <span className="editor-title">Takeoff type</span>
      </div>

      <div className="form-group">
        <label className="field">
          <span>Name</span>
          <input id="type-name" value={type.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Measured as</span>
            <select id="type-kind" value={type.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
              <option value="area">Area</option>
              <option value="linear">Length</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label className="field narrow">
            <span>Height ({lengthUnit(units)})</span>
            <input
              id="type-height"
              type="number"
              min={0}
              step={0.1}
              value={type.height}
              onChange={(e) => set({ height: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="field color">
            <span>Colour</span>
            <input id="type-color" type="color" value={type.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Estimate division</span>
          <input
            id="type-division"
            list="division-list"
            placeholder="09 Finishes"
            value={type.division ?? ''}
            onChange={(e) => set({ division: e.target.value || undefined })}
          />
          <datalist id="division-list">
            {DIVISIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Subtrade package</span>
          <input
            id="type-package"
            placeholder="Drywall & ceilings"
            value={type.package ?? ''}
            onChange={(e) => set({ package: e.target.value || undefined })}
          />
        </label>
      </div>

      <div className="group-title">Assembly</div>
      <div className="assembly-items">
        {type.items.length === 0 && <p className="muted small-text">Add the materials this type needs. Each one is a formula of the totals below.</p>}
        {type.items.map((it, i) => {
          const r = evaluate(it.formula, { ...vars });
          const update = (patch: Partial<typeof it>) => set({ items: type.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div className="assembly-item" key={it.id}>
              <div className="item-top">
                <input id={`item-name-${it.id}`} className="item-name" value={it.name} aria-label="Material" onChange={(e) => update({ name: e.target.value })} />
                <span className="item-qty">{r.ok ? formatQty(r.value) : '—'}</span>
                <button className="icon-button" title="Remove material" aria-label="Remove material" onClick={() => set({ items: type.items.filter((_, j) => j !== i) })}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="item-bottom">
                <input
                  id={`item-formula-${it.id}`}
                  className={r.ok ? 'formula' : 'formula bad'}
                  value={it.formula}
                  aria-label="Formula"
                  title={r.ok ? '' : r.error}
                  onChange={(e) => update({ formula: e.target.value })}
                />
                <input id={`item-unit-${it.id}`} className="unit" value={it.unit} aria-label="Unit" onChange={(e) => update({ unit: e.target.value })} />
              </div>
              {!r.ok && <div className="field-hint error">{r.error}</div>}
            </div>
          );
        })}
        <button className="add-row" onClick={() => set({ items: [...type.items, { id: newId(), name: 'New material', unit: 'ea', formula: 'N' }] })}>
          <Icon name="plus" size={14} /> Add material
        </button>
      </div>

      <div className="vars-card">
        <div className="vars-title">Totals for this type</div>
        <dl>
          {VARS_HELP.map(([k, d]) => (
            <div key={k}>
              <dt>
                <code>{k}</code> {d}
              </dt>
              <dd>{formatQty(vars[k])}</dd>
            </div>
          ))}
        </dl>
        <p className="small-text muted">
          Formulas use these letters with + - * / and <code>ceil</code> <code>floor</code> <code>round</code> <code>min</code> <code>max</code>, e.g.{' '}
          <code>ceil(L / 0.61) + N</code>.
        </p>
      </div>

      <button className="destructive wide" onClick={onDelete}>
        <Icon name="trash" size={16} /> Delete type and its takeoffs
      </button>
    </div>
  );
}
