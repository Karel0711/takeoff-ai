import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diffProjects, type ActivityEvent } from './activity';
import { AiAssembliesDialog } from './components/AiAssembliesDialog';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { askConfirm, askText, DialogHost, notify } from './components/Dialogs';
import { Icon, type IconName } from './components/Icons';
import { Inspector, type InspectorTab } from './components/Inspector';
import { Menu, Popover } from './components/Popover';
import { RoomsDialog } from './components/RoomsDialog';
import { RoomFinishesDialog } from './components/RoomFinishesDialog';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ScalePicker } from './components/ScalePicker';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { TypeEditor } from './components/TypeEditor';
import { Viewer, type Tool } from './components/Viewer';
import { WallTakeoffDialog } from './components/WallTakeoffDialog';
import { exportWorkbook } from './exportExcel';
import { segmentsOf, wallModelFor } from './fill/sheetWalls';
import { findSimilar, pointInRing } from './fill/similar';
import { findSymbols } from './fill/symbols';
import { isHosted, saveFile } from './host';
import { newId, newProject, type Project, type Pt, type Sheet, type TakeoffType, type Units } from './model';
import { inspectPage, openPdf, type PDFDocumentProxy, type PDFPageProxy } from './pdf';
import { typeTotals } from './quantities';
import { deleteProject, listProjects, loadActivity, loadCurrentProject, loadPdf, loadProjectById, persistStorage, saveActivity, savePdf, saveProject } from './storage';
import { readProjectFile, writeProjectFile } from './projectFile';
import { canUseServiceWorker, isInstalled, onLaunchFiles, promptInstall, registerServiceWorker } from './pwa';
import { formatQty, parseScale } from './units';

const PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#ac8e68', '#5e5ce6', '#ff6961'];
const UNDO_LIMIT = 200;

interface Toast {
  text: string;
  undo: boolean;
  /** A button other than Undo, e.g. "Restart" for an update. */
  action?: { label: string; run: () => void };
  /** Stay until dismissed. */
  sticky?: boolean;
}

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; help: string }[] = [
  { id: 'select', label: 'Select', icon: 'select', key: 'V', help: 'Select, move around and delete takeoffs' },
  { id: 'measure', label: 'Measure', icon: 'measure', key: 'M', help: 'Measure with the chosen takeoff type' },
  { id: 'fill', label: 'Fill room', icon: 'fill', key: 'R', help: 'Click inside a room to take off its area' },
  { id: 'cutout', label: 'Cutout', icon: 'cutout', key: 'C', help: 'Cut a hole out of the selected area' },
  { id: 'symbol', label: 'Count symbols', icon: 'count', key: 'S', help: 'Drag a box around one symbol to count every copy on the sheet' },
];

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastCommit = useRef<{ key: string; at: number; batch: string } | null>(null);
  const [, setHistoryTick] = useState(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const activityRef = useRef<ActivityEvent[]>([]);

  const [pdfs, setPdfs] = useState<Map<string, PDFDocumentProxy>>(new Map());
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [activeTypeId, setActiveTypeId] = useState<string | null>(null);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sheetFilter, setSheetFilter] = useState('');
  const [aiDialog, setAiDialog] = useState<'assemblies' | 'settings' | 'walls' | 'rooms' | 'finishes' | 'shortcuts' | null>(null);
  const [popover, setPopover] = useState<'scale' | 'more' | 'automate' | 'projects' | null>(null);
  const [tab, setTab] = useState<InspectorTab>('quantities');
  const [persisted, setPersisted] = useState(false);
  const projectFileInput = useRef<HTMLInputElement>(null);
  const projectsButton = useRef<HTMLButtonElement>(null);
  /** Fill closes wall openings up to this width (metres); wider ones count as open. */
  const [maxOpening, setMaxOpening] = useState(3);
  const fileInput = useRef<HTMLInputElement>(null);
  const scaleButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const automateButton = useRef<HTMLButtonElement>(null);

  // Load the saved project, its PDFs and its activity log.
  /** Opens a project: its drawings, its history, a fresh undo stack. */
  const openProjectState = useCallback(async (p: Project) => {
    const opened = new Map<string, PDFDocumentProxy>();
    for (const doc of p.docs) {
      const data = await loadPdf(doc.id);
      if (data) opened.set(doc.id, await openPdf(data));
    }
    const log = p.id ? await loadActivity(p.id) : [];
    past.current = [];
    future.current = [];
    lastCommit.current = null;
    activityRef.current = log;
    setActivity(log);
    setPdfs(opened);
    projectRef.current = p;
    setProject(p);
    setSheetId(p.sheets[0]?.id ?? null);
    setActiveTypeId(null);
    setEditingTypeId(null);
    setSelectedId(null);
    setTool('select');
  }, []);

  useEffect(() => {
    (async () => {
      const saved = (await loadCurrentProject()) ?? newProject('metric');
      await openProjectState(saved.id ? saved : { ...saved, id: newId() });
      setPersisted(await persistStorage());
    })();
    registerServiceWorker((apply) =>
      setToast({ text: 'A new version of Takeoff AI is ready', undo: false, sticky: true, action: { label: 'Restart', run: apply } }),
    );
  }, [openProjectState]);

  // Files the installed app was opened with from Finder.
  const launchHandler = useRef<(files: File[]) => void>(() => {});
  useEffect(() => onLaunchFiles((files) => launchHandler.current(files)), []);

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

  useEffect(() => {
    if (!toast || toast.sticky) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const totals = useMemo(() => (project ? typeTotals(project) : []), [project]);

  const record = useCallback((events: ActivityEvent[], replaceBatch?: string) => {
    if (!events.length && !replaceBatch) return;
    const kept = replaceBatch ? activityRef.current.filter((e) => e.batch !== replaceBatch) : activityRef.current;
    const all = [...kept, ...events];
    activityRef.current = all;
    setActivity(all);
    const id = projectRef.current?.id;
    if (id) void saveActivity(id, all);
  }, []);

  /**
   * Applies a change: keeps it for undo and records what changed in the activity log.
   * Changes with the same `key` in quick succession (typing in a field) count as one.
   */
  const commit = useCallback(
    (fn: (p: Project) => Project, source: string, key?: string) => {
      const prev = projectRef.current;
      if (!prev) return;
      const next = fn(prev);
      if (next === prev) return;
      const now = Date.now();
      const last = lastCommit.current;
      if (key && last && last.key === key && now - last.at < 4000 && past.current.length) {
        const base = past.current[past.current.length - 1];
        const events = diffProjects(base, next, source).map((e) => ({ ...e, batch: last.batch }));
        record(events, last.batch);
        lastCommit.current = { key, at: now, batch: last.batch };
      } else {
        past.current.push(prev);
        if (past.current.length > UNDO_LIMIT) past.current.shift();
        const events = diffProjects(prev, next, source);
        record(events);
        lastCommit.current = key ? { key, at: now, batch: events[0]?.batch ?? newId() } : null;
      }
      future.current = [];
      projectRef.current = next;
      setProject(next);
      setHistoryTick((n) => n + 1);
    },
    [record],
  );

  const undo = useCallback(() => {
    const cur = projectRef.current;
    const prev = past.current.pop();
    if (!cur || !prev) return;
    future.current.push(cur);
    record(diffProjects(cur, prev, 'Undo'));
    lastCommit.current = null;
    projectRef.current = prev;
    setProject(prev);
    setSelectedId(null);
    setHistoryTick((n) => n + 1);
  }, [record]);

  const redo = useCallback(() => {
    const cur = projectRef.current;
    const next = future.current.pop();
    if (!cur || !next) return;
    past.current.push(cur);
    record(diffProjects(cur, next, 'Redo'));
    lastCommit.current = null;
    projectRef.current = next;
    setProject(next);
    setHistoryTick((n) => n + 1);
  }, [record]);

  // Keyboard: tools, undo and redo. Typing in a field or a dialog is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop, .popover')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (found) setTool(found.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (!project) return <div className="loading">Opening your project…</div>;

  const updateSheet = (id: string, patch: Partial<Sheet>, source: string) =>
    commit((p) => ({ ...p, sheets: p.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), source);
  const updateType = (type: TakeoffType) =>
    commit((p) => ({ ...p, types: p.types.map((t) => (t.id === type.id ? type : t)) }), 'Edit type', `type:${type.id}`);

  const activeType = project.types.find((t) => t.id === activeTypeId) ?? null;
  const editingType = project.types.find((t) => t.id === editingTypeId) ?? null;
  const selected = project.measurements.find((m) => m.id === selectedId) ?? null;
  const selectedType = selected ? project.types.find((t) => t.id === selected.typeId) : undefined;
  const sheetMeasurements = sheet ? project.measurements.filter((m) => m.sheetId === sheet.id) : [];
  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

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
      commit((p) => ({ ...p, docs: [...p.docs, { id: docId, name: file.name }], sheets: [...p.sheets, ...sheets] }), 'Add drawings');
      setSheetId((cur) => cur ?? sheets[0]?.id ?? null);
    }
    setBusy(null);
  }

  /** Saves the open project now (rather than on the autosave timer), before switching away. */
  const flush = async () => {
    if (projectRef.current) await saveProject(projectRef.current);
  };

  async function startNewProject(units: Units) {
    await flush();
    const fresh = newProject(units);
    await saveProject(fresh);
    await openProjectState(fresh);
    setToast({ text: `New ${units} project`, undo: false });
  }

  async function switchProject(id: string) {
    await flush();
    const p = await loadProjectById(id);
    if (!p) {
      await notify('That project could not be opened. It may have been deleted in another window.');
      return;
    }
    await openProjectState(p);
  }

  async function removeProject(id: string) {
    const target = id === project!.id ? project! : await loadProjectById(id);
    if (!target) return;
    const ok = await askConfirm(
      `Delete “${target.name}” with its drawings, takeoffs and history from this computer? Save it to a file first if you may need it again.`,
      { confirmLabel: 'Delete project', danger: true },
    );
    if (!ok) return;
    await deleteProject(target);
    if (id === project!.id) {
      const next = await loadCurrentProject();
      await openProjectState(next ?? newProject(project!.units));
    }
    setPopover(null);
    setToast({ text: `Deleted ${target.name}`, undo: false });
  }

  async function saveProjectFile() {
    setBusy('Saving the project file…');
    try {
      await flush();
      const { blob, missing } = await writeProjectFile(project!, activityRef.current, async (id) => await loadPdf(id));
      const filename = `${project!.name.replace(/[^\w\- ]+/g, '').trim() || 'takeoff'}.takeoff`;
      const result = await saveFile(filename, blob);
      if (result === 'failed') await notify('The project file could not be saved here. Try again in a moment.');
      else if (missing.length) await notify(`Saved, but these drawings were missing from this browser and are not in the file: ${missing.join(', ')}.`);
    } finally {
      setBusy(null);
    }
  }

  async function openProjectFile(file: File) {
    setBusy(`Opening ${file.name}…`);
    try {
      const opened = await readProjectFile(await file.arrayBuffer());
      // Opening a file always makes a new project; say so when the name is already taken.
      const names = new Set((await listProjects()).map((p) => p.name));
      if (names.has(opened.project.name)) opened.project = { ...opened.project, name: `${opened.project.name} (copy)` };
      await flush();
      for (const [id, data] of opened.pdfs) await savePdf(id, data);
      await saveProject(opened.project);
      if (opened.project.id) await saveActivity(opened.project.id, opened.activity);
      await openProjectState(opened.project);
      setToast({ text: `Opened ${opened.project.name}`, undo: false });
    } catch (e) {
      await notify(e instanceof Error ? e.message : 'That file could not be opened.');
    } finally {
      setBusy(null);
    }
  }

  async function installApp() {
    const result = await promptInstall();
    if (result === 'manual')
      await notify(
        'To install Takeoff AI: in Safari choose File › Add to Dock; in Chrome or Edge click the install button at the right of the address bar. It then opens in its own window, works offline and updates itself.',
      );
  }

  launchHandler.current = (files: File[]) => {
    const takeoff = files.find((f) => /\.(takeoff|zip)$/i.test(f.name));
    if (takeoff) void openProjectFile(takeoff);
    const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfFiles.length) {
      const dt = new DataTransfer();
      pdfFiles.forEach((f) => dt.items.add(f));
      void upload(dt.files);
    }
  };

  async function removeDrawings(docId: string) {
    const doc = project!.docs.find((d) => d.id === docId);
    const sheetIds = new Set(project!.sheets.filter((s) => s.docId === docId).map((s) => s.id));
    const count = project!.measurements.filter((m) => sheetIds.has(m.sheetId)).length;
    const ok = await askConfirm(
      `Remove ${doc?.name ?? 'this drawing set'}${count ? ` and its ${count} takeoff${count === 1 ? '' : 's'}` : ''}? Its sheets leave the project.`,
      { confirmLabel: 'Remove', danger: true },
    );
    if (!ok) return;
    commit(
      (p) => ({
        ...p,
        docs: p.docs.filter((d) => d.id !== docId),
        sheets: p.sheets.filter((s) => s.docId !== docId),
        measurements: p.measurements.filter((m) => !sheetIds.has(m.sheetId)),
      }),
      'Remove drawings',
    );
    if (sheetId && sheetIds.has(sheetId)) setSheetId(project!.sheets.find((s) => !sheetIds.has(s.id))?.id ?? null);
    setToast({ text: `Removed ${doc?.name ?? 'drawings'}`, undo: true });
  }

  async function exportExcel() {
    setBusy('Building the Excel file…');
    try {
      const blob = await exportWorkbook(project!, activityRef.current);
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
    commit((p) => ({ ...p, types: [...p.types, type] }), 'New type');
    setEditingTypeId(type.id);
  }

  function deleteType(typeId: string) {
    const type = project!.types.find((t) => t.id === typeId);
    const count = project!.measurements.filter((m) => m.typeId === typeId).length;
    commit(
      (p) => ({
        ...p,
        types: p.types.filter((t) => t.id !== typeId),
        measurements: p.measurements
          .filter((m) => m.typeId !== typeId)
          .map((m) =>
            m.finishes && Object.values(m.finishes).includes(typeId)
              ? { ...m, finishes: Object.fromEntries(Object.entries(m.finishes).filter(([, id]) => id !== typeId)) }
              : m,
          ),
      }),
      'Delete type',
    );
    if (editingTypeId === typeId) setEditingTypeId(null);
    if (activeTypeId === typeId) setActiveTypeId(null);
    setToast({ text: `Deleted ${type?.name.split(' – ')[0] ?? 'type'}${count ? ` and ${count} takeoff${count === 1 ? '' : 's'}` : ''}`, undo: true });
  }

  /** Counts every copy of the symbol in the box, as the active count type. */
  async function countSymbols(box: [number, number, number, number]) {
    if (!page || !sheet || activeType?.kind !== 'count') return;
    setBusy('Looking for this symbol…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const found = findSymbols(await segmentsOf(page), box);
      if (!found.length) {
        setToast({ text: 'Nothing to match in that box. Drag it around one symbol’s linework.', undo: false });
        return;
      }
      // Copies already counted as this type are left alone.
      const span = Math.max(Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1]));
      const counted = project!.measurements.filter((m) => m.sheetId === sheet.id && m.typeId === activeType.id).map((m) => m.points[0]);
      const fresh = found.filter((f) => !counted.some((p) => Math.hypot(p[0] - f.at[0], p[1] - f.at[1]) < span / 2));
      if (!fresh.length) {
        setToast({ text: `All ${found.length} copies of this symbol are already counted.`, undo: false });
        return;
      }
      const added = fresh.map((f) => ({ id: newId(), sheetId: sheet.id, typeId: activeType.id, points: [f.at], holes: [] }));
      commit((p) => ({ ...p, measurements: [...p.measurements, ...added] }), 'Count symbols');
      setToast({
        text: `Counted ${added.length} ${activeType.name.split(' – ')[0]}${found.length > added.length ? ` (${found.length - added.length} already counted)` : ''}`,
        undo: true,
      });
    } finally {
      setBusy(null);
    }
  }

  /** Adds every area on the sheet hatched like the given one, as the same type. */
  async function addSimilar(id: string) {
    const m = project!.measurements.find((x) => x.id === id);
    if (!m || !page || !sheet || m.sheetId !== sheet.id) return;
    setBusy('Looking for areas hatched like this one…');
    try {
      // Let the busy note paint before the sheet-wide search.
      await new Promise((r) => setTimeout(r, 30));
      const [segs, model] = await Promise.all([segmentsOf(page), wallModelFor(page, sheet, maxOpening)]);
      const { pattern, areas } = findSimilar(segs, model, m.points, sheet.width, sheet.height);
      if (!pattern) {
        setToast({ text: 'This area has no hatch pattern to match. Pick an area drawn with a hatch (dots, tile grid, lines).', undo: false });
        return;
      }
      // Skip areas already taken off as this type.
      const own = project!.measurements.filter((x) => x.sheetId === sheet.id && x.typeId === m.typeId);
      const centroid = (pts: Pt[]): Pt => [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length];
      const fresh = areas.filter((a) => !own.some((x) => pointInRing(centroid(a.points), x.points)));
      if (!fresh.length) {
        setToast({ text: 'No other areas hatched like this one on this sheet.', undo: false });
        return;
      }
      const added = fresh.map((a) => ({ id: newId(), sheetId: sheet.id, typeId: m.typeId, points: a.points, holes: [] }));
      commit((p) => ({ ...p, measurements: [...p.measurements, ...added] }), 'Find similar');
      setToast({ text: `Added ${added.length} area${added.length === 1 ? '' : 's'} hatched like this one`, undo: true });
    } finally {
      setBusy(null);
    }
  }

  function deleteMeasurements(ids: string[]) {
    if (!ids.length) return;
    const gone = new Set(ids);
    commit((p) => ({ ...p, measurements: p.measurements.filter((m) => !gone.has(m.id)) }), 'Delete');
    if (selectedId && gone.has(selectedId)) setSelectedId(null);
    setToast({ text: `Deleted ${ids.length} takeoff${ids.length === 1 ? '' : 's'}`, undo: true });
  }

  const addMeasurement = (points: Pt[]) => {
    if (!sheet || !activeType) return;
    const m = { id: newId(), sheetId: sheet.id, typeId: activeType.id, points, holes: [] };
    commit((p) => ({ ...p, measurements: [...p.measurements, m] }), tool === 'fill' ? 'Fill room' : 'Measure');
    return m.id;
  };

  const chooseType = (t: TakeoffType) => {
    setActiveTypeId(t.id);
    setSelectedId(null);
    if (tool === 'select' || tool === 'calibrate' || (tool === 'fill' && t.kind !== 'area') || (tool === 'symbol' && t.kind !== 'count') || tool === 'cutout') setTool('measure');
  };

  const filteredSheets = project.sheets.filter((s) => s.name.toLowerCase().includes(sheetFilter.toLowerCase()));
  const totalFor = (typeId: string) => totals.find((t) => t.type.id === typeId);
  const scaleState = !sheet ? 'none' : !sheet.metersPerPoint ? 'unset' : sheet.scaleSource === 'detected' ? 'check' : 'set';
  const toolDisabled = (id: Tool) =>
    !page ||
    (id === 'measure' && !activeType) ||
    (id === 'fill' && activeType?.kind !== 'area') ||
    (id === 'symbol' && activeType?.kind !== 'count') ||
    (id === 'cutout' && selectedType?.kind !== 'area');
  const toolTitle = (t: (typeof TOOLS)[number]) =>
    `${t.help} (${t.key})${
      t.id === 'measure' && !activeType ? ' — choose a takeoff type first' : t.id === 'fill' && activeType?.kind !== 'area' ? ' — choose an area type first' : t.id === 'symbol' && activeType?.kind !== 'count' ? ' — choose a count type first' : t.id === 'cutout' && selectedType?.kind !== 'area' ? ' — select an area first' : ''
    }`;

  return (
    <div className="app">
      <header className="titlebar">
        <input
          ref={projectFileInput}
          type="file"
          accept=".takeoff,.zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openProjectFile(f);
            e.target.value = '';
          }}
        />
        <div className="tb-left">
          <div className="app-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="20" height="20">
              <rect x="1" y="1" width="18" height="18" rx="5" fill="var(--accent)" />
              <path d="M5 14.5V6h4.5L15 14.5z" fill="#fff" />
            </svg>
          </div>
          <input
            id="project-name"
            className="project-name"
            aria-label="Project name"
            value={project.name}
            onChange={(e) => {
              const name = e.target.value;
              const next = { ...projectRef.current!, name };
              projectRef.current = next;
              setProject(next);
            }}
          />
          <button
            ref={projectsButton}
            className="icon-button small"
            onClick={() => setPopover(popover === 'projects' ? null : 'projects')}
            aria-expanded={popover === 'projects'}
            aria-label="Projects"
            title="Projects"
          >
            <Icon name="chevronDown" size={14} />
          </button>
        </div>

        <div className="tb-center">
          <div className="segmented tools" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={tool === t.id ? 'on' : ''}
                aria-pressed={tool === t.id}
                disabled={toolDisabled(t.id)}
                onClick={() => setTool(t.id)}
                title={toolTitle(t)}
              >
                <Icon name={t.icon} size={16} />
                <span className="tool-label">{t.label}</span>
              </button>
            ))}
          </div>
          {sheet && (
            <button
              ref={scaleButton}
              className={`scale-pill ${scaleState}`}
              onClick={() => setPopover(popover === 'scale' ? null : 'scale')}
              aria-expanded={popover === 'scale'}
              title="Drawing scale for this sheet"
            >
              <Icon name="scale" size={16} />
              <span>{sheet.metersPerPoint ? sheet.scaleLabel : 'Set scale'}</span>
              {scaleState === 'check' && <span className="pill-badge">Check</span>}
              <Icon name="chevronDown" size={12} />
            </button>
          )}
          {sheet && (
            <button
              ref={automateButton}
              className="ai-button"
              onClick={() => setPopover(popover === 'automate' ? null : 'automate')}
              aria-expanded={popover === 'automate'}
              title="Read assemblies, take off walls, fill rooms"
            >
              <Icon name="sparkle" size={16} />
              <span>Automate</span>
              <Icon name="chevronDown" size={12} />
            </button>
          )}
        </div>

        <div className="tb-right">
          <button className="icon-button" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button className="icon-button" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
            <Icon name="redo" />
          </button>
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
          <button className="secondary" onClick={() => fileInput.current?.click()} title="Add PDF drawings">
            <Icon name="upload" size={16} />
            <span className="hide-narrow">Add drawings</span>
          </button>
          <button className="primary" onClick={() => void exportExcel()} disabled={!project.measurements.length} title="Export the takeoff to Excel">
            <Icon name="download" size={16} />
            <span className="hide-narrow">Export</span>
          </button>
          <button ref={moreButton} className="icon-button" onClick={() => setPopover(popover === 'more' ? null : 'more')} aria-label="More" title="More">
            <Icon name="more" />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section className="source sheets">
          <div className="source-head">
            <h2>Sheets</h2>
            <span className="count">{project.sheets.length || ''}</span>
          </div>
          {project.sheets.length > 8 && (
            <label className="search">
              <Icon name="search" size={14} />
              <input id="sheet-filter" placeholder="Search sheets" value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)} />
            </label>
          )}
          <ul className="source-list">
            {filteredSheets.map((s) => {
              const count = project.measurements.filter((m) => m.sheetId === s.id).length;
              const state = !s.metersPerPoint ? 'unset' : s.scaleSource === 'detected' ? 'check' : 'set';
              return (
                <li key={s.id}>
                  <button
                    className={`source-row ${s.id === sheetId ? 'active' : ''}`}
                    onClick={() => {
                      setSheetId(s.id);
                      setSelectedId(null);
                    }}
                    onDoubleClick={async () => {
                      const name = await askText('Rename sheet', { initial: s.name });
                      if (name?.trim()) updateSheet(s.id, { name: name.trim() }, 'Rename sheet');
                    }}
                    title="Double-click to rename"
                  >
                    <Icon name="sheet" size={16} />
                    <span className="row-main">
                      <span className="row-title sheet-name">{s.name}</span>
                      <span className={`row-sub scale-${state}`}>
                        {state === 'check' && <span className="check-dot" title="Read from the sheet; check it against a dimension" />}
                        {s.metersPerPoint ? s.scaleLabel : 'No scale'}
                      </span>
                    </span>
                    {count > 0 && <span className="badge">{count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {project.sheets.length === 0 && <p className="source-empty">Drawings you add appear here, one row per sheet.</p>}
        </section>

        <section className="source types">
          <div className="source-head">
            <h2>Takeoff types</h2>
            <button className="icon-button small" onClick={addType} title="New takeoff type" aria-label="New takeoff type">
              <Icon name="plus" size={16} />
            </button>
          </div>
          <ul className="source-list">
            {project.types.map((t) => {
              const tt = totalFor(t.id);
              return (
                <li key={t.id} className="type-item">
                  <button className={`source-row ${t.id === activeTypeId ? 'active' : ''}`} onClick={() => chooseType(t)} title={`Take off ${t.name}`}>
                    <span className="dot" style={{ background: t.color }} />
                    <span className="row-main">
                      <span className="row-title type-name">{t.name}</span>
                      <span className="row-sub">
                        {t.kind === 'area' ? 'Area' : t.kind === 'linear' ? 'Length' : 'Count'}
                        {tt && tt.vars.N > 0 ? ` · ${formatQty(tt.primary)} ${tt.unit}` : ''}
                      </span>
                    </span>
                  </button>
                  <span className="row-actions-hover">
                    <button className="icon-button small" title="Edit type" aria-label={`Edit ${t.name}`} onClick={() => setEditingTypeId(t.id)}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="icon-button small danger" title="Delete type and its takeoffs" aria-label={`Delete ${t.name}`} onClick={() => deleteType(t.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </aside>

      <main className="stage">
        <Viewer
          page={page}
          sheet={sheet}
          measurements={sheetMeasurements}
          types={project.types}
          activeType={activeType}
          units={project.units}
          tool={tool}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setEditingTypeId(null);
          }}
          onAdd={addMeasurement}
          onReplacePoints={(id, points) =>
            commit((p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, points } : m)) }), 'Fill room')
          }
          getWallModel={() => (page && sheet ? wallModelFor(page, sheet, maxOpening) : null)}
          onAddHole={(id, ring) =>
            commit(
              (p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, holes: [...m.holes, ring] } : m)) }),
              'Cutout',
            )
          }
          onDelete={(id) => deleteMeasurements([id])}
          onCalibrate={(mpp, label) => sheet && updateSheet(sheet.id, { metersPerPoint: mpp, scaleLabel: label, scaleSource: 'calibrated' }, 'Calibrate')}
          onToolDone={() => setTool('select')}
          onFindSymbols={(box) => void countSymbols(box)}
        />

        {project.sheets.length === 0 && (
          <div className="welcome">
            <div className="welcome-card">
              <div className="welcome-icon">
                <Icon name="doc" size={28} />
              </div>
              <h1>Start a takeoff</h1>
              <p>
                Add a PDF drawing set. Every page becomes a sheet, with its number and scale read for you. Measure by hand, fill rooms with a click, or let
                Wall takeoff measure every tagged wall.
              </p>
              <button className="primary large" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={18} /> Add drawings
              </button>
              <p className="welcome-foot">
                {project.units === 'metric' ? 'Metric project (m, m²).' : 'Imperial project (ft, SF).'} Drawings stay in this browser.
              </p>
            </div>
          </div>
        )}

        {tool === 'fill' && page && (
          <div className="tool-options">
            <label htmlFor="max-opening">Close openings up to</label>
            <input
              id="max-opening"
              type="number"
              min={0.5}
              step={project.units === 'metric' ? 0.5 : 1}
              value={project.units === 'metric' ? maxOpening : Math.round(maxOpening / 0.3048)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setMaxOpening(project.units === 'metric' ? v : v * 0.3048);
              }}
            />
            <span>{project.units === 'metric' ? 'm' : 'ft'}</span>
          </div>
        )}

        {page && <div className="hint-pill">{toolHint(tool, activeType, sheet)}</div>}
        {busy && (
          <div className="busy">
            <span className="spinner small" /> {busy}
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <span>{toast.text}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
            {toast.sticky && (
              <button aria-label="Dismiss" onClick={() => setToast(null)}>
                Later
              </button>
            )}
            {toast.undo && (
              <button
                onClick={() => {
                  undo();
                  setToast(null);
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </main>

      <aside className="inspector-pane">
        {editingType ? (
          <TypeEditor
            type={editingType}
            units={project.units}
            totals={totalFor(editingType.id)?.vars}
            onChange={updateType}
            onDelete={() => deleteType(editingType.id)}
            onClose={() => setEditingTypeId(null)}
          />
        ) : (
          <Inspector
            tab={tab}
            onTab={setTab}
            project={project}
            sheet={sheet}
            totals={totals}
            activity={activity}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={deleteMeasurements}
            onRetype={(id, typeId) => commit((p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, typeId } : m)) }), 'Change type')}
            onEditType={setEditingTypeId}
            onEditFinishes={() => setAiDialog('finishes')}
            onFindSimilar={(id) => void addSimilar(id)}
            canFindSimilar={!!page && !!sheet?.metersPerPoint && !busy}
          />
        )}
      </aside>

      {popover === 'scale' && sheet && (
        <Popover anchor={scaleButton} onClose={() => setPopover(null)} width={340} label="Drawing scale">
          <ScalePicker
            sheet={sheet}
            units={project.units}
            onPick={(label, mpp) => {
              updateSheet(sheet.id, { metersPerPoint: mpp, scaleLabel: label, scaleSource: 'preset' }, 'Scale');
              setPopover(null);
            }}
            onCalibrate={() => {
              setPopover(null);
              setTool('calibrate');
            }}
            onClear={() => {
              updateSheet(sheet.id, { metersPerPoint: null, scaleLabel: null, scaleSource: null }, 'Scale');
              setPopover(null);
            }}
          />
        </Popover>
      )}
      {popover === 'projects' && (
        <Popover anchor={projectsButton} onClose={() => setPopover(null)} width={400} label="Projects">
          <ProjectsPanel
            currentId={project.id}
            persisted={persisted}
            onOpen={(id) => {
              setPopover(null);
              void switchProject(id);
            }}
            onNew={(units) => {
              setPopover(null);
              void startNewProject(units);
            }}
            onDelete={(id) => void removeProject(id)}
            onSaveFile={() => {
              setPopover(null);
              void saveProjectFile();
            }}
            onOpenFile={() => {
              setPopover(null);
              projectFileInput.current?.click();
            }}
          />
        </Popover>
      )}
      {popover === 'automate' && sheet && (
        <Popover anchor={automateButton} onClose={() => setPopover(null)} width={360} label="Automate">
          <div className="automate-menu" role="menu">
            {[
              {
                id: 'assemblies' as const,
                icon: 'sparkle' as const,
                title: sheet.aiAssemblies ? 'Assembly types (saved)' : 'Read assembly types',
                text: 'On a legend sheet: Claude reads every wall, floor, roof and ceiling type into takeoff types with their materials.',
                ready: !!page,
              },
              {
                id: 'walls' as const,
                icon: 'walls' as const,
                title: 'Wall takeoff',
                text: 'On a plan: measures every tagged wall on its centreline, by type.',
                ready: !!page && !!sheet.metersPerPoint,
              },
              {
                id: 'rooms' as const,
                icon: 'area' as const,
                title: 'Rooms',
                text: 'On a plan: fills every tagged room and adds it as a named area.',
                ready: !!page && !!sheet.metersPerPoint,
              },
              {
                id: 'finishes' as const,
                icon: 'list' as const,
                title: 'Room finishes',
                text: 'Floor, base, walls and ceiling for every room, typed in or read from the finish schedule.',
                ready: true,
              },
            ].map((a) => (
              <button
                key={a.id}
                role="menuitem"
                className="automate-item"
                disabled={!a.ready}
                onClick={() => {
                  setPopover(null);
                  setAiDialog(a.id);
                }}
              >
                <span className="automate-icon">
                  <Icon name={a.icon} size={18} />
                </span>
                <span className="automate-text">
                  <span className="automate-title">{a.title}</span>
                  <span className="automate-desc">{a.ready ? a.text : 'Set this sheet’s scale first.'}</span>
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
      {popover === 'more' && (
        <Menu
          anchor={moreButton}
          onClose={() => setPopover(null)}
          label="More"
          groups={[
            [
              { label: 'History', hint: 'Every change', onSelect: () => setTab('history') },
              { label: 'Keyboard shortcuts', onSelect: () => setAiDialog('shortcuts') },
              ...(canUseServiceWorker() && !isInstalled() ? [{ label: 'Install as an app…', onSelect: () => void installApp() }] : []),
              ...(isHosted ? [] : [{ label: 'AI settings…', onSelect: () => setAiDialog('settings') }]),
            ],
            project.docs.map((d) => ({ label: `Remove ${d.name}…`, danger: true, onSelect: () => void removeDrawings(d.id) })),
            [
              { label: 'Projects…', onSelect: () => setPopover('projects') },
              { label: 'Save project to file…', onSelect: () => void saveProjectFile() },
              { label: 'Open project file…', onSelect: () => projectFileInput.current?.click() },
            ],
          ].filter((g) => g.length)}
        />
      )}

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
            commit(
              (p) => ({
                ...p,
                types: [...p.types, ...types],
                measurements: [...p.measurements.filter((m) => !(replaceEarlier && m.sheetId === sheet.id && m.source === 'walls')), ...measurements],
              }),
              'Wall takeoff',
            )
          }
          onClose={() => setAiDialog(null)}
        />
      )}
      {aiDialog === 'rooms' && page && sheet && (
        <RoomsDialog
          page={page}
          sheet={sheet}
          units={project.units}
          types={project.types}
          earlier={project.measurements.filter((m) => m.sheetId === sheet.id && m.source === 'rooms').length}
          palette={PALETTE}
          maxOpening={maxOpening}
          onApply={({ types, measurements, replaceEarlier }) =>
            commit(
              (p) => ({
                ...p,
                types: [...p.types, ...types],
                measurements: [...p.measurements.filter((m) => !(replaceEarlier && m.sheetId === sheet.id && m.source === 'rooms')), ...measurements],
              }),
              'Room takeoff',
            )
          }
          onClose={() => setAiDialog(null)}
        />
      )}
      {aiDialog === 'finishes' && (
        <RoomFinishesDialog
          project={project}
          palette={PALETTE}
          getPage={async (s) => (await pdfs.get(s.docId)?.getPage(s.page)) ?? null}
          onApply={({ types, finishes }) =>
            commit(
              (p) => ({
                ...p,
                types: [...p.types, ...types],
                measurements: p.measurements.map((m) => (finishes.has(m.id) ? { ...m, finishes: finishes.get(m.id) } : m)),
              }),
              'Room finishes',
            )
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
            commit((p) => {
              const byId = new Map(incoming.map((t) => [t.id, t]));
              const kept = p.types.map((t) => byId.get(t.id) ?? t);
              const added = incoming.filter((t) => !p.types.some((x) => x.id === t.id));
              return { ...p, types: [...kept, ...added] };
            }, 'Assembly types')
          }
          onSaveResult={(result) => updateSheet(sheet.id, { aiAssemblies: result }, 'Assembly types')}
          onClose={() => setAiDialog(null)}
          onOpenSettings={() => setAiDialog('settings')}
        />
      )}
      {aiDialog === 'settings' && <AiSettingsDialog onClose={() => setAiDialog(null)} />}
      {aiDialog === 'shortcuts' && <ShortcutsDialog onClose={() => setAiDialog(null)} />}
      <DialogHost />
    </div>
  );
}

function toolHint(tool: Tool, type: TakeoffType | null, sheet: Sheet | null): string {
  if (sheet && !sheet.metersPerPoint && tool !== 'calibrate') return 'Set this sheet’s scale before measuring';
  switch (tool) {
    case 'select':
      return 'Click a takeoff to select it · Delete removes it · Drag to pan · Scroll to zoom · F fits the sheet';
    case 'measure':
      if (!type) return 'Choose a takeoff type on the left';
      if (type.kind === 'count') return `Click each ${type.name.split(' – ')[0]} to count it`;
      return 'Click points · Double-click or Return to finish · Shift keeps lines straight · Esc cancels';
    case 'calibrate':
      return 'Click both ends of a dimension you know, then type its length';
    case 'symbol':
      if (type?.kind !== 'count') return 'Choose a count type on the left';
      return 'Drag a box around one symbol · every copy on this sheet is counted, turned or not';
    case 'cutout':
      return 'Draw the hole inside the selected area · Double-click or Return to finish';
    case 'fill':
      if (type?.kind !== 'area') return 'Choose an area type on the left';
      return 'Click inside a room · Shift-click the next space to join it';
  }
}
