import { useMemo, useRef, useState } from 'react';
import { finishRooms, finishTypeFor, readFinishes, type Finishes, type FinishesRead } from '../automate/finishes';
import type { SetAccess } from '../automate/set';
import { segmentsOnce } from '../fill/sheetWalls';
import { FINISH_ROLES, type FinishRole, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import { pageTexts } from '../pageText';
import type { PDFPageProxy } from '../pdf';
import { measurementVars } from '../quantities';
import { areaUnit, formatQty, lengthUnit } from '../units';
import { askText, useEscape } from './Dialogs';


interface Props {
  project: Project;
  palette: string[];
  /** The page of a sheet, for reading a finish schedule. */
  getPage: (sheet: Sheet) => Promise<PDFPageProxy | null>;
  /** `ceilingHeights`: rooms whose ceiling height changed (undefined clears it), in project length units. */
  onApply: (result: { types: TakeoffType[]; finishes: Map<string, Finishes>; ceilingHeights: Map<string, number | undefined> }) => void;
  /** Runs Rooms on the open sheet, when it can (a plan with a scale). */
  onFindRooms?: () => void;
  onClose: () => void;
}

const NONE = '';
const NEW = '__new__';

/**
 * The room finish schedule: the floor, base, walls and ceiling of every room takeoff,
 * typed in here or read from the finish schedule on the drawings. Each finish is a
 * takeoff type; the room's area counts toward floor and ceiling, its perimeter
 * toward base and walls (walls × the type's height).
 */
export function RoomFinishesDialog({ project, palette, getPage, onApply, onFindRooms, onClose }: Props) {
  const rooms = useMemo(
    () => finishRooms(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.measurements],
  );
  const [draft, setDraft] = useState<Map<string, Finishes>>(() => new Map(rooms.map((m) => [m.id, { ...m.finishes }])));
  const [added, setAdded] = useState<TakeoffType[]>([]);
  /** The types made in this dialog so far, current even inside a long-running read. */
  const addedRef = useRef<TakeoffType[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<FinishRole>('floor');
  const [bulkType, setBulkType] = useState(NONE);
  const [reading, setReading] = useState<string | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);
  /** After reading the schedules: their lines no room matched, and rooms no line matched. */
  const [unmatched, setUnmatched] = useState<{ rows: string[]; rooms: string[] } | null>(null);
  const [heights, setHeights] = useState<Map<string, number | undefined>>(() => new Map(rooms.map((m) => [m.id, m.ceilingHeight])));
  const types = [...project.types, ...added];
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));

  /** Types a finish can be: the right kind, and not the type the room itself is (that would count it twice). */
  const optionsFor = (role: FinishRole, room?: Measurement) => {
    const kind = FINISH_ROLES.find((r) => r.role === role)!.kind;
    return types.filter((t) => t.kind === kind && t.id !== room?.typeId);
  };

  const set = (ids: string[], role: FinishRole, typeId: string) =>
    setDraft((d) => {
      const next = new Map(d);
      for (const id of ids) {
        // Never a room's own type (see optionsFor).
        if (typeId && rooms.find((m) => m.id === id)?.typeId === typeId) continue;
        const f = { ...next.get(id) };
        if (typeId) f[role] = typeId;
        else delete f[role];
        next.set(id, f);
      }
      return next;
    });

  /** A type for this finish code: one already named with it, or a new one. */
  const typeFor = (role: FinishRole, code: string, pool: TakeoffType[], fresh: TakeoffType[]) => finishTypeFor(project, role, code, pool, fresh, undefined, palette);

  async function newType(ids: string[], role: FinishRole) {
    const code = await askText(`New ${FINISH_ROLES.find((r) => r.role === role)!.label.toLowerCase()} type`, {
      hint: 'Its code as on the finish schedule, e.g. CPT-1',
    });
    if (!code?.trim()) return;
    const fresh: TakeoffType[] = [];
    const id = typeFor(role, code.trim(), [...project.types, ...addedRef.current], fresh);
    addedRef.current = [...addedRef.current, ...fresh];
    setAdded(addedRef.current);
    set(ids, role, id);
  }

  /**
   * Reads every room finish schedule in the set, or with none the finishes tagged on the
   * drawings, onto the room takeoffs (see `src/automate/finishes.ts`). Applied to the latest
   * picks and types: the dialog stays usable while the sheets are read.
   */
  async function readSchedule() {
    setReadNote(null);
    setUnmatched(null);
    let read: FinishesRead;
    const access: SetAccess = {
      page: getPage,
      texts: async (s) => {
        const page = await getPage(s);
        return page ? pageTexts(page) : [];
      },
      segments: async (s) => {
        const page = await getPage(s);
        return page ? segmentsOnce(page) : null;
      },
      progress: setReading,
    };
    try {
      read = await readFinishes(project, rooms, access, [...project.types, ...addedRef.current], palette);
    } finally {
      setReading(null);
    }
    addedRef.current = [...addedRef.current, ...read.fresh];
    setAdded(addedRef.current);
    setDraft((d) => {
      const next = new Map(d);
      for (const [id, f] of read.picks) next.set(id, { ...next.get(id), ...f });
      return next;
    });
    if (read.heights.size) setHeights((hs) => new Map([...hs, ...read.heights]));
    setUnmatched(read.unmatched);
    setReadNote(read.note);
  }

  const heightChanged = (m: Measurement) => (heights.get(m.id) ?? undefined) !== (m.ceilingHeight ?? undefined);
  const changed = rooms.filter((m) => JSON.stringify(m.finishes ?? {}) !== JSON.stringify(draft.get(m.id) ?? {}) || heightChanged(m)).length;
  const usedAdded = added.filter((t) => [...draft.values()].some((f) => Object.values(f).includes(t.id)));

  function save() {
    const finishes = new Map<string, Finishes>();
    const ceilingHeights = new Map<string, number | undefined>();
    for (const m of rooms) {
      const f = draft.get(m.id) ?? {};
      if (JSON.stringify(m.finishes ?? {}) !== JSON.stringify(f)) finishes.set(m.id, f);
      if (heightChanged(m)) ceilingHeights.set(m.id, heights.get(m.id));
    }
    onApply({ types: usedAdded, finishes, ceilingHeights });
    onClose();
  }

  const area = (m: Measurement) => {
    const sheet = sheets.get(m.sheetId);
    const type = types.find((t) => t.id === m.typeId);
    const v = sheet && type ? measurementVars(m, type, sheet, project.units) : null;
    return v ? `${formatQty(v.A)} ${areaUnit(project.units)}` : '—';
  };

  const allPicked = rooms.length > 0 && rooms.every((m) => picked.has(m.id));
  // A stray click outside or Esc closes only while nothing is unsaved; Cancel always does.
  const dismiss = () => {
    if (!changed) onClose();
  };
  useEscape(dismiss);

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal wide finishes" role="dialog" aria-label="Room finishes" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Room finishes</h3>
          <button onClick={onClose}>{changed ? 'Cancel' : 'Close'}</button>
        </div>
        <p className="muted">
          Each room’s floor and ceiling count as its area, its base and walls as its perimeter (walls × the wall type’s height). Pick types per
          room, select several rooms to set them together, or read the finish schedule from the drawings.
        </p>

        {rooms.length === 0 ? (
          <>
            <p className="warn">No rooms yet. Finishes go on rooms: find them on a plan, or fill rooms by hand and name them, then come back here.</p>
            {onFindRooms && (
              <div className="row-actions">
                <button className="primary" onClick={onFindRooms}>
                  Find rooms on this sheet
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row-actions">
              <button onClick={() => void readSchedule()} disabled={!!reading || !project.sheets.length}>
                Read finishes from the drawings
              </button>
              {reading && (
                <span className="muted inline">
                  <span className="spinner small" /> {reading}
                </span>
              )}
              {readNote && <span className="muted">{readNote}</span>}
            </div>
            {unmatched && (
              <details className="muted">
                <summary>
                  Not matched: {unmatched.rows.length} schedule line{unmatched.rows.length === 1 ? '' : 's'}, {unmatched.rooms.length} room
                  {unmatched.rooms.length === 1 ? '' : 's'}
                </summary>
                {unmatched.rows.length > 0 && <p>On the schedules but not in your room takeoffs: {unmatched.rows.join(', ')}</p>}
                {unmatched.rooms.length > 0 && <p>Room takeoffs with no schedule line: {unmatched.rooms.join(', ')}</p>}
              </details>
            )}

            {picked.size > 0 && (
              <div className="row-actions bulk-bar">
                <span>
                  {picked.size} room{picked.size === 1 ? '' : 's'}:
                </span>
                <select aria-label="Finish to set" value={bulkRole} onChange={(e) => (setBulkRole(e.target.value as FinishRole), setBulkType(NONE))}>
                  {FINISH_ROLES.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Type to set"
                  value={bulkType}
                  onChange={(e) => (e.target.value === NEW ? void newType([...picked], bulkRole) : setBulkType(e.target.value))}
                >
                  <option value={NONE}>None</option>
                  {optionsFor(bulkRole).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value={NEW}>New type…</option>
                </select>
                <button onClick={() => set([...picked], bulkRole, bulkType)}>Set</button>
                <div className="spacer" />
                <button className="plain" onClick={() => setPicked(new Set())}>
                  Clear selection
                </button>
              </div>
            )}

            <div className="table-scroll">
              <table className="wall-table rooms-table finishes-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all rooms"
                        checked={allPicked}
                        onChange={(e) => setPicked(new Set(e.target.checked ? rooms.map((m) => m.id) : []))}
                      />
                    </th>
                    <th>Room</th>
                    <th>Sheet</th>
                    <th className="num">Area</th>
                    {FINISH_ROLES.map((r) => (
                      <th key={r.role}>{r.label}</th>
                    ))}
                    <th className="num">Ceiling ht ({lengthUnit(project.units)})</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((m) => {
                    const f = draft.get(m.id) ?? {};
                    return (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${m.label ?? 'room'}`}
                            checked={picked.has(m.id)}
                            onChange={(e) =>
                              setPicked((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(m.id);
                                else next.delete(m.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="room-label">{m.label || 'Unnamed area'}</td>
                        <td className="muted">{sheets.get(m.sheetId)?.name}</td>
                        <td className="num">{area(m)}</td>
                        {FINISH_ROLES.map((r) => (
                          <td key={r.role}>
                            <select
                              className="cell-select"
                              aria-label={`${r.label} of ${m.label ?? 'room'}`}
                              value={f[r.role] ?? NONE}
                              onChange={(e) => (e.target.value === NEW ? void newType([m.id], r.role) : set([m.id], r.role, e.target.value))}
                            >
                              <option value={NONE}>—</option>
                              {optionsFor(r.role, m).map((t) => (
                                <option key={t.id} value={t.id} title={t.name}>
                                  {t.name.split(' – ')[0]}
                                </option>
                              ))}
                              <option value={NEW}>New type…</option>
                            </select>
                          </td>
                        ))}
                        <td className="num">
                          <input
                            className="cell-input num"
                            type="number"
                            min={0}
                            step="any"
                            aria-label={`Ceiling height of ${m.label ?? 'room'}`}
                            value={heights.get(m.id) ?? ''}
                            onChange={(e) => {
                              const v = e.target.value === '' ? undefined : Number(e.target.value);
                              setHeights((hs) => new Map(hs).set(m.id, v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined));
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="row-actions sticky">
          <div className="spacer" />
          <button className="primary" disabled={!changed} onClick={save}>
            {changed ? `Save finishes for ${changed} room${changed === 1 ? '' : 's'}` : 'Save finishes'}
          </button>
        </div>
      </div>
    </div>
  );
}
