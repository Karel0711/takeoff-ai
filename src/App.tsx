import { useEffect, useMemo, useRef, useState } from 'react';
import { AiAssembliesDialog } from './components/AiAssembliesDialog';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { askConfirm, askText, DialogHost, notify } from './components/Dialogs';
import { QuantityPanel } from './components/QuantityPanel';
import { TypeEditor } from './components/TypeEditor';
import { WallTakeoffDialog } from './components/WallTakeoffDialog';
import { Viewer, type Tool } from './components/Viewer';
import { exportWorkbook } from './exportExcel';
import { wallModelFor } from './fill/sheetWalls';
import { isHosted, saveFile } from './host';
import { newId, newProject, type Project, type Pt, type Sheet, type TakeoffType, type Units } from './model';
import { inspectPage, openPdf, type PDFDocumentProxy, type PDFPageProxy } from './pdf';
import { typeTotals } from './quantities';
import { deletePdf, loadPdf, loadProject, savePdf, saveProject } from './storage';
import { formatQty, parseScale, SCALE_PRESETS } from './units';

const PALETTE = ['#e4572e', '#17bebb', '#76b041', '#ffc914', '#7d5ba6', '#2e86ab', '#f18f01', '#c73e1d', '#3b1f2b', '#44af69'];

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [pdfs, setPdfs] = useState<Map<string, PDFDocumentProxy>>(new Map());
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [activeTypeId, setActiveTypeId] = useState<string | null>(null);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetFilter, setSheetFilter] = useState('');
  const [aiDialog, setAiDialog] = useState<'assemblies' | 'settings' | 'walls' | null>(null);
  /** Fill closes wall openings up to this width (metres); wider ones count as open. */
  const [maxOpening, setMaxOpening] = useState(3);
  const fileInput = useRef<HTMLInputElement>(null);

  // Load the saved project and its PDFs.
  useEffect(() => {
    (async () => {
      const saved = (await loadProject()) ?? newProject('metric');
      const opened = new Map<string, PDFDocumentProxy>();
      for (const doc of saved.docs) {
        const data = await loadPdf(doc.id);
        if (data) opened.set(doc.id, await openPdf(data));
      }
      setPdfs(opened);
      setProject(saved);
      setSheetId(saved.sheets[0]?.id ?? null);
    })();
  }, []);

  // Autosave.
  useEffect(() => {
    if (!project) return;
    const t = window.setTimeout(() => void saveProject(project), 400);
    return () => window.clearTimeout(t);
  }, [project]);

  const sheet = project?.sheets.find((s) => s.id === sheetId) ?? null;

  // Load the current sheet's page.
  useEffect(() => {
    let cancelled = false;
    setPage(null);
    if (!sheet) return;
    const doc = pdfs.get(sheet.docId);
    if (!doc) return;
    doc.getPage(sheet.page).then((p) => {
      if (!cancelled) setPage(p);
    });
    return () => {
      cancelled = true;
    };
  }, [sheet?.id, sheet?.docId, sheet?.page, pdfs]);

  const totals = useMemo(() => (project ? typeTotals(project) : []), [project]);

  if (!project) return <div className="loading">Loading…</div>;

  const update = (fn: (p: Project) => Project) => setProject((p) => (p ? fn(p) : p));
  const updateSheet = (id: string, patch: Partial<Sheet>) =>
    update((p) => ({ ...p, sheets: p.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const updateType = (type: TakeoffType) =>
    update((p) => ({ ...p, types: p.types.map((t) => (t.id === type.id ? type : t)) }));

  const activeType = project.types.find((t) => t.id === activeTypeId) ?? null;
  const editingType = project.types.find((t) => t.id === editingTypeId) ?? null;
  const selected = project.measurements.find((m) => m.id === selectedId) ?? null;
  const selectedType = selected ? project.types.find((t) => t.id === selected.typeId) : undefined;
  const sheetMeasurements = sheet ? project.measurements.filter((m) => m.sheetId === sheet.id) : [];

  async function upload(files: FileList) {
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`);
      const data = await file.arrayBuffer();
      const docId = newId();
      await savePdf(docId, data);
      const pdf = await openPdf(data);
      const sheets: Sheet[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        setBusy(`Reading ${file.name}: sheet ${n} of ${pdf.numPages}`);
        const pg = await pdf.getPage(n);
        const info = await inspectPage(pg);
        pg.cleanup();
        // A single standard scale on the sheet is applied automatically and flagged for checking.
        const detected = info.scaleHints.length === 1 ? info.scaleHints[0] : null;
        sheets.push({
          id: newId(),
          docId,
          page: n,
          name: info.name ?? `Page ${n}`,
          width: info.width,
          height: info.height,
          metersPerPoint: detected ? parseScale(detected) : null,
          scaleLabel: detected,
          scaleSource: detected ? 'detected' : null,
          scaleHints: info.scaleHints,
        });
      }
      setPdfs((m) => new Map(m).set(docId, pdf));
      update((p) => ({ ...p, docs: [...p.docs, { id: docId, name: file.name }], sheets: [...p.sheets, ...sheets] }));
      setSheetId((cur) => cur ?? sheets[0]?.id ?? null);
    }
    setBusy(null);
  }

  async function startNewProject(units: Units) {
    const ok = await askConfirm('Start a new project? The current project and its drawings will be removed from this browser.', {
      confirmLabel: 'Start new project',
      danger: true,
    });
    if (!ok) return;
    for (const d of project!.docs) await deletePdf(d.id);
    setPdfs(new Map());
    setProject(newProject(units));
    setSheetId(null);
    setActiveTypeId(null);
    setEditingTypeId(null);
    setSelectedId(null);
  }

  async function exportExcel() {
    setBusy('Building Excel file…');
    try {
      const blob = await exportWorkbook(project!);
      const filename = `${project!.name.replace(/[^\w\- ]+/g, '').trim() || 'takeoff'} - takeoff.xlsx`;
      if ((await saveFile(filename, blob)) === 'failed') {
        await notify('The Excel file could not be saved here. Try again in a moment.');
      }
    } finally {
      setBusy(null);
    }
  }

  function addType() {
    const type: TakeoffType = {
      id: newId(),
      name: 'New takeoff type',
      color: PALETTE[project!.types.length % PALETTE.length],
      kind: 'area',
      height: project!.units === 'metric' ? 3 : 10,
      items: [],
    };
    update((p) => ({ ...p, types: [...p.types, type] }));
    setEditingTypeId(type.id);
  }

  const addMeasurement = (points: Pt[]) => {
    if (!sheet || !activeType) return;
    const m = { id: newId(), sheetId: sheet.id, typeId: activeType.id, points, holes: [] };
    update((p) => ({ ...p, measurements: [...p.measurements, m] }));
    return m.id;
  };

  const filteredSheets = project.sheets.filter((s) => s.name.toLowerCase().includes(sheetFilter.toLowerCase()));
  const totalFor = (typeId: string) => totals.find((t) => t.type.id === typeId);

  return (
    <div className="app">
      <header>
        <strong className="brand">Takeoff AI</strong>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
        />
        <span className="muted">{project.units === 'metric' ? 'Metric (m, m²)' : 'Imperial (ft, SF)'}</span>
        <div className="spacer" />
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInput.current?.click()}>Upload drawings</button>
        {!isHosted && <button onClick={() => setAiDialog('settings')}>AI settings</button>}
        <button onClick={() => void exportExcel()} disabled={!project.measurements.length}>
          Export Excel
        </button>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) void startNewProject(e.target.value as Units);
          }}
        >
          <option value="">New project…</option>
          <option value="metric">New metric project</option>
          <option value="imperial">New imperial project</option>
        </select>
      </header>

      <aside className="left">
        <div className="panel sheets">
          <div className="panel-head">
            <h3>Sheets</h3>
            <input placeholder="Filter" value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)} />
          </div>
          <ul>
            {filteredSheets.map((s) => {
              const count = project.measurements.filter((m) => m.sheetId === s.id).length;
              return (
                <li
                  key={s.id}
                  className={s.id === sheetId ? 'active' : ''}
                  onClick={() => {
                    setSheetId(s.id);
                    setSelectedId(null);
                  }}
                  onDoubleClick={async () => {
                    const name = await askText('Sheet name', { initial: s.name });
                    if (name?.trim()) updateSheet(s.id, { name: name.trim() });
                  }}
                  title="Double-click to rename"
                >
                  <span className="sheet-name">{s.name}</span>
                  {count > 0 && <span className="badge">{count}</span>}
                  <span className={`scale ${s.metersPerPoint ? s.scaleSource : 'none'}`}>
                    {s.scaleLabel ?? 'no scale'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel types">
          <div className="panel-head">
            <h3>Takeoff types</h3>
            <button onClick={addType}>+ New</button>
          </div>
          <ul>
            {project.types.map((t) => {
              const tt = totalFor(t.id);
              return (
                <li
                  key={t.id}
                  className={t.id === activeTypeId ? 'active' : ''}
                  onClick={() => {
                    setActiveTypeId(t.id);
                    setTool('measure');
                  }}
                  title="Click to measure with this type"
                >
                  <span className="swatch" style={{ background: t.color }} />
                  <span className="kind">{t.kind === 'area' ? '▱' : t.kind === 'linear' ? '╱' : '●'}</span>
                  <span className="type-name">{t.name}</span>
                  {tt && tt.vars.N > 0 && (
                    <span className="type-total">
                      {formatQty(tt.primary)} {tt.unit}
                    </span>
                  )}
                  <button
                    className="icon"
                    title="Edit type and assembly"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTypeId(t.id);
                    }}
                  >
                    ✎
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <main>
        <div className="toolbar">
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select and pan">
            Select
          </button>
          <button
            className={tool === 'measure' ? 'on' : ''}
            onClick={() => setTool('measure')}
            disabled={!activeType}
            title="Measure with the active takeoff type"
          >
            Measure{activeType ? `: ${activeType.name.split(' – ')[0]}` : ''}
          </button>
          <button
            className={tool === 'fill' ? 'on' : ''}
            onClick={() => setTool('fill')}
            disabled={activeType?.kind !== 'area' || !page}
            title="Click inside a room to take its area off along the inside face of the walls"
          >
            Fill room
          </button>
          {tool === 'fill' && (
            <label className="muted" title="Door and other openings up to this width are closed off; wider ones join the spaces either side. Windows with glazing drawn close up to 10 m.">
              Close openings up to{' '}
              <input
                className="opening"
                type="number"
                min={0.5}
                step={project.units === 'metric' ? 0.5 : 1}
                value={project.units === 'metric' ? maxOpening : Math.round(maxOpening / 0.3048)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) setMaxOpening(project.units === 'metric' ? v : v * 0.3048);
                }}
              />{' '}
              {project.units === 'metric' ? 'm' : 'ft'}
            </label>
          )}
          <button
            className={tool === 'cutout' ? 'on' : ''}
            onClick={() => setTool('cutout')}
            disabled={selectedType?.kind !== 'area'}
            title="Cut a hole out of the selected area"
          >
            Cutout
          </button>
          <span className="sep" />
          {sheet && (
            <>
              <span className="muted">Scale:</span>
              <select
                value={sheet.scaleLabel && parseScale(sheet.scaleLabel) ? sheet.scaleLabel : ''}
                onChange={(e) => {
                  const label = e.target.value;
                  const mpp = parseScale(label);
                  if (mpp) updateSheet(sheet.id, { metersPerPoint: mpp, scaleLabel: label, scaleSource: 'preset' });
                }}
              >
                <option value="">{sheet.scaleLabel && !parseScale(sheet.scaleLabel) ? sheet.scaleLabel : 'Choose…'}</option>
                {[...new Set([...sheet.scaleHints, ...SCALE_PRESETS[project.units]])].map((s) => (
                  <option key={s} value={s}>
                    {s}
                    {sheet.scaleHints.includes(s) ? ' (on sheet)' : ''}
                  </option>
                ))}
              </select>
              <button className={tool === 'calibrate' ? 'on' : ''} onClick={() => setTool('calibrate')}>
                Calibrate
              </button>
              <button
                className="ai"
                onClick={() => setAiDialog('assemblies')}
                disabled={!page}
                title="Read wall, floor, roof and ceiling types from this sheet into takeoff types"
              >
                {sheet.aiAssemblies ? '✦ Assembly types (AI result saved)' : '✦ Read assembly types'}
              </button>
              <button
                className="ai"
                onClick={() => setAiDialog('walls')}
                disabled={!page || !sheet.metersPerPoint}
                title={sheet.metersPerPoint ? 'Measure every tagged wall on this sheet by type, on the centreline' : 'Set the sheet scale first'}
              >
                ✦ Wall takeoff
              </button>
              {sheet.scaleSource === 'detected' && (
                <span className="hint warn-text" title="Read from the sheet's text. Check it against a known dimension.">
                  Scale detected: verify
                </span>
              )}
            </>
          )}
          <div className="spacer" />
          <span className="hint">{toolHint(tool, activeType)}</span>
        </div>
        <Viewer
          page={page}
          sheet={sheet}
          measurements={sheetMeasurements}
          types={project.types}
          activeType={activeType}
          units={project.units}
          tool={tool}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={addMeasurement}
          onReplacePoints={(id, points) =>
            update((p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, points } : m)) }))
          }
          getWallModel={() => (page && sheet ? wallModelFor(page, sheet, maxOpening) : null)}
          onAddHole={(id, ring) =>
            update((p) => ({
              ...p,
              measurements: p.measurements.map((m) => (m.id === id ? { ...m, holes: [...m.holes, ring] } : m)),
            }))
          }
          onDelete={(id) => {
            update((p) => ({ ...p, measurements: p.measurements.filter((m) => m.id !== id) }));
            setSelectedId(null);
          }}
          onCalibrate={(mpp, label) =>
            sheet && updateSheet(sheet.id, { metersPerPoint: mpp, scaleLabel: label, scaleSource: 'calibrated' })
          }
          onToolDone={() => setTool('select')}
        />
        {busy && <div className="busy">{busy}</div>}
      </main>

      {aiDialog === 'walls' && page && sheet && (
        <WallTakeoffDialog
          page={page}
          sheet={sheet}
          units={project.units}
          types={project.types}
          earlier={project.measurements.filter((m) => m.sheetId === sheet.id && m.source === 'walls').length}
          palette={PALETTE}
          legend={project.sheets.flatMap((s) => s.aiAssemblies?.assemblies ?? [])}
          maxOpening={maxOpening}
          onApply={({ types, measurements, replaceEarlier }) =>
            update((p) => ({
              ...p,
              types: [...p.types, ...types],
              measurements: [
                ...p.measurements.filter((m) => !(replaceEarlier && m.sheetId === sheet.id && m.source === 'walls')),
                ...measurements,
              ],
            }))
          }
          onClose={() => setAiDialog(null)}
        />
      )}
      {aiDialog === 'assemblies' && page && sheet && (
        <AiAssembliesDialog
          page={page}
          sheet={sheet}
          units={project.units}
          existingTypes={project.types}
          onApply={(incoming) =>
            update((p) => {
              const byId = new Map(incoming.map((t) => [t.id, t]));
              const kept = p.types.map((t) => byId.get(t.id) ?? t);
              const added = incoming.filter((t) => !p.types.some((x) => x.id === t.id));
              return { ...p, types: [...kept, ...added] };
            })
          }
          onSaveResult={(result) => updateSheet(sheet.id, { aiAssemblies: result })}
          onClose={() => setAiDialog(null)}
          onOpenSettings={() => setAiDialog('settings')}
        />
      )}
      {aiDialog === 'settings' && <AiSettingsDialog onClose={() => setAiDialog(null)} />}
      <DialogHost />

      <aside className="right">
        {editingType ? (
          <TypeEditor
            type={editingType}
            units={project.units}
            totals={totalFor(editingType.id)?.vars}
            onChange={updateType}
            onDelete={() => {
              update((p) => ({
                ...p,
                types: p.types.filter((t) => t.id !== editingType.id),
                measurements: p.measurements.filter((m) => m.typeId !== editingType.id),
              }));
              setEditingTypeId(null);
              if (activeTypeId === editingType.id) setActiveTypeId(null);
            }}
            onClose={() => setEditingTypeId(null)}
          />
        ) : (
          <QuantityPanel totals={totals} onEdit={setEditingTypeId} />
        )}
      </aside>
    </div>
  );
}

function toolHint(tool: Tool, type: TakeoffType | null): string {
  switch (tool) {
    case 'select':
      return 'Click a shape to select · Del to delete · drag to pan · scroll to zoom · F to fit';
    case 'measure':
      if (!type) return 'Pick a takeoff type on the left';
      if (type.kind === 'count') return 'Click each item to count';
      return 'Click points · double-click or Enter to finish · Shift = straight · Backspace = undo point · Esc = cancel';
    case 'calibrate':
      return 'Click both ends of a known dimension, then type its real length';
    case 'cutout':
      return 'Draw the hole inside the selected area · double-click or Enter to finish';
    case 'fill':
      if (type?.kind !== 'area') return 'Pick an area takeoff type on the left';
      return 'Click inside a room to fill it · Shift+click a neighbouring space to join it · Del removes it';
  }
}
