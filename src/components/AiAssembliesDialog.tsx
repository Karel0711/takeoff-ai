import { useEffect, useRef, useState } from 'react';
import { aiRoute, describeAiError, readLegend, type AiRoute } from '../ai/readLegend';
import type { ExtractedAssembly } from '../ai/schema';
import { buildTakeoffType, findAssemblyCodes } from '../assemblyBuilder';
import type { SavedLegendRead, Sheet, TakeoffType, Units } from '../model';
import { readAnswerKey, type ExpectedAssembly } from '../eval/answerKey';
import { scoreExtraction, type ScoreReport } from '../eval/score';
import { saveFile } from '../host';
import type { PDFPageProxy } from '../pdf';
import { ScorePanel } from './ScorePanel';
import { scoringOn } from '../scoring';
import { lengthUnit } from '../units';

interface Props {
  page: PDFPageProxy;
  sheet: Sheet;
  units: Units;
  existingTypes: TakeoffType[];
  /** Types to add; a type whose id matches an existing type replaces it. */
  onApply: (types: TakeoffType[]) => void;
  /** Keeps the result on the sheet so it can be reopened without another AI run. */
  onSaveResult: (result: SavedLegendRead) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

type State =
  | { phase: 'idle' }
  | { phase: 'running'; step: string; started: number }
  | ({ phase: 'done' } & SavedLegendRead)
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

/** The last answer-key workbook loaded, kept for this visit so each sheet can be scored without re-picking it. */
let answerKey: { name: string; key: ExpectedAssembly[] } | null = null;

export function AiAssembliesDialog({ page, sheet, units, existingTypes, onApply, onSaveResult, onClose, onOpenSettings }: Props) {
  const saved = sheet.aiAssemblies;
  const [state, setState] = useState<State>(saved ? { phase: 'done', ...saved } : { phase: 'idle' });
  // Selection is by position: one tag can have several entries (R1 option 1 and option 2).
  const [selected, setSelected] = useState<Set<number>>(() => new Set(saved?.assemblies.map((_, i) => i) ?? []));
  const [height, setHeight] = useState(units === 'metric' ? 3 : 10);
  const [, tick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const [route, setRoute] = useState<AiRoute | null>(null);
  const [score, setScore] = useState<{ report: ScoreReport; keyName: string } | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  const scoreWith = (key: { name: string; key: ExpectedAssembly[] }, assemblies: ExtractedAssembly[]) => {
    setScore({ report: scoreExtraction(key.key, assemblies, sheet.name), keyName: key.name });
  };

  async function loadKey(file: File, assemblies: ExtractedAssembly[]) {
    setScoreError(null);
    try {
      const key = await readAnswerKey(await file.arrayBuffer());
      if (!key.length) {
        setScoreError('No assembly schedule found in that workbook (a table headed Type | Design | Construction | Notes).');
        return;
      }
      answerKey = { name: file.name, key };
      scoreWith(answerKey, assemblies);
    } catch {
      setScoreError('That file could not be read as an Excel workbook.');
    }
  }

  useEffect(() => {
    void aiRoute().then(setRoute);
    if (saved && answerKey) scoreWith(answerKey, saved.assemblies);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingByCode = new Map(existingTypes.map((t) => [codeOf(t.name), t]));
  const kindOf = (a: ExtractedAssembly) =>
    a.category === 'interior_wall' || a.category === 'exterior_wall' ? 'linear' : 'area';
  /** An existing type of the same code and kind is updated in place, keeping its measurements and colour. */
  const replaces = (a: ExtractedAssembly, all: ExtractedAssembly[]) => {
    // A repeated tag is matched by its full name, so each option updates its own type.
    const t =
      all.filter((x) => x.code === a.code).length > 1
        ? existingTypes.find((x) => x.name === `${a.code} – ${a.title}`.replace(/\s+/g, ' ').trim())
        : existingByCode.get(a.code);
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
      setState({ phase: 'running', step: 'Claude is reading the assembly types…', started });
      const { extraction, runsText, answeredBy } = await readLegend(page, sheet.name, abort.current.signal);
      const printed = findAssemblyCodes(runsText);
      const assemblies = extraction.assemblies;
      setSelected(new Set(assemblies.map((_, i) => i)));
      if (answerKey) scoreWith(answerKey, assemblies);
      const result: SavedLegendRead = {
        assemblies,
        printed,
        answeredBy,
        readAt: new Date().toISOString(),
        seconds: Math.round((Date.now() - started) / 1000),
      };
      onSaveResult(result);
      setState({ phase: 'done', ...result });
    } catch (e) {
      if (abort.current?.signal.aborted) {
        setState({ phase: 'idle' });
        return;
      }
      setState({ phase: 'error', message: describeAiError(e) });
    }
  }

  function add() {
    if (state.phase !== 'done') return;
    const chosen = state.assemblies.filter((_, i) => selected.has(i));
    onApply(
      chosen.map((a, i) => {
        const built = buildTakeoffType(a, units, existingTypes.length + i, height);
        const old = replaces(a, state.assemblies);
        return old
          ? { ...built, id: old.id, color: old.color, division: old.division ?? built.division, package: old.package }
          : built;
      }),
    );
    onClose();
  }

  const toggle = (code: number) =>
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
              {route === 'account'
                ? 'This uses your own Claude account; the first time, Claude asks you to allow this page. It usually takes one to three minutes.'
                : route === 'api-key'
                  ? "The sheet's images and text are sent to Anthropic's API using your key. It usually takes one to three minutes."
                  : 'AI features need an Anthropic API key when the app runs on your own computer. Add one in AI settings.'}
            </p>
            <div className="row-actions">
              <button className="on" disabled={route === null || route === 'none'} onClick={() => void run()}>
                Read assembly types
              </button>
              {route !== 'account' && <button onClick={onOpenSettings}>AI settings</button>}
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
              {route !== 'account' && <button onClick={onOpenSettings}>AI settings</button>}
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
          in {state.seconds} s · read {new Date(state.readAt).toLocaleString()}
          {state.printed.length > 0 && (
            <>
              {' '}
              · {state.printed.length - missed.length} of {state.printed.length} type tags printed on the sheet
            </>
          )}
          <span className="muted"> · answered by {state.answeredBy}</span>
          {missed.length > 0 && (
            <div className="warn">
              In the sheet's text but not returned: {missed.join(', ')}. These may be references to other sheets or
              types removed by an addendum (their text often stays in the file). Check the drawing; if one is real,
              run it again or add it by hand.
            </div>
          )}
          {unprinted.length > 0 && (
            <div className="warn">Not found in the sheet text, check these: {unprinted.join(', ')}</div>
          )}
          <div className="row-actions">
            <input
              ref={keyInput}
              id="answer-key-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadKey(f, state.assemblies);
                e.target.value = '';
              }}
            />
            {scoringOn() && (
              <button onClick={() => keyInput.current?.click()}>
                {score ? 'Score against another workbook…' : 'Score against bid workbook…'}
              </button>
            )}
            <button onClick={() => void run()} title="Ask Claude to read this sheet again">
              Read again
            </button>
            <button
              onClick={() =>
                void saveFile(
                  `${sheet.name} assembly types (AI).json`,
                  new Blob([JSON.stringify({ sheet: sheet.name, answeredBy: state.answeredBy, assemblies: state.assemblies }, null, 2)], {
                    type: 'application/json',
                  }),
                )
              }
            >
              Download AI result
            </button>
          </div>
          {scoreError && <p className="err-box">{scoreError}</p>}
          {score && <ScorePanel report={score.report} keyName={score.keyName} />}
        </div>

        <div className="assembly-list">
          {state.assemblies.map((a, i) => (
            <label key={i} className={`assembly ${selected.has(i) ? 'picked' : ''}`}>
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
              <div className="assembly-body">
                <div className="assembly-head">
                  <strong>{a.code}</strong> {a.title}
                  <span className="tag">{CATEGORY_LABEL[a.category]}</span>
                  {a.total_thickness_mm !== null && <span className="tag">{a.total_thickness_mm} mm</span>}
                  {replaces(a, state.assemblies) ? (
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
          <button onClick={() => setSelected(new Set(state.assemblies.map((_, i) => i)))}>Select all</button>
          <button onClick={() => setSelected(new Set())}>Select none</button>
          <button className="on" disabled={selected.size === 0} onClick={add}>
            Add {selected.size} type{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      </>
    );
  }
}
