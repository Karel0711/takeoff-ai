import { useEffect, useRef, useState } from 'react';
import { describeError, readAssemblyLegend } from '../ai/claude';
import type { ExtractedAssembly } from '../ai/schema';
import { buildTakeoffType, findAssemblyCodes } from '../assemblyBuilder';
import type { Sheet, TakeoffType, Units } from '../model';
import { pageTextRuns, renderTiles, type PDFPageProxy } from '../pdf';
import { textLines } from '../sheetInfo';
import { lengthUnit } from '../units';

interface Props {
  page: PDFPageProxy;
  sheet: Sheet;
  units: Units;
  existingTypes: TakeoffType[];
  /** Types to add; a type whose id matches an existing type replaces it. */
  onApply: (types: TakeoffType[]) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

type State =
  | { phase: 'idle' }
  | { phase: 'running'; step: string; started: number }
  | { phase: 'done'; assemblies: ExtractedAssembly[]; printed: string[]; model: string; seconds: number }
  | { phase: 'error'; message: string };

const CATEGORY_LABEL: Record<ExtractedAssembly['category'], string> = {
  interior_wall: 'Interior wall',
  exterior_wall: 'Exterior wall',
  floor: 'Floor',
  roof: 'Roof',
  ceiling: 'Ceiling',
  other: 'Other',
};

const codeOf = (typeName: string) => typeName.split(' – ')[0].trim();

export function AiAssembliesDialog({ page, sheet, units, existingTypes, onApply, onClose, onOpenSettings }: Props) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [height, setHeight] = useState(units === 'metric' ? 3 : 10);
  const [, tick] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const existingByCode = new Map(existingTypes.map((t) => [codeOf(t.name), t]));
  const kindOf = (a: ExtractedAssembly) =>
    a.category === 'interior_wall' || a.category === 'exterior_wall' ? 'linear' : 'area';
  /** An existing type of the same code and kind is updated in place, keeping its measurements and colour. */
  const replaces = (a: ExtractedAssembly) => {
    const t = existingByCode.get(a.code);
    return t && t.kind === kindOf(a) ? t : undefined;
  };

  useEffect(() => {
    if (state.phase !== 'running') return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [state.phase]);

  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    const started = Date.now();
    abort.current = new AbortController();
    try {
      setState({ phase: 'running', step: 'Reading the sheet text…', started });
      const runs = await pageTextRuns(page);
      const printed = findAssemblyCodes(runs.map((r) => r.str));
      setState({ phase: 'running', step: 'Preparing sheet images…', started });
      const tiles = await renderTiles(page, 2, 2, 2576);
      setState({ phase: 'running', step: 'Claude is reading the assembly types…', started });
      const { extraction, model } = await readAssemblyLegend(tiles, textLines(runs), sheet.name, abort.current.signal);
      const assemblies = extraction.assemblies;
      setSelected(new Set(assemblies.map((a) => a.code)));
      setState({ phase: 'done', assemblies, printed, model, seconds: Math.round((Date.now() - started) / 1000) });
    } catch (e) {
      if (abort.current?.signal.aborted) {
        setState({ phase: 'idle' });
        return;
      }
      setState({ phase: 'error', message: describeError(e) });
    }
  }

  function add() {
    if (state.phase !== 'done') return;
    const chosen = state.assemblies.filter((a) => selected.has(a.code));
    onApply(
      chosen.map((a, i) => {
        const built = buildTakeoffType(a, units, existingTypes.length + i, height);
        const old = replaces(a);
        return old ? { ...built, id: old.id, color: old.color } : built;
      }),
    );
    onClose();
  }

  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>AI: read assembly types from {sheet.name}</h3>
          <button
            onClick={() => {
              abort.current?.abort();
              onClose();
            }}
          >
            Close
          </button>
        </div>

        {state.phase === 'idle' && (
          <>
            <p>
              Claude reads the wall, floor, roof and ceiling types on this sheet and turns each one into a takeoff type
              with its layers as assembly items. You review everything before it is added.
            </p>
            <p className="muted">
              The sheet's image and text are sent to Anthropic's API using your key. It usually takes one to three
              minutes.
            </p>
            <div className="row-actions">
              <button className="on" onClick={() => void run()}>
                Read assembly types
              </button>
              <button onClick={onOpenSettings}>AI settings</button>
            </div>
          </>
        )}

        {state.phase === 'running' && (
          <div className="running">
            <div className="spinner" />
            <div>
              <div>{state.step}</div>
              <div className="muted">{Math.round((Date.now() - state.started) / 1000)} s</div>
            </div>
            <button
              onClick={() => {
                abort.current?.abort();
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {state.phase === 'error' && (
          <>
            <p className="err-box">{state.message}</p>
            <div className="row-actions">
              <button onClick={() => void run()}>Try again</button>
              <button onClick={onOpenSettings}>AI settings</button>
            </div>
          </>
        )}

        {state.phase === 'done' && renderResults()}
      </div>
    </div>
  );

  // Called as a function, not used as a component, so inputs keep focus across renders.
  function renderResults() {
    if (state.phase !== 'done') return null;
    const found = new Set(state.assemblies.map((a) => a.code));
    const missed = state.printed.filter((c) => !found.has(c));
    const unprinted = state.assemblies.map((a) => a.code).filter((c) => !state.printed.includes(c));
    return (
      <>
        <div className="coverage">
          <strong>
            Found {state.assemblies.length} type{state.assemblies.length === 1 ? '' : 's'}
          </strong>{' '}
          in {state.seconds} s
          {state.printed.length > 0 && (
            <>
              {' '}
              · {state.printed.length - missed.length} of {state.printed.length} type tags printed on the sheet
            </>
          )}
          {state.model !== 'claude-opus-5-5' && <span className="muted"> · answered by {state.model}</span>}
          {missed.length > 0 && (
            <div className="warn">
              Printed on the sheet but not returned: {missed.join(', ')}. Some may be references to types on other
              sheets; otherwise run it again or add them by hand.
            </div>
          )}
          {unprinted.length > 0 && (
            <div className="warn">Not found in the sheet text, check these: {unprinted.join(', ')}</div>
          )}
        </div>

        <div className="assembly-list">
          {state.assemblies.map((a) => (
            <label key={a.code} className={`assembly ${selected.has(a.code) ? 'picked' : ''}`}>
              <input type="checkbox" checked={selected.has(a.code)} onChange={() => toggle(a.code)} />
              <div className="assembly-body">
                <div className="assembly-head">
                  <strong>{a.code}</strong> {a.title}
                  <span className="tag">{CATEGORY_LABEL[a.category]}</span>
                  {a.total_thickness_mm !== null && <span className="tag">{a.total_thickness_mm} mm</span>}
                  {replaces(a) ? (
                    <span className="tag warn-tag">replaces existing {a.code}</span>
                  ) : (
                    existingByCode.has(a.code) && <span className="tag warn-tag">{a.code} exists; added as new type</span>
                  )}
                </div>
                <ol className="layers">
                  {a.layers.map((l, i) => (
                    <li key={i}>
                      {l.material}
                      <span className="role">{l.role.replace('_', ' ')}</span>
                    </li>
                  ))}
                </ol>
                {a.notes.length > 0 && <div className="notes">{a.notes.join(' · ')}</div>}
              </div>
            </label>
          ))}
        </div>

        <div className="row-actions sticky">
          <label className="inline">
            Wall height ({lengthUnit(units)})
            <input
              type="number"
              min={0}
              step={0.1}
              value={height}
              onChange={(e) => setHeight(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <div className="spacer" />
          <button onClick={() => setSelected(new Set(state.assemblies.map((a) => a.code)))}>Select all</button>
          <button onClick={() => setSelected(new Set())}>Select none</button>
          <button className="on" disabled={selected.size === 0} onClick={add}>
            Add {selected.size} type{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      </>
    );
  }
}
