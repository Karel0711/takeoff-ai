import { useMemo, useState } from 'react';
import { describeGroup, groupActivity, type ActivityEvent } from '../activity';
import { FINISH_ROLES, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import { measurementVars, primaryOf, primaryUnit, type TypeTotals } from '../quantities';
import { formatQty } from '../units';
import { Icon } from './Icons';
import { QuantityPanel } from './QuantityPanel';

export type InspectorTab = 'quantities' | 'takeoffs' | 'history';

interface Props {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  project: Project;
  sheet: Sheet | null;
  totals: TypeTotals[];
  /** The same, for the current sheet only. */
  sheetTotals: TypeTotals[];
  activity: ActivityEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (ids: string[]) => void;
  onRetype: (id: string, typeId: string) => void;
  onEditType: (typeId: string) => void;
  onEditFinishes: () => void;
  onFindSimilar: (id: string) => void;
  /** Selects a takeoff and brings it into view, switching sheets when needed. */
  onShow: (id: string) => void;
  onRename: (id: string, label: string) => void;
  canFindSimilar: boolean;
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'quantities', label: 'Quantities' },
  { id: 'takeoffs', label: 'Takeoffs' },
  { id: 'history', label: 'History' },
];

export function Inspector(props: Props) {
  const { tab, onTab, project, selectedId } = props;
  const selected = project.measurements.find((m) => m.id === selectedId) ?? null;
  return (
    <div className="inspector">
      {selected && <SelectionCard {...props} m={selected} />}
      <div className="inspector-tabs">
        <div className="segmented" role="tablist" aria-label="Inspector">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-body">
        {tab === 'quantities' && <QuantityPanel totals={props.totals} sheetTotals={props.sheetTotals} sheetName={props.sheet?.name} onEdit={props.onEditType} />}
        {tab === 'takeoffs' && <TakeoffList {...props} />}
        {tab === 'history' && <HistoryList events={props.activity} />}
      </div>
    </div>
  );
}

function qtyOf(m: Measurement, type: TakeoffType | undefined, project: Project): string {
  const sheet = project.sheets.find((s) => s.id === m.sheetId);
  if (!type || !sheet) return '';
  const v = measurementVars(m, type, sheet, project.units);
  return v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, project.units)}` : 'no scale';
}

function SelectionCard({ m, project, sheet: current, onDelete, onRetype, onSelect, onEditFinishes, onFindSimilar, canFindSimilar, onRename }: Props & { m: Measurement }) {
  const type = project.types.find((t) => t.id === m.typeId);
  const sheet = project.sheets.find((s) => s.id === m.sheetId);
  return (
    <div className="selection-card">
      <div className="selection-top">
        <span className="dot" style={{ background: type?.color }} />
        <div className="selection-text">
          <div className="selection-qty">{qtyOf(m, type, project)}</div>
          <div className="selection-sub">
            Selected takeoff · {sheet?.name}
            {m.source === 'walls' ? ' · wall takeoff' : ''}
          </div>
        </div>
        <button className="icon-button" title="Deselect (Esc)" aria-label="Deselect" onClick={() => onSelect(null)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <label className="field">
        <span>Name</span>
        <input id="takeoff-name" value={m.label ?? ''} placeholder="e.g. 112 Receiving" onChange={(e) => onRename(m.id, e.target.value)} />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={m.typeId} onChange={(e) => onRetype(m.id, e.target.value)}>
          {project.types
            .filter((t) => t.kind === type?.kind)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </label>
      {type?.kind === 'area' && (
        <div className="field">
          <span>Finishes</span>
          <div className="finish-chips">
            {FINISH_ROLES.flatMap(({ role, label }) => {
              const t = m.finishes?.[role] ? project.types.find((x) => x.id === m.finishes![role]) : undefined;
              return t ? [<span key={role} className="finish-chip" title={t.name}>{`${label}: ${t.name.split(' – ')[0]}`}</span>] : [];
            })}
            <button className="link-button" onClick={onEditFinishes}>
              {m.finishes && Object.keys(m.finishes).length ? 'Edit…' : 'Set floor, base, walls, ceiling…'}
            </button>
          </div>
        </div>
      )}
      {type?.kind === 'area' && m.sheetId === current?.id && (
        <button className="wide" disabled={!canFindSimilar} onClick={() => onFindSimilar(m.id)} title="Adds every other area on this sheet drawn with the same hatch, as this type">
          <Icon name="sparkle" size={16} /> Find areas hatched like this
        </button>
      )}
      <button className="destructive wide" onClick={() => onDelete([m.id])}>
        <Icon name="trash" size={16} /> Delete takeoff
      </button>
    </div>
  );
}

function TakeoffList({ project, sheet, selectedId, onShow, onDelete }: Props) {
  const [scope, setScope] = useState<'sheet' | 'all'>('sheet');
  const [query, setQuery] = useState('');
  const typeName = useMemo(() => new Map(project.types.map((t) => [t.id, t.name.toLowerCase()])), [project.types]);
  const q = query.trim().toLowerCase();
  const list = (scope === 'sheet' && sheet ? project.measurements.filter((m) => m.sheetId === sheet.id) : project.measurements).filter(
    (m) => !q || (m.label ?? '').toLowerCase().includes(q) || (typeName.get(m.typeId) ?? '').includes(q),
  );
  const groups = useMemo(() => {
    const byType = new Map<string, Measurement[]>();
    for (const m of list) {
      const items = byType.get(m.typeId);
      if (items) items.push(m);
      else byType.set(m.typeId, [m]);
    }
    return project.types.filter((t) => byType.has(t.id)).map((t) => ({ type: t, items: byType.get(t.id)! }));
  }, [list, project.types]);
  const sheetName = (id: string) => project.sheets.find((s) => s.id === id)?.name ?? '';

  return (
    <div className="takeoff-list">
      <div className="list-toolbar">
        <div className="segmented small" role="tablist" aria-label="Show takeoffs from">
          <button role="tab" aria-selected={scope === 'sheet'} className={scope === 'sheet' ? 'on' : ''} onClick={() => setScope('sheet')}>
            This sheet
          </button>
          <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All sheets
          </button>
        </div>
        {list.length > 0 && (
          <button className="quiet danger" onClick={() => onDelete(list.map((m) => m.id))}>
            Delete all {list.length}
          </button>
        )}
      </div>
      <label className="search takeoff-search">
        <Icon name="search" size={14} />
        <input id="takeoff-filter" placeholder="Find a room, door or type" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {groups.length === 0 && (
        <div className="empty-note">
          <Icon name="list" size={22} />
          <p>
            {q ? `Nothing matches “${query.trim()}”.` : `No takeoffs ${scope === 'sheet' ? 'on this sheet' : 'yet'}. Pick a type on the left and measure, fill a room, or run a wall takeoff.`}
          </p>
        </div>
      )}
      {groups.map(({ type, items }) => (
        <section className="takeoff-group" key={type.id}>
          <header>
            <span className="dot" style={{ background: type.color }} />
            <span className="group-name">{type.name}</span>
            <span className="group-count">{items.length}</span>
            <button className="icon-button" title={`Delete all ${items.length} ${type.name.split(' – ')[0]} takeoffs shown`} aria-label="Delete group" onClick={() => onDelete(items.map((m) => m.id))}>
              <Icon name="trash" size={15} />
            </button>
          </header>
          <ul>
            {items.map((m, i) => (
              <li key={m.id} className={m.id === selectedId ? 'selected' : ''} onClick={() => onShow(m.id)} title="Show on the sheet">
                <span className="row-index">{i + 1}</span>
                <span className="row-qty">
                  {m.label && <span className="row-label">{m.label}</span>}
                  {qtyOf(m, type, project)}
                </span>
                {scope === 'all' && <span className="row-sheet">{sheetName(m.sheetId)}</span>}
                <button
                  className="icon-button row-delete"
                  title="Delete takeoff"
                  aria-label="Delete takeoff"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete([m.id]);
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

function HistoryList({ events }: { events: ActivityEvent[] }) {
  const groups = useMemo(() => groupActivity(events).slice(0, 300), [events]);
  const [open, setOpen] = useState<string | null>(null);
  if (!groups.length)
    return (
      <div className="empty-note">
        <Icon name="clock" size={22} />
        <p>Every takeoff you add, change or delete is recorded here, with the time and the sheet.</p>
      </div>
    );
  return (
    <ol className="history">
      {groups.map((g) => {
        const sheets = [...new Set(g.map((e) => e.sheet).filter(Boolean))];
        const kind = g.every((e) => e.action === 'deleted') ? 'deleted' : g.every((e) => e.action === 'created') ? 'created' : 'updated';
        const id = g[0].batch;
        return (
          <li key={id} className={`history-item ${kind}`}>
            <button className="history-row" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
              <span className={`history-mark ${kind}`} />
              <span className="history-text">
                <span className="history-title">
                  {describeGroup(g)}
                  {g.length === 1 && g[0].detail && <span className="history-detail"> · {g[0].detail}</span>}
                </span>
                <span className="history-meta">
                  {time(g[0].at)} · {g[0].source}
                  {sheets.length ? ` · ${sheets.slice(0, 3).join(', ')}${sheets.length > 3 ? '…' : ''}` : ''}
                </span>
              </span>
              {g.length > 1 && <Icon name={open === id ? 'chevronDown' : 'chevron'} size={14} />}
            </button>
            {open === id && g.length > 1 && (
              <ul className="history-details">
                {g.slice(0, 200).map((e) => (
                  <li key={e.id}>
                    <span>{e.name}</span>
                    <span className="muted">
                      {e.detail}
                      {e.sheet && e.what === 'takeoff' && g.length > 1 ? ` · ${e.sheet}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
