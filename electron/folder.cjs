// The shared projects folder (in iCloud Drive, say): one subfolder per project.
//
//   <folder>/<Project name> (<id>)/meta.json        { id, name, savedAt }   read to list projects
//   <folder>/<Project name> (<id>)/project.json     { format, version, savedAt, project, activity }
//   <folder>/<Project name> (<id>)/drawings/<docId>.pdf
//   <folder>/<Project name> (<id>)/.versions/<time>.json   earlier project.json, every 10 minutes, the last 50
//
// Every path is checked to stay inside the folder. Files are written to a temporary name
// and renamed, so a sync service never picks up half a file.
const fs = require('node:fs/promises');
const path = require('node:path');

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** A path inside `root`, refusing anything that would step outside it. */
function inside(root, ...parts) {
  const base = path.resolve(root);
  const full = path.resolve(base, ...parts);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Path outside the projects folder');
  return full;
}

/** A readable folder name for a new project: its name, with its id to keep it unique. */
function dirFor(name, id) {
  if (!SAFE_ID.test(id)) throw new Error('Bad project id');
  const clean = String(name || 'Untitled project')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  return `${clean || 'Untitled project'} (${id.slice(0, 8)})`;
}

async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** Every project in the folder, from its meta.json; folders without one are skipped. */
async function list(root) {
  let entries;
  try {
    entries = await fs.readdir(inside(root), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    try {
      const meta = JSON.parse(await fs.readFile(inside(root, e.name, 'meta.json'), 'utf8'));
      if (meta && SAFE_ID.test(meta.id) && typeof meta.savedAt === 'string') out.push({ dir: e.name, id: meta.id, name: String(meta.name ?? ''), savedAt: meta.savedAt });
    } catch {
      // Not a project folder, or one still arriving from the other computer.
    }
  }
  return out;
}

async function readProject(root, dir) {
  try {
    return await fs.readFile(inside(root, dir, 'project.json'), 'utf8');
  } catch {
    return null;
  }
}

const VERSION_EVERY_MS = 10 * 60 * 1000;
const VERSIONS_KEPT = 50;

/** Keeps the project as it was before this write, at most every 10 minutes, the last 50. */
async function keepVersion(root, dir, now) {
  const current = inside(root, dir, 'project.json');
  const versions = inside(root, dir, '.versions');
  let names = [];
  try {
    names = (await fs.readdir(versions)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    // No versions yet.
  }
  const newest = names.length ? Date.parse(names[names.length - 1].replace(/\.json$/, '').replace(/_/g, ':')) : 0;
  if (now - newest < VERSION_EVERY_MS) return;
  try {
    await fs.mkdir(versions, { recursive: true });
    const name = `${new Date(now).toISOString().replace(/:/g, '_')}.json`;
    await fs.copyFile(current, path.join(versions, name));
    names.push(name);
  } catch {
    return; // Nothing written yet.
  }
  for (const old of names.slice(0, Math.max(0, names.length - VERSIONS_KEPT))) await fs.rm(path.join(versions, old), { force: true });
}

/** Writes the project, then its meta.json (so a listed project is always complete). */
async function writeProject(root, dir, json, meta, now = Date.now()) {
  if (!SAFE_ID.test(meta.id)) throw new Error('Bad project id');
  await keepVersion(root, dir, now);
  await writeAtomic(inside(root, dir, 'project.json'), json);
  await writeAtomic(inside(root, dir, 'meta.json'), JSON.stringify({ id: meta.id, name: meta.name, savedAt: meta.savedAt }));
}

const pdfPath = (root, dir, docId) => {
  if (!SAFE_ID.test(docId)) throw new Error('Bad drawing id');
  return inside(root, dir, 'drawings', `${docId}.pdf`);
};

async function hasPdf(root, dir, docId) {
  try {
    await fs.access(pdfPath(root, dir, docId));
    return true;
  } catch {
    return false;
  }
}

async function readPdf(root, dir, docId) {
  try {
    return await fs.readFile(pdfPath(root, dir, docId));
  } catch {
    return null;
  }
}

async function writePdf(root, dir, docId, data) {
  await writeAtomic(pdfPath(root, dir, docId), Buffer.from(data));
}

/** Renames a project's folder (after the project is renamed), unless the new name is taken. */
async function rename(root, from, to) {
  const target = inside(root, to);
  try {
    await fs.access(target);
    return false;
  } catch {
    await fs.rename(inside(root, from), target);
    return true;
  }
}

module.exports = { inside, dirFor, list, readProject, writeProject, hasPdf, readPdf, writePdf, rename };
