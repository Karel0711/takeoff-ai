import { evaluate } from '../formula';
import { newId, type Kind, type TakeoffType, type Units } from '../model';
import type { Vars } from '../quantities';
import { formatQty, lengthUnit } from '../units';
import { askConfirm } from './Dialogs';

interface Props {
  type: TakeoffType;
  units: Units;
  totals: Vars | undefined;
  onChange: (type: TakeoffType) => void;
  onDelete: () => void;
  onClose: () => void;
}

const VARS_HELP: [string, string][] = [
  ['L', 'total length (linear)'],
  ['H', 'height of this type'],
  ['A', 'area (area types), or L × H (linear)'],
  ['P', 'perimeter incl. cutouts (area)'],
  ['N', 'number of runs / rooms / items'],
];

export function TypeEditor({ type, units, totals, onChange, onDelete, onClose }: Props) {
  const set = (patch: Partial<TakeoffType>) => onChange({ ...type, ...patch });
  const vars = totals ?? { L: 0, H: type.height, A: 0, P: 0, N: 0 };

  return (
    <div className="panel type-editor">
      <div className="panel-head">
        <h3>Edit takeoff type</h3>
        <button onClick={onClose}>Done</button>
      </div>
      <label>
        Name
        <input value={type.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Kind
          <select value={type.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
            <option value="area">Area</option>
            <option value="linear">Linear</option>
            <option value="count">Count</option>
          </select>
        </label>
        <label>
          Colour
          <input type="color" value={type.color} onChange={(e) => set({ color: e.target.value })} />
        </label>
        <label>
          Height ({lengthUnit(units)})
          <input
            type="number"
            min={0}
            step={0.1}
            value={type.height}
            onChange={(e) => set({ height: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
      </div>

      <h4>Assembly items</h4>
      <table className="items">
        <thead>
          <tr>
            <th>Item</th>
            <th>Unit</th>
            <th>Formula</th>
            <th className="num">Qty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {type.items.map((it, i) => {
            const r = evaluate(it.formula, { ...vars });
            const update = (patch: Partial<typeof it>) =>
              set({ items: type.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <tr key={it.id}>
                <td>
                  <input value={it.name} onChange={(e) => update({ name: e.target.value })} />
                </td>
                <td>
                  <input className="unit" value={it.unit} onChange={(e) => update({ unit: e.target.value })} />
                </td>
                <td>
                  <input
                    className={r.ok ? 'formula' : 'formula bad'}
                    value={it.formula}
                    title={r.ok ? '' : r.error}
                    onChange={(e) => update({ formula: e.target.value })}
                  />
                </td>
                <td className="num">{r.ok ? formatQty(r.value) : <span className="err">{r.error}</span>}</td>
                <td>
                  <button
                    className="icon"
                    title="Remove item"
                    onClick={() => set({ items: type.items.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        onClick={() => set({ items: [...type.items, { id: newId(), name: 'New item', unit: 'ea', formula: 'N' }] })}
      >
        + Add item
      </button>

      <div className="help">
        <strong>Formula variables</strong> (totals for this type):
        <ul>
          {VARS_HELP.map(([k, d]) => (
            <li key={k}>
              <code>{k}</code> {d} = {formatQty(vars[k as keyof Vars])}
            </li>
          ))}
        </ul>
        Functions: <code>ceil</code> <code>floor</code> <code>round</code> <code>min</code> <code>max</code>{' '}
        <code>abs</code>. Example: <code>ceil(L / 0.61) + N</code>
      </div>

      <button
        className="danger"
        onClick={async () => {
          if (await askConfirm(`Delete "${type.name}" and all of its measurements?`, { confirmLabel: 'Delete', danger: true }))
            onDelete();
        }}
      >
        Delete type
      </button>
    </div>
  );
}
