import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Project, Pt, Sheet } from './model';
import { measurementVars, primaryOf, primaryUnit, typeTotals } from './quantities';
import { formatQty } from './units';

/** Maps PDF user space to sheet points: pdf.js's viewport transform at scale 1. */
export type ViewportTransform = number[];

export interface MarkupSource {
  /** The drawing file's bytes. */
  loadBytes: (docId: string) => Promise<ArrayBuffer | undefined>;
  /** The sheet's viewport transform at scale 1 (`page.getViewport({ scale: 1 }).transform`). */
  transformOf: (sheet: Sheet) => Promise<ViewportTransform | undefined>;
  /**
   * The sheet as a JPEG, upright, for drawings whose pages can't be copied (an encrypted
   * file: pdf-lib can't decrypt it, and copying would carry the scrambled content across).
   */
  renderJpeg?: (sheet: Sheet) => Promise<Uint8Array | undefined>;
}

const hex = (c: string) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c);
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0.2, 0.4, 0.9);
};

const centroid = (pts: Pt[]): Pt => [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length];

/** Signed area in a y-down frame: positive runs clockwise on screen. */
const signedArea = (pts: Pt[]) => pts.reduce((n, p, i) => n + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;

/** Sheet point to PDF user space (the inverse of the viewport transform). */
export function toUser([a, b, c, d, e, f]: ViewportTransform, [x, y]: Pt): Pt {
  const det = a * d - b * c;
  return [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
}

/** Keeps the characters the standard font can draw. */
export function safeText(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    // Locale number spacing (narrow and non-breaking spaces) as a plain space.
    if (ch === '\u202f' || ch === '\u00a0' || ch === '\u2009') {
      out += ' ';
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch === '−' ? '-' : '';
    }
  }
  return out;
}

/**
 * The drawings with their takeoffs drawn over them, in vector, after a summary page
 * listing each type's total and what each sheet carries: for a quote or a review.
 * Only sheets with takeoffs are included; the drawing pages stay as they were drawn.
 */
export async function markupPdf(project: Project, source: MarkupSource): Promise<{ bytes: Uint8Array; sheets: number; missing: string[] }> {
  const out = await PDFDocument.create();
  out.setTitle(`${project.name} – takeoff`);
  out.setCreator('Takeoff');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const types = new Map(project.types.map((t) => [t.id, t]));
  const withTakeoffs = project.sheets.filter((s) => project.measurements.some((m) => m.sheetId === s.id && types.has(m.typeId)));

  const missing: string[] = [];
  // Pages copy one document at a time, all of its sheets in one call, so resources the
  // sheets share (title block images, fonts) are copied once.
  const copied = new Map<string, PDFPage>();
  for (const docId of new Set(withTakeoffs.map((s) => s.docId))) {
    const data = await source.loadBytes(docId);
    const doc = data ? await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false }) : null;
    if (!doc || doc.isEncrypted) continue;
    const sheets = withTakeoffs.filter((s) => s.docId === docId && s.page >= 1 && s.page <= doc.getPageCount());
    const pages = await out.copyPages(doc, sheets.map((s) => s.page - 1));
    sheets.forEach((s, i) => copied.set(s.id, pages[i]));
  }
  const placed: { sheet: Sheet; page: PDFPage; transform: ViewportTransform }[] = [];
  for (const sheet of withTakeoffs) {
    const page = copied.get(sheet.id);
    const transform = page && (await source.transformOf(sheet));
    if (page && transform) {
      out.addPage(page);
      placed.push({ sheet, page, transform });
      continue;
    }
    // Not copyable: the sheet as an image, in sheet space (y down from the top).
    const jpeg = !page ? await source.renderJpeg?.(sheet) : undefined;
    if (jpeg) {
      const img = await out.embedJpg(jpeg);
      const flat = out.addPage([sheet.width, sheet.height]);
      flat.drawImage(img, { x: 0, y: 0, width: sheet.width, height: sheet.height });
      placed.push({ sheet, page: flat, transform: [1, 0, 0, -1, 0, sheet.height] });
      continue;
    }
    missing.push(sheet.name);
  }

  for (const { sheet, page, transform } of placed) drawTakeoffs(project, sheet, page, transform, font, bold);
  drawCover(project, out, placed.map((p) => p.sheet), font, bold);
  return { bytes: await out.save(), sheets: placed.length, missing };
}

function drawTakeoffs(project: Project, sheet: Sheet, page: PDFPage, transform: ViewportTransform, font: PDFFont, bold: PDFFont) {
  const types = new Map(project.types.map((t) => [t.id, t]));
  const user = (p: Pt) => toUser(transform, p);
  // drawSvgPath draws y-up from its origin: a user-space point (x, y) is (x, -y) in the path.
  const path = (pts: Pt[], close: boolean) =>
    pts.map((p, i) => {
      const [x, y] = user(p);
      return `${i ? 'L' : 'M'}${x.toFixed(2)} ${(-y).toFixed(2)}`;
    }).join(' ') + (close ? ' Z' : '');
  const rotate = degrees(page.getRotation().angle);
  const labels: { at: Pt; text: string }[] = [];

  for (const m of project.measurements) {
    if (m.sheetId !== sheet.id) continue;
    const type = types.get(m.typeId);
    if (!type || !m.points.length) continue;
    const color = hex(type.color);
    if (type.kind === 'count') {
      const [x, y] = user(m.points[0]);
      // See-through, so the tag or symbol under it still reads.
      page.drawCircle({ x, y, size: 6, color, opacity: 0.3, borderColor: color, borderWidth: 1.5, borderOpacity: 0.95 });
    } else if (type.kind === 'linear') {
      if (m.points.length < 2) continue;
      page.drawSvgPath(path(m.points, false), { x: 0, y: 0, borderColor: color, borderWidth: 2.5, borderOpacity: 0.8, borderLineCap: 1 });
    } else {
      if (m.points.length < 3) continue;
      // Non-zero fill: the outline one way round and its holes the other.
      const cw = (pts: Pt[], want: boolean) => ((signedArea(pts) > 0) === want ? pts : [...pts].reverse());
      const d = [path(cw(m.points, true), true), ...m.holes.filter((h) => h.length > 2).map((h) => path(cw(h, false), true))].join(' ');
      page.drawSvgPath(d, { x: 0, y: 0, color, opacity: 0.25, borderColor: color, borderWidth: 1, borderOpacity: 0.9 });
      const v = measurementVars(m, type, sheet, project.units);
      const qty = v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, project.units)}` : '';
      const text = m.label ? `${m.label.split(' ')[0]} · ${qty}` : qty;
      if (text.trim()) labels.push({ at: centroid(m.points), text });
    }
  }

  // Labels on top, on a white tab so they read over the linework.
  const size = 7;
  for (const l of labels) {
    const text = safeText(bold, l.text);
    if (!text) continue;
    const w = bold.widthOfTextAtSize(text, size);
    // Centre the text on its point in sheet (screen) space, then map the corner across.
    const [x, y] = user([l.at[0] - w / 2, l.at[1] + size * 0.35]);
    const [bx, by] = user([l.at[0] - w / 2 - 2, l.at[1] + size * 0.7]);
    page.drawRectangle({ x: bx, y: by, width: w + 4, height: size * 1.4, color: rgb(1, 1, 1), opacity: 0.8, rotate });
    page.drawText(text, { x, y, size, font: bold, color: rgb(0.07, 0.07, 0.07), rotate });
  }

  // The sheet's legend along the top edge, inside the margin.
  const totals = typeTotals({ ...project, measurements: project.measurements.filter((m) => m.sheetId === sheet.id) }).filter((t) => t.vars.N > 0 || t.unscaled > 0);
  const fs = 9;
  let cx = 18;
  let top = 16;
  if (sheet.repeat && sheet.repeat > 1) {
    const text = `Totals count this sheet ×${sheet.repeat}:`;
    const [tx, ty] = user([cx, top + 2]);
    page.drawText(text, { x: tx, y: ty, size: fs, font: bold, color: rgb(0.1, 0.1, 0.1), rotate });
    cx += bold.widthOfTextAtSize(text, fs) + 10;
  }
  for (const t of totals) {
    const text = safeText(font, `${t.type.name}  ${t.unscaled ? 'no scale' : `${formatQty(t.primary)} ${t.unit}`}`);
    const w = font.widthOfTextAtSize(text, fs) + 26;
    if (cx + w > sheet.width - 18 && cx > 18) {
      cx = 18;
      top += fs + 5;
    }
    const [sx, sy] = user([cx, top + 3]);
    page.drawRectangle({ x: sx, y: sy, width: 9, height: 9, color: hex(t.type.color), rotate });
    const [tx, ty] = user([cx + 13, top + 2]);
    page.drawText(text, { x: tx, y: ty, size: fs, font, color: rgb(0.1, 0.1, 0.1), rotate });
    cx += w;
  }
}

/** The summary pages, inserted at the front: type totals, then the sheets included. */
function drawCover(project: Project, out: PDFDocument, sheets: Sheet[], font: PDFFont, bold: PDFFont) {
  const [width, height] = [792, 612];
  let pages = 0;
  let page = out.insertPage(pages++, [width, height]);
  const more = () => {
    page = out.insertPage(pages++, [width, height]);
    y = height - 56;
  };
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  let y = height - 56;
  page.drawText(safeText(bold, project.name || 'Takeoff'), { x: 48, y, size: 22, font: bold, color: ink });
  y -= 22;
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  page.drawText(safeText(font, `Takeoff summary · ${date} · ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} with takeoffs`), { x: 48, y, size: 10, font, color: muted });
  y -= 30;

  const totals = typeTotals(project).filter((t) => t.vars.N > 0 || t.unscaled > 0);
  const col = (x: number, text: string, f = font, size = 10, color = ink, right = false) =>
    page.drawText(text, { x: right ? x - f.widthOfTextAtSize(text, size) : x, y, size, font: f, color });
  col(48, 'Type', bold, 9, muted);
  col(520, 'Quantity', bold, 9, muted, true);
  col(530, 'Unit', bold, 9, muted);
  col(580, 'Not counted', bold, 9, muted);
  y -= 6;
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
  y -= 16;
  for (const t of totals) {
    if (y < 60) more();
    page.drawRectangle({ x: 48, y: y - 1, width: 9, height: 9, color: hex(t.type.color) });
    const name = safeText(font, t.type.name);
    let shown = name;
    while (shown.length > 4 && font.widthOfTextAtSize(shown, 10) > 440) shown = shown.slice(0, -2);
    col(64, shown === name ? name : `${shown.trimEnd()}...`);
    col(520, safeText(bold, formatQty(t.primary)), bold, 10, ink, true);
    col(530, safeText(font, t.unit));
    if (t.unscaled) col(580, `${t.unscaled} on sheets without a scale`, font, 9, rgb(0.75, 0.4, 0.05));
    y -= 18;
  }

  y -= 14;
  if (y < 90) more();
  {
    col(48, 'Sheets', bold, 9, muted);
    y -= 16;
    const names = sheets.map((s) => s.name);
    let line = '';
    for (const n of names) {
      const next = line ? `${line}   ${n}` : n;
      if (font.widthOfTextAtSize(safeText(font, next), 10) > width - 96) {
        col(48, safeText(font, line));
        y -= 15;
        if (y < 48) more();
        line = n;
      } else line = next;
    }
    if (line) col(48, safeText(font, line));
  }
}
