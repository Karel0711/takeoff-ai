import { describe, expect, it } from 'vitest';
import { runTool, toolList, TOOL_DEFS, type McpContext } from '../src/mcp/tools';
import { newProject, type Project, type Sheet } from '../src/model';
import { summarize } from '../src/storage';
import { parseScale } from '../src/units';

const sheet = (id: string, name: string, extra: Partial<Sheet> = {}): Sheet => ({
  id,
  docId: 'd1',
  page: 1,
  name,
  width: 3024,
  height: 2160,
  metersPerPoint: null,
  scaleLabel: null,
  scaleSource: null,
  scaleHints: ['1:100'],
  ...extra,
});

function fake(start?: Project) {
  let project: Project | null = start ?? {
    ...newProject('metric'),
    name: 'Kelso',
    docs: [{ id: 'd1', name: 'A-set.pdf' }],
    sheets: [sheet('s1', 'A2.1', { title: 'Ground Floor Plan' }), sheet('s2', 'A6.1', { title: 'Reflected Ceiling Plan', superseded: true })],
  };
  const history: Project[] = [];
  const shown: string[] = [];
  const projects = new Map<string, Project>();
  if (project) projects.set(project.id!, project);
  const ctx: McpContext = {
    project: () => project,
    commit: (fn) => {
      history.push(project!);
      project = fn(project!);
      projects.set(project.id!, project);
    },
    undo: () => {
      const prev = history.pop();
      if (!prev) return false;
      project = prev;
      return true;
    },
    listProjects: async () => [...projects.values()].map((p) => summarize(p, '2026-10-01', '2026-10-20')),
    openProject: async (id) => {
      const p = projects.get(id);
      if (p) project = p;
      return !!p;
    },
    createProject: async (name, units) => {
      project = { ...newProject(units), name };
      projects.set(project.id!, project);
      return project;
    },
    readPdf: async (p) => ({ name: p.split('/').pop()!, data: new ArrayBuffer(8) }),
    addDrawing: async (name) => {
      const s = sheet(`n${project!.sheets.length}`, 'A1.0', { metersPerPoint: parseScale('1:100'), scaleLabel: '1:100', scaleSource: 'detected' });
      ctx.commit((p) => ({ ...p, docs: [...p.docs, { id: 'd2', name }], sheets: [...p.sheets, s] }), 'Add drawings');
      return [s];
    },
    page: async () => null,
    doc: () => undefined,
    docs: () => [],
    texts: async (s) => (s.id === 's1' ? [{ str: 'ROOM 112 RECEIVING', cx: 500, cy: 400, w: 80, h: 6 }, { str: 'W1', cx: 300, cy: 200, w: 10, h: 5 }] : []),
    access: () => ({ page: async () => null, texts: async () => [], segments: async () => null }),
    render: async () => 'iVBORw0KGgo=',
    exportExcel: async () => '/Users/x/iCloud/Takeoff AI/Kelso (abc)/Exports/Kelso - takeoff.xlsx',
    showSheet: (id) => shown.push(id),
    projectFolder: async () => '/Users/x/iCloud/Takeoff AI/Kelso (abc)',
    maxOpening: () => 3,
  };
  return { ctx, get: () => project!, shown };
}

const textOf = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');

describe('MCP tools', () => {
  it('lists every tool with an object schema and unique name', () => {
    const list = toolList();
    expect(new Set(list.map((t) => t.name)).size).toBe(list.length);
    expect(list.length).toBe(TOOL_DEFS.length);
    for (const t of list) expect((t.inputSchema as { type: string }).type).toBe('object');
  });

  it('lists sheets, leaving out superseded ones unless asked', async () => {
    const { ctx } = fake();
    const r = await runTool(ctx, 'list_sheets', {});
    const sheets = (r.structuredContent as { sheets: { id: string; scale: string }[] }).sheets;
    expect(sheets.map((s) => s.id)).toEqual(['s1']);
    expect(sheets[0].scale).toBe('not set');
    const all = await runTool(ctx, 'list_sheets', { include_superseded: true, filter: 'ceiling' });
    expect((all.structuredContent as { sheets: unknown[] }).sheets).toHaveLength(1);
  });

  it('sets a scale, creates a type and adds an area takeoff with its quantity', async () => {
    const { ctx, get, shown } = fake();
    expect((await runTool(ctx, 'set_sheet_scale', { sheet_ids: ['s1'], scale: '1:100' })).isError).toBeUndefined();
    expect(get().sheets[0]).toMatchObject({ scaleLabel: '1:100', scaleSource: 'preset' });
    const made = await runTool(ctx, 'create_type', { name: 'Rooms', kind: 'area', division: '09 Finishes', items: [{ name: 'Floor', unit: 'm²', formula: 'A' }] });
    const typeId = (made.structuredContent as { type_id: string }).type_id;
    // 10 m × 10 m at 1:100: 10 m is 10000 mm on paper / 100 = 100 mm = 283.46 pt.
    const side = 0.1 / 0.0254 * 72;
    const r = await runTool(ctx, 'add_takeoff', { sheet_id: 's1', type_id: typeId, points: [[100, 100], [100 + side, 100], [100 + side, 100 + side], [100, 100 + side]], label: '112 Receiving' });
    expect(textOf(r)).toMatch(/100 m²/);
    const m = get().measurements[0];
    expect(m).toMatchObject({ source: 'ai', label: '112 Receiving' });
    expect(shown).toContain('s1');
    const q = await runTool(ctx, 'get_quantities', {});
    const rows = (q.structuredContent as { quantities: { type: string; total: number; items: { value: number }[] }[] }).quantities;
    expect(rows[0]).toMatchObject({ type: 'Rooms', total: 100 });
    expect(rows[0].items[0].value).toBe(100);
  });

  it('counts each point of a count takeoff and deletes and undoes', async () => {
    const { ctx, get } = fake();
    const t = (await runTool(ctx, 'create_type', { name: 'Doors', kind: 'count' })).structuredContent as { type_id: string };
    const r = await runTool(ctx, 'add_takeoff', { sheet_id: 's1', type_id: t.type_id, points: [[10, 10], [20, 20], [30, 30]] });
    expect(textOf(r)).toMatch(/Added 3 Doors takeoffs/);
    const ids = (r.structuredContent as { ids: string[] }).ids;
    expect((await runTool(ctx, 'delete_takeoffs', { ids: ids.slice(0, 2) })).isError).toBeUndefined();
    expect(get().measurements).toHaveLength(1);
    expect(textOf(await runTool(ctx, 'undo', {}))).toBe('Undone.');
    expect(get().measurements).toHaveLength(3);
  });

  it('gives errors a model can act on', async () => {
    const { ctx } = fake();
    expect(textOf(await runTool(ctx, 'add_takeoff', { sheet_id: 'nope', type_id: 'x', points: [[1, 1]] }))).toMatch(/list_sheets/);
    expect(textOf(await runTool(ctx, 'set_sheet_scale', { sheet_ids: ['s1'], scale: 'big' }))).toMatch(/Could not read the scale/);
    const t = (await runTool(ctx, 'create_type', { name: 'Slab', kind: 'area' })).structuredContent as { type_id: string };
    const r = await runTool(ctx, 'add_takeoff', { sheet_id: 's1', type_id: t.type_id, points: [[1, 1], [2, 2]] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/at least 3 points/);
    expect(textOf(await runTool(ctx, 'add_takeoff', { sheet_id: 's1', type_id: t.type_id, points: [[1, 1], [2, 2], [99999, 5]] }))).toMatch(/off the sheet/);
    expect(textOf(await runTool(ctx, 'create_type', { name: 'slab', kind: 'area' }))).toMatch(/already exists/);
    expect(textOf(await runTool(ctx, 'run_automation', { kind: 'rooms' }))).toMatch(/sheet_id/);
    expect(textOf(await runTool(ctx, 'run_automation', { kind: 'rooms', sheet_id: 's1' }))).toMatch(/not open/);
  });

  it('reads and searches sheet text with positions', async () => {
    const { ctx } = fake();
    const one = await runTool(ctx, 'get_sheet_text', { sheet_id: 's1' });
    expect(JSON.parse(textOf(one))).toEqual([
      { text: 'ROOM 112 RECEIVING', x: 500, y: 400, h: 6 },
      { text: 'W1', x: 300, y: 200, h: 5 },
    ]);
    const hits = JSON.parse(textOf(await runTool(ctx, 'get_sheet_text', { query: 'receiving' })));
    expect(hits).toEqual([{ sheet_id: 's1', sheet: 'A2.1', text: 'ROOM 112 RECEIVING', x: 500, y: 400, h: 6 }]);
    expect((await runTool(ctx, 'get_sheet_text', {})).isError).toBe(true);
  });

  it('returns a sheet image with how its pixels map to sheet points', async () => {
    const { ctx } = fake();
    const r = await runTool(ctx, 'get_sheet_image', { sheet_id: 's1', region: [1000, 500, 1800, 1100], max_px: 1600 });
    expect(r.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(textOf(r)).toMatch(/2 px per pt: sheet x = 1000 \+ px \/ 2, sheet y = 500 \+ py \/ 2/);
  });

  it('creates, lists and opens projects and adds drawings by path', async () => {
    const { ctx, get } = fake();
    const first = get().id!;
    await runTool(ctx, 'create_project', { name: 'Sixteen Mile Creek', units: 'imperial' });
    expect(get()).toMatchObject({ name: 'Sixteen Mile Creek', units: 'imperial' });
    expect(textOf(await runTool(ctx, 'add_drawings', { paths: ['/Users/x/bids/S-set.pdf'] }))).toMatch(/S-set.pdf: 1 sheets, 1 with a scale read, 0 to set/);
    const listed = (await runTool(ctx, 'list_projects', {})).structuredContent as { projects: { id: string; open: boolean }[] };
    expect(listed.projects).toHaveLength(2);
    expect(listed.projects.find((p) => p.open)?.id).toBe(get().id);
    expect(textOf(await runTool(ctx, 'open_project', { project_id: first }))).toMatch(/Opened "Kelso"/);
    const summary = (await runTool(ctx, 'project_summary', {})).structuredContent as { folder: string; sheets_without_scale: string[] };
    expect(summary.folder).toMatch(/Kelso/);
    expect(summary.sheets_without_scale).toEqual(['A2.1']);
    expect(textOf(await runTool(ctx, 'export_excel', {}))).toMatch(/Exports\/Kelso - takeoff.xlsx/);
  });

  it('asks for a project when none is open', async () => {
    const { ctx } = fake();
    (ctx as { project: () => Project | null }).project = () => null;
    expect(textOf(await runTool(ctx, 'list_sheets', {}))).toMatch(/No project is open/);
  });
});
