/**
 * Reads wall lengths per type and drawing sheet from an estimator's bid workbook
 * (rows with Mark | … | Dwg | … | Measured qty | Unit columns), as the answer key
 * for scoring the automatic wall takeoff.
 */

type Cell = string | number | null | undefined;

export interface WallKeyEntry {
  code: string;
  sheet: string;
  /** Measured centreline length in metres. */
  meters: number;
}

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c)).trim();
const MARK = /^(?:ARCH\s+)?((?:EW|IW|W|FR|FW|CB|PW|SW)\d{1,2}[A-Z]?)$/i;
const FEET = 0.3048;

/** Wall rows of one worksheet: summed per type and sheet. */
export function parseWallRows(rows: Cell[][]): WallKeyEntry[] {
  let cols: { mark: number; dwg: number; qty: number; unit: number } | null = null;
  const sums = new Map<string, WallKeyEntry>();
  for (const row of rows) {
    const cells = row.map(text);
    const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
    const header = { mark: find(/^mark$/i), dwg: find(/^dwg$|^drawing$|^sheet$/i), qty: find(/^measured qty|^quantity$|^qty$/i), unit: find(/^unit$/i) };
    if (header.mark >= 0 && header.dwg >= 0 && header.qty >= 0 && header.unit >= 0) {
      cols = header;
      continue;
    }
    if (!cols) continue;
    const code = MARK.exec(cells[cols.mark] ?? '')?.[1]?.toUpperCase();
    const qty = Number(row[cols.qty]);
    const unit = (cells[cols.unit] ?? '').toUpperCase();
    if (!code || !Number.isFinite(qty) || qty <= 0) continue;
    const meters = unit === 'M' ? qty : unit === 'FT' || unit === 'LF' ? qty * FEET : null;
    if (meters === null) continue;
    for (const sheet of (cells[cols.dwg] ?? '').toUpperCase().match(/\b[A-Z]{1,2}\d\.\d{1,2}\b/g) ?? []) {
      const k = `${code}|${sheet}`;
      const e = sums.get(k) ?? { code, sheet, meters: 0 };
      e.meters += meters;
      sums.set(k, e);
    }
  }
  return [...sums.values()];
}

/**
 * Combines the worksheets. A wall priced in two divisions (framing in one,
 * cladding in another) appears on both tabs, so per type and sheet the largest
 * tab total is kept rather than the sum.
 */
export function combineWallKeys(perTab: WallKeyEntry[][]): WallKeyEntry[] {
  const best = new Map<string, WallKeyEntry>();
  for (const tab of perTab) {
    for (const e of tab) {
      const k = `${e.code}|${e.sheet}`;
      if ((best.get(k)?.meters ?? -1) < e.meters) best.set(k, e);
    }
  }
  return [...best.values()];
}

export async function readWallKey(data: ArrayBuffer): Promise<WallKeyEntry[]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const tabs: WallKeyEntry[][] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: Cell[] = [];
      for (let i = 1; i <= Math.min(ws.columnCount, 30); i++) {
        const v = row.getCell(i).value as unknown;
        cells.push(
          v && typeof v === 'object' && 'richText' in v
            ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('')
            : v && typeof v === 'object' && 'result' in v
              ? ((v as { result: Cell }).result ?? null)
              : (v as Cell),
        );
      }
      rows.push(cells);
    });
    tabs.push(parseWallRows(rows));
  });
  return combineWallKeys(tabs);
}

export interface WallScoreRow {
  code: string;
  expected: number | null;
  got: number | null;
}

/** Per-type comparison for one sheet, plus the summed absolute difference as a share of the key. */
export function scoreWalls(key: WallKeyEntry[], sheet: string, got: Map<string, number>): { rows: WallScoreRow[]; error: number | null } {
  const expected = new Map(key.filter((e) => e.sheet === sheet.toUpperCase()).map((e) => [e.code, e.meters]));
  const codes = [...new Set([...expected.keys(), ...got.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = codes.map((code) => ({ code, expected: expected.get(code) ?? null, got: got.get(code) ?? null }));
  const total = [...expected.values()].reduce((n, v) => n + v, 0);
  const diff = rows.reduce((n, r) => n + Math.abs((r.got ?? 0) - (r.expected ?? 0)), 0);
  return { rows, error: total > 0 ? diff / total : null };
}
