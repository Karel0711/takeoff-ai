import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model';
import { readProjectFile, writeProjectFile } from '../src/projectFile';

describe('project files', () => {
  it('round-trips a project, its history and its drawings, as a new project', async () => {
    const p = { ...newProject('imperial'), name: 'Lodge' };
    const project = {
      ...p,
      docs: [{ id: 'd1', name: 'set.pdf' }],
      sheets: [{ id: 's1', docId: 'd1', page: 1, name: 'A2.1', width: 100, height: 100, metersPerPoint: null, scaleLabel: null, scaleSource: null, scaleHints: [] }],
    };
    const pdf = new Uint8Array([37, 80, 68, 70, 1, 2, 3]).buffer;
    const activity = [{ id: 'e', at: '2026-01-01T00:00:00Z', batch: 'b', source: 'Measure', action: 'created' as const, what: 'takeoff' as const, name: 'W1' }];
    const { blob, missing } = await writeProjectFile(project, activity, async (id) => (id === 'd1' ? pdf : undefined));
    expect(missing).toEqual([]);
    const opened = await readProjectFile(await blob.arrayBuffer());
    expect(opened.project.name).toBe('Lodge');
    expect(opened.project.units).toBe('imperial');
    expect(opened.project.id).not.toBe(project.id);
    const newDoc = opened.project.docs[0].id;
    expect(newDoc).not.toBe('d1');
    expect(opened.project.sheets[0].docId).toBe(newDoc);
    expect(new Uint8Array(opened.pdfs.get(newDoc)!)).toEqual(new Uint8Array(pdf));
    expect(opened.activity).toEqual(activity);
  });

  it('refuses files that are not project files', async () => {
    await expect(readProjectFile(new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow(/not a Takeoff AI project file/);
  });
});

describe('backups', () => {
  it('holds every project and restores each as a new project', async () => {
    const { writeBackup, readProjectFiles } = await import('../src/projectFile');
    const a = { ...newProject('metric'), name: 'Lodge' };
    const b = { ...newProject('imperial'), name: 'Garage' };
    const blob = await writeBackup(
      [
        { project: a, activity: [] },
        { project: b, activity: [] },
      ],
      async () => undefined,
    );
    const opened = await readProjectFiles(await blob.arrayBuffer());
    expect(opened.map((o) => [o.project.name, o.project.units])).toEqual([
      ['Lodge', 'metric'],
      ['Garage', 'imperial'],
    ]);
    expect(opened.every((o) => o.project.id !== a.id && o.project.id !== b.id)).toBe(true);
  });
});
