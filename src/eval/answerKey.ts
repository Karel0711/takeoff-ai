/**
 * Reads an estimator's hand-transcribed assembly schedule (a table headed
 * Type | Design / assembly name | Construction | Notes) as the answer key for
 * scoring AI legend reading.
 */

export type Category = 'interior_wall' | 'exterior_wall' | 'floor' | 'roof' | 'ceiling' | 'other';

export interface ExpectedAssembly {
  /** Tag as printed on the drawing, e.g. "W1" ("R1 (opt 1)" becomes "R1"). */
  code: string;
  /** The tag as written in the workbook, e.g. "R1 (opt 1)". */
  label: string;
  title: string;
  layers: string[];
  notes: string;
  /** Drawing sheet the section came from, e.g. "A0.3", when the section heading names one. */
  sheet: string | null;
  category: Category;
  /** Overall thickness in mm, when the notes give one ("Overall 125"). */
  overallMm: number | null;
}

type Cell = string | number | null | undefined;

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c)).trim();

function categoryOf(heading: string): Category {
  const h = heading.toUpperCase();
  if (h.includes('EXTERIOR WALL')) return 'exterior_wall';
  if (h.includes('INTERIOR WALL') || h.includes('PARTITION')) return 'interior_wall';
  if (h.includes('FLOOR')) return 'floor';
  if (h.includes('ROOF')) return 'roof';
  if (h.includes('CEILING')) return 'ceiling';
  return 'other';
}

const sheetOf = (heading: string) => /\b([A-Z]{1,2}\d\.\d{1,2})\b/.exec(heading.toUpperCase())?.[1] ?? null;

/** Splits a construction cell into layers: bullet-separated, or one layer per line. */
export function splitLayers(construction: string): string[] {
  const parts = construction.includes('•') ? construction.split('•') : construction.split(/\n+/);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * Parses one worksheet given as rows of cells. Returns nothing if it holds no schedule table.
 * `tabName` labels sections whose heading names no sheet, when the tab names exactly one.
 */
export function parseScheduleRows(rows: Cell[][], tabName = ''): ExpectedAssembly[] {
  const tabSheets = tabName.toUpperCase().match(/\b[A-Z]{1,2}\d\.\d{1,2}\b/g) ?? [];
  const tabSheet = tabSheets.length === 1 ? tabSheets[0] : null;
  const out: ExpectedAssembly[] = [];
  let heading = '';
  let inTable = false;
  for (const row of rows) {
    const [a, b, c, d] = [text(row[0]), text(row[1]), text(row[2]), text(row[3])];
    if (!a && !b && !c) continue;
    if (/^type$/i.test(a) && /construction/i.test(c)) {
      inTable = true;
      continue;
    }
    // A row with only a first cell is a section heading ("INTERIOR WALL TYPES - A0.3").
    if (a && !b && !c && !d) {
      heading = a;
      inTable = false;
      continue;
    }
    if (!inTable || !a) continue;
    const code = /^([A-Z]{1,3}\d{1,2}[A-Z]?)/.exec(a.toUpperCase())?.[1];
    if (!code) continue;
    const overall = /overall\s*(?:\+\/-|±)?\s*(\d{2,4})/i.exec(d);
    out.push({
      code,
      label: a,
      title: b,
      layers: splitLayers(c),
      notes: d,
      sheet: sheetOf(heading) ?? sheetOf(b) ?? tabSheet,
      category: categoryOf(heading),
      overallMm: overall ? Number(overall[1]) : null,
    });
  }
  return out;
}

/** Reads every schedule table in an .xlsx workbook. */
export async function readAnswerKey(data: ArrayBuffer): Promise<ExpectedAssembly[]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const all: ExpectedAssembly[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: Cell[] = [];
      for (let i = 1; i <= 4; i++) {
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
    all.push(...parseScheduleRows(rows, ws.name));
  });
  return all;
}
