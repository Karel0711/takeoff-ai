import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FolderSync, type FolderApi, type LocalStore } from '../src/folderSync';
import type { ActivityEvent } from '../src/activity';
import { newProject, type Project } from '../src/model';
import { summarize, type ProjectSummary, type SyncMark } from '../src/storage';

const folder = createRequire(import.meta.url)('../electron/folder.cjs') as {
  dirFor(name: string, id: string): string;
  inside(root: string, ...parts: string[]): string;
  list(root: string): Promise<{ dir: string; id: string; name: string; savedAt: string }[]>;
  readProject(root: string, dir: string): Promise<string | null>;
  writeProject(root: string, dir: string, json: string, meta: { id: string; name: string; savedAt: string }): Promise<void>;
  hasPdf(root: string, dir: string, docId: string): Promise<boolean>;
  readPdf(root: string, dir: string, docId: string): Promise<Buffer | null>;
  writePdf(root: string, dir: string, docId: string, data: ArrayBuffer): Promise<void>;
  rename(root: string, from: string, to: string): Promise<boolean>;
};

/** The shared folder, on disk, as the desktop app's main process serves it. */
function diskApi(root: string): FolderApi {
  return {
    getFolder: async () => root,
    chooseFolder: async () => root,
    revealFolder: async () => undefined,
    list: () => folder.list(root),
    dirFor: async (name, id) => folder.dirFor(name, id),
    read: (dir) => folder.readProject(root, dir),
    write: (dir, json, meta) => folder.writeProject(root, dir, json, meta),
    hasPdf: (dir, id) => folder.hasPdf(root, dir, id),
    readPdf: async (dir, id) => {
      const b = await folder.readPdf(root, dir, id);
      return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null;
    },
    writePdf: (dir, id, data) => folder.writePdf(root, dir, id, data),
    trash: async () => undefined,
    rename: (from, to) => folder.rename(root, from, to),
  };
}

/** One computer's database, in memory, saving the way src/storage.ts does. */
function computer(clock: () => string): LocalStore & { edit(p: Project): Promise<void>; projects: Map<string, Project> } {
  const projects = new Map<string, Project>();
  const index = new Map<string, ProjectSummary>();
  const activity = new Map<string, ActivityEvent[]>();
  const pdfs = new Map<string, ArrayBuffer>();
  const marks = new Map<string, SyncMark>();
  const save = async (p: Project, updatedAt: string) => {
    projects.set(p.id!, structuredClone(p));
    index.set(p.id!, summarize(p, index.get(p.id!)?.createdAt, updatedAt));
  };
  return {
    projects,
    edit: (p) => save(p, clock()),
    listProjects: async () => [...index.values()],
    loadProjectById: async (id) => structuredClone(projects.get(id)),
    saveProject: (p, { fromFolder }) => save(p, fromFolder),
    loadActivity: async (id) => activity.get(id) ?? [],
    saveActivity: async (id, e) => void activity.set(id, e),
    loadPdf: async (id) => pdfs.get(id),
    savePdf: async (id, d) => void pdfs.set(id, d),
    getSyncMark: async (id) => marks.get(id),
    setSyncMark: async (id, m) => void marks.set(id, m),
  };
}

const project = (name: string): Project => ({
  ...newProject('metric'),
  id: `p${Math.random().toString(36).slice(2, 10)}`,
  name,
  docs: [{ id: 'doc1', name: 'set.pdf' }],
});

describe('shared projects folder', () => {
  it('carries projects, drawings and edits between two computers, both ways', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    // The two computers' clocks disagree by a day; nothing should depend on them agreeing.
    const macClock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const pcClock = () => new Date(Date.UTC(2026, 9, 12, 12, 0, t++)).toISOString();
    const mac = computer(macClock);
    const pc = computer(pcClock);
    const macSync = new FolderSync(diskApi(root), mac, macClock);
    const pcSync = new FolderSync(diskApi(root), pc, pcClock);

    const p = project('Kelso Lodge');
    await mac.savePdf('doc1', new Uint8Array([1, 2, 3]).buffer);
    await mac.edit(p);
    await macSync.push(p.id!);

    // On disk: a readable folder with the project, its meta and its drawing.
    const [dir] = await readdir(root);
    expect(dir).toMatch(/^Kelso Lodge \(p/);
    expect(JSON.parse(await readFile(path.join(root, dir, 'meta.json'), 'utf8')).name).toBe('Kelso Lodge');
    expect([...(await readFile(path.join(root, dir, 'drawings', 'doc1.pdf')))]).toEqual([1, 2, 3]);

    // The PC picks it up, drawing included.
    expect(await pcSync.pull()).toEqual({ added: [p.id], updated: [], conflicts: [] });
    expect(pc.projects.get(p.id!)?.name).toBe('Kelso Lodge');
    expect(new Uint8Array((await pc.loadPdf('doc1'))!)).toEqual(new Uint8Array([1, 2, 3]));
    // Nothing changed since: pulling again on either side does nothing.
    expect(await pcSync.pull()).toEqual({ added: [], updated: [], conflicts: [] });
    expect(await macSync.pull()).toEqual({ added: [], updated: [], conflicts: [] });

    // An edit on the PC comes back to the Mac.
    await pc.edit({ ...pc.projects.get(p.id!)!, name: 'Kelso Lodge rev 2' });
    await pcSync.push(p.id!);
    expect(await macSync.pull()).toEqual({ added: [], updated: [p.id], conflicts: [] });
    expect(mac.projects.get(p.id!)?.name).toBe('Kelso Lodge rev 2');

    // Edited on both before either synced: the Mac keeps its own, and the PC's comes in beside it.
    await mac.edit({ ...mac.projects.get(p.id!)!, name: 'Mac edit' });
    await pc.edit({ ...pc.projects.get(p.id!)!, name: 'PC edit' });
    await pcSync.push(p.id!);
    const clash = await macSync.pull();
    expect(clash.added).toEqual([]);
    expect(clash.conflicts).toHaveLength(1);
    expect(mac.projects.get(p.id!)?.name).toBe('Mac edit');
    expect(mac.projects.get(clash.conflicts[0].copyId)?.name).toBe('PC edit (from the other computer)');
    // The copy has drawings of its own, so deleting it can't take the original's.
    expect(mac.projects.get(clash.conflicts[0].copyId)?.docs[0].id).not.toBe('doc1');
    // And the PC then gets the Mac's version and the copy.
    const after = await pcSync.pull();
    expect(after.added).toEqual([clash.conflicts[0].copyId]);
    expect(pc.projects.get(p.id!)?.name).toBe('Mac edit');
  });

  it('leaves the blank project the app opens with out of the folder', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const mac = computer(clock);
    const blank = { ...newProject('metric'), id: 'blank1234' };
    await mac.edit(blank);
    const sync = new FolderSync(diskApi(root), mac, clock);
    await sync.pull();
    expect(await readdir(root)).toEqual([]);
    await mac.edit({ ...blank, name: 'Kelso Lodge' });
    await sync.push(blank.id);
    expect(await readdir(root)).toEqual([folder.dirFor('Kelso Lodge', blank.id)]);
  });

  it('sends out a project made here that was never sent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const mac = computer(clock);
    const p = { ...project('Offline job'), docs: [] };
    await mac.edit(p);
    await new FolderSync(diskApi(root), mac, clock).pull();
    expect((await folder.list(root)).map((e) => e.name)).toEqual(['Offline job']);
  });

  it('waits for a drawing still on its way from the other computer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const p = project('Half synced');
    const dir = folder.dirFor(p.name, p.id!);
    await folder.writeProject(root, dir, JSON.stringify({ format: 'takeoff-ai-project', version: 1, savedAt: clock(), project: p, activity: [] }), {
      id: p.id!,
      name: p.name,
      savedAt: clock(),
    });
    const pc = computer(clock);
    expect((await new FolderSync(diskApi(root), pc, clock).pull()).added).toEqual([]);
    expect(pc.projects.size).toBe(0);
  });

  it('renames a project folder with its project, and keeps earlier versions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const mac = computer(clock);
    const sync = new FolderSync(diskApi(root), mac, clock);
    const p = { ...project('Bid draft'), docs: [] };
    await mac.edit(p);
    await sync.push(p.id!);
    await mac.edit({ ...p, name: 'Kelso Lodge' });
    await sync.push(p.id!);
    expect(await readdir(root)).toEqual([folder.dirFor('Kelso Lodge', p.id!)]);
    // One version per 10 minutes: the first overwrite kept the original, the next ones within 10 minutes don't add more.
    const dir = path.join(root, folder.dirFor('Kelso Lodge', p.id!));
    const versions = await readdir(path.join(dir, '.versions'));
    expect(versions).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(dir, '.versions', versions[0]), 'utf8')).project.name).toBe('Bid draft');
    const meta = { id: p.id!, name: 'Kelso Lodge', savedAt: clock() };
    await folder.writeProject(root, folder.dirFor('Kelso Lodge', p.id!), '{}', meta);
    expect(await readdir(path.join(dir, '.versions'))).toHaveLength(1);
    await (folder as unknown as { writeProject(...a: unknown[]): Promise<void> }).writeProject(root, folder.dirFor('Kelso Lodge', p.id!), '{}', meta, Date.now() + 11 * 60 * 1000);
    expect(await readdir(path.join(dir, '.versions'))).toHaveLength(2);
  });

  it('keeps every path inside the projects folder', () => {
    expect(() => folder.inside('/tmp/projects', '../elsewhere')).toThrow();
    expect(() => folder.dirFor('x', '../../etc')).toThrow();
    expect(folder.dirFor('A/B: "plans"', 'abcdefgh123')).toBe('A B plans (abcdefgh)');
  });
});
