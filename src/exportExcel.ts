import type { ActivityEvent } from './activity';
import type { Workbook, Worksheet } from 'exceljs';
import { FINISH_ROLES, type Project, type TakeoffType } from './model';
import { contributions, measurementVars, primaryOf, primaryUnit, sheetRepeat, typeTotals } from './quantities';

/*
 * The workbook follows the estimator's bid workbook conventions: a Bid Summary
 * linked to one tab per division; each division tab has the columns Mark …
 * Notes, blue GROUP rows per subtrade package, imperial pricing formulas and a
 * subtotal that skips GROUP rows. Yellow cells are the estimator's inputs.
 */

const COLOR = {
  title: 'FF1F4E79',
  header: 'FFD9E1F2',
  group: 'FFBDD7EE',
  groupText: 'FF1F3864',
  input: 'FFFFF2CC',
  white: 'FFFFFFFF',
};
const QTY = '#,##0.000';
const MONEY = '$#,##0.00';

const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

const DIVISION_COLUMNS: [string, number][] = [
  ['Mark', 9],
  ['Item (as measured)', 46],
  ['Assembly type - per schedule', 36],
  ['Assembly description', 60],
  ['Dwg', 9],
  ['Source package', 14],
  ['Inst', 6],
  ['Measured qty', 13],
  ['Unit', 6],
  ['Height', 9],
  ['Qty for pricing (IMPERIAL)', 14],
  ['Unit (imp)', 7],
  ['Unit rate MATERIAL $ / imp unit', 14],
  ['Unit rate LABOUR $ / imp unit', 14],
  ['Unit rate $ / imp unit (MAT+LAB, or all-in)', 16],
  ['Incl?', 6],
  ['Amount $', 15],
  ['Qty (metric)', 13],
  ['Unit (metric)', 8],
  ['Unit rate (metric) $', 13],
  ['Notes', 60],
];

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique in the book. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31).trim() || 'Sheet';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 28)} ${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

const divisionTitle = (division: string) => {
  const m = /^([\d-]+)\s+(.*)$/.exec(division);
  return m ? `${m[1]} - ${m[2].toUpperCase()}` : division.toUpperCase();
};

/** A linear type priced as wall area (its height matters) when its assembly uses A or H. */
const pricedByHeight = (t: TakeoffType) => t.kind === 'linear' && t.items.some((i) => /\b(A|H|Area|Height)\b/.test(i.formula));

const unitLabel = (t: TakeoffType, project: Project) =>
  t.kind === 'count' ? 'EA' : project.units === 'metric' ? (t.kind === 'area' ? 'M2' : 'M') : t.kind === 'area' ? 'SF' : 'LF';

const markOf = (name: string) => {
  const head = name.split(' – ')[0].trim();
  return head !== name.trim() ? head : '';
};

interface Row {
  type: TakeoffType;
  sheetName: string;
  inst: number;
  qty: number;
  unscaled: number;
}

/** One row per takeoff type and drawing sheet, in sheet order. Rooms count toward their finish types. */
function measuredRows(project: Project): Map<string, Row[]> {
  const byType = new Map<string, Row[]>();
  const all = contributions(project);
  for (const sheet of project.sheets) {
    const onSheet = new Map<string, typeof all>();
    for (const c of all) {
      if (c.sheet.id !== sheet.id) continue;
      const list = onSheet.get(c.type.id);
      if (list) list.push(c);
      else onSheet.set(c.type.id, [c]);
    }
    for (const type of project.types) {
      const cs = onSheet.get(type.id);
      if (!cs) continue;
      let qty = 0;
      let unscaled = 0;
      for (const c of cs) {
        if (c.vars) qty += primaryOf(type.kind, c.vars);
        else unscaled++;
      }
      const k = sheetRepeat(sheet);
      const row = { type, sheetName: k > 1 ? `${sheet.name} ×${k}` : sheet.name, inst: cs.length * k, qty, unscaled };
      const list = byType.get(type.id);
      if (list) list.push(row);
      else byType.set(type.id, [row]);
    }
  }
  return byType;
}

function writeTitle(ws: Worksheet, title: string, lines: string[]) {
  ws.getCell('A1').value = title;
  ws.getRow(1).font = { bold: true, size: 13, color: { argb: COLOR.white } };
  ws.getRow(1).fill = solid(COLOR.title);
  lines.forEach((line, i) => {
    ws.getCell(`A${i + 2}`).value = line;
    ws.getCell(`A${i + 2}`).font = { italic: true, size: 9 };
  });
}

function writeDivision(ws: Worksheet, division: string, types: TakeoffType[], rows: Map<string, Row[]>, project: Project): number {
  writeTitle(ws, divisionTitle(division), [
    'Yellow cells are yours to change: Height, unit rates and Incl?. Quantities come from Takeoff AI measurements.',
    `${project.name} · exported ${new Date().toISOString().slice(0, 10)} · measured in ${project.units === 'metric' ? 'metric' : 'imperial'} units`,
  ]);
  ws.columns = DIVISION_COLUMNS.map(([, width]) => ({ width }));
  const header = ws.getRow(4);
  header.values = DIVISION_COLUMNS.map(([name]) => name);
  header.font = { bold: true };
  header.fill = solid(COLOR.header);
  header.alignment = { wrapText: true, vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  let r = 5;
  const first = r;
  const writeItem = (row: Row) => {
    const t = row.type;
    const height = pricedByHeight(t) ? t.height : null;
    const notes = row.unscaled ? `${row.unscaled} measurement(s) on this sheet have no scale and are not counted.` : '';
    const cells: Record<string, unknown> = {
      A: markOf(t.name),
      B: t.name,
      C: t.assemblyTitle ?? '',
      D: t.description ?? '',
      E: row.sheetName,
      F: 'Takeoff AI',
      G: row.inst,
      H: row.qty,
      I: unitLabel(t, project),
      J: height,
      K: { formula: `IF(S${r}="M2",R${r}*10.7639,IF(S${r}="M",R${r}*3.28084,IF(S${r}="M3",R${r}*35.3147,R${r})))` },
      L: { formula: `IF(S${r}="M2","SF",IF(S${r}="M","LF",IF(S${r}="M3","CF",S${r})))` },
      M: null,
      N: null,
      O: { formula: `M${r}+N${r}` },
      P: 1,
      Q: { formula: `K${r}*O${r}*P${r}` },
      R: { formula: `IF(J${r}="",H${r},H${r}*J${r})` },
      S: { formula: `IF(J${r}="",I${r},IF(I${r}="M","M2",IF(I${r}="LF","SF",I${r})))` },
      T: { formula: `IF(S${r}="M2",O${r}*10.7639,IF(S${r}="M",O${r}*3.28084,IF(S${r}="M3",O${r}*35.3147,O${r})))` },
      U: notes,
    };
    for (const [col, value] of Object.entries(cells)) ws.getCell(`${col}${r}`).value = value as never;
    for (const col of ['H', 'K', 'R']) ws.getCell(`${col}${r}`).numFmt = QTY;
    for (const col of ['M', 'N', 'O', 'Q', 'T']) ws.getCell(`${col}${r}`).numFmt = MONEY;
    for (const col of ['J', 'M', 'N', 'P']) ws.getCell(`${col}${r}`).fill = solid(COLOR.input);
    r++;
  };

  // Types without a package first, then one GROUP per subtrade package.
  const loose = types.filter((t) => !t.package);
  const packages = [...new Set(types.map((t) => t.package).filter((p): p is string => !!p))].sort();
  for (const t of loose) (rows.get(t.id) ?? []).forEach(writeItem);
  for (const pkg of packages) {
    const members = types.filter((t) => t.package === pkg).flatMap((t) => rows.get(t.id) ?? []);
    if (!members.length) continue;
    const g = r++;
    members.forEach(writeItem);
    const row = ws.getRow(g);
    ws.getCell(`A${g}`).value = 'GRP';
    ws.getCell(`B${g}`).value = `GROUP - ${pkg}`;
    ws.getCell(`P${g}`).value = 'GRP';
    ws.getCell(`Q${g}`).value = { formula: `SUM(Q${g + 1}:Q${r - 1})` };
    ws.getCell(`Q${g}`).numFmt = MONEY;
    ws.getCell(`U${g}`).value =
      `Group total of the ${members.length} row(s) below. When the subtrade price lands, set these rows to Incl? = 0 and enter the sub as one row in the group.`;
    row.fill = solid(COLOR.group);
    row.font = { bold: true, color: { argb: COLOR.groupText } };
  }

  const last = r - 1;
  const total = r;
  ws.getCell(`B${total}`).value = `${divisionTitle(division)}  -  SUBTOTAL`;
  ws.getCell(`Q${total}`).value =
    last >= first ? { formula: `SUM(Q${first}:Q${last})-SUMIF(P${first}:P${last},"GRP",Q${first}:Q${last})` } : 0;
  ws.getCell(`Q${total}`).numFmt = MONEY;
  ws.getRow(total).font = { bold: true };
  ws.getRow(total).border = { top: { style: 'thin' } };
  return total;
}

/** Builds the workbook; separate from the Blob step so it can be tested in Node. */
export async function buildWorkbook(project: Project, activity: ActivityEvent[] = []): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const used = new Set<string>();
  const rows = measuredRows(project);

  const summary = wb.addWorksheet(sheetName('Bid Summary', used));

  // Divisions in estimate order; types with no division go to "Unassigned".
  const divisions = new Map<string, TakeoffType[]>();
  for (const t of project.types) {
    if (!rows.has(t.id)) continue;
    const d = t.division?.trim() || 'Unassigned';
    divisions.set(d, [...(divisions.get(d) ?? []), t]);
  }
  const ordered = [...divisions.keys()].sort((a, b) =>
    a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b, undefined, { numeric: true }),
  );
  const subtotals: { division: string; ref: string }[] = [];
  for (const division of ordered) {
    const ws = wb.addWorksheet(sheetName(division, used));
    const totalRow = writeDivision(ws, division, divisions.get(division)!, rows, project);
    subtotals.push({ division, ref: `${quoteSheet(ws.name)}!Q${totalRow}` });
  }

  writeTitle(summary, 'Bid Summary', [
    'Cost = the division tab subtotal. Markup is yours to set (yellow). Total = Cost x (1 + Markup). HST extra.',
    project.name,
  ]);
  summary.columns = [{ width: 46 }, { width: 18 }, { width: 10 }, { width: 18 }, { width: 18 }, { width: 60 }];
  const sh = summary.getRow(4);
  sh.values = ['Division', 'Cost $', 'Markup', 'Markup $', 'Total $', 'Comment'];
  sh.font = { bold: true };
  sh.fill = solid(COLOR.header);
  summary.views = [{ state: 'frozen', ySplit: 4 }];
  let r = 5;
  for (const { division, ref } of subtotals) {
    summary.getCell(`A${r}`).value = divisionTitle(division);
    summary.getCell(`B${r}`).value = { formula: ref };
    summary.getCell(`C${r}`).value = 0.2;
    summary.getCell(`C${r}`).fill = solid(COLOR.input);
    summary.getCell(`C${r}`).numFmt = '0%';
    summary.getCell(`D${r}`).value = { formula: `E${r}-B${r}` };
    summary.getCell(`E${r}`).value = { formula: `B${r}*(1+C${r})` };
    for (const c of ['B', 'D', 'E']) summary.getCell(`${c}${r}`).numFmt = MONEY;
    r++;
  }
  const t = r;
  summary.getCell(`A${t}`).value = 'Construction subtotal (all divisions, markup included)';
  if (subtotals.length) {
    summary.getCell(`B${t}`).value = { formula: `SUM(B5:B${t - 1})` };
    summary.getCell(`C${t}`).value = { formula: `IF(B${t}=0,0,E${t}/B${t}-1)` };
    summary.getCell(`D${t}`).value = { formula: `SUM(D5:D${t - 1})` };
    summary.getCell(`E${t}`).value = { formula: `SUM(E5:E${t - 1})` };
  }
  summary.getCell(`C${t}`).numFmt = '0.0%';
  for (const c of ['B', 'D', 'E']) summary.getCell(`${c}${t}`).numFmt = MONEY;
  summary.getRow(t).font = { bold: true };
  summary.getRow(t).border = { top: { style: 'thin' } };

  // Material breakdown from each type's assembly.
  const materials = wb.addWorksheet(sheetName('Assembly Materials', used));
  materials.columns = [
    { header: 'Division', key: 'division', width: 28 },
    { header: 'Package', key: 'pkg', width: 24 },
    { header: 'Takeoff type', key: 'type', width: 50 },
    { header: 'Item', key: 'item', width: 44 },
    { header: 'Quantity', key: 'qty', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Formula', key: 'formula', width: 30 },
  ];
  for (const tt of typeTotals(project)) {
    if (tt.vars.N === 0) continue;
    for (const it of tt.items) {
      materials.addRow({
        division: tt.type.division ?? '',
        pkg: tt.type.package ?? '',
        type: tt.type.name,
        item: it.name,
        qty: it.value ?? `ERROR: ${it.error}`,
        unit: it.unit,
        formula: it.formula,
      });
    }
  }
  materials.getRow(1).font = { bold: true };
  materials.getRow(1).fill = solid(COLOR.header);
  materials.views = [{ state: 'frozen', ySplit: 1 }];

  // Every measurement, for checking.
  const detail = wb.addWorksheet(sheetName('Measurements', used));
  detail.columns = [
    { header: 'Sheet', key: 'sheet', width: 10 },
    { header: 'Takeoff type', key: 'type', width: 50 },
    { header: 'Name', key: 'label', width: 34 },
    { header: 'Quantity', key: 'qty', width: 14, style: { numFmt: '#,##0.000' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Sheet counts', key: 'times', width: 12 },
    { header: 'Perimeter', key: 'perim', width: 12, style: { numFmt: '#,##0.000' } },
    { header: 'Sheet scale', key: 'scale', width: 16 },
  ];
  const roleLabel = new Map(FINISH_ROLES.map((r) => [r.role, r.label.toLowerCase()]));
  const all = contributions(project);
  for (const s of project.sheets) {
    for (const c of all) {
      if (c.sheet.id !== s.id) continue;
      const { type, vars: v } = c;
      detail.addRow({
        sheet: s.name,
        type: type.name,
        label: [c.m.label, c.role ? `(${roleLabel.get(c.role)})` : ''].filter(Boolean).join(' '),
        // As drawn, the same as the app shows for the takeoff; a typical floor's count is beside it.
        qty: v ? primaryOf(type.kind, v) / sheetRepeat(s) : 'not scaled',
        unit: primaryUnit(type.kind, project.units),
        times: sheetRepeat(s),
        perim: type.kind === 'area' && v ? v.P / sheetRepeat(s) : null,
        scale: s.scaleLabel ?? '',
      });
    }
  }
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = solid(COLOR.header);
  detail.views = [{ state: 'frozen', ySplit: 1 }];

  // Room finish schedule: every named area with its finishes.
  const typeById = new Map(project.types.map((t) => [t.id, t]));
  const sheetById = new Map(project.sheets.map((x) => [x.id, x]));
  const rooms = project.measurements.filter((m) => typeById.get(m.typeId)?.kind === 'area' && (m.label || m.source === 'rooms' || m.finishes));
  if (rooms.length) {
    const ws = wb.addWorksheet(sheetName('Room Finishes', used));
    const area = project.units === 'metric' ? 'm²' : 'SF';
    const len = project.units === 'metric' ? 'm' : 'LF';
    ws.columns = [
      { header: 'Room', key: 'room', width: 40 },
      { header: 'Sheet', key: 'sheet', width: 10 },
      { header: `Area (${area})`, key: 'area', width: 12, style: { numFmt: '#,##0.00' } },
      { header: `Perimeter (${len})`, key: 'perim', width: 14, style: { numFmt: '#,##0.00' } },
      { header: `Doorways (${len})`, key: 'doorways', width: 14, style: { numFmt: '#,##0.00' } },
      ...FINISH_ROLES.map((r) => ({ header: r.label, key: r.role, width: 30 })),
    ];
    const sorted = [...rooms].sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', undefined, { numeric: true }));
    for (const m of sorted) {
      const sheet = sheetById.get(m.sheetId);
      const type = typeById.get(m.typeId)!;
      const v = sheet ? measurementVars(m, type, sheet, project.units) : null;
      ws.addRow({
        room: m.label ?? '',
        sheet: sheet ? (sheetRepeat(sheet) > 1 ? `${sheet.name} ×${sheetRepeat(sheet)}` : sheet.name) : '',
        area: v ? v.A : 'not scaled',
        perim: v ? v.P : null,
        doorways: v?.O || null,
        ...Object.fromEntries(FINISH_ROLES.map((r) => [r.role, m.finishes?.[r.role] ? (typeById.get(m.finishes[r.role]!)?.name ?? '') : ''])),
      });
    }
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = solid(COLOR.header);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // The activity log: every takeoff added, changed or deleted, newest first.
  if (activity.length) {
    const log = wb.addWorksheet(sheetName('Activity', used));
    log.columns = [
      { header: 'When', key: 'at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
      { header: 'Action', key: 'action', width: 10 },
      { header: 'What', key: 'what', width: 10 },
      { header: 'Name', key: 'name', width: 40 },
      { header: 'Sheet', key: 'sheet', width: 10 },
      { header: 'Detail', key: 'detail', width: 24 },
      { header: 'By', key: 'source', width: 16 },
    ];
    for (const e of [...activity].reverse()) {
      log.addRow({ at: new Date(e.at), action: e.action, what: e.what, name: e.name, sheet: e.sheet ?? '', detail: e.detail ?? '', source: e.source });
    }
    log.getRow(1).font = { bold: true };
    log.getRow(1).fill = solid(COLOR.header);
    log.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return wb;
}

export async function exportWorkbook(project: Project, activity: ActivityEvent[] = []): Promise<Blob> {
  const wb = await buildWorkbook(project, activity);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
