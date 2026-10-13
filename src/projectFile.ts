import type { ActivityEvent } from './activity';
import { newId, type Project } from './model';

/**
 * A project file (.takeoff): a zip holding the project, its activity log and its
 * drawings, for backups and for moving a takeoff to another computer.
 *
 *   project.json   { format, version, savedAt, project, activity }
 *   drawings/<docId>.pdf
 */
const FORMAT = 'takeoff-ai-project';

export async function writeProjectFile(
  project: Project,
  activity: ActivityEvent[],
  loadPdf: (docId: string) => Promise<ArrayBuffer | undefined>,
): Promise<{ blob: Blob; missing: string[] }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify({ format: FORMAT, version: 1, savedAt: new Date().toISOString(), project, activity }));
  const missing: string[] = [];
  for (const d of project.docs) {
    const data = await loadPdf(d.id);
    if (data) zip.file(`drawings/${d.id}.pdf`, data);
    else missing.push(d.name);
  }
  // PDFs are already compressed; storing them is faster and barely larger.
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
  return { blob, missing };
}

export interface OpenedProject {
  project: Project;
  activity: ActivityEvent[];
  /** Drawing data by the project's (new) document ids. */
  pdfs: Map<string, ArrayBuffer>;
}

/**
 * Reads a project file as a new project: it gets fresh ids for itself and its
 * drawings, so opening the same file twice never ties two projects together.
 */
export async function readProjectFile(data: ArrayBuffer): Promise<OpenedProject> {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('That file is not a Takeoff AI project file.');
  }
  const head = zip.file('project.json');
  if (!head) throw new Error('That file is not a Takeoff AI project file.');
  const parsed = JSON.parse(await head.async('string')) as { format?: string; project?: Project; activity?: ActivityEvent[] };
  if (parsed.format !== FORMAT || !parsed.project) throw new Error('That file is not a Takeoff AI project file.');
  const docIds = new Map(parsed.project.docs.map((d) => [d.id, newId()]));
  const pdfs = new Map<string, ArrayBuffer>();
  for (const [oldId, id] of docIds) {
    const f = zip.file(`drawings/${oldId}.pdf`);
    if (f) pdfs.set(id, await f.async('arraybuffer'));
  }
  const project: Project = {
    ...parsed.project,
    id: newId(),
    docs: parsed.project.docs.map((d) => ({ ...d, id: docIds.get(d.id)! })),
    sheets: parsed.project.sheets.map((s) => ({ ...s, docId: docIds.get(s.docId) ?? s.docId })),
  };
  return { project, activity: parsed.activity ?? [], pdfs };
}

const BACKUP = 'takeoff-ai-backup';

/**
 * A backup of every project: one zip holding each project's .takeoff file, so it can
 * be restored whole or any one project opened from it on its own.
 *
 *   backup.json                 { format, version, savedAt, projects: names }
 *   projects/<n> <name>.takeoff
 */
export async function writeBackup(
  projects: { project: Project; activity: ActivityEvent[] }[],
  loadPdf: (docId: string) => Promise<ArrayBuffer | undefined>,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify({ format: BACKUP, version: 1, savedAt: new Date().toISOString(), projects: projects.map((p) => p.project.name) }));
  for (const [i, { project, activity }] of projects.entries()) {
    const { blob } = await writeProjectFile(project, activity, loadPdf);
    const safe = project.name.replace(/[^\w\- ]+/g, '').trim() || 'project';
    zip.file(`projects/${String(i + 1).padStart(2, '0')} ${safe}.takeoff`, await blob.arrayBuffer());
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}

/** Reads a project file or a backup of several, each as a new project. */
export async function readProjectFiles(data: ArrayBuffer): Promise<OpenedProject[]> {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('That file is not a Takeoff AI project file.');
  }
  if (!zip.file('backup.json')) return [await readProjectFile(data)];
  const entries = zip.file(/^projects\/.+\.takeoff$/).sort((a, b) => a.name.localeCompare(b.name));
  const out: OpenedProject[] = [];
  for (const e of entries) out.push(await readProjectFile(await e.async('arraybuffer')));
  if (!out.length) throw new Error('That backup has no projects in it.');
  return out;
}
