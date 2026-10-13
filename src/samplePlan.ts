import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

/**
 * A small floor plan drawn the way CAD exports are (vector linework, real text, a title
 * block with its scale), so a new user can try every tool before opening their own set.
 * Five rooms with tags, doors with tags, tagged walls and dimension strings at 1:100.
 */
export async function samplePlanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Takeoff sample plan');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([1224, 792]);
  drawPlan(page, font, bold);
  return doc.save();
}

const W = 1224;
const H = 792;
/** Points per metre at 1:100. */
const K = 72 / 0.0254 / 100;
const OX = 110;
const OY = 150;
const ink = rgb(0, 0, 0);
const WALL = 0.7;
const THIN = 0.25;

function drawPlan(page: PDFPage, font: PDFFont, bold: PDFFont) {
  // Plan metres to PDF points (PDF y runs up from the bottom).
  const px = (x: number) => OX + x * K;
  const py = (y: number) => H - (OY + y * K);
  const line = (x1: number, y1: number, x2: number, y2: number, thickness = WALL) =>
    page.drawLine({ start: { x: px(x1), y: py(y1) }, end: { x: px(x2), y: py(y2) }, thickness, color: ink });
  /** A straight wall face from `a` to `b` along a fixed x or y, skipping the gaps. */
  const face = (vertical: boolean, at: number, a: number, b: number, gaps: [number, number][] = []) => {
    let from = a;
    for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (g0 > from) (vertical ? line(at, from, at, g0) : line(from, at, g0, at));
      from = Math.max(from, g1);
    }
    if (b > from) (vertical ? line(at, from, at, b) : line(from, at, b, at));
  };
  const text = (str: string, x: number, y: number, size: number, f = font, rotate = 0) => {
    const w = f.widthOfTextAtSize(str, size);
    // Centred on (x, y) in plan metres.
    if (rotate) page.drawText(str, { x: px(x) + size * 0.35, y: py(y) - w / 2, size, font: f, color: ink, rotate: degrees(rotate) });
    else page.drawText(str, { x: px(x) - w / 2, y: py(y) - size * 0.35, size, font: f, color: ink });
  };

  // Exterior walls, 250 thick, centred on 0–18 × 0–11, with the entry at the bottom.
  const t = 0.125;
  const entry: [number, number] = [8.1, 9.9];
  face(false, -t, -t, 18 + t);
  face(false, 11 + t, -t, 18 + t, [entry]);
  face(true, -t, -t, 11 + t);
  face(true, 18 + t, -t, 11 + t);
  // Inside faces, open where partitions meet them.
  const p = 0.075;
  face(false, t, t, 18 - t, [
    [6 - p, 6 + p],
    [12 - p, 12 + p],
  ]);
  face(false, 11 - t, t, 18 - t, [[6 - p, 6 + p], [12 - p, 12 + p], entry]);
  face(true, t, t, 11 - t, [[5.5 - p, 5.5 + p]]);
  face(true, 18 - t, t, 11 - t, [[5.5 - p, 5.5 + p]]);
  for (const x of entry) line(x, 11 - t, x, 11 + t);

  // Partitions, 150 thick: two across the building, and one splitting each side.
  const doorsAt: [number, number][] = [
    [2, 2.9],
    [7.5, 8.4],
  ];
  for (const x of [6, 12]) {
    const outer = x === 6 ? x - p : x + p;
    const inner = x === 6 ? x + p : x - p;
    face(true, outer, t, 11 - t, [...doorsAt, [5.5 - p, 5.5 + p]]);
    face(true, inner, t, 11 - t, doorsAt);
    for (const [d0, d1] of doorsAt) {
      line(x - p, d0, x + p, d0);
      line(x - p, d1, x + p, d1);
    }
  }
  face(false, 5.5 - p, t, 6 - p);
  face(false, 5.5 + p, t, 6 - p);
  face(false, 5.5 - p, 12 + p, 18 - t);
  face(false, 5.5 + p, 12 + p, 18 - t);

  // Doors: leaf and swing into the lobby, in a thin pen.
  const swing = (hx: number, hy: number, dir: 1 | -1) => {
    line(hx, hy, hx + 0.9 * dir, hy, THIN);
    const r = 0.9 * K;
    const cx = px(hx);
    const cy = py(hy);
    // Quarter arc from the leaf's end to the opening's far jamb (SVG y runs down from the origin).
    page.drawSvgPath(`M ${(dir * r).toFixed(2)} 0 A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${dir === 1 ? 1 : 0} 0 ${r.toFixed(2)}`, {
      x: cx,
      y: cy,
      borderColor: ink,
      borderWidth: THIN,
    });
  };
  for (const [d0] of doorsAt) {
    swing(6 + p, d0, 1);
    swing(12 - p, d0, -1);
  }
  // Entry: a pair of leaves swinging out.
  line(entry[0], 11 + t, entry[0], 11 + t + 0.9, THIN);
  line(entry[1], 11 + t, entry[1], 11 + t + 0.9, THIN);

  // Room tags: the name over its number in a box.
  const rooms: [string, string, number, number][] = [
    ['LOBBY', '101', 9, 4.2],
    ['OFFICE', '102', 3, 2.75],
    ['OFFICE', '103', 3, 8.25],
    ['MEETING ROOM', '104', 15, 2.75],
    ['STORAGE', '105', 15, 8.25],
  ];
  for (const [name, num, x, y] of rooms) {
    text(name, x, y - 0.45, 7);
    page.drawRectangle({ x: px(x) - 12, y: py(y + 0.05) - 6, width: 24, height: 12, borderColor: ink, borderWidth: THIN });
    text(num, x, y + 0.05, 7);
  }

  // Door tags: the number in an oval beside each door.
  const doorTags: [string, number, number][] = [
    ['102', 7.1, 3.4],
    ['103', 7.1, 8.9],
    ['104', 10.9, 3.4],
    ['105', 10.9, 8.9],
    ['101', 9, 12.1],
  ];
  for (const [num, x, y] of doorTags) {
    page.drawEllipse({ x: px(x), y: py(y), xScale: 11, yScale: 7, borderColor: ink, borderWidth: THIN });
    text(num, x, y, 6);
  }

  // Wall tags: the type in a diamond, with a leader to the wall.
  const wallTag = (tag: string, x: number, y: number, toX: number) => {
    const r = 10;
    const cx = px(x);
    const cy = py(y);
    const pts: [number, number][] = [
      [cx, cy + r],
      [cx + r, cy],
      [cx, cy - r],
      [cx - r, cy],
    ];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % 4];
      page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: THIN, color: ink });
    });
    const side = toX > x ? r : -r;
    page.drawLine({ start: { x: cx + side, y: cy }, end: { x: px(toX), y: cy }, thickness: THIN, color: ink });
    text(tag, x, y, 6);
  };
  wallTag('W1', 4.3, 1.1, 6 - p);
  wallTag('W1', 13.7, 9.9, 12 + p);
  wallTag('W1', 3.2, 4.4, 1.2);
  wallTag('EW1', -1.7, 3.2, -t);
  // The leader for the third tag ends on the 5.5 m partition: turn it down to it.
  page.drawLine({ start: { x: px(1.2), y: py(4.4) }, end: { x: px(1.2), y: py(5.5 - p) }, thickness: THIN, color: ink });

  // Dimension strings in millimetres: one line per dimension, ticks at the ends.
  const dim = (x1: number, x2: number, y: number, label: string) => {
    line(x1, y, x2, y, THIN);
    for (const x of [x1, x2]) {
      line(x - 0.12, y + 0.12, x + 0.12, y - 0.12, THIN);
      line(x, y - 0.25, x, y + 0.25, THIN);
    }
    text(label, (x1 + x2) / 2, y - 0.22, 6);
  };
  for (const y of [-1.2, 12.9]) {
    dim(0, 6, y, '6000');
    dim(6, 12, y, '6000');
    dim(12, 18, y, '6000');
  }
  dim(0, 18, -2.2, '18000');
  dim(0, 18, 13.9, '18000');
  // Vertical dimensions on the right.
  const vdim = (y1: number, y2: number, x: number, label: string) => {
    line(x, y1, x, y2, THIN);
    for (const y of [y1, y2]) line(x - 0.25, y, x + 0.25, y, THIN);
    text(label, x - 0.22, (y1 + y2) / 2, 6, font, 90);
  };
  vdim(0, 5.5, 19.4, '5500');
  vdim(5.5, 11, 19.4, '5500');
  vdim(0, 11, 20.4, '11000');

  // Plan title.
  page.drawText('FLOOR PLAN', { x: px(0), y: py(15.4), size: 11, font: bold, color: ink });
  page.drawText('1:100', { x: px(0), y: py(15.4) - 13, size: 8, font, color: ink });

  // Title block along the right edge.
  const tb = 0.74 * W;
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: ink, borderWidth: 1 });
  page.drawLine({ start: { x: tb, y: 24 }, end: { x: tb, y: H - 24 }, thickness: 1, color: ink });
  const tx = tb + 16;
  page.drawText('TAKEOFF SAMPLE PROJECT', { x: tx, y: H - 70, size: 12, font: bold, color: ink });
  page.drawText('A sample drawing for trying the app.', { x: tx, y: H - 88, size: 8, font, color: ink });
  page.drawText('Not a real building.', { x: tx, y: H - 100, size: 8, font, color: ink });
  page.drawText('SAMPLE FLOOR PLAN', { x: tx, y: 150, size: 11, font: bold, color: ink });
  page.drawText('SCALE: 1:100', { x: tx, y: 132, size: 9, font, color: ink });
  page.drawText('A1.01', { x: tx, y: 60, size: 30, font: bold, color: ink });
}
