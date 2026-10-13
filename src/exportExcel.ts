import type { Project } from './model';
import { measurementVars, primaryOf, primaryUnit, typeTotals } from './quantities';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2933' } } as const;

/** Builds the takeoff workbook: summary by type, assembly materials, and every measurement. */
export async function exportWorkbook(project: Project): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const totals = typeTotals(project);

  const styleHeader = (ws: import('exceljs').Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = HEADER_FILL;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Takeoff type', key: 'name', width: 60 },
    { header: 'Kind', key: 'kind', width: 10 },
    { header: 'Quantity', key: 'qty', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Measurements', key: 'n', width: 14 },
    { header: 'Not scaled', key: 'unscaled', width: 12 },
  ];
  for (const t of totals) {
    summary.addRow({
      name: t.type.name,
      kind: t.type.kind,
      qty: t.primary,
      unit: t.unit,
      n: t.vars.N,
      unscaled: t.unscaled || '',
    });
  }
  styleHeader(summary);

  const materials = wb.addWorksheet('Assemblies');
  materials.columns = [
    { header: 'Takeoff type', key: 'type', width: 60 },
    { header: 'Item', key: 'item', width: 40 },
    { header: 'Quantity', key: 'qty', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Formula', key: 'formula', width: 30 },
  ];
  for (const t of totals) {
    for (const it of t.items) {
      materials.addRow({
        type: t.type.name,
        item: it.name,
        qty: it.value ?? `ERROR: ${it.error}`,
        unit: it.unit,
        formula: it.formula,
      });
    }
  }
  styleHeader(materials);

  const detail = wb.addWorksheet('Detail');
  detail.columns = [
    { header: 'Sheet', key: 'sheet', width: 12 },
    { header: 'Takeoff type', key: 'type', width: 60 },
    { header: 'Quantity', key: 'qty', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Perimeter', key: 'perim', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Sheet scale', key: 'scale', width: 14 },
  ];
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const types = new Map(project.types.map((t) => [t.id, t]));
  const ordered = project.sheets.flatMap((s) => project.measurements.filter((m) => m.sheetId === s.id));
  for (const m of ordered) {
    const sheet = sheets.get(m.sheetId)!;
    const type = types.get(m.typeId);
    if (!type) continue;
    const v = measurementVars(m, type, sheet, project.units);
    detail.addRow({
      sheet: sheet.name,
      type: type.name,
      qty: v ? primaryOf(type.kind, v) : 'not scaled',
      unit: primaryUnit(type.kind, project.units),
      perim: type.kind === 'area' && v ? v.P : null,
      scale: sheet.scaleLabel ?? '',
    });
  }
  styleHeader(detail);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
