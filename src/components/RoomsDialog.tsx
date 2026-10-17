import { useEffect, useState } from 'react';
import { findRoomLabels, fillRoomsAsync, type FoundRoom } from '../fill/rooms';
import { fillRoom } from '../fill/roomFill';
import { ringArea } from '../geometry';
import { segmentsOf, wallModelFor } from '../fill/sheetWalls';
import { newId, type Measurement, type Pt, type Sheet, type TakeoffType, type Units } from '../model';
import { pageTexts } from '../pageText';
import type { PDFPageProxy } from '../pdf';
import { useEscape } from './Dialogs';
import { areaUnit, formatQty, toArea } from '../units';

interface Props {
  page: PDFPageProxy;
  sheet: Sheet;
  units: Units;
  types: TakeoffType[];
  /** Room takeoffs this sheet already has from an earlier run. */
  earlier: number;
  palette: string[];
  maxOpening: number;
  onApply: (result: { types: TakeoffType[]; measurements: Measurement[]; replaceEarlier: boolean }) => void;
  onClose: () => void;
}

type State =
  | { phase: 'running'; step: string; done: number; total: number }
  | { phase: 'done'; rooms: FoundRoom[]; ms: number }
  | { phase: 'error'; message: string };

const NEW = '__new__';
const roomNumber = (r: FoundRoom) => r.labels.map((l) => l.number).join(' / ');
const roomName = (r: FoundRoom) => [...new Set(r.labels.map((l) => l.name).filter(Boolean))].join(' / ');

/**
 * Room takeoff: finds every room tag on the sheet (number in a box, name above or below it),
 * fills each room to the inside face of its walls, and adds the ones picked as
 * named area takeoffs.
 */
export function RoomsDialog({ page, sheet, units, types, earlier, palette, maxOpening, onApply, onClose }: Props) {
  const [state, setState] = useState<State>({ phase: 'running', step: 'Reading the sheet…', done: 0, total: 0 });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const areaTypes = types.filter((t) => t.kind === 'area');
  // Rooms go under their own type; their floor, ceiling and other finishes are set in Room finishes.
  const [typeId, setTypeId] = useState(() => areaTypes.find((t) => /^rooms?\b/i.test(t.name))?.id ?? NEW);
  const [replaceEarlier, setReplaceEarlier] = useState(true);
  const mpp = sheet.metersPerPoint ?? 0;

  useEffect(() => {
    let live = true;
    const started = performance.now();
    (async () => {
      try {
        const [segs, texts, model] = await Promise.all([segmentsOf(page), pageTexts(page), wallModelFor(page, sheet, maxOpening)]);
        const labels = findRoomLabels(texts, segs);
        if (!live) return;
        const rooms = await fillRoomsAsync(model, labels, sheet.width, sheet.height, (done, total) => {
          if (live) setState({ phase: 'running', step: `Filling room ${Math.min(done + 1, total)} of ${total}…`, done, total });
        });
        if (!live) return;
        setPicked(new Set(rooms.flatMap((r, i) => (r.points ? [i] : []))));
        setNames(new Map(rooms.map((r, i) => [i, roomName(r)])));
        setState({ phase: 'done', rooms, ms: Math.round(performance.now() - started) });
      } catch (e) {
        if (live) setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Rooms being retried with wider openings, and ones a retry could not close either. */
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  const [stillOpen, setStillOpen] = useState<Set<number>>(new Set());

  /**
   * Retries one unclosed room closing openings up to 8 m (an open counter, a wide
   * archway). The result is shown for checking before it is added.
   */
  async function retryWider(i: number) {
    if (state.phase !== 'done') return;
    setRetrying((s) => new Set(s).add(i));
    try {
      const model = await wallModelFor(page, sheet, Math.max(8, maxOpening * 2));
      await new Promise((r) => setTimeout(r, 0));
      const room = state.rooms[i];
      const res = fillRoom(model, room.labels.map((l) => l.at), sheet.width, sheet.height, 2);
      if (res.ok) {
        // From the latest state: another retry may have finished meanwhile.
        setState((cur) =>
          cur.phase === 'done'
            ? { ...cur, rooms: cur.rooms.map((r, j) => (j === i ? { ...r, points: res.points, openings: res.openings, reason: undefined, area: Math.abs(ringArea(res.points)), wider: true } : r)) }
            : cur,
        );
        setPicked((s) => new Set(s).add(i));
      } else setStillOpen((s) => new Set(s).add(i));
    } finally {
      setRetrying((s) => {
        const next = new Set(s);
        next.delete(i);
        return next;
      });
    }
  }

  const area = (r: FoundRoom) => `${formatQty(toArea(r.area * mpp * mpp, units))} ${areaUnit(units)}`;

  function add() {
    if (state.phase !== 'done') return;
    const newTypes: TakeoffType[] = [];
    let target = typeId;
    if (typeId === NEW) {
      const t: TakeoffType = {
        id: newId(),
        name: 'Rooms',
        color: palette[types.length % palette.length],
        kind: 'area',
        height: units === 'metric' ? 3 : 10,
        items: [],
        division: '09 Finishes',
      };
      newTypes.push(t);
      target = t.id;
    }
    const measurements: Measurement[] = state.rooms.flatMap((r, i) =>
      r.points && picked.has(i)
        ? [
            {
              id: newId(),
              sheetId: sheet.id,
              typeId: target,
              points: r.points.map((p) => [...p] as Pt),
              holes: [],
              ...(r.openings ? { openings: r.openings } : {}),
              source: 'rooms' as const,
              label: `${roomNumber(r)} ${names.get(i) ?? ''}`.trim(),
            },
          ]
        : [],
    );
    onApply({ types: newTypes, measurements, replaceEarlier: earlier > 0 && replaceEarlier });
    onClose();
  }

  const chosen = state.phase === 'done' ? state.rooms.filter((r, i) => r.points && picked.has(i)) : [];
  const total = chosen.reduce((n, r) => n + r.area, 0);

  useEscape(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Room takeoff" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Rooms · {sheet.name}</h3>
          <button onClick={onClose}>Close</button>
        </div>

        {state.phase === 'running' && (
          <div className="running">
            <div className="spinner" />
            <div>
              <div>{state.step}</div>
              {state.total > 0 && (
                <progress className="progress" max={state.total} value={state.done}>
                  {state.done} of {state.total}
                </progress>
              )}
            </div>
          </div>
        )}
        {state.phase === 'error' && <p className="err-box">{state.message}</p>}

        {state.phase === 'done' && (
          <>
            <p className="muted">
              Every room tag on the sheet (a number such as 101, 101a or B23 in a small box, with the name above or below it), filled to the
              inside face of its walls. Tags in one open space share it.
            </p>
            {state.rooms.length === 0 ? (
              <p className="warn">No room tags found on this sheet. A room tag is a room number in a small box with the room name above or below it, or a bare number under the name.</p>
            ) : (
              <table className="wall-table rooms-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Pick all rooms"
                        checked={state.rooms.every((r, i) => !r.points || picked.has(i))}
                        onChange={(e) => setPicked(new Set(e.target.checked ? state.rooms.flatMap((r, i) => (r.points ? [i] : [])) : []))}
                      />
                    </th>
                    <th>Room</th>
                    <th>Name</th>
                    <th className="num">Area</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rooms.map((r, i) => (
                    <tr key={i} className={r.points ? '' : 'disabled-row'}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Pick room ${roomNumber(r)}`}
                          disabled={!r.points}
                          checked={picked.has(i)}
                          onChange={(e) =>
                            setPicked((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(i);
                              else next.delete(i);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="room-number">{roomNumber(r)}</td>
                      <td>
                        <input
                          id={`room-name-${i}`}
                          className="room-name"
                          value={names.get(i) ?? ''}
                          aria-label={`Name of room ${roomNumber(r)}`}
                          onChange={(e) => setNames((m) => new Map(m).set(i, e.target.value))}
                        />
                      </td>
                      <td className="num">
                        {r.points ? (
                          <>
                            {area(r)}
                            {(r as FoundRoom & { wider?: boolean }).wider && <div className="field-hint">wider openings closed, check it</div>}
                          </>
                        ) : stillOpen.has(i) ? (
                          <span className="muted">Not closed, draw by hand</span>
                        ) : (
                          <button className="link-button" disabled={retrying.has(i)} onClick={() => void retryWider(i)}>
                            {retrying.has(i) ? 'Trying…' : 'Not closed · try wider openings'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row-actions sticky">
              <label className="inline">
                Add to
                <select id="rooms-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  {areaTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value={NEW}>New type “Rooms”</option>
                </select>
              </label>
              {earlier > 0 && (
                <label className="inline">
                  <input type="checkbox" checked={replaceEarlier} onChange={(e) => setReplaceEarlier(e.target.checked)} /> Replace this sheet’s
                  earlier rooms ({earlier})
                </label>
              )}
              <div className="spacer" />
              <button className="primary" disabled={!chosen.length} onClick={add}>
                Add {chosen.length} room{chosen.length === 1 ? '' : 's'} · {formatQty(toArea(total * mpp * mpp, units))} {areaUnit(units)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
