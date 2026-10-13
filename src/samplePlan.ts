import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import type { Units } from './model';

/**
 * A small floor plan drawn the way CAD exports are (vector linework, real text, a title
 * block with its scale), so a new user can try every tool before opening their own set.
 * Five rooms with tags, doors with tags, tagged walls and dimension strings: at 1:100 in
 * millimetres, or in imperial at 1/8" = 1'-0" in feet and inches (the same plan, 60' × 36'-8").
 * A second sheet is its reflected ceiling plan: an ACT grid, a GWB stipple, downlights and
 * a ceiling legend.
 */
export async function samplePlanPdf(units: Units = 'metric'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Takeoff sample plan');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  drawPlan(doc.addPage([W, H]), font, bold, units, false);
  drawPlan(doc.addPage([W, H]), font, bold, units, true);
  return doc.save();
}

const W = 1224;
const H = 792;
/**
 * The plan is laid out in units of one metre (metric) or 3'-4" (imperial, so walls come out
 * 10" and 6", doors 3'-0"). Points per unit: 1 m at 1:100, or 3.333' at 1/8" = 1'-0" (9 pt a foot).
 */
const FT_PER_UNIT = 10 / 3;
/** A length in feet as written on drawings: 18'-4". */
const feetInches = (ft: number) => {
  const inches = Math.round(ft * 12);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
};
const OX = 110;
const OY = 150;
const ink = rgb(0, 0, 0);
const WALL = 0.7;
const THIN = 0.25;

function drawPlan(page: PDFPage, font: PDFFont, bold: PDFFont, units: Units, ceiling: boolean) {
  const metric = units === 'metric';
  const K = metric ? 72 / 0.0254 / 100 : 9 * FT_PER_UNIT;
  const label = (len: number) => (metric ? String(Math.round(len * 1000)) : feetInches(len * FT_PER_UNIT));
  const scale = metric ? '1:100' : '1/8" = 1\'-0"';
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
  if (!ceiling) {
    for (const [d0] of doorsAt) {
      swing(6 + p, d0, 1);
      swing(12 - p, d0, -1);
    }
    // Entry: a pair of leaves swinging out.
    line(entry[0], 11 + t, entry[0], 11 + t + 0.9, THIN);
    line(entry[1], 11 + t, entry[1], 11 + t + 0.9, THIN);
  }

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
  for (const [num, x, y] of ceiling ? [] : doorTags) {
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
  if (!ceiling) {
    wallTag('W1', 4.3, 1.1, 6 - p);
    wallTag('W1', 13.7, 9.9, 12 + p);
    wallTag('W1', 3.2, 4.4, 1.2);
    wallTag('EW1', -1.7, 3.2, -t);
    // The leader for the third tag ends on the 5.5 m partition: turn it down to it.
    page.drawLine({ start: { x: px(1.2), y: py(4.4) }, end: { x: px(1.2), y: py(5.5 - p) }, thickness: THIN, color: ink });
  }

  if (ceiling) {
    const GRID = 0.18;
    // ACT: a 2×4 grid (1.2 × 0.6) in the offices and the meeting room.
    const act = (x0: number, y0: number, x1: number, y1: number) => {
      for (let x = x0 + 0.5; x < x1; x += 1.2) line(x, y0, x, y1, GRID);
      for (let y = y0 + 0.3; y < y1; y += 0.6) line(x0, y, x1, y, GRID);
    };
    act(t, t, 6 - p, 5.5 - p);
    act(t, 5.5 + p, 6 - p, 11 - t);
    act(12 + p, t, 18 - t, 5.5 - p);
    // GWB: a stipple of dots in the lobby and storage, placed on a jittered grid.
    const dot = (x: number, y: number) =>
      page.drawLine({ start: { x, y }, end: { x, y }, thickness: 0.9, color: ink, lineCap: LineCapStyle.Round });
    const stipple = (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0 + 0.2; y < y1 - 0.1; y += 0.35)
        for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.35) {
          n++;
          // A fixed scatter: the same sample every time.
          dot(px(x + 0.12 * Math.sin(n * 12.9898)), py(y + 0.12 * Math.cos(n * 78.233)));
        }
    };
    stipple(6 + p, t, 12 - p, 11 - t);
    stipple(12 + p, 5.5 + p, 18 - t, 11 - t);
    // Downlights: a circle with a cross, one block repeated.
    const light = (x: number, y: number) => {
      page.drawCircle({ x, y, size: 4.5, borderColor: ink, borderWidth: THIN });
      page.drawLine({ start: { x: x - 3, y }, end: { x: x + 3, y }, thickness: THIN, color: ink });
      page.drawLine({ start: { x, y: y - 3 }, end: { x, y: y + 3 }, thickness: THIN, color: ink });
    };
    const lights: [number, number][] = [
      [7.5, 1.5], [10.5, 1.5], [7.5, 6.5], [10.5, 6.5], [7.5, 9], [10.5, 9], [7.5, 3.4], [10.5, 3.4],
      [1.7, 1.4], [4.1, 1.4], [1.7, 4.1], [4.1, 4.1],
      [1.7, 6.9], [4.1, 6.9], [1.7, 9.6], [4.1, 9.6],
      [13.7, 1.4], [16.1, 1.4], [13.7, 4.1], [16.1, 4.1],
      [13.7, 8.2], [16.1, 8.2],
    ];
    for (const [x, y] of lights) light(px(x), py(y));

    // Ceiling legend, between the plan and the title block (in sheet points).
    const lx = 745;
    let ly = H - 210;
    page.drawText('CEILING LEGEND:', { x: lx, y: ly, size: 8, font: bold, color: ink });
    const swatch = (fill: (x0: number, y0: number, x1: number, y1: number) => void) => {
      const [x0, y0, x1, y1] = [lx, ly - 7, lx + 34, ly + 7];
      page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, borderColor: ink, borderWidth: THIN });
      fill(x0, y0, x1, y1);
    };
    const row = (label: string) => page.drawText(label, { x: lx + 50, y: ly - 2.5, size: 6.5, font, color: ink });
    ly -= 26;
    swatch((x0, y0, x1, y1) => {
      page.drawLine({ start: { x: (x0 + x1) / 2, y: y0 }, end: { x: (x0 + x1) / 2, y: y1 }, thickness: GRID, color: ink });
      page.drawLine({ start: { x: x0, y: (y0 + y1) / 2 }, end: { x: x1, y: (y0 + y1) / 2 }, thickness: GRID, color: ink });
    });
    row('ACT-1 ACOUSTIC TILE, 2X4 GRID');
    ly -= 26;
    swatch((x0, y0, x1, y1) => {
      for (let y = y0 + 2.5; y < y1 - 1; y += 3) for (let x = x0 + 2.5; x < x1 - 1; x += 3) dot(x + ((x * 7 + y * 3) % 2) - 0.5, y);
    });
    row('GWB-1 PAINTED GYPSUM BOARD');
    ly -= 26;
    light(lx + 17, ly);
    row('DOWNLIGHT');
  }

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
    dim(0, 6, y, label(6));
    dim(6, 12, y, label(6));
    dim(12, 18, y, label(6));
  }
  dim(0, 18, -2.2, label(18));
  dim(0, 18, 13.9, label(18));
  // Vertical dimensions on the right.
  const vdim = (y1: number, y2: number, x: number, label: string) => {
    line(x, y1, x, y2, THIN);
    for (const y of [y1, y2]) line(x - 0.25, y, x + 0.25, y, THIN);
    text(label, x - 0.22, (y1 + y2) / 2, 6, font, 90);
  };
  vdim(0, 5.5, 19.4, label(5.5));
  vdim(5.5, 11, 19.4, label(5.5));
  vdim(0, 11, 20.4, label(11));

  // Plan title.
  page.drawText(ceiling ? 'REFLECTED CEILING PLAN' : 'FLOOR PLAN', { x: px(0), y: py(15.4), size: 11, font: bold, color: ink });
  page.drawText(scale, { x: px(0), y: py(15.4) - 13, size: 8, font, color: ink });

  // Title block along the right edge.
  const tb = 0.74 * W;
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: ink, borderWidth: 1 });
  page.drawLine({ start: { x: tb, y: 24 }, end: { x: tb, y: H - 24 }, thickness: 1, color: ink });
  const tx = tb + 16;
  page.drawText('TAKEOFF SAMPLE PROJECT', { x: tx, y: H - 70, size: 12, font: bold, color: ink });
  page.drawText('A sample drawing for trying the app.', { x: tx, y: H - 88, size: 8, font, color: ink });
  page.drawText('Not a real building.', { x: tx, y: H - 100, size: 8, font, color: ink });
  page.drawText(ceiling ? 'SAMPLE CEILING PLAN' : 'SAMPLE FLOOR PLAN', { x: tx, y: 150, size: 11, font: bold, color: ink });
  page.drawText(`SCALE: ${scale}`, { x: tx, y: 132, size: 9, font, color: ink });
  page.drawText(ceiling ? 'A2.01' : 'A1.01', { x: tx, y: 60, size: 30, font: bold, color: ink });
}
