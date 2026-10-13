import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { centroid, orthoSnap, polylineLength, ringArea, ringToPath } from '../geometry';
import type { Measurement, Pt, Sheet, TakeoffType, Units } from '../model';
import type { PDFPageProxy } from '../pdf';
import { measurementVars, primaryOf, primaryUnit } from '../quantities';
import { areaUnit, formatQty, lengthUnit, parseLength, toArea, toLength } from '../units';
import { askText, notify } from './Dialogs';
import { fillRoom, type WallModel } from '../fill/roomFill';

export type Tool = 'select' | 'measure' | 'calibrate' | 'cutout' | 'fill';

const FILL_FAILURES = {
  'on-wall': 'That click landed on a wall. Click inside the room.',
  'not-closed':
    'This space isn’t closed: it leaks out through an opening wider than the “close openings” size, or the sheet has no walls around it. Raise the opening size, or draw the area by hand.',
  'not-connected': 'That space is on the other side of a wall from the last fill. Fill it on its own instead (Shift+click joins spaces split only by a closed opening).',
  'no-walls': 'No wall lines were found on this sheet, so rooms can’t be filled. Draw the area by hand.',
};

interface View {
  zoom: number;
  x: number;
  y: number;
}

interface Props {
  page: PDFPageProxy | null;
  sheet: Sheet | null;
  measurements: Measurement[];
  types: TakeoffType[];
  activeType: TakeoffType | null;
  units: Units;
  tool: Tool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Adds a measurement with the active type; returns its id. */
  onAdd: (points: Pt[]) => string | undefined;
  /** Replaces a measurement's outline (used when Shift+click grows a fill). */
  onReplacePoints: (id: string, points: Pt[]) => void;
  /** The sheet's wall model for Fill, read on first use. */
  getWallModel: () => Promise<WallModel> | null;
  onAddHole: (measurementId: string, ring: Pt[]) => void;
  onDelete: (id: string) => void;
  onCalibrate: (metersPerPoint: number, label: string) => void;
  onToolDone: () => void;
}

/** Longest edge of the low-resolution page bitmap used for instant pan and zoom. */
const BASE_MAX_PX = 4096;

const sameView = (a: View, b: View) => a.zoom === b.zoom && a.x === b.x && a.y === b.y;

export function Viewer(props: Props) {
  const { page, sheet, measurements, types, activeType, units, tool, selectedId } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 0.3, x: 0, y: 0 });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<{ pt: Pt; sx: number; sy: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const base = useRef<{ canvas: HTMLCanvasElement; pageRef: PDFPageProxy } | null>(null);
  const hi = useRef<{ canvas: HTMLCanvasElement; view: View; dpr: number } | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const spaceHeld = useRef(false);
  /** The last fill on this sheet, so Shift+click can grow it into a neighbouring space. */
  const lastFill = useRef<{ id: string; seeds: Pt[] } | null>(null);
  const [filling, setFilling] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const dpr = window.devicePixelRatio || 1;
  const typeById = new Map(types.map((t) => [t.id, t]));

  // Track the viewer's size.
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!sheet || !size.w) return;
    const zoom = Math.min(size.w / sheet.width, size.h / sheet.height) * 0.95;
    setView({ zoom, x: (size.w - sheet.width * zoom) / 2, y: (size.h - sheet.height * zoom) / 2 });
  }, [sheet, size.w, size.h]);

  // Fit the whole sheet when switching sheets.
  useEffect(() => {
    fit();
    setDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, size.w > 0]);

  useEffect(() => {
    setDraft([]);
    lastFill.current = null;
  }, [tool, activeType?.id, sheet?.id]);

  async function fillAt(pt: Pt, grow: boolean) {
    if (!sheet || filling) return;
    const pending = props.getWallModel();
    if (!pending) return;
    setFilling(true);
    setStatus('Finding the room…');
    try {
      const model = await pending;
      const previous = grow ? lastFill.current : null;
      const seeds = previous ? [...previous.seeds, pt] : [pt];
      const result = fillRoom(model, seeds, sheet.width, sheet.height);
      if (!result.ok) {
        setStatus(null);
        await notify(FILL_FAILURES[result.reason]);
        return;
      }
      if (previous) {
        props.onReplacePoints(previous.id, result.points);
        lastFill.current = { id: previous.id, seeds };
      } else {
        const id = props.onAdd(result.points);
        if (id) {
          lastFill.current = { id, seeds };
          props.onSelect(id);
        }
      }
      setStatus(null);
    } catch (err) {
      setStatus(null);
      await notify(`Couldn’t read this sheet’s linework: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFilling(false);
    }
  }

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--desk').trim() || '#d6dcdf';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const v = viewRef.current;
    if (hi.current && sameView(hi.current.view, v) && hi.current.dpr === dpr) {
      ctx.drawImage(hi.current.canvas, 0, 0);
      return;
    }
    if (base.current && base.current.pageRef === page && sheet) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base.current.canvas, v.x * dpr, v.y * dpr, sheet.width * v.zoom * dpr, sheet.height * v.zoom * dpr);
    }
  }, [size.w, size.h, dpr, page, sheet]);

  // Render the low-resolution page bitmap once per page.
  useEffect(() => {
    base.current = null;
    hi.current = null;
    paint();
    if (!page || !sheet) return;
    const scale = Math.min(BASE_MAX_PX / Math.max(sheet.width, sheet.height), 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    setStatus('Rendering sheet…');
    const task = page.render({ canvas, viewport });
    task.promise.then(
      () => {
        base.current = { canvas, pageRef: page };
        setStatus(null);
        paint();
      },
      (err: Error) => {
        if (err?.name !== 'RenderingCancelledException') setStatus(`Could not render sheet: ${err.message}`);
      },
    );
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Repaint immediately on view change, then render a sharp view once it settles.
  useEffect(() => {
    paint();
    if (!page || !sheet || !size.w) return;
    const baseScale = Math.min(BASE_MAX_PX / Math.max(sheet.width, sheet.height), 2);
    if (view.zoom * dpr <= baseScale * 1.05) return;
    let task: ReturnType<PDFPageProxy['render']> | null = null;
    const target = { ...view };
    const timer = window.setTimeout(() => {
      const canvas = document.createElement('canvas');
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
      const viewport = page.getViewport({ scale: target.zoom * dpr });
      task = page.render({ canvas, viewport, transform: [1, 0, 0, 1, target.x * dpr, target.y * dpr] });
      task.promise.then(
        () => {
          hi.current = { canvas, view: target, dpr };
          paint();
        },
        () => undefined,
      );
    }, 180);
    return () => {
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [view, size.w, size.h, dpr, page, sheet, paint]);

  // Wheel zoom around the cursor (needs a non-passive listener).
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const zoom = Math.min(40, Math.max(0.03, v.zoom * Math.exp(-e.deltaY * 0.0015)));
        const k = zoom / v.zoom;
        return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toPt = (e: { clientX: number; clientY: number }): { pt: Pt; sx: number; sy: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { pt: [(sx - view.x) / view.zoom, (sy - view.y) / view.zoom], sx, sy };
  };

  const snap = (pt: Pt, shift: boolean): Pt => (shift && draft.length ? orthoSnap(draft[draft.length - 1], pt) : pt);

  const selected = measurements.find((m) => m.id === selectedId) ?? null;
  const selectedType = selected ? typeById.get(selected.typeId) : undefined;
  const drawKind: 'area' | 'linear' | 'count' | 'calibrate' | null =
    tool === 'calibrate'
      ? 'calibrate'
      : tool === 'cutout'
        ? 'area'
        : tool === 'measure' && activeType
          ? activeType.kind
          : null;

  const finish = useCallback(() => {
    if (tool === 'measure' && activeType) {
      if (activeType.kind === 'linear' && draft.length >= 2) props.onAdd(draft);
      if (activeType.kind === 'area' && draft.length >= 3) props.onAdd(draft);
    } else if (tool === 'cutout' && selected && draft.length >= 3) {
      props.onAddHole(selected.id, draft);
      props.onToolDone();
    }
    setDraft([]);
  }, [tool, activeType, draft, selected, props]);

  const calibrate = async (a: Pt, b: Pt) => {
    const lengthPts = polylineLength([a, b]);
    const example = units === 'metric' ? 'For example 3.5 (metres) or 3500mm' : `For example 12'6" or 12.5 (feet)`;
    const input = await askText('Real length of the line you drew', { hint: example });
    if (input === null) return;
    const meters = parseLength(input, units);
    if (!meters || lengthPts <= 0) {
      await notify(`"${input}" is not a length this tool can read. ${example}.`);
      return;
    }
    props.onCalibrate(meters / lengthPts, `Calibrated (${input.trim()})`);
    props.onToolDone();
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const background = e.target === svgRef.current || (e.target as Element).classList.contains('bg');
    if (e.button === 1 || spaceHeld.current || (tool === 'select' && e.button === 0 && background)) {
      e.preventDefault();
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      svgRef.current!.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (p) {
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
      setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
      return;
    }
    const h = toPt(e);
    setHover({ ...h, pt: snap(h.pt, e.shiftKey) });
  };

  const onPointerUp = () => {
    if (pan.current) {
      suppressClick.current = pan.current.moved;
      pan.current = null;
    }
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (e.button !== 0 || spaceHeld.current) return;
    if (tool === 'select') {
      props.onSelect(null);
      return;
    }
    if (!sheet) return;
    const pt = snap(toPt(e).pt, e.shiftKey);
    if (tool === 'measure') {
      if (!activeType) return;
      if (activeType.kind === 'count') {
        props.onAdd([pt]);
        return;
      }
      if (e.detail >= 2) {
        finish();
        return;
      }
      setDraft((d) => [...d, pt]);
    } else if (tool === 'calibrate') {
      const next = [...draft, pt];
      if (next.length === 2) {
        setDraft([]);
        void calibrate(next[0], next[1]);
      } else {
        setDraft(next);
      }
    } else if (tool === 'fill') {
      if (activeType?.kind !== 'area') return;
      void fillAt(toPt(e).pt, e.shiftKey);
    } else if (tool === 'cutout') {
      if (!selected || selectedType?.kind !== 'area') return;
      if (e.detail >= 2) {
        finish();
        return;
      }
      setDraft((d) => [...d, pt]);
    }
  };

  // Keyboard: Enter finishes, Esc cancels, Backspace undoes a point or deletes the selection, Space pans.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === ' ') {
        spaceHeld.current = true;
        e.preventDefault();
      } else if (e.key === 'Enter') {
        finish();
      } else if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else props.onSelect(null);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (draft.length && e.key === 'Backspace') setDraft((d) => d.slice(0, -1));
        else if (selectedId) props.onDelete(selectedId);
        e.preventDefault();
      } else if (e.key === 'f' || e.key === 'F') {
        fit();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [finish, draft.length, selectedId, props, fit]);

  // Live readout for the shape being drawn.
  let readout: string | null = null;
  if (sheet && hover && draft.length && drawKind && drawKind !== 'count') {
    const pts = [...draft, hover.pt];
    if (drawKind === 'calibrate') {
      readout = 'Click the other end of a known dimension';
    } else if (!sheet.metersPerPoint) {
      readout = 'Set the sheet scale first';
    } else if (drawKind === 'linear') {
      readout = `${formatQty(toLength(polylineLength(pts) * sheet.metersPerPoint, units))} ${lengthUnit(units)}`;
    } else if (pts.length >= 3) {
      const mpp = sheet.metersPerPoint;
      readout = `${formatQty(toArea(ringArea(pts) * mpp * mpp, units))} ${areaUnit(units)}`;
    }
  }

  const z = view.zoom;
  const shapesInteractive = tool === 'select';
  const cursor = pan.current ? 'grabbing' : filling ? 'progress' : tool === 'select' ? 'default' : tool === 'fill' ? 'cell' : 'crosshair';

  return (
    <div className="viewer" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onAuxClick={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${z})`}>
          {sheet && measurements.map((m) => {
            const type = typeById.get(m.typeId);
            if (!type) return null;
            const isSel = m.id === selectedId;
            const common = {
              className: shapesInteractive ? 'shape interactive' : 'shape',
              onClick: (e: MouseEvent) => {
                if (!shapesInteractive) return;
                e.stopPropagation();
                props.onSelect(m.id);
              },
            };
            const v = measurementVars(m, type, sheet, units);
            const label = v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, units)}` : 'no scale';
            if (type.kind === 'count') {
              const [x, y] = m.points[0];
              return (
                <circle
                  key={m.id}
                  {...common}
                  cx={x}
                  cy={y}
                  r={(isSel ? 8 : 6) / z}
                  fill={type.color}
                  stroke={isSel ? '#000' : '#fff'}
                  strokeWidth={1.5 / z}
                />
              );
            }
            if (type.kind === 'linear') {
              const mid = m.points[Math.floor((m.points.length - 1) / 2)];
              return (
                <g key={m.id} {...common}>
                  <polyline
                    points={m.points.map((p) => p.join(',')).join(' ')}
                    fill="none"
                    stroke={type.color}
                    strokeWidth={isSel ? 5 : 3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.85}
                  />
                  {isSel && <Label at={mid} z={z} text={label} />}
                </g>
              );
            }
            return (
              <g key={m.id} {...common}>
                <path
                  d={[m.points, ...m.holes].map(ringToPath).join('')}
                  fillRule="evenodd"
                  fill={type.color}
                  fillOpacity={isSel ? 0.4 : 0.25}
                  stroke={type.color}
                  strokeWidth={isSel ? 3 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
                <Label at={centroid(m.points)} z={z} text={label} />
              </g>
            );
          })}

          {draft.length > 0 && drawKind && (
            <g className="draft">
              {drawKind === 'area' && hover && draft.length >= 2 && (
                <path d={ringToPath([...draft, hover.pt])} fill={tool === 'cutout' ? '#fff' : activeType?.color ?? '#333'} fillOpacity={0.25} stroke="none" />
              )}
              <polyline
                points={[...draft, ...(hover ? [hover.pt] : [])].map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke={drawKind === 'calibrate' ? '#d00' : tool === 'cutout' ? '#000' : activeType?.color ?? '#333'}
                strokeWidth={2}
                strokeDasharray={drawKind === 'calibrate' || tool === 'cutout' ? '6 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {draft.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={3 / z} fill="#fff" stroke="#000" strokeWidth={1 / z} />
              ))}
            </g>
          )}
        </g>
      </svg>
      {readout && hover && (
        <div className="readout" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          {readout}
        </div>
      )}
      {!page && <div className="empty">Upload a drawing set to start.</div>}
      {status && <div className="status">{status}</div>}
      <div className="zoom-controls">
        <button onClick={() => setView((v) => zoomAt(v, size, 1.25))}>+</button>
        <button onClick={() => setView((v) => zoomAt(v, size, 0.8))}>−</button>
        <button onClick={fit} title="Fit sheet (F)">Fit</button>
      </div>
    </div>
  );
}

function zoomAt(v: View, size: { w: number; h: number }, k: number): View {
  const cx = size.w / 2;
  const cy = size.h / 2;
  const zoom = Math.min(40, Math.max(0.03, v.zoom * k));
  const f = zoom / v.zoom;
  return { zoom, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
}

function Label({ at, z, text }: { at: Pt; z: number; text: string }) {
  return (
    <text x={at[0]} y={at[1]} fontSize={12 / z} textAnchor="middle" dominantBaseline="middle" className="label" strokeWidth={3 / z}>
      {text}
    </text>
  );
}
